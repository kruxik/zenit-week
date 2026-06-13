// Regression tests for cross-week transfer + undo/redo + Drive-sync bugs.
//   Bug A: _nextWeekRawCache must track the current week, or undo writes a stale
//          (wrong-week) blob into the next-week record → duplication into week+2.
//   Bug B: undo of a cross-week move must tombstone the copy it placed in the
//          next week, and force-push that week, or a Drive pull-merge resurrects it.
import { describe, test, expect, beforeEach } from 'vitest';
import { takeSnapshot, undo, saveWeekIDB, _state } from './setup.js';

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
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
  });

  test('tombstones the moved-in node and force-pushes the next week', async () => {
    const WK = '2026-01';
    const NEXT = '2026-02';

    // Pre-move state: current week holds a1; next week is just a branch.
    _state.setWeekKey(WK);
    _state.set({ nodes: [mkBranch('work', ['a1']),
      { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 100 }],
      tombstones: [] });
    _state.setNextWeekRawCache(JSON.stringify({ nodes: [mkBranch('work')], tombstones: [] }));

    // Snapshot captures the pre-move state of both weeks.
    takeSnapshot();

    // Simulate the move having completed: a1 gone from current, a fresh copy
    // 'moved1' placed in the next-week record (as moveNodeToNextWeek would).
    _state.set({ nodes: [mkBranch('work')], tombstones: ['a1'] });
    await _state.saveWeekIDB(NEXT, {
      nodes: [mkBranch('work', ['moved1']),
        { id: 'moved1', type: 'activity', parent: 'work', branch: 'work', label: 'a1', children: [], done: false, _ts: 9000 }],
      tombstones: [],
    });

    await undo();

    const restoredNext = await _state.loadWeekIDB(NEXT);
    // The moved-in copy is gone AND tombstoned so a Drive merge can't bring it back.
    expect(restoredNext.nodes.some(n => n.id === 'moved1')).toBe(false);
    expect(restoredNext.tombstones).toContain('moved1');
    // Structural branches must never be tombstoned (a branch tombstone lets a
    // Drive merge permanently delete it).
    expect(restoredNext.tombstones).not.toContain('work');
    // Both touched weeks are force-pushed (no pull-before-push that would resurrect).
    expect(_state.getUndoRedoForcePush().has(WK)).toBe(true);
    expect(_state.getUndoRedoForcePush().has(NEXT)).toBe(true);
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
