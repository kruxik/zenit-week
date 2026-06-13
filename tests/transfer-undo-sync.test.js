// Regression tests for cross-week transfer + undo/redo + Drive-sync bugs.
//   Bug A: _nextWeekRawCache must track the current week, or undo writes a stale
//          (wrong-week) blob into the next-week record → duplication into week+2.
//   Bug B: undo of a cross-week move must tombstone the copy it placed in the
//          next week, and force-push that week, or a Drive pull-merge resurrects it.
import { describe, test, expect, beforeEach } from 'vitest';
import { takeSnapshot, undo, _state } from './setup.js';

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
    // Both touched weeks are force-pushed (no pull-before-push that would resurrect).
    expect(_state.getUndoRedoForcePush().has(WK)).toBe(true);
    expect(_state.getUndoRedoForcePush().has(NEXT)).toBe(true);
  });
});
