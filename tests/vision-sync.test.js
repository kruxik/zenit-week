import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  _state,
  weekContentHash,
  pollDriveChanges,
  validateAndRepairVision,
  saveVision,
  mergeRemoteVision,
  onPeerVisionSaved,
  syncVisionToDrive,
  syncVisionFromDrive,
  importCarriesRecord,
} from './setup.js';

// The vision's storage and sync: one IDB record under `vision`, one Drive file
// `zenit-week-vision.json`, merged with the week CRDT and kept apart from
// every week.

const branch = (id, children = [], extra = {}) => ({
  id, type: 'branch', branch: id, label: 'Area ' + id, children, side: 'right', _ts: 1, ...extra,
});
const intention = (id, parent, extra = {}) => ({
  id, type: 'activity', branch: parent, parent, label: 'Intention ' + id, children: [], _ts: 1, ...extra,
});
const vision = (nodes, extra = {}) => ({ nodes, tombstones: [], crdtVersion: 1, savedAt: 1000, ...extra });
const labels = (rec) => rec.nodes.filter(n => n.type === 'activity').map(n => n.label).sort();

beforeEach(() => {
  _state.clearIDBStore();
  _state.resetSyncState();
  _state.setCurrentView('mindmap');
  _state.clearPendingRemoteMerge();
  _state.sandbox._tabPosts = [];
});

describe('Drive file name mapping', () => {
  it('maps zenit-week-vision.json to the vision key', () => {
    expect(_state.wKeyForDriveFileName('zenit-week-vision.json')).toBe('vision');
  });

  it('still maps weeks, colors and the schedule', () => {
    expect(_state.wKeyForDriveFileName('zenit-week-2026-45.json')).toBe('2026-45');
    expect(_state.wKeyForDriveFileName('zenit-week-colors.json')).toBe('colors');
    expect(_state.wKeyForDriveFileName('zenit-week-schedule.json')).toBe('schedule');
    expect(_state.wKeyForDriveFileName('zenit-week-visions.json')).toBeNull();
  });
});

describe('Data records', () => {
  it('the vision is a data record, so export, import, reset and force-push cover it', () => {
    const rec = _state.getDataRecords().find(r => r.idbKey === 'vision');
    expect(rec).toBeTruthy();
    expect(rec.exportKey).toBe('zenit-week-vision');
    expect(rec.keepWhenAbsentOnImport).toBe(true);
    expect(rec.importDefault).toBeNull();
  });

  it('colors stays the last record pushed', () => {
    const recs = _state.getDataRecords();
    expect(recs[recs.length - 1].idbKey).toBe('zenit-week-colors');
  });

  it('import sanitizes the vision with the vision validator', () => {
    const rec = _state.getDataRecords().find(r => r.idbKey === 'vision');
    const out = rec.sanitize(vision([branch('vb1', ['i1']), intention('i1', 'vb1', { done: true })]));
    expect(out.nodes.find(n => n.id === 'i1')).not.toHaveProperty('done');
  });

  it('a bundle is asked whether it carries the vision under either prefix', () => {
    expect(importCarriesRecord({ 'zenit-week-vision': '{}' }, 'zenit-week-vision')).toBe(true);
    expect(importCarriesRecord({ 'week-planner-vision': '{}' }, 'zenit-week-vision')).toBe(true);
    expect(importCarriesRecord({ 'zenit-week-schedule': '{}' }, 'zenit-week-vision')).toBe(false);
  });

  it('a Drive reset clears the local vision', async () => {
    await _state.saveValueIDB('vision', vision([branch('vb1')]));
    await _state.handleResetTokenMismatch('fresh-token');
    expect(await _state.loadValueIDB('vision')).toBeNull();
  });
});

describe('mergeRemoteVision', () => {
  it('merges into the stored record when the Vision is not in view', async () => {
    await _state.saveValueIDB('vision', vision([branch('vb1', ['a']), intention('a', 'vb1')]));
    const weekBefore = JSON.stringify(_state.get());
    const { outcome } = await mergeRemoteVision(vision([branch('vb1', ['b']), intention('b', 'vb1')]));
    expect(outcome).toBe('merged');
    expect(labels(await _state.loadValueIDB('vision'))).toEqual(['Intention a', 'Intention b']);
    // The week in memory is not touched.
    expect(JSON.stringify(_state.get())).toBe(weekBefore);
  });

  it('reports unchanged and writes nothing for content it already holds', async () => {
    const rec = vision([branch('vb1', ['a']), intention('a', 'vb1')]);
    await _state.saveValueIDB('vision', structuredClone(rec));
    const { outcome } = await mergeRemoteVision(structuredClone(rec));
    expect(outcome).toBe('unchanged');
    expect(_state.sandbox._tabPosts).toHaveLength(0);
  });

  it('tells peers when the merge holds something the remote lacks', async () => {
    await _state.saveValueIDB('vision', vision([branch('vb1', ['a']), intention('a', 'vb1')]));
    await mergeRemoteVision(vision([branch('vb1', ['b']), intention('b', 'vb1')]));
    const posts = _state.sandbox._tabPosts.filter(m => m.type === 'week-saved');
    expect(posts.map(m => m.wk)).toEqual(['vision']);
  });

  it('replaces the record in view when the Vision is on screen', async () => {
    const local = vision([branch('vb1', ['a']), intention('a', 'vb1')]);
    await _state.saveValueIDB('vision', structuredClone(local));
    _state.setCurrentView('vision');
    _state.set(structuredClone(local));
    await mergeRemoteVision(vision([branch('vb1', ['b']), intention('b', 'vb1')]));
    expect(labels(_state.get())).toEqual(['Intention a', 'Intention b']);
  });
});

