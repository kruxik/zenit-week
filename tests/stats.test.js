import { describe, it, expect, beforeEach } from 'vitest';
import { _state, computeWeekStats } from './setup.js';

// T1 (revised) — single priority-weighted lens feeding both the summary box and the
// Stats panel. Load is split planned/unplanned × done/open and weighted by priority
// (critical=5, high=3, normal=1); a counter contributes val of its weight as done and
// (max-val) as open, so partial progress counts fractionally.

const mkBranch = (id) => ({ id, type: 'branch', parent: 'center', children: [] });
const mkAct = (id, branch, extra = {}) =>
  ({ id, type: 'activity', branch, parent: branch, children: [], done: false, ...extra });
const mkCounter = (id, branch, val, max, extra = {}) =>
  ({ id, type: 'counter', branch, parent: branch, children: [], val, max, ...extra });

function setNodes(nodes) {
  _state.reset();
  _state.set({ nodes: [{ id: 'center', type: 'center' }, ...nodes] });
  const data = _state.get();
  for (const b of data.nodes.filter(n => n.type === 'branch')) {
    b.children = data.nodes.filter(n => n.parent === b.id).map(n => n.id);
  }
}

describe('computeWeekStats — weighted 2×2 split (normal priority)', () => {
  beforeEach(() => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { done: true }),                  // planned-done
      mkAct('a2', 'work', { done: false }),                 // planned-open
      mkAct('a3', 'work', { done: true, unplanned: true }), // unplanned-done
      mkAct('a4', 'work', { done: false, unplanned: true }),// unplanned-open
      mkAct('a5', 'work', { done: false }),                 // planned-open
    ]);
  });

  it('splits the global 2×2 (all normal weight = task counts)', () => {
    const g = computeWeekStats().global;
    expect(g.plannedDone).toBe(1);
    expect(g.plannedOpen).toBe(2);
    expect(g.unplannedDone).toBe(1);
    expect(g.unplannedOpen).toBe(1);
    expect(g.total).toBe(5);
    expect(g.done).toBe(2);
    expect(g.percent).toBe(40); // 2/5
  });

  it('reports per-branch figures', () => {
    const w = computeWeekStats().perBranch.work;
    expect(w.total).toBe(5);
    expect(w.unplannedDone + w.unplannedOpen).toBe(2);
  });
});

describe('computeWeekStats — priority weighting', () => {
  it('weights done/open by priority (critical=5, high=3, normal=1)', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { priority: 'critical', done: true }),  // 5 planned-done
      mkAct('a2', 'work', { priority: 'high', done: false }),     // 3 planned-open
      mkAct('a3', 'work', { done: true }),                        // 1 planned-done
    ]);
    const g = computeWeekStats().global;
    expect(g.plannedDone).toBe(6);   // 5 + 1
    expect(g.plannedOpen).toBe(3);
    expect(g.total).toBe(9);
    expect(g.done).toBe(6);
    expect(g.percent).toBe(67);      // round(6/9)
  });

  it('weights an unplanned critical task into the unplanned arcs', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { priority: 'critical', done: false, unplanned: true }),
    ]);
    const g = computeWeekStats().global;
    expect(g.unplannedOpen).toBe(5);
    expect(g.total).toBe(5);
    expect(g.done).toBe(0);
  });
});

describe('computeWeekStats — counters count fractionally', () => {
  it('splits a counter into val (done) and max-val (open) of its weight', () => {
    setNodes([mkBranch('work'), mkCounter('c1', 'work', 3, 10)]);
    const g = computeWeekStats().global;
    expect(g.plannedDone).toBe(3);
    expect(g.plannedOpen).toBe(7);
    expect(g.total).toBe(10);
    expect(g.percent).toBe(30);
  });

  it('scales a counter by priority weight', () => {
    setNodes([mkBranch('work'), mkCounter('c1', 'work', 3, 10, { priority: 'high' })]);
    const g = computeWeekStats().global;
    expect(g.plannedDone).toBe(9);   // 3 × 3
    expect(g.plannedOpen).toBe(21);  // 7 × 3
    expect(g.total).toBe(30);
  });

  it('a counter at max is fully done; a degenerate max<=0 counter contributes nothing', () => {
    setNodes([mkBranch('work'), mkCounter('c1', 'work', 10, 10), mkCounter('c2', 'work', 0, 0)]);
    const g = computeWeekStats().global;
    expect(g.plannedDone).toBe(10);
    expect(g.plannedOpen).toBe(0);
    expect(g.total).toBe(10);
    expect(g.percent).toBe(100);
  });
});

describe('computeWeekStats — structural rules', () => {
  it('excludes _editing nodes entirely', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { done: true }),
      mkAct('a2', 'work', { _editing: true }),
    ]);
    expect(computeWeekStats().global.total).toBe(1);
  });

  it('counts only leaves (a parent with active children is not a leaf)', () => {
    setNodes([
      mkBranch('work'),
      mkAct('p', 'work', { done: false, children: ['child'] }),
      { id: 'child', type: 'activity', branch: 'work', parent: 'p', children: [], done: true },
    ]);
    const data = _state.get();
    data.nodes.find(n => n.id === 'work').children = ['p'];
    const g = computeWeekStats().global;
    expect(g.total).toBe(1);       // only the leaf 'child'
    expect(g.plannedDone).toBe(1);
  });

  it('handles an empty week without dividing by zero', () => {
    setNodes([mkBranch('work')]);
    const g = computeWeekStats().global;
    expect(g.total).toBe(0);
    expect(g.done).toBe(0);
    expect(g.percent).toBe(0);
  });

  it('gives a branch with no tasks a zeroed entry', () => {
    setNodes([mkBranch('work'), mkBranch('me'), mkAct('a1', 'work', { done: true })]);
    const me = computeWeekStats().perBranch.me;
    expect(me.total).toBe(0);
    expect(me.done).toBe(0);
  });

  it('reports an all-planned week with zero unplanned', () => {
    setNodes([mkBranch('work'), mkAct('a1', 'work', { done: true }), mkAct('a2', 'work')]);
    const g = computeWeekStats().global;
    expect(g.unplannedDone + g.unplannedOpen).toBe(0);
    expect(g.plannedDone + g.plannedOpen).toBe(2);
  });

  it('reports an all-unplanned week', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { done: true, unplanned: true }),
      mkAct('a2', 'work', { unplanned: true }),
    ]);
    const g = computeWeekStats().global;
    expect(g.plannedDone + g.plannedOpen).toBe(0);
    expect(g.unplannedDone).toBe(1);
    expect(g.unplannedOpen).toBe(1);
  });
});

describe('computeWeekStats — box/panel agreement', () => {
  it('global percent equals weighted done ÷ total (matches the summary box)', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { priority: 'critical', done: true }), // 5 done
      mkAct('a2', 'work', { done: false }),                      // 1 open
      mkCounter('c1', 'work', 2, 4),                             // 2 done / 2 open
    ]);
    const g = computeWeekStats().global;
    // done = 5 + 0 + 2 = 7 ; total = 5 + 1 + 4 = 10
    expect(g.done).toBe(7);
    expect(g.total).toBe(10);
    expect(g.percent).toBe(70);
  });
});
