// Regression guard for the Drive-sync "ping-pong" bug.
//
// mergeWeekData bumps crdtVersion/savedAt on every call and JSON key order is
// unstable, so a raw-byte hash (fnv1a32(JSON.stringify(...))) differs after every
// merge even when nothing actually changed. With a raw-byte hash as the sync
// identity, two devices would pull → merge → upload → pull → merge → upload …
// forever, re-downloading and re-uploading every poll cycle.
//
// The fix bases sync identity on weekContentHash() = fnv1a32(_weekContentSig()),
// which strips _ts/_editing/crdtVersion/savedAt and sorts keys + nodes, so
// identical *content* yields an identical hash on every device. These tests pin
// that contract from both directions:
//   - identical content MUST hash the same (no false "changed" → no ping-pong)
//   - different content MUST hash differently (no false "synced" → no data loss)
//   - a merge of already-converged data is a fixed point (loop terminates)
//   - end-to-end: a clean pull does not trigger a re-upload or a re-download

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  _state,
  weekContentHash,
  colorsContentHash,
  _weekContentSig,
  mergeWeekData,
  validateAndRepair,
  migrateCrdt,
  defaultWeekData,
  attemptSilentRestore,
  syncWeekFromDrive,
  syncWeekToDrive,
  pollDriveMeta,
  pollDriveChanges,
} from './setup.js';

const CHANGE_FEED_FLAG = 'zenit-week-sync-changes-feed';

const GOOGLE_AUTH_STORAGE_KEY = 'zenit-week-google-auth';

// Deep clone that survives the VM boundary (structuredClone is available in Node).
const clone = (o) => structuredClone(o);

// A small but realistic week: default branches + one activity with a counter child.
function sampleWeek() {
  const data = defaultWeekData();
  // A real synced week always carries node.side (syncBranchConfig backfills it on
  // load). Set it explicitly so merges don't mutate the branches mid-test.
  data.nodes.filter((n) => n.type === 'branch').forEach((b, i) => { b.side = i === 0 ? 'left' : 'right'; });
  const work = data.nodes.find((n) => n.id === 'work');
  work.children.push('act1');
  data.nodes.push({ id: 'act1', type: 'activity', branch: 'work', label: 'Ship it', parent: 'work', children: ['cnt1'], _ts: 1000 });
  data.nodes.push({ id: 'cnt1', type: 'counter', branch: 'work', label: '3', parent: 'act1', children: [], val: 1, max: 3, _ts: 1001 });
  data.savedAt = 1000;
  data.crdtVersion = 1;
  return data;
}

// Mimics what syncWeekFromDrive does to bytes pulled from Drive.
const normalizeAsPulled = (data) => migrateCrdt(validateAndRepair(clone(data)));

