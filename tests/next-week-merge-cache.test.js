import { describe, test, expect, beforeEach } from 'vitest';
import {
  _state,
  applyRemoteMerge,
  takeSnapshot,
  undo,
  fnv1a32,
} from './setup.js';

// Regression for the "renamed next-week node deleted on sync" data-loss bug.
//
// Drive-poll / peer merges write the next week via saveWeekIDB inside
// _commitRemoteMerge, bypassing saveWeek's _nextWeekRawCache refresh. A stale
// cache made the next undo/redo restore an outdated next-week blob and
// _tombstoneRemovedNodes() then tombstoned (and force-pushed) the live nodes the
// merge had just pulled in — wiping a node and its subtree everywhere.

const WK = '2026-01';
const NK = '2026-02'; // offsetWeek(WK, +1)

const branch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, _ts: 0 });

function staleNextWeek() {
  return { nodes: [branch('work')], tombstones: [], crdtVersion: 1, savedAt: 1000 };
}

// What a background Drive/peer merge pulls into the next week: a node ("Klienti")
// with a subnode, neither of which exists in the pre-poll cache.
function mergedNextWeek() {
  return {
    nodes: [
      branch('work', ['klienti']),
      { id: 'klienti', type: 'activity', branch: 'work', parent: 'work', label: 'Klienti', children: ['sub1'], _ts: 500 },
      { id: 'sub1', type: 'activity', branch: 'work', parent: 'klienti', label: 'sub', children: [], _ts: 500 },
    ],
    tombstones: [],
    crdtVersion: 2,
    savedAt: 5000,
  };
}

async function applyMerge(wk, data) {
  const json = JSON.stringify(data);
  await applyRemoteMerge(wk, data, json, fnv1a32(json), false, data);
}

describe('next-week cache freshness after Drive/peer merge', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
    _state.setWeekKey(WK);
    _state.set({ nodes: [branch('work')] });
    // Navigation captured the next week as it was before the poll.
    _state.setNextWeekRawCache(JSON.stringify(staleNextWeek()));
    _state.saveWeekIDB(NK, staleNextWeek());
  });

  test('merging the next week refreshes _nextWeekRawCache', async () => {
    await applyMerge(NK, mergedNextWeek());

    const cached = _state.getNextWeekRawCache();
    expect(cached).toContain('klienti');
    expect(JSON.parse(cached).nodes.some(n => n.id === 'klienti')).toBe(true);
  });

  test('undo after a next-week merge does not tombstone the pulled node + subtree', async () => {
    // Background poll pulls "Klienti" (+ subnode) into the next week.
    await applyMerge(NK, mergedNextWeek());

    // A later current-week action snapshots state, then the user undoes it.
    takeSnapshot();
    const cur = _state.get();
    cur.nodes.push({ id: 'tmp', type: 'activity', branch: 'work', parent: 'work', label: 'tmp', children: [], _ts: 700 });
    cur.nodes.find(n => n.id === 'work').children.push('tmp');
    _state.set(cur);

    await undo();

    const next = await _state.loadWeekIDB(NK);
    expect(next.nodes.some(n => n.id === 'klienti')).toBe(true);
    expect(next.nodes.some(n => n.id === 'sub1')).toBe(true);
    expect(next.tombstones || []).not.toContain('klienti');
    expect(next.tombstones || []).not.toContain('sub1');
  });
});
