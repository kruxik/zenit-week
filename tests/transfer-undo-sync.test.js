// Regression tests for cross-week transfer + undo/redo + Drive-sync bugs.
//   Bug A: _nextWeekRawCache must track the current week, or undo writes a stale
//          (wrong-week) blob into the next-week record → duplication into week+2.
//   Bug B: undo of a cross-week move must tombstone the copy it placed in the
//          next week, and force-push that week, or a Drive pull-merge resurrects it.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { takeSnapshot, undo, redo, openDB, saveWeekIDB, loadWeekIDB, _state } from './setup.js';

const mkBranch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });

describe('Bug A — refreshNextWeekCache tracks the current week', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
  });

  test('loads the correct next-week record after a week switch', async () => {
    const next = { nodes: [mkBranch('work')], tombstones: [] };
    await _state.saveWeekIDB('2026-03', next);

    _state.setWeekKey('2026-02');
    await _state.refreshNextWeekCache();

    expect(JSON.parse(_state.getNextWeekRawCache())).toEqual(next);
  });

  test('caches null when the next week does not exist', async () => {
    _state.setWeekKey('2026-09');
    await _state.refreshNextWeekCache();
    expect(_state.getNextWeekRawCache()).toBeNull();
  });

  // The regression that caused the user-reported bug: prev/next navigation goes
  // through loadAndRender (not the hashchange handler), so the cache refresh must
  // live there. Drive the real navigation function and confirm the cache aligns
  // with the week we landed on — not the week we left.
  test('navigation via loadAndRender refreshes the cache for the new week', async () => {
    const next = { nodes: [mkBranch('work')], tombstones: [] };
    await _state.saveWeekIDB('2099-02', next);
    _state.setLocalStorage('zenit-week-2099-01', { nodes: [mkBranch('work')], tombstones: [] });

    // Land on a stale value, then navigate — loadAndRender must overwrite it.
    _state.setNextWeekRawCache(JSON.stringify({ nodes: [mkBranch('stale')], tombstones: [] }));
    await _state.loadAndRender('2099-01');

    expect(JSON.parse(_state.getNextWeekRawCache())).toEqual(next);
  });
});

describe('Bug B — undo of a move un-resurrects the next-week copy', () => {
  const WK = '2026-01';
  const NEXT = '2026-02';

  // Driven over real IndexedDB against the real transfer: undo reverses the ids
  // the move recorded, so a hand-simulated move (which records nothing) would no
  // longer exercise the path at all.
  beforeEach(async () => {
    _state.useRealIDB(true);
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['weeks', 'misc'], 'readwrite');
      tx.objectStore('weeks').clear();
      tx.objectStore('misc').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    _state.clearLocalStorage();
    _state.reset();
    _state.resetSyncState();
  });

  afterEach(() => _state.useRealIDB(false));

  test('tombstones the moved-in node and force-pushes the next week', async () => {
    _state.setWeekKey(WK);
    const week = {
      nodes: [mkBranch('work', ['a1']),
        { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 }],
      tombstones: [],
    };
    _state.set(structuredClone(week));
    await saveWeekIDB(WK, structuredClone(week));
    await saveWeekIDB(NEXT, { nodes: [mkBranch('work')], tombstones: [] });
    await _state.refreshNextWeekCache();

    await _state.moveNodeToNextWeek('a1');
    const movedId = (await loadWeekIDB(NEXT)).nodes.find(n => n.label === 'a1').id;

    await undo();

    const restoredNext = await loadWeekIDB(NEXT);
    // The moved-in copy is gone AND tombstoned so a Drive merge can't bring it back.
    expect(restoredNext.nodes.some(n => n.id === movedId)).toBe(false);
    expect(restoredNext.tombstones).toContain(movedId);
    // Structural branches must never be tombstoned (a branch tombstone lets a
    // Drive merge permanently delete it).
    expect(restoredNext.tombstones).not.toContain('work');
    // Both touched weeks are force-pushed (no pull-before-push that would resurrect).
    expect(_state.getUndoRedoForcePush().has(WK)).toBe(true);
    expect(_state.getUndoRedoForcePush().has(NEXT)).toBe(true);
    // a1 is back where it started.
    expect(_state.get().nodes.some(n => n.id === 'a1')).toBe(true);
  });

  test('a node someone else put in the next week survives that undo', async () => {
    _state.setWeekKey(WK);
    const week = {
      nodes: [mkBranch('work', ['a1']),
        { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 }],
      tombstones: [],
    };
    _state.set(structuredClone(week));
    await saveWeekIDB(WK, structuredClone(week));
    // Next week already holds unrelated work — an earlier transfer, or another device.
    await saveWeekIDB(NEXT, {
      nodes: [mkBranch('work', ['keep1']),
        { id: 'keep1', type: 'activity', parent: 'work', branch: 'work', label: 'keep me', children: [], done: false, _ts: 500 }],
      tombstones: [],
    });
    await _state.refreshNextWeekCache();

    await _state.moveNodeToNextWeek('a1');
    await undo();

    const next = await loadWeekIDB(NEXT);
    expect(next.nodes.some(n => n.id === 'keep1')).toBe(true);
    expect(next.tombstones).not.toContain('keep1');
  });

  test('redo puts the moved copy back', async () => {
    _state.setWeekKey(WK);
    const week = {
      nodes: [mkBranch('work', ['a1']),
        { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 }],
      tombstones: [],
    };
    _state.set(structuredClone(week));
    await saveWeekIDB(WK, structuredClone(week));
    await saveWeekIDB(NEXT, { nodes: [mkBranch('work')], tombstones: [] });
    await _state.refreshNextWeekCache();

    await _state.moveNodeToNextWeek('a1');
    await undo();
    await redo();

    const next = await loadWeekIDB(NEXT);
    const copy = next.nodes.find(n => n.label === 'a1');
    expect(copy).toBeTruthy();
    // Its tombstone from the undo must be cleared, or the next merge kills it again.
    expect(next.tombstones).not.toContain(copy.id);
    expect(next.nodes.find(n => n.id === 'work').children).toContain(copy.id);
  });

  test('an undo that never touched the next week leaves it alone', async () => {
    _state.setWeekKey(WK);
    _state.set({ nodes: [mkBranch('work', [])], tombstones: [] });
    await saveWeekIDB(NEXT, {
      nodes: [mkBranch('work', ['keep1']),
        { id: 'keep1', type: 'activity', parent: 'work', branch: 'work', label: 'keep me', children: [], done: false, _ts: 500 }],
      tombstones: [],
    });
    // Snapshot taken before the next week existed locally — the case that used to
    // make undo replace the whole week with an empty record.
    _state.setNextWeekRawCache(null);
    takeSnapshot();

    const after = {
      nodes: [mkBranch('work', ['n1']),
        { id: 'n1', type: 'activity', parent: 'work', branch: 'work', label: 'n1', children: [], done: false, _ts: 700 }],
      tombstones: [],
    };
    _state.set(structuredClone(after));
    await saveWeekIDB(WK, structuredClone(after));

    await undo();

    const next = await loadWeekIDB(NEXT);
    expect(next.nodes.some(n => n.id === 'keep1')).toBe(true);
    expect(next.tombstones).toEqual([]);
  });
});