describe('Drive sync — content-hash convergence (ping-pong guard)', () => {
  describe('weekContentHash ignores bookkeeping churn', () => {
    test('crdtVersion does not affect the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.crdtVersion = a.crdtVersion + 999;
      expect(weekContentHash(b)).toBe(weekContentHash(a));
    });

    test('savedAt does not affect the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.savedAt = a.savedAt + 123456;
      expect(weekContentHash(b)).toBe(weekContentHash(a));
    });

    test('per-node _ts does not affect the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.nodes.forEach((n) => { if (typeof n._ts === 'number') n._ts += 50000; });
      expect(weekContentHash(b)).toBe(weekContentHash(a));
    });

    test('node array order and key order do not affect the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.nodes.reverse();
      // Rebuild each node object with reversed key insertion order.
      b.nodes = b.nodes.map((n) => {
        const out = {};
        for (const k of Object.keys(n).reverse()) out[k] = n[k];
        return out;
      });
      expect(weekContentHash(b)).toBe(weekContentHash(a));
    });
  });

  describe('weekContentHash still detects real changes (no data loss)', () => {
    test('changing a label changes the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.nodes.find((n) => n.id === 'act1').label = 'Renamed';
      expect(weekContentHash(b)).not.toBe(weekContentHash(a));
    });

    test('marking a node done changes the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.nodes.find((n) => n.id === 'act1').done = true;
      expect(weekContentHash(b)).not.toBe(weekContentHash(a));
    });

    test('incrementing a counter value changes the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.nodes.find((n) => n.id === 'cnt1').val = 2;
      expect(weekContentHash(b)).not.toBe(weekContentHash(a));
    });

    test('adding a tombstone changes the hash', () => {
      const a = sampleWeek();
      const b = clone(a);
      b.tombstones = ['gone'];
      expect(weekContentHash(b)).not.toBe(weekContentHash(a));
    });

    test('changing agendaOrder ids changes the hash', () => {
      const a = sampleWeek();
      a.agendaOrder = { 'mo-pending': { ids: ['x'], ts: 10 } };
      const b = clone(a);
      b.agendaOrder['mo-pending'].ids = ['y'];
      expect(weekContentHash(b)).not.toBe(weekContentHash(a));
    });
  });

  describe('merge convergence — the loop must terminate', () => {
    test('merging identical content yields the same content hash (no upload scheduled)', () => {
      const remote = sampleWeek();
      const local = clone(remote);
      const merged = mergeWeekData(local, remote);
      // scheduleUpload is `weekContentHash(merged) !== weekContentHash(remote)`.
      // If this ever differs for identical input, every merge re-uploads → ping-pong.
      expect(weekContentHash(merged)).toBe(weekContentHash(remote));
    });

    test('merging when local has nothing new does not change the content hash', () => {
      const remote = sampleWeek();
      const local = defaultWeekData(); // only the empty default branches
      const merged = mergeWeekData(local, remote);
      expect(weekContentHash(merged)).toBe(weekContentHash(remote));
    });

    test('repeated merge of converged data is a fixed point despite crdtVersion climbing', () => {
      const remote = sampleWeek();
      const m1 = mergeWeekData(clone(remote), remote);
      const m2 = mergeWeekData(clone(m1), remote);
      const m3 = mergeWeekData(clone(m2), remote);
      // Raw bytes drift (crdtVersion +1 each time) but the content hash is stable.
      expect(m2.crdtVersion).toBeGreaterThan(m1.crdtVersion);
      expect(weekContentHash(m2)).toBe(weekContentHash(m1));
      expect(weekContentHash(m3)).toBe(weekContentHash(m1));
    });

    test('normalize pipeline is idempotent on the content signature (re-download is stable)', () => {
      // A device uploads merged bytes; another device pulls and re-normalizes them.
      // If normalize is not a fixed point, the re-normalized sig differs and the
      // puller re-uploads forever.
      const merged = mergeWeekData(clone(sampleWeek()), sampleWeek());
      const roundTripped = normalizeAsPulled(JSON.parse(JSON.stringify(merged)));
      expect(_weekContentSig(roundTripped)).toBe(_weekContentSig(merged));
      expect(weekContentHash(roundTripped)).toBe(weekContentHash(merged));
    });
  });
});

describe('Colors sync — content-hash convergence', () => {
  // Shape produced by saveBranchColors(): savedAt + per-branch {main} + theme + lang.
  const sampleColors = () => ({
    savedAt: 1000,
    work: { main: '#F24E1E' },
    family: { main: '#A259FF' },
    me: { main: '#1ABCFE' },
    theme: 'light',
    lang: 'en',
  });

  test('savedAt does not affect the colors hash', () => {
    const a = sampleColors();
    const b = { ...clone(a), savedAt: 999999 };
    expect(colorsContentHash(b)).toBe(colorsContentHash(a));
  });

  test('branch key order does not affect the colors hash', () => {
    const a = sampleColors();
    // Reinsert keys in a different order (simulates a device whose BRANCH_COLORS
    // was built in a different sequence).
    const b = {};
    for (const k of Object.keys(a).reverse()) b[k] = a[k];
    expect(colorsContentHash(b)).toBe(colorsContentHash(a));
  });

  test('changing a branch color changes the hash', () => {
    const a = sampleColors();
    const b = clone(a);
    b.work.main = '#000000';
    expect(colorsContentHash(b)).not.toBe(colorsContentHash(a));
  });

  test('changing theme changes the hash', () => {
    const a = sampleColors();
    const b = { ...clone(a), theme: 'dark' };
    expect(colorsContentHash(b)).not.toBe(colorsContentHash(a));
  });

  test('changing language changes the hash', () => {
    const a = sampleColors();
    const b = { ...clone(a), lang: 'cs' };
    expect(colorsContentHash(b)).not.toBe(colorsContentHash(a));
  });

  test('identical settings with different savedAt converge (no needless re-upload)', () => {
    // Device A uploaded with savedAt T1; device B re-saves identical settings at T2.
    const a = { ...sampleColors(), savedAt: 1000 };
    const b = { ...sampleColors(), savedAt: 2000 };
    expect(colorsContentHash(a)).toBe(colorsContentHash(b));
  });
});

