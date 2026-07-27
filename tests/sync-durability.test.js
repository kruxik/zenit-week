// Regression tests for three ways local work failed to reach Drive, or reached
// it as a destructive write.
//
//   P1b: only the displayed week was flushed on tab close, so a transfer's
//        queued upload of the *next* week was dropped — nothing else ever
//        uploads a week the user isn't looking at.
//   P2:  the import-pending flag is written to IndexedDB but was read from
//        localStorage, so an import never force-pushed and imported data was
//        merged against whatever Drive already held.
//   P3:  undo tombstoned every live node missing from its snapshot, including
//        nodes another device had just sent — a permanent, cross-device delete.
import { describe, test, expect, beforeEach } from 'vitest';
import { _state, takeSnapshot, undo, saveWeekIDB } from './setup.js';

const mkBranch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });

const mkNode = (id, parent, ts, extra = {}) => ({
  id, type: 'activity', parent, branch: 'work', label: id,
  children: [], done: false, _ts: ts, ...extra,
});

// validateAndRepair re-creates the default branches, so compare activities only.
const activityIds = () => _state.get().nodes
  .filter(n => n.type === 'activity').map(n => n.id).sort();

function reset() {
  _state.clearLocalStorage();
  _state.clearIDBStore();
  _state.reset();
  _state.resetSyncState();
}

describe('P1b — tab teardown flushes every queued week', () => {
  beforeEach(reset);

  test('flush covers the current week and every debounced week', async () => {
    _state.setWeekKey('2026-30');
    const uploaded = [];
    await _state.withStubbedUploads(uploaded, async () => {
      _state.setSyncDebounceTimer('2026-31'); // queued by a transfer
      _state.setSyncDebounceTimer('2026-29');
      _state.flushAllPendingSyncToDrive();
    });
    expect(uploaded.sort()).toEqual(['2026-29', '2026-30', '2026-31']);
  });

  test('flush clears the debounce timers it consumed', async () => {
    _state.setWeekKey('2026-30');
    await _state.withStubbedUploads([], async () => {
      _state.setSyncDebounceTimer('2026-31');
      _state.flushAllPendingSyncToDrive();
    });
    expect(_state.getSyncDebounceTimerKeys()).toEqual([]);
  });
});

describe('P2 — import-pending flag is read from the store it is written to', () => {
  beforeEach(reset);

  test('false when nothing is pending', async () => {
    expect(await _state.isImportPending()).toBe(false);
  });

  test('true for a flag written the way importAllData writes it', async () => {
    await _state.saveValueIDB('zenit-week-import-pending', '1');
    expect(await _state.isImportPending()).toBe(true);
  });

  test('a stale localStorage flag alone does not count', async () => {
    _state.setLocalStorage('zenit-week-import-pending', '1');
    expect(await _state.isImportPending()).toBe(false);
  });
});

describe('P3 — undo does not delete another device\'s work', () => {
  beforeEach(reset);

  test('a node that arrived from a peer survives an unrelated undo', async () => {
    const WK = '2026-30';
    _state.setWeekKey(WK);

    // Pre-edit state: one local task.
    const before = { nodes: [mkBranch('work', ['local1']), mkNode('local1', 'work', 100)], tombstones: [] };
    _state.set(structuredClone(before));
    _state.setNextWeekRawCache(null);
    takeSnapshot();

    // The local edit adds local2 …
    const afterEdit = {
      nodes: [
        mkBranch('work', ['local1', 'local2']),
        mkNode('local1', 'work', 100),
        mkNode('local2', 'work', 200),
      ],
      tombstones: [],
    };
    // … then a merge brings in remote1 from a peer. Only remote1 is an arrival.
    const afterMerge = {
      nodes: [
        mkBranch('work', ['local1', 'local2', 'remote1']),
        mkNode('local1', 'work', 100),
        mkNode('local2', 'work', 200),
        mkNode('remote1', 'work', 300),
      ],
      tombstones: [],
    };
    _state.recordRemoteArrivals(WK, afterEdit, afterMerge);
    _state.set(structuredClone(afterMerge));
    await _state.saveWeekIDB(WK, structuredClone(afterMerge));

    await undo();

    expect(activityIds()).toEqual(['local1', 'remote1']);       // local2 undone
    expect(_state.get().tombstones).toContain('local2');        // and un-resurrectable
    expect(_state.get().tombstones).not.toContain('remote1');   // peer's work spared
    // The peer's timestamp is kept so the next merge doesn't treat this as an edit.
    expect(_state.get().nodes.find(n => n.id === 'remote1')._ts).toBe(300);
  });

  test('a remote subtree is reattached whole', async () => {
    const WK = '2026-30';
    _state.setWeekKey(WK);

    const before = { nodes: [mkBranch('work', [])], tombstones: [] };
    _state.set(structuredClone(before));
    _state.setNextWeekRawCache(null);
    takeSnapshot();

    const afterMerge = {
      nodes: [
        mkBranch('work', ['rParent']),
        mkNode('rParent', 'work', 300, { children: ['rChild'] }),
        mkNode('rChild', 'rParent', 310),
      ],
      tombstones: [],
    };
    _state.recordRemoteArrivals(WK, before, afterMerge);
    _state.set(structuredClone(afterMerge));
    await _state.saveWeekIDB(WK, structuredClone(afterMerge));

    await undo();

    expect(activityIds()).toEqual(['rChild', 'rParent']);
    expect(_state.get().tombstones).toEqual([]);
  });

  test('locally created nodes are still tombstoned when no merge happened', async () => {
    const WK = '2026-30';
    _state.setWeekKey(WK);

    _state.set({ nodes: [mkBranch('work', [])], tombstones: [] });
    _state.setNextWeekRawCache(null);
    takeSnapshot();

    const after = {
      nodes: [mkBranch('work', ['local1']), mkNode('local1', 'work', 200)],
      tombstones: [],
    };
    _state.set(structuredClone(after));
    await _state.saveWeekIDB(WK, structuredClone(after));

    await undo();

    expect(activityIds()).toEqual([]);
    expect(_state.get().tombstones).toContain('local1');
  });

  test('arrivals are only recorded for ids the local record lacked', () => {
    const WK = '2026-30';
    const local = { nodes: [mkBranch('work', ['a']), mkNode('a', 'work', 100)] };
    const merged = {
      nodes: [mkBranch('work', ['a', 'b']), mkNode('a', 'work', 100), mkNode('b', 'work', 200)],
    };
    _state.recordRemoteArrivals(WK, local, merged);
    expect([..._state.getRemoteOriginIds(WK)]).toEqual(['b']);
  });
});