describe('peer tab', () => {
  it('a tab without the Vision in view does nothing', async () => {
    await _state.saveValueIDB('vision', vision([branch('vb1', ['a']), intention('a', 'vb1')]));
    const weekBefore = JSON.stringify(_state.get());
    await onPeerVisionSaved({ type: 'week-saved', wk: 'vision', sig: 'x' });
    expect(JSON.stringify(_state.get())).toBe(weekBefore);
  });

  it('a tab with the Vision in view merges the peer write', async () => {
    _state.setCurrentView('vision');
    _state.set(vision([branch('vb1', ['a']), intention('a', 'vb1')]));
    await _state.saveValueIDB('vision', vision([branch('vb1', ['b']), intention('b', 'vb1')]));
    await onPeerVisionSaved({ type: 'week-saved', wk: 'vision', sig: 'x' });
    expect(labels(_state.get())).toEqual(['Intention a', 'Intention b']);
  });
});

describe('Vision Drive sync', () => {
  let remoteBody = null;
  let remoteStatus = 200;
  const seen = [];

  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files/:id', ({ request, params }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('alt') === 'media') {
        seen.push({ kind: 'download', id: params.id });
        if (remoteStatus !== 200) return new HttpResponse(null, { status: remoteStatus });
        return new HttpResponse(remoteBody == null ? '' : JSON.stringify(remoteBody));
      }
      seen.push({ kind: 'meta', id: params.id });
      return HttpResponse.json({ appProperties: {} });
    }),
    http.patch('https://www.googleapis.com/upload/drive/v3/files/:id', async ({ request, params }) => {
      seen.push({ kind: 'upload', id: params.id, body: await request.text() });
      return HttpResponse.json({ id: params.id });
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(() => {
    seen.length = 0;
    remoteBody = null;
    remoteStatus = 200;
    _state.setAccessToken('test-token');
    _state.setDriveFileId('vision', 'file_vision');
  });

  afterEach(() => {
    _state.clearVisionSyncTimer();
    _state.setAccessToken(null);
  });

  it('an empty file answers absent, so seeding may proceed', async () => {
    remoteBody = null;
    expect(await syncVisionFromDrive()).toBe('absent');
  });

  it('a remote vision is merged into the local one and marked synced', async () => {
    remoteBody = vision([branch('vb1', ['r']), intention('r', 'vb1')]);
    expect(await syncVisionFromDrive()).toBe('merged');
    const stored = await _state.loadValueIDB('vision');
    expect(labels(stored)).toEqual(['Intention r']);
    expect(_state.getVisionSyncedHash()).toBe(weekContentHash(validateAndRepairVision(remoteBody)));
  });

  it('a merge that taught us something leaves the hash for the next upload', async () => {
    await _state.saveValueIDB('vision', vision([branch('vb1', ['l']), intention('l', 'vb1')]));
    remoteBody = vision([branch('vb1', ['r']), intention('r', 'vb1')]);
    await syncVisionFromDrive();
    expect(_state.getVisionSyncedHash()).toBeNull();
  });

  it('a failed download reports error and never seeds', async () => {
    remoteStatus = 500;
    expect(await syncVisionFromDrive()).toBe('error');
  });

  it('uploads the stored vision with its content hash, and only once per content', async () => {
    await _state.saveValueIDB('vision', vision([branch('vb1')]));
    await syncVisionToDrive();
    await syncVisionToDrive();
    const uploads = seen.filter(r => r.kind === 'upload');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].id).toBe('file_vision');
    expect(_state.getVisionSyncedHash()).toBe(weekContentHash(vision([branch('vb1')])));
  });

  it('a vision save schedules the push and never touches a week file', async () => {
    _state.setDriveFileId('2026-01', 'file_week');
    await saveVision(vision([branch('vb1')]));
    expect(_state.getVisionSyncTimer()).toBeTruthy();
    expect(seen.some(r => r.id === 'file_week')).toBe(false);
  });
});

describe('changes feed routing', () => {
  const CHANGES = 'https://www.googleapis.com/drive/v3/changes';
  const downloads = [];
  let feed = [];
  const server = setupServer(
    http.get(CHANGES, () => HttpResponse.json({ newStartPageToken: 'tok2', changes: feed })),
    http.get('https://www.googleapis.com/drive/v3/files/:id', ({ params }) => {
      downloads.push(params.id);
      return new HttpResponse(JSON.stringify(vision([branch('vb1', ['r']), intention('r', 'vb1')])));
    }),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(() => {
    downloads.length = 0;
    _state.setAccessToken('token');
    _state.setChangesPageToken('tok1');
    _state.setDriveFileId('vision', 'file_vision');
  });
  afterEach(() => { _state.setChangesPageToken(null); _state.setAccessToken(null); });

  const change = (hash) => ({ removed: false, fileId: 'file_vision',
    file: { id: 'file_vision', name: 'zenit-week-vision.json', appProperties: { contentHash: hash } } });

  it('a changed vision file is pulled', async () => {
    feed = [change('h-remote')];
    await pollDriveChanges('2026-01');
    expect(downloads).toEqual(['file_vision']);
    expect(_state.getLastSeenRemoteVisionHash()).toBe('h-remote');
  });

  it('our own upload echoing back is not pulled', async () => {
    _state.setVisionSyncedHash('h-own');
    feed = [change('h-own')];
    await pollDriveChanges('2026-01');
    expect(downloads).toEqual([]);
  });
});
