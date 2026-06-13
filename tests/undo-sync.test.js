import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  _state,
  takeSnapshot,
  undo,
  redo,
  defaultWeekData,
  syncWeekFromDrive,
  syncWeekToDrive,
  pollDriveMeta,
  attemptSilentRestore,
  fnv1a32,
} from './setup.js';

const GOOGLE_AUTH_STORAGE_KEY = 'zenit-week-google-auth';
const WK = '2026-01';

function buildLocalData(extras = []) {
  const data = defaultWeekData();
  const work = data.nodes.find(n => n.id === 'work');
  for (const e of extras) {
    data.nodes.push({ id: e.id, type: 'activity', label: e.label, parent: 'work', branch: 'work', children: [], _ts: e.ts });
    work.children.push(e.id);
  }
  data.savedAt = Math.max(1000, ...extras.map(e => e.ts));
  return data;
}

let remoteData;

const handlers = [
  http.post('http://localhost/api/token', async ({ request }) => {
    const body = await request.json();
    const cookieSession = body.grant_type === 'refresh_token' && !body.refresh_token;
    if (body.refresh_token === 'rt' || cookieSession) return HttpResponse.json({ access_token: 'at', expires_in: 3600 });
    return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }),
  http.get('https://www.googleapis.com/drive/v3/files', ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    if (q?.includes(`name = 'zenit-week-${WK}.json'`)) {
      return HttpResponse.json({ files: [{ id: 'fid', name: `zenit-week-${WK}.json`, appProperties: { contentHash: 'rh' } }] });
    }
    if (q?.includes("name = 'zenit-week-colors.json'")) {
      return HttpResponse.json({ files: [{ id: 'cid', name: 'zenit-week-colors.json', appProperties: {} }] });
    }
    return HttpResponse.json({ files: [] });
  }),
  http.get('https://www.googleapis.com/drive/v3/files/:fileId', ({ params, request }) => {
    const url = new URL(request.url);
    if (params.fileId === 'fid' && url.searchParams.get('alt') === 'media') {
      return HttpResponse.json(remoteData);
    }
    if (params.fileId === 'fid') {
      return HttpResponse.json({ id: 'fid', appProperties: { contentHash: 'rh' } });
    }
    return new HttpResponse(null, { status: 404 });
  }),
  http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', () => {
    return HttpResponse.json({ id: 'fid' });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => { server.resetHandlers(); _state.resetSyncState(); });
afterAll(() => server.close());

async function authAndLink() {
  _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { refresh_token: 'rt' });
  await attemptSilentRestore();
  _state.setDriveFileId(WK, 'fid');
}

