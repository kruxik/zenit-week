// The invariant that every data-loss bug in this area violated:
//
//   A node may leave a week record only if that record gains a tombstone for it.
//
// A node that disappears without a tombstone is a silent local delete: no merge
// can distinguish it from "never existed", so the next Drive pull either
// resurrects it (confusing) or, if every device agrees, loses it for good. A
// node that gains a tombstone but no replacement anywhere is the harder failure —
// tombstones are permanent, so nothing can ever bring it back.
//
// These tests drive the real mutation paths and assert the invariant after each,
// including the cross-week transfer over real IndexedDB rather than the
// synchronous localStorage stand-ins the rest of the suite uses. Those
// stand-ins are what hid the transfer race in the first place: they made a
// read-modify-write look atomic.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  _state, openDB, loadWeekIDB, saveWeekIDB, loadWeek,
  deleteNode, setActivityDays, takeSnapshot, undo, mergeWeekData,
} from './setup.js';

const mkBranch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });

const mkNode = (id, parent, ts, extra = {}) => ({
  id, type: 'activity', parent, branch: 'work', label: id,
  children: [], done: false, _ts: ts, ...extra,
});

// Every non-branch node in `before` must still be in `after`, or be tombstoned
// there. Branches are exempt: they are structural and validateAndRepair
// re-creates them, which is why _tombstoneRemovedNodes never tombstones them.
function expectNoSilentLoss(before, after, label = '') {
  const present = new Set((after.nodes || []).map(n => n.id));
  const tombstoned = new Set(after.tombstones || []);
  const silent = (before.nodes || [])
    .filter(n => n.type !== 'branch')
    .filter(n => !present.has(n.id) && !tombstoned.has(n.id))
    .map(n => n.id);
  expect(silent, `${label}: nodes vanished without a tombstone`).toEqual([]);
}

// The mirror image: a tombstone with no surviving copy anywhere is permanent
// loss. Callers pass every week record the operation could have moved nodes into.
function expectTombstonesHaveReplacements(before, after, destinations, label = '') {
  const beforeById = new Map((before.nodes || []).map(n => [n.id, n]));
  const survivingLabels = new Set(
    destinations.flatMap(d => (d?.nodes || []))
      .filter(n => n.type === 'activity')
      .map(n => n.label)
  );
  const orphaned = (after.tombstones || [])
    .filter(id => beforeById.has(id))
    .filter(id => beforeById.get(id).type === 'activity')
    .filter(id => !survivingLabels.has(beforeById.get(id).label));
  expect(orphaned, `${label}: tombstoned with no copy anywhere`).toEqual([]);
}

describe('week-record invariants — same-week edits', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.resetSyncState();
    _state.setWeekKey('2026-30');
  });

  test('deleting a subtree tombstones every node it removed', () => {
    const before = {
      nodes: [
        mkBranch('work', ['p']),
        mkNode('p', 'work', 100, { children: ['c1', 'c2'] }),
        mkNode('c1', 'p', 110),
        mkNode('c2', 'p', 120),
      ],
      tombstones: [],
    };
    _state.set(structuredClone(before));
    deleteNode('p');
    expectNoSilentLoss(before, _state.get(), 'deleteNode');
  });

  test('rescheduling days tombstones the day-children it replaces', () => {
    const before = {
      nodes: [
        mkBranch('work', ['task']),
        mkNode('task', 'work', 100, { children: ['d1', 'd2'] }),
        mkNode('d1', 'task', 110, { dayChild: true, dayIndex: 1, label: 'Mon' }),
        mkNode('d2', 'task', 120, { dayChild: true, dayIndex: 2, label: 'Tue' }),
      ],
      tombstones: [],
    };
    _state.set(structuredClone(before));
    setActivityDays('task', new Set([4]), true);
    expectNoSilentLoss(before, _state.get(), 'setActivityDays');
  });

  test('undo of an add tombstones the node it removes', async () => {
    const before = { nodes: [mkBranch('work', [])], tombstones: [] };
    _state.set(structuredClone(before));
    _state.setNextWeekRawCache(null);
    takeSnapshot();

    const after = {
      nodes: [mkBranch('work', ['n1']), mkNode('n1', 'work', 200)],
      tombstones: [],
    };
    _state.set(structuredClone(after));
    await _state.saveWeekIDB('2026-30', structuredClone(after));

    await undo();
    expectNoSilentLoss(after, _state.get(), 'undo');
  });

  test('a CRDT merge never drops a node either side still holds', () => {
    const local = {
      nodes: [mkBranch('work', ['a', 'b']), mkNode('a', 'work', 100), mkNode('b', 'work', 200)],
      tombstones: [], savedAt: 10,
    };
    const remote = {
      nodes: [mkBranch('work', ['a', 'c']), mkNode('a', 'work', 150), mkNode('c', 'work', 300)],
      tombstones: [], savedAt: 20,
    };
    const merged = mergeWeekData(structuredClone(local), structuredClone(remote));
    expectNoSilentLoss(local, merged, 'merge (local side)');
    expectNoSilentLoss(remote, merged, 'merge (remote side)');
  });
});