describe('undo keeps the displayed week (does not jump to the action week)', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
  });

  test('undoing an action taken on another week leaves the view where it is', async () => {
    const ACTED = '2026-05';   // where the snapshot was taken
    const VIEW  = '2026-06';   // where the user is now looking

    // Take a snapshot while "on" the acted-upon week.
    _state.setWeekKey(ACTED);
    _state.set({ nodes: [mkBranch('work', ['a1']),
      { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 }],
      tombstones: [] });
    _state.setNextWeekRawCache(null);
    takeSnapshot();
    _state.set({ nodes: [mkBranch('work')], tombstones: ['a1'] });

    // Navigate to a different week (the user "switches" before undoing).
    await saveWeekIDB(VIEW, { nodes: [mkBranch('work')], tombstones: [] });
    _state.setWeekKey(VIEW);
    _state.set({ nodes: [mkBranch('work')], tombstones: [] });
    _state.setNextWeekRawCache(null);

    await undo();

    // The view must stay on VIEW, not jump back to ACTED.
    expect(_state.getWeekKey()).toBe(VIEW);
  });
});

describe('undo of a single-week op does not force-push the untouched next week', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
  });

  test('next week is left untouched (no clobbering of concurrent next-week edits)', async () => {
    const CUR = '2030-10', NEXT = '2030-11';

    // A next week that the operation never touches.
    const nextRecord = {
      nodes: [mkBranch('work', ['nx']),
        { id: 'nx', type: 'activity', parent: 'work', branch: 'work', label: 'NextItem', children: [], done: false, _ts: 5000 }],
      tombstones: [],
    };
    await saveWeekIDB(NEXT, nextRecord);

    _state.setWeekKey(CUR);
    _state.set({ nodes: [mkBranch('work', ['a1']),
      { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 }],
      tombstones: [] });
    _state.setNextWeekRawCache(JSON.stringify(nextRecord));

    // Snapshot, then make a current-week-only edit.
    takeSnapshot();
    _state.set({ nodes: [mkBranch('work', ['a1', 'a2']),
      { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 },
      { id: 'a2', type: 'activity', parent: 'work', branch: 'work', label: 'a2', children: [], done: false, _ts: 200 }],
      tombstones: [] });

    await undo();

    expect(_state.getUndoRedoForcePush().has(CUR)).toBe(true);
    expect(_state.getUndoRedoForcePush().has(NEXT)).toBe(false);
    // Next week record is byte-for-byte unchanged (no _ts bump, no rewrite).
    expect(await _state.loadWeekIDB(NEXT)).toEqual(nextRecord);
  });
});
