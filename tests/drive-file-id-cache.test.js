// Sign-in used to spend a full round trip turning the current week's file name
// into a Drive file id before it could ask for the content. The ids are stable
// per account, so they are kept across sessions — which only works if a stale
// one (file deleted elsewhere, or a different account signing in) is detected
// and dropped rather than retried into a wall.
import { describe, test, expect, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { _state, syncWeekFromDrive, pickDriveSurvivor, listAllDriveWeekFiles } from './setup.js';

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

// I5 — two devices resolving the same file name from the same listing must pick
// the same file id. Drive lets two devices create the same name in the same
// second; nothing here repairs an existing split, it only stops the two copies
// from being used alternately.
describe('duplicate file names (I5)', () => {
  test('the newest modifiedTime survives', () => {
    const files = [
      { id: 'zzz', modifiedTime: '2026-09-15T10:00:00.000Z' },
      { id: 'aaa', modifiedTime: '2026-09-14T10:00:00.000Z' },
    ];
    expect(pickDriveSurvivor(files).id).toBe('zzz');
    expect(pickDriveSurvivor([...files].reverse()).id).toBe('zzz');
  });

  test('an identical modifiedTime ties to the lexically smallest id', () => {
    const files = [
      { id: 'zzz', modifiedTime: '2026-09-15T10:00:00.000Z' },
      { id: 'aaa', modifiedTime: '2026-09-15T10:00:00.000Z' },
    ];
    expect(pickDriveSurvivor(files).id).toBe('aaa');
    expect(pickDriveSurvivor([...files].reverse()).id).toBe('aaa');
  });

  test('a missing modifiedTime reads as the oldest possible', () => {
    expect(pickDriveSurvivor([
      { id: 'b' },
      { id: 'a', modifiedTime: '2020-01-01T00:00:00.000Z' },
    ]).id).toBe('a');
  });

  test('handles zero and one file', () => {
    expect(pickDriveSurvivor([])).toBeNull();
    expect(pickDriveSurvivor(undefined)).toBeNull();
    expect(pickDriveSurvivor([{ id: 'only' }]).id).toBe('only');
  });
});

describe('listAllDriveWeekFiles with a duplicated week', () => {
  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files', () =>
      HttpResponse.json({
        files: [
          { id: 'old', name: 'zenit-week-2026-16.json', modifiedTime: '2026-04-01T00:00:00.000Z',
            appProperties: { savedAt: '100', contentHash: 'h-old' } },
          { id: 'new', name: 'zenit-week-2026-16.json', modifiedTime: '2026-04-09T00:00:00.000Z',
            appProperties: { savedAt: '900', contentHash: 'h-new' } },
          { id: 'w17', name: 'zenit-week-2026-17.json', modifiedTime: '2026-04-20T00:00:00.000Z',
            appProperties: { savedAt: '50', contentHash: 'h17' } },
        ],
      })),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.resetSyncState();
    _state.setAccessToken('test-token');
  });
  afterEach(() => _state.setAccessToken(null));

  test('emits one entry per week key, and it is the survivor', async () => {
    const found = await listAllDriveWeekFiles();
    const w16 = found.filter(f => f.wKey === '2026-16');
    expect(w16).toHaveLength(1);
    expect(w16[0].contentHash).toBe('h-new');
    expect(found.map(f => f.wKey).sort()).toEqual(['2026-16', '2026-17']);
    expect(_state.getDriveFileId('2026-16')).toBe('new');
  });
});

describe('creating a week file that another device just created', () => {
  const calls = [];
  // The search before the POST sees nothing; the re-check afterwards sees the
  // peer's copy, which is newer and therefore the survivor.
  let searchCount = 0;
  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files', () => {
      searchCount += 1;
      calls.push('search');
      if (searchCount === 1) return HttpResponse.json({ files: [] });
      return HttpResponse.json({
        files: [
          { id: 'mine',  name: 'zenit-week-2026-30.json', modifiedTime: '2026-07-20T10:00:00.000Z' },
          { id: 'peers', name: 'zenit-week-2026-30.json', modifiedTime: '2026-07-20T10:00:05.000Z' },
        ],
      });
    }),
    http.post('https://www.googleapis.com/drive/v3/files', () => {
      calls.push('create');
      return HttpResponse.json({ id: 'mine' });
    }),
    http.delete('https://www.googleapis.com/drive/v3/files/:id', ({ params }) => {
      calls.push('delete:' + params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());
  beforeEach(() => {
    calls.length = 0;
    searchCount = 0;
    _state.clearLocalStorage();
    _state.resetSyncState();
    _state.setAccessToken('test-token');
  });
  afterEach(() => _state.setAccessToken(null));

  test('deletes its own placeholder and adopts the survivor', async () => {
    const id = await _state.resolveDriveFileId('2026-30');
    expect(id).toBe('peers');
    expect(calls).toContain('delete:mine');
    expect(_state.getDriveFileId('2026-30')).toBe('peers');
  });

  test('keeps its own file when the re-check shows no duplicate', async () => {
    server.use(
      http.get('https://www.googleapis.com/drive/v3/files', () => {
        searchCount += 1;
        if (searchCount === 1) return HttpResponse.json({ files: [] });
        return HttpResponse.json({
          files: [{ id: 'mine', name: 'zenit-week-2026-31.json', modifiedTime: '2026-07-27T10:00:00.000Z' }],
        });
      }),
    );
    const id = await _state.resolveDriveFileId('2026-31');
    expect(id).toBe('mine');
    expect(calls.some(c => c.startsWith('delete:'))).toBe(false);
  });
});