describe('week-record invariants — cross-week transfer over real IndexedDB', () => {
  const WK = '2026-30';
  const NEXT = '2026-31';

  beforeEach(async () => {
    // The rest of the suite swaps loadWeek/saveWeek for synchronous
    // localStorage versions, which turns the transfer's read-modify-write into
    // an atomic step and hides exactly the bug these tests exist for.
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
    _state.setWeekKey(WK);
  });

  afterEach(() => _state.useRealIDB(false));

  async function seed(count) {
    const ids = [];
    const nodes = [];
    for (let i = 1; i <= count; i++) {
      ids.push('a' + i);
      nodes.push(mkNode('a' + i, 'work', 100 + i, { label: 'task' + i }));
    }
    const wd = { nodes: [mkBranch('work', ids), ...nodes], tombstones: [] };
    _state.set(structuredClone(wd));
    await saveWeekIDB(WK, structuredClone(wd));
    await _state.refreshNextWeekCache();
    return { ids, before: wd };
  }

  test('sequential transfers preserve every task and the invariant', async () => {
    const { ids, before } = await seed(10);
    for (const id of ids) await _state.moveNodeToNextWeek(id);

    const next = await loadWeekIDB(NEXT);
    const source = _state.get();
    expect(next.nodes.filter(n => n.type === 'activity')).toHaveLength(10);
    expectNoSilentLoss(before, source, 'transfer source');
    expectTombstonesHaveReplacements(before, source, [next], 'transfer');
  });

  test('overlapping transfers preserve every task and the invariant', async () => {
    const { ids, before } = await seed(10);
    await Promise.all(ids.map(id => _state.moveNodeToNextWeek(id)));

    const next = await loadWeekIDB(NEXT);
    const source = _state.get();
    expect(next.nodes.filter(n => n.type === 'activity').map(n => n.label).sort())
      .toEqual(ids.map((_, i) => 'task' + (i + 1)).sort());
    expectNoSilentLoss(before, source, 'transfer source');
    expectTombstonesHaveReplacements(before, source, [next], 'transfer');
  });

  test('every transferred node is reachable from a branch after reload', async () => {
    const { ids } = await seed(6);
    await Promise.all(ids.map(id => _state.moveNodeToNextWeek(id)));

    // loadWeek runs validateAndRepair, which garbage-collects anything not
    // reachable from a branch through children arrays — a copy wired up wrongly
    // would survive the write and vanish here, after the source was tombstoned.
    const reloaded = await loadWeek(NEXT);
    expect(reloaded.nodes.filter(n => n.type === 'activity')).toHaveLength(6);
  });

  test('a transfer and a concurrent write to the next week both survive', async () => {
    const { ids } = await seed(1);

    const move = _state.moveNodeToNextWeek(ids[0]);
    const peerWrite = _state.withWeekLock(NEXT, async () => {
      const cur = (await loadWeekIDB(NEXT)) || { nodes: [mkBranch('work')], tombstones: [] };
      cur.nodes.push(mkNode('remote1', 'work', 9000, { label: 'from-other-device' }));
      cur.nodes.find(n => n.id === 'work').children.push('remote1');
      await saveWeekIDB(NEXT, cur);
    });
    await Promise.all([move, peerWrite]);

    const labels = (await loadWeek(NEXT)).nodes
      .filter(n => n.type === 'activity').map(n => n.label).sort();
    expect(labels).toEqual(['from-other-device', 'task1']);
  });
});
