import { describe, it, expect, beforeEach } from 'vitest';
import { _state, touchLayout, touchNode, findNode, handleNodeDrop, migrateCrdt } from './setup.js';

// I1 — a layout-only operation never changes _ts on any node.
//
// The incident this pins: a stale phone panned from the root, every node got a
// fresh _ts, and the next push made that stale week the LWW winner everywhere.
// Position now travels on its own stamp, _posTs.

const week = () => ({
  nodes: [
    { id: 'center', type: 'center', label: '2026-W01', children: ['work'] },
    { id: 'work',   type: 'branch', branch: 'work', label: 'Work', side: 'left',
      children: ['t1', 'x1'], _ts: 100, _posTs: 100 },
    { id: 't1', type: 'activity', branch: 'work', label: 'Alfa', parent: 'work',
      children: ['a1'], _ts: 100, _posTs: 100, offX: 5, offY: 5 },
    { id: 'a1', type: 'activity', branch: 'work', label: 'Alfa child', parent: 't1',
      children: [], _ts: 100, _posTs: 100, offX: 5, offY: 5 },
    { id: 'x1', type: 'activity', branch: 'work', label: 'Other', parent: 'work',
      children: [], _ts: 100, _posTs: 100, offX: 5, offY: 5 },
  ],
  tombstones: [],
  crdtVersion: 0,
});

const stamps = () => Object.fromEntries(
  _state.get().nodes.map(n => [n.id, { ts: n._ts, posTs: n._posTs }])
);

describe('touchLayout', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey('2026-01');
    _state.set(week());
  });

  it('stamps _posTs and leaves _ts alone', () => {
    touchLayout('t1');
    const n = findNode('t1');
    expect(n._posTs).toBeGreaterThan(100);
    expect(n._ts).toBe(100);
  });

  it('does not claim an onboarding seed node the way touchNode does', () => {
    const n = findNode('t1');
    n._demo = true;
    touchLayout('t1');
    expect(findNode('t1')._demo).toBe(true);
    touchNode('t1');
    expect(findNode('t1')._demo).toBeUndefined();
  });

  it('is a no-op for an unknown id', () => {
    expect(() => touchLayout('nope')).not.toThrow();
  });

  it('touches nothing but the named node', () => {
    touchLayout('t1');
    expect(findNode('a1')._posTs).toBe(100);
    expect(findNode('x1')._posTs).toBe(100);
  });
});

describe('recenter-all from the root (I1)', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey('2026-01');
    _state.set(week());
  });

  it('zeroes every non-center offset and stamps only _posTs', () => {
    const before = stamps();
    _state.endCenterPan({ startX: 0, startY: 0, clientX: 200, clientY: 200, pointerType: 'mouse' });

    for (const n of _state.get().nodes) {
      expect(n._ts, `${n.id} content stamp must not move`).toBe(before[n.id].ts);
      if (n.type === 'center') continue;
      expect(n.offX).toBe(0);
      expect(n.offY).toBe(0);
      expect(n._posTs, `${n.id} position stamp must move`).toBeGreaterThan(before[n.id].posTs);
    }
  });

  it('a pen drag from the root still recenters', () => {
    _state.endCenterPan({ startX: 0, startY: 0, clientX: 200, clientY: 200, pointerType: 'pen' });
    expect(findNode('t1').offX).toBe(0);
  });

  // Fix 2 — a finger pan that started on the root is a pan and nothing else.
  it('a touch pan from the root changes nothing at all', () => {
    const before = stamps();
    const undoBefore = _state.getUndoStack().length;
    _state.endCenterPan({ startX: 0, startY: 0, clientX: 200, clientY: 200, pointerType: 'touch' });

    for (const n of _state.get().nodes) {
      expect(n._ts).toBe(before[n.id].ts);
      expect(n._posTs).toBe(before[n.id].posTs);
    }
    expect(findNode('t1').offX).toBe(5);
    expect(findNode('a1').offY).toBe(5);
    expect(_state.getUndoStack().length, 'no snapshot from a pan').toBe(undoBefore);
    expect(_state.getLocalStorage('zenit-week-2026-01'), 'nothing saved').toBeUndefined();
  });
});

describe('drag drop stamps position, not content (I1)', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey('2026-01');
    _state.set(week());
  });

  // Reorder within the same parent — the non-rebind path.
  it('leaves _ts alone on the dragged node, its subtree and its parent', () => {
    const before = stamps();
    _state.setViewport({ panX: 0, panY: 0, zoom: 1 });
    _state.setDragState({
      activeNodeId: 't1',
      layoutPositions: {
        work: { x: -400, y: 0,   w: 160, h: 64 },
        t1:   { x: 0,    y: 0,   w: 160, h: 64 },
        a1:   { x: 200,  y: 0,   w: 160, h: 64 },
        x1:   { x: 0,    y: 300, w: 160, h: 64 },
      },
      descendantSet: new Set(['t1', 'a1']),
    });
    // Empty space below x1 — far from every node box, so nothing rebinds.
    handleNodeDrop(900, 900);

    for (const n of _state.get().nodes) {
      expect(n._ts, `${n.id} content stamp must not move`).toBe(before[n.id].ts);
    }
    expect(findNode('t1')._posTs).toBeGreaterThan(100);
    expect(findNode('a1')._posTs).toBeGreaterThan(100);
    expect(findNode('work')._posTs).toBeGreaterThan(100);
  });
});

describe('migrateCrdt backfills _posTs', () => {
  it('gives a legacy node _posTs = 0', () => {
    const d = migrateCrdt({
      nodes: [{ id: 'a1', type: 'activity', branch: 'work', label: 'x', children: [], _ts: 7 }],
      savedAt: 500,
    });
    expect(d.nodes[0]._posTs).toBe(0);
    expect(d.nodes[0]._ts).toBe(7);
  });

  it('keeps an existing _posTs', () => {
    const d = migrateCrdt({
      nodes: [{ id: 'a1', type: 'activity', branch: 'work', label: 'x', children: [], _ts: 7, _posTs: 42 }],
      savedAt: 500,
    });
    expect(d.nodes[0]._posTs).toBe(42);
  });
});