// ── End-to-end: a clean pull must not cascade into re-upload / re-download ──────
describe('Drive sync E2E — clean pull does not ping-pong', () => {
  const WK = '2026-01'; // currentWeekKey in the test harness
  const FILE_ID = 'file_id_2026_01';

  // Remote week content and the contentHash a real uploader would have written.
  const remoteMedia = sampleWeek();
  const remoteHash = String(weekContentHash(normalizeAsPulled(remoteMedia)));

  let patchCount = 0;
  let mediaFetchCount = 0;

  const server = setupServer(
    http.post('http://localhost/api/token', () =>
      HttpResponse.json({ access_token: 'new_access_token', expires_in: 3600 })
    ),
    http.get('https://www.googleapis.com/drive/v3/files/:fileId', ({ params, request }) => {
      if (params.fileId !== FILE_ID) return new HttpResponse(null, { status: 404 });
      const url = new URL(request.url);
      if (url.searchParams.get('alt') === 'media') {
        mediaFetchCount++;
        return HttpResponse.json(remoteMedia);
      }
      return HttpResponse.json({ id: FILE_ID, appProperties: { contentHash: remoteHash } });
    }),
    http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', () => {
      patchCount++;
      return HttpResponse.json({ id: FILE_ID });
    })
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(async () => {
    server.resetHandlers();
    _state.resetSyncState();
    _state.clearLocalStorage();
    _state.clearIDBStore();
    patchCount = 0;
    mediaFetchCount = 0;
    // Authenticate and point the cache at the remote file.
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    await attemptSilentRestore();
    _state.setDriveFileId(WK, FILE_ID);
    // Local already holds the same content as remote (the steady state).
    await _state.saveWeekIDB(WK, clone(remoteMedia));
  });
  afterEach(() => { _state.resetSyncState(); });

  test('pulling identical content does not schedule a re-upload', async () => {
    await syncWeekFromDrive(WK);
    // syncWeekToDrive pulls-then-pushes; for converged content it must skip the PATCH.
    await syncWeekToDrive(WK);
    expect(patchCount).toBe(0);
  });

  test('after a clean pull, the next poll does not re-download', async () => {
    await syncWeekFromDrive(WK); // sets lastSyncedHash to the remote contentHash
    mediaFetchCount = 0;
    await pollDriveMeta(WK);
    expect(mediaFetchCount).toBe(0);
  });
});

