// Four smaller defects found while tracing the cross-week data loss.
//
//   1. A reset triggered from another device wiped only localStorage, but week
//      records live in IndexedDB — so it discarded nothing.
//   2. validateAndRepair dropped unreachable nodes silently, the one remaining
//      way a node can leave the data with no tombstone and no trace.
//   3. The pull that runs immediately before an upload was conditional, so a
//      cached ETag could answer it with 304 and skip the merge it exists for.
//   4. The poll only looked at weeks whose Drive file id was already cached, so
//      a week another device created stayed invisible until the next sign-in.
import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  _state, validateAndRepair, syncWeekToDrive, syncWeekFromDrive, pollDriveMeta,
} from './setup.js';

const mkBranch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });

const mkNode = (id, parent, extra = {}) => ({
  id, type: 'activity', parent, branch: 'work', label: id,
  children: [], done: false, _ts: 100, ...extra,
});

describe('validateAndRepair announces what it garbage-collects', () => {
  test('warns, naming every dropped node', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 'ghost' names its parent but the parent does not list it as a child, so it
    // is unreachable from any branch — exactly the shape a mis-wired cross-week
    // copy has, and previously deleted without a word.
    validateAndRepair({
      nodes: [mkBranch('work', ['a']), mkNode('a', 'work'), mkNode('ghost', 'work')],
      tombstones: [],
    });
    expect(warn).toHaveBeenCalled();
    const [msg, detail] = warn.mock.calls.at(-1);
    expect(msg).toContain('dropped 1 unreachable node');
    expect(detail).toEqual([{ id: 'ghost', type: 'activity', label: 'ghost', parent: 'work' }]);
    warn.mockRestore();
  });

  test('stays quiet when nothing is dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateAndRepair({ nodes: [mkBranch('work', ['a']), mkNode('a', 'work')], tombstones: [] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('reset from another device clears IndexedDB too', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
  });

  test('week records and the settings blob are deleted, keep-list survives', async () => {
    await _state.saveWeekIDB('2026-30', { nodes: [mkBranch('work', ['a']), mkNode('a', 'work')], tombstones: [] });
    await _state.saveWeekIDB('2026-31', { nodes: [mkBranch('work')], tombstones: [] });
    await _state.saveValueIDB('zenit-week-colors', { work: { main: '#fff' } });
    await _state.saveValueIDB('zenit-week-import-pending', '1');
    _state.setLocalStorage('zenit-week-theme', 'dark');
    _state.setLocalStorage('zenit-week-storage-migrated', '1');
    _state.setLocalStorage('zenit-week-google-auth', { hasSession: true });

    await _state.handleResetTokenMismatch('fresh-token');

    expect(await _state.loadWeekIDB('2026-30')).toBeNull();
    expect(await _state.loadWeekIDB('2026-31')).toBeNull();
    expect(await _state.loadValueIDB('zenit-week-colors')).toBeNull();
    expect(await _state.loadValueIDB('zenit-week-import-pending')).toBeNull();

    // Adopted so the reset does not loop; migration marker and auth kept.
    expect(_state.getLocalStorage('zenit-week-reset-token')).toBe('fresh-token');
    expect(_state.getLocalStorage('zenit-week-storage-migrated')).toBeTruthy();
    expect(_state.getLocalStorage('zenit-week-google-auth')).toBeTruthy();
    // User data in localStorage is discarded.
    expect(_state.getLocalStorage('zenit-week-theme')).toBeUndefined();
  });

  test('the undo stack is dropped so it cannot rewrite the discarded data', async () => {
    _state.setWeekKey('2026-30');
    _state.set({ nodes: [mkBranch('work', ['a']), mkNode('a', 'work')], tombstones: [] });
    _state.setNextWeekRawCache(null);
    _state.takeSnapshot();
    expect(_state.getUndoStack()).toHaveLength(1);

    await _state.handleResetTokenMismatch('fresh-token');
    expect(_state.getUndoStack()).toHaveLength(0);
  });
});

describe('Drive request shape', () => {
  const seen = [];
  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files', ({ request }) => {
      const url = new URL(request.url);
      const q = url.searchParams.get('q');
      if (q?.includes("'zenit-week-2026-40.json'")) {
        seen.push({ kind: 'search', q });
        return HttpResponse.json({ files: [{ id: 'file_40' }] });
      }
      if (q?.includes("'zenit-week-2026-41.json'")) {
        seen.push({ kind: 'search', q });
        return HttpResponse.json({ files: [] }); // no such week in Drive
      }
      return HttpResponse.json({ files: [] });
    }),
    http.get('https://www.googleapis.com/drive/v3/files/:id', ({ request, params }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('alt') === 'media') {
        seen.push({ kind: 'download', id: params.id, ifNoneMatch: request.headers.get('if-none-match') });
        return new HttpResponse(
          JSON.stringify({ nodes: [mkBranch('work')], tombstones: [], savedAt: 5 }),
          { headers: { ETag: 'etag-v1' } }
        );
      }
      seen.push({ kind: 'meta', id: params.id });
      return HttpResponse.json({ appProperties: { contentHash: 'remote-hash' } });
    }),
    http.patch('https://www.googleapis.com/upload/drive/v3/files/:id', () => HttpResponse.json({ id: 'ok' })),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());
  beforeEach(() => {
    seen.length = 0;
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
    _state.setAccessToken('test-token');
  });
  afterEach(() => _state.setAccessToken(null));

  test('the pull before an upload ignores a cached ETag', async () => {
    await _state.saveWeekIDB('2026-40', { nodes: [mkBranch('work')], tombstones: [], savedAt: 1 });

    // A poll-style pull caches the ETag …
    await syncWeekFromDrive('2026-40');
    expect(seen.filter(s => s.kind === 'download')).toHaveLength(1);

    // … and a second poll-style pull sends it back, as intended for polling.
    await syncWeekFromDrive('2026-40');
    expect(seen.filter(s => s.kind === 'download').at(-1).ifNoneMatch).toBe('etag-v1');

    // The pull that guards an upload must not: it has to see the real remote.
    await syncWeekToDrive('2026-40');
    expect(seen.filter(s => s.kind === 'download').at(-1).ifNoneMatch).toBeNull();
  });

  test('the poll finds a week it has never fetched', async () => {
    await pollDriveMeta('2026-40');
    // The id was not cached, so the poll had to look it up before reading metadata.
    expect(seen.some(s => s.kind === 'search')).toBe(true);
    expect(seen.some(s => s.kind === 'meta' && s.id === 'file_40')).toBe(true);
  });

  test('a week with no Drive file is not searched again every cycle', async () => {
    await pollDriveMeta('2026-41');
    const first = seen.filter(s => s.kind === 'search').length;
    expect(first).toBeGreaterThan(0);

    seen.length = 0;
    await pollDriveMeta('2026-41');
    await pollDriveMeta('2026-41');
    // Misses are rate-limited, so repeat cycles cost nothing for that key.
    expect(seen.filter(s => s.kind === 'search' && s.q.includes('2026-41'))).toHaveLength(0);
  });
});
