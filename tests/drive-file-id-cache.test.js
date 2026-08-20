// Sign-in used to spend a full round trip turning the current week's file name
// into a Drive file id before it could ask for the content. The ids are stable
// per account, so they are kept across sessions — which only works if a stale
// one (file deleted elsewhere, or a different account signing in) is detected
// and dropped rather than retried into a wall.
import { describe, test, expect, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { _state, syncWeekFromDrive } from './setup.js';

const IDS_KEY = 'zenit-week-drive-file-ids';

const mkBranch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });

const remoteWeek = () => ({ nodes: [mkBranch('work')], tombstones: [], savedAt: 5 });

describe('persisted Drive file ids', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.resetSyncState();
  });

  test('are written stamped with the account that owns them', () => {
    _state.setLocalStorage('zenit-week-google-auth', { hasSession: true, email: 'a@example.com' });
    _state.setDriveFileId('2026-34', 'file_34');
    _state.persistDriveFileIds();

    const rec = JSON.parse(_state.getLocalStorage(IDS_KEY));
    expect(rec).toEqual({ email: 'a@example.com', ids: { '2026-34': 'file_34' } });
  });

  test('are not written at all when no account is known', () => {
    _state.setDriveFileId('2026-34', 'file_34');
    _state.persistDriveFileIds();
    expect(_state.getLocalStorage(IDS_KEY)).toBeUndefined();
  });

  test('hydrate the in-memory cache for the same account', () => {
    _state.setLocalStorage(IDS_KEY, { email: 'a@example.com', ids: { '2026-34': 'file_34' } });
    _state.loadDriveFileIds('a@example.com');
    expect(_state.getDriveFileId('2026-34')).toBe('file_34');
  });

  test('are ignored for a different account — those ids address another Drive', () => {
    _state.setLocalStorage(IDS_KEY, { email: 'a@example.com', ids: { '2026-34': 'file_34' } });
    _state.loadDriveFileIds('b@example.com');
    expect(_state.getDriveFileId('2026-34')).toBeNull();
  });

  test('forgetting one id rewrites the stored record without it', () => {
    _state.setLocalStorage('zenit-week-google-auth', { hasSession: true, email: 'a@example.com' });
    _state.setDriveFileId('2026-34', 'file_34');
    _state.setDriveFileId('2026-35', 'file_35');
    _state.persistDriveFileIds();

    _state.forgetDriveFileId('2026-34');

    expect(_state.getDriveFileId('2026-34')).toBeNull();
    expect(JSON.parse(_state.getLocalStorage(IDS_KEY)).ids).toEqual({ '2026-35': 'file_35' });
  });
});

describe('a stale persisted id', () => {
  const seen = [];
  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q');
      seen.push({ kind: 'search', q });
      return HttpResponse.json({ files: [{ id: 'file_fresh' }] });
    }),
    http.get('https://www.googleapis.com/drive/v3/files/:id', ({ request, params }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('alt') !== 'media') return HttpResponse.json({});
      seen.push({ kind: 'download', id: params.id });
      // The id kept from the last session no longer exists in this Drive.
      if (params.id === 'file_gone') return new HttpResponse(null, { status: 404 });
      return new HttpResponse(JSON.stringify(remoteWeek()), { headers: { ETag: 'etag-v1' } });
    }),
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
    _state.setLocalStorage('zenit-week-google-auth', { hasSession: true, email: 'a@example.com' });
  });
  afterEach(() => _state.setAccessToken(null));

  test('is dropped on a 404 and the week is pulled with a freshly resolved id', async () => {
    _state.setDriveFileId('2026-40', 'file_gone');
    _state.persistDriveFileIds();

    await syncWeekFromDrive('2026-40');

    // 404 → one name lookup → download with the id that lookup returned.
    expect(seen.map(s => s.kind)).toEqual(['download', 'search', 'download']);
    expect(seen.at(-1).id).toBe('file_fresh');
    expect(_state.getDriveFileId('2026-40')).toBe('file_fresh');
    expect(JSON.parse(_state.getLocalStorage(IDS_KEY)).ids['2026-40']).toBe('file_fresh');
    // The pull actually landed rather than being abandoned at the 404.
    expect(await _state.loadWeekIDB('2026-40')).not.toBeNull();
  });

  test('does not retry forever when the name resolves to nothing either', async () => {
    server.use(
      http.get('https://www.googleapis.com/drive/v3/files', ({ request }) => {
        seen.push({ kind: 'search', q: new URL(request.url).searchParams.get('q') });
        return HttpResponse.json({ files: [{ id: 'file_gone' }] }); // same dead id
      }),
    );
    _state.setDriveFileId('2026-41', 'file_gone');

    await syncWeekFromDrive('2026-41');

    expect(seen.filter(s => s.kind === 'download')).toHaveLength(2);
    expect(seen.filter(s => s.kind === 'search')).toHaveLength(1);
  });
});