describe('Undo/redo vs Drive sync', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.setWeekKey(WK);
  });

  test('undo sets _undoRedoForcePush flag', async () => {
    _state.set(buildLocalData([{ id: 'a1', label: 'Task', ts: 100 }]));
    takeSnapshot();

    const data = _state.get();
    data.nodes.find(n => n.id === 'a1').done = true;
    data.nodes.find(n => n.id === 'a1')._ts = 200;
    _state.set(data);

    await undo();

    expect(_state.getUndoRedoForcePush().has(WK)).toBe(true);
  });

  test('redo sets _undoRedoForcePush flag', async () => {
    _state.set(buildLocalData([{ id: 'a1', label: 'Task', ts: 100 }]));
    takeSnapshot();

    const data = _state.get();
    data.nodes.find(n => n.id === 'a1').done = true;
    data.nodes.find(n => n.id === 'a1')._ts = 200;
    _state.set(data);

    await undo();
    _state.setUndoRedoForcePush(null);
    await redo();

    expect(_state.getUndoRedoForcePush().has(WK)).toBe(true);
  });

  test('undo bumps _ts on all restored nodes', async () => {
    _state.set(buildLocalData([{ id: 'a1', label: 'Task', ts: 100 }]));
    takeSnapshot();

    const data = _state.get();
    data.nodes.find(n => n.id === 'a1').done = true;
    _state.set(data);

    const before = Date.now();
    await undo();

    const restored = _state.get();
    for (const n of restored.nodes) {
      expect(n._ts).toBeGreaterThanOrEqual(before);
    }
  });

  test('syncWeekFromDrive skips pull when force-push flag is set', async () => {
    await authAndLink();

    remoteData = buildLocalData([{ id: 'remote_only', label: 'Remote', ts: 9000 }]);
    remoteData.savedAt = 9000;

    const localData = buildLocalData([]);
    localData.savedAt = 1000;
    await _state.saveWeekIDB(WK, localData);
    _state.set(localData);
    _state.setUndoRedoForcePush(WK);

    await syncWeekFromDrive(WK);

    const afterSync = await _state.loadWeekIDB(WK);
    expect(afterSync.nodes.some(n => n.id === 'remote_only')).toBe(false);
  });

  test('syncWeekToDrive force-pushes without merge when flag is set', async () => {
    await authAndLink();

    remoteData = buildLocalData([{ id: 'remote_only', label: 'Remote', ts: 9000 }]);
    remoteData.savedAt = 9000;

    const localData = buildLocalData([{ id: 'local_only', label: 'Local', ts: 100 }]);
    localData.savedAt = 2000;
    await _state.saveWeekIDB(WK, localData);
    _state.set(localData);
    _state.setUndoRedoForcePush(WK);

    let uploadedBody = null;
    server.use(
      http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', async ({ request }) => {
        uploadedBody = await request.text();
        return HttpResponse.json({ id: 'fid' });
      })
    );

    await syncWeekToDrive(WK);

    expect(uploadedBody).toContain('local_only');
    expect(uploadedBody).not.toContain('remote_only');
    expect(_state.getUndoRedoForcePush().has(WK)).toBe(false);
  });

  test('pollDriveMeta does not resurrect undone changes when flag is set', async () => {
    await authAndLink();

    remoteData = buildLocalData([{ id: 'undone_node', label: 'Undone', ts: 9000 }]);
    remoteData.savedAt = 9000;

    const localData = buildLocalData([]);
    await _state.saveWeekIDB(WK, localData);
    _state.set(localData);
    _state.setLastSyncedHash(WK, 'old_hash');
    _state.setUndoRedoForcePush(WK);

    await pollDriveMeta(WK);

    const afterPoll = await _state.loadWeekIDB(WK);
    expect(afterPoll.nodes.some(n => n.id === 'undone_node')).toBe(false);
  });

  test('undo property change survives Drive sync (LWW with bumped _ts)', async () => {
    await authAndLink();

    const initial = buildLocalData([{ id: 'a1', label: 'Task', ts: 100 }]);
    _state.set(initial);
    _state.setWeekKey(WK);
    takeSnapshot();

    const modified = _state.get();
    modified.nodes.find(n => n.id === 'a1').done = true;
    modified.nodes.find(n => n.id === 'a1')._ts = 500;
    _state.set(modified);

    await undo();

    const afterUndo = _state.get();
    expect(afterUndo.nodes.find(n => n.id === 'a1').done).toBeFalsy();

    remoteData = buildLocalData([{ id: 'a1', label: 'Task', ts: 500 }]);
    remoteData.nodes.find(n => n.id === 'a1').done = true;
    remoteData.savedAt = 5000;

    _state.setUndoRedoForcePush(null);
    const localIDB = await _state.loadWeekIDB(WK);
    if (localIDB) {
      await _state.saveWeekIDB(WK, localIDB);
    } else {
      await _state.saveWeekIDB(WK, afterUndo);
    }

    await syncWeekFromDrive(WK);

    const merged = await _state.loadWeekIDB(WK);
    const node = merged.nodes.find(n => n.id === 'a1');
    expect(node.done).toBeFalsy();
  });
});