// A file last uploaded by an OLD app version carries an appProperty contentHash
// computed by a now-replaced hashing scheme (e.g. raw-JSON fnv1a32). Its content is
// byte-for-byte what we already hold, so the merge is a no-op and never re-uploads
// to rewrite the appProperty. Without a "remote hash we last reconciled" guard, the
// poll would compare that stale hash against our canonical hash forever and
// re-download the file every cycle — a read-only download storm.
describe('Drive sync E2E — legacy-scheme appProperty self-heals (no download storm)', () => {
  const WK = '2026-01';
  const FILE_ID = 'file_id_2026_01';

  const remoteMedia = sampleWeek();
  // The stored appProperty hash deliberately does NOT match weekContentHash(content),
  // mimicking a value written by a previous hashing scheme.
  const canonical = String(weekContentHash(normalizeAsPulled(remoteMedia)));
  const legacyHash = canonical + '_legacy';

  let patchCount = 0;
  let mediaFetchCount = 0;

  const server = setupServer(
    http.post('http://localhost/api/token', () =>
      HttpResponse.json({ access_token: 'new_access_token', expires_in: 3600 })
    ),
    http.get('https://www.googleapis.com/drive/v3/files/:fileId', ({ params, request }) => {
      if (params.fileId !== FILE_ID) return new HttpResponse(null, { status: 404 });
      const url = new URL(request.url);
      if (url.searchParams.get('alt') === 'media') {
        mediaFetchCount++;
        return HttpResponse.json(remoteMedia);
      }
      return HttpResponse.json({ id: FILE_ID, appProperties: { contentHash: legacyHash } });
    }),
    http.patch('https://www.googleapis.com/upload/drive/v3/files/:fileId', () => {
      patchCount++;
      return HttpResponse.json({ id: FILE_ID });
    })
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(async () => {
    server.resetHandlers();
    _state.resetSyncState();
    _state.clearLocalStorage();
    _state.clearIDBStore();
    patchCount = 0;
    mediaFetchCount = 0;
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    await attemptSilentRestore();
    _state.setDriveFileId(WK, FILE_ID);
    await _state.saveWeekIDB(WK, clone(remoteMedia)); // local already holds the remote content
  });
  afterEach(() => { _state.resetSyncState(); });

  test('poll converges: at most one reconciling download, then quiet, never re-uploads', async () => {
    await syncWeekFromDrive(WK); // initial pull (sets lastSyncedHash to canonical)
    await pollDriveMeta(WK);      // first poll reconciles the legacy hash once
    mediaFetchCount = 0;
    await pollDriveMeta(WK);      // subsequent polls must not re-download
    await pollDriveMeta(WK);
    expect(mediaFetchCount).toBe(0);
    expect(patchCount).toBe(0);   // identical content — never corrects the appProperty by re-upload
  });
});

// The colors/settings file has the same legacy-appProperty failure mode as week
// files, on a separate poll branch. A colors file written by an older hashing
// scheme advertises a contentHash that never matches colorsSyncedHash (canonical),
// and syncColorsFromDrive only ever rewrites colorsSyncedHash to canonical — it
// never re-uploads to correct the appProperty — so the poll re-downloaded it every
// cycle. lastSeenRemoteColorsHash breaks that loop.
describe('Colors sync E2E — legacy-scheme appProperty self-heals (no download storm)', () => {
  const COLORS_FILE_ID = 'file_id_colors';
  const remoteColors = { savedAt: 5000, work: { main: '#F24E1E' }, family: { main: '#A259FF' }, me: { main: '#1ABCFE' }, theme: 'light', lang: 'en' };
  const legacyHash = colorsContentHash(remoteColors) + '_legacy';

  let colorsMediaFetchCount = 0;

  const server = setupServer(
    http.post('http://localhost/api/token', () =>
      HttpResponse.json({ access_token: 'new_access_token', expires_in: 3600 })
    ),
    http.get('https://www.googleapis.com/drive/v3/files/:fileId', ({ params, request }) => {
      if (params.fileId !== COLORS_FILE_ID) return new HttpResponse(null, { status: 404 });
      const url = new URL(request.url);
      if (url.searchParams.get('alt') === 'media') {
        colorsMediaFetchCount++;
        return HttpResponse.json(remoteColors);
      }
      return HttpResponse.json({ id: COLORS_FILE_ID, appProperties: { contentHash: legacyHash } });
    })
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(async () => {
    server.resetHandlers();
    _state.resetSyncState();
    _state.clearLocalStorage();
    _state.clearIDBStore();
    colorsMediaFetchCount = 0;
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    await attemptSilentRestore();
    // Point the poll at the colors file but configure NO week files, so the poll
    // exercises only the colors branch.
    _state.setDriveFileId('colors', COLORS_FILE_ID);
  });
  afterEach(() => { _state.resetSyncState(); });

  test('poll converges: colors reconciles once, then stops re-downloading', async () => {
    await pollDriveMeta('2026-01'); // first poll reconciles the legacy colors hash
    colorsMediaFetchCount = 0;
    await pollDriveMeta('2026-01'); // subsequent polls must not re-download colors
    await pollDriveMeta('2026-01');
    expect(colorsMediaFetchCount).toBe(0);
  });
});

// Experimental Changes-API poll (behind the zenit-week-sync-changes-feed flag).
// One changes.list drain per cycle replaces per-file appProperties GETs. These pin
// the contract: baseline-then-drain, react once to a reported change, suppress the
// echo of our own uploads, and stay quiet when nothing changed.
describe('Drive sync E2E — Changes API poll (flagged)', () => {
  const WK = '2026-01';
  const FILE_ID = 'file_id_2026_01';
  const remoteMedia = sampleWeek();
  const remoteHash = String(weekContentHash(normalizeAsPulled(remoteMedia)));

  let mediaFetchCount = 0;
  let startTokenCalls = 0;
  let changesPayload = { newStartPageToken: '1001', changes: [] };

  const server = setupServer(
    http.post('http://localhost/api/token', () =>
      HttpResponse.json({ access_token: 'new_access_token', expires_in: 3600 })
    ),
    http.get('https://www.googleapis.com/drive/v3/changes/startPageToken', () => {
      startTokenCalls++;
      return HttpResponse.json({ startPageToken: '1000' });
    }),
    http.get('https://www.googleapis.com/drive/v3/changes', () => HttpResponse.json(changesPayload)),
    http.get('https://www.googleapis.com/drive/v3/files/:fileId', ({ params, request }) => {
      if (params.fileId !== FILE_ID) return new HttpResponse(null, { status: 404 });
      const url = new URL(request.url);
      if (url.searchParams.get('alt') === 'media') {
        mediaFetchCount++;
        return HttpResponse.json(remoteMedia);
      }
      return HttpResponse.json({ id: FILE_ID, appProperties: { contentHash: remoteHash } });
    })
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(async () => {
    server.resetHandlers();
    _state.resetSyncState();
    _state.clearLocalStorage();
    _state.clearIDBStore();
    mediaFetchCount = 0;
    startTokenCalls = 0;
    changesPayload = { newStartPageToken: '1001', changes: [] };
    _state.setLocalStorage(GOOGLE_AUTH_STORAGE_KEY, { hasSession: true });
    _state.setLocalStorage(CHANGE_FEED_FLAG, 1); // JSON.stringify(1) === '1' → flag on
    await attemptSilentRestore();
    _state.setDriveFileId(WK, FILE_ID);
    await _state.saveWeekIDB(WK, clone(remoteMedia));
  });
  afterEach(() => { _state.resetSyncState(); });

  // A change event whose appProperties carries this week file.
  const weekChange = (hash) => ({
    newStartPageToken: '1002',
    changes: [{ removed: false, fileId: FILE_ID, file: { id: FILE_ID, name: `zenit-week-${WK}.json`, appProperties: { contentHash: hash } } }],
  });

  test('first tick only baselines the cursor — no changes processed, no download', async () => {
    await pollDriveChanges(WK);
    expect(startTokenCalls).toBe(1);
    expect(mediaFetchCount).toBe(0);
  });

  test('a reported change with a new hash downloads once; an empty drain stays quiet', async () => {
    await pollDriveChanges(WK);          // baseline
    changesPayload = weekChange(remoteHash + '_remote'); // a genuinely different remote hash
    await pollDriveChanges(WK);          // drains the change → one download
    expect(mediaFetchCount).toBe(1);
    changesPayload = { newStartPageToken: '1003', changes: [] }; // nothing new
    await pollDriveChanges(WK);
    await pollDriveChanges(WK);
    expect(mediaFetchCount).toBe(1);     // no further downloads
  });

  test('own-upload echo is suppressed (remote hash == lastSyncedHash)', async () => {
    await pollDriveChanges(WK);          // baseline
    _state.setLastSyncedHash(WK, remoteHash); // simulate: we just uploaded this content
    changesPayload = weekChange(remoteHash);  // Drive echoes our own write back
    await pollDriveChanges(WK);
    expect(mediaFetchCount).toBe(0);     // recognised as our own content — no re-download
  });
});
