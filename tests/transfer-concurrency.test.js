// Regression tests for concurrent writes to the next-week record.
//
// moveNodeToNextWeek reads the next-week record, mutates it, writes it back, and
// then tombstones the moved subtree in the source week. Without serialization,
// anything else that writes that record between the read and the write (a second
// transfer, a Drive pull-merge, a peer-tab merge) is silently overwritten — and
// because the source side is already tombstoned, the nodes are unrecoverable on
// every device. Reported symptom: ten tasks transferred on a Sunday were gone
// from both weeks the next morning.
import { describe, test, expect, beforeEach } from 'vitest';
import { _state, withWeekLock } from './setup.js';

const WK = '2026-30';
const NEXT = '2026-31';

const mkBranch = (id, children = []) =>
  ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });

function seed(count) {
  _state.clearLocalStorage();
  _state.clearIDBStore();
  _state.reset();
  _state.resetSyncState();
  _state.setWeekKey(WK);

  const ids = [];
  const nodes = [];
  for (let i = 1; i <= count; i++) {
    ids.push('a' + i);
    nodes.push({
      id: 'a' + i, type: 'activity', parent: 'work', branch: 'work',
      label: 'task' + i, children: [], done: false, _ts: 100 + i,
    });
  }
  const wd = { nodes: [mkBranch('work', ids), ...nodes], tombstones: [] };
  _state.set(wd);
  _state.setLocalStorage('zenit-week-' + WK, wd);
  return ids;
}

const nextWeek = () => JSON.parse(_state.getLocalStorage('zenit-week-' + NEXT));

describe('concurrent transfers to the next week', () => {
  beforeEach(() => seed(0));

  test('sequential transfers all land', async () => {
    const ids = seed(10);
    for (const id of ids) await _state.moveNodeToNextWeek(id);

    const moved = nextWeek().nodes.filter(n => n.type === 'activity');
    expect(moved).toHaveLength(10);
    expect(moved.map(n => n.label).sort()).toEqual(ids.map((_, i) => 'task' + (i + 1)).sort());
  });

  test('overlapping transfers all land — none dropped by a stale write', async () => {
    const ids = seed(10);
    // Fire every transfer without awaiting in between: each one suspends at its
    // own load of the next-week record, exactly as rapid clicks do in the app.
    await Promise.all(ids.map(id => _state.moveNodeToNextWeek(id)));

    const moved = nextWeek().nodes.filter(n => n.type === 'activity');
    expect(moved).toHaveLength(10);
    expect(moved.map(n => n.label).sort()).toEqual(ids.map((_, i) => 'task' + (i + 1)).sort());
  });

  test('a node is never tombstoned in the source week without a copy in the next', async () => {
    const ids = seed(10);
    await Promise.all(ids.map(id => _state.moveNodeToNextWeek(id)));

    const source = _state.get();
    const survivingLabels = new Set(
      nextWeek().nodes.filter(n => n.type === 'activity').map(n => n.label)
    );
    // Every tombstoned activity must have a counterpart in the destination.
    for (const id of ids) {
      expect(source.tombstones).toContain(id);
      expect(survivingLabels.has('task' + id.slice(1))).toBe(true);
    }
    expect(source.nodes.filter(n => n.type === 'activity')).toHaveLength(0);
  });

  test('a merge landing mid-transfer is not clobbered', async () => {
    const ids = seed(1);

    // A Drive/peer merge writes the next-week record through the same lock.
    // Queue it so it runs while the transfer is in flight.
    const move = _state.moveNodeToNextWeek(ids[0]);
    const merge = withWeekLock(NEXT, async () => {
      const cur = _state.getLocalStorage('zenit-week-' + NEXT);
      const data = cur ? JSON.parse(cur) : { nodes: [mkBranch('work')], tombstones: [] };
      const branch = data.nodes.find(n => n.id === 'work');
      data.nodes.push({
        id: 'remote1', type: 'activity', parent: 'work', branch: 'work',
        label: 'from-other-device', children: [], done: false, _ts: 9000,
      });
      branch.children.push('remote1');
      _state.setLocalStorage('zenit-week-' + NEXT, data);
    });
    await Promise.all([move, merge]);

    const labels = nextWeek().nodes.filter(n => n.type === 'activity').map(n => n.label).sort();
    expect(labels).toEqual(['from-other-device', 'task1']);
  });
});

describe('withWeekLock', () => {
  test('serializes callbacks on the same key', async () => {
    const order = [];
    const slow = (tag, ms) => withWeekLock('k', async () => {
      order.push(tag + ':start');
      await new Promise(r => setTimeout(r, ms));
      order.push(tag + ':end');
    });
    await Promise.all([slow('a', 20), slow('b', 0)]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  test('runs different keys concurrently', async () => {
    const order = [];
    const p1 = withWeekLock('k1', async () => {
      order.push('k1:start');
      await new Promise(r => setTimeout(r, 20));
      order.push('k1:end');
    });
    const p2 = withWeekLock('k2', async () => { order.push('k2:run'); });
    await Promise.all([p1, p2]);
    expect(order).toEqual(['k1:start', 'k2:run', 'k1:end']);
  });

  test('a rejected section does not poison later waiters', async () => {
    await expect(withWeekLock('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withWeekLock('k', async () => 'ok')).resolves.toBe('ok');
  });
});
