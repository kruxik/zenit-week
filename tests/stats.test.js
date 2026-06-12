import { describe, it, expect, beforeEach } from 'vitest';
import { _state, computeWeekStats } from './setup.js';

// T1 — shared statistics helper feeding both the top summary box and the Stats panel.
// counts lens: one task = one unit, planned/unplanned × done/open.
// weighted lens: priority-weighted effort (critical=5, high=3, normal=1; counters val/max).

const mkBranch = (id) => ({ id, type: 'branch', parent: 'center', children: [] });
const mkAct = (id, branch, extra = {}) =>
  ({ id, type: 'activity', branch, parent: branch, children: [], done: false, ...extra });
const mkCounter = (id, branch, val, max, extra = {}) =>
  ({ id, type: 'counter', branch, parent: branch, children: [], val, max, ...extra });

function setNodes(nodes) {
  _state.reset();
  _state.set({ nodes: [{ id: 'center', type: 'center' }, ...nodes] });
  // wire each branch's children for the active-children / leaf logic
  const data = _state.get();
  for (const b of data.nodes.filter(n => n.type === 'branch')) {
    b.children = data.nodes.filter(n => n.parent === b.id).map(n => n.id);
  }
}

describe('computeWeekStats — counts lens', () => {
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

  it('splits the global 2×2 by count', () => {
    const c = computeWeekStats().global.counts;
    expect(c.plannedDone).toBe(1);
    expect(c.plannedOpen).toBe(2);
    expect(c.unplannedDone).toBe(1);
    expect(c.unplannedOpen).toBe(1);
    expect(c.total).toBe(5);
    expect(c.done).toBe(2);
    expect(c.completionPct).toBe(40); // 2/5
  });

  it('reports per-branch counts', () => {
    const c = computeWeekStats().perBranch.work.counts;
    expect(c.total).toBe(5);
    expect(c.unplannedDone + c.unplannedOpen).toBe(2);
  });
});

describe('computeWeekStats — counter semantics', () => {
  it('counts a counter as ONE task, done iff val>=max', () => {
    setNodes([
      mkBranch('work'),
      mkCounter('c1', 'work', 10, 10), // at max → done
      mkCounter('c2', 'work', 3, 10),  // partial → open
    ]);
    const c = computeWeekStats().global.counts;
    expect(c.total).toBe(2);
    expect(c.plannedDone).toBe(1);
    expect(c.plannedOpen).toBe(1);
  });

  it('weights a counter fractionally by val/max', () => {
    setNodes([mkBranch('work'), mkCounter('c1', 'work', 3, 10)]);
    const w = computeWeekStats().global.weighted;
    expect(w.total).toBe(10); // max × weight(1)
    expect(w.done).toBe(3);   // val × weight(1)
    expect(w.percent).toBe(30);
  });

  it('treats a degenerate max<=0 counter as one open task', () => {
    setNodes([mkBranch('work'), mkCounter('c1', 'work', 0, 0)]);
    const c = computeWeekStats().global.counts;
    expect(c.total).toBe(1);
    expect(c.plannedOpen).toBe(1);
    expect(c.plannedDone).toBe(0);
  });
});

describe('computeWeekStats — weighted lens by priority', () => {
  it('applies critical=5, high=3, normal=1', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { priority: 'critical', done: true }),  // 5 done / 5 total
      mkAct('a2', 'work', { priority: 'high', done: false }),     // 0 / 3
      mkAct('a3', 'work', { done: true }),                        // 1 / 1
    ]);
    const w = computeWeekStats().global.weighted;
    expect(w.total).toBe(9);            // 5 + 3 + 1
    expect(w.done).toBe(6);             // 5 + 0 + 1
    expect(w.percent).toBe(67);         // round(6/9)
  });
});

describe('computeWeekStats — structural rules', () => {
  it('excludes _editing nodes entirely', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { done: true }),
      mkAct('a2', 'work', { _editing: true }),
    ]);
    const c = computeWeekStats().global.counts;
    expect(c.total).toBe(1);
  });

  it('counts only leaves (parent with active children is not a leaf)', () => {
    setNodes([
      mkBranch('work'),
      mkAct('p', 'work', { done: false, children: ['child'] }),
      { id: 'child', type: 'activity', branch: 'work', parent: 'p', children: [], done: true },
    ]);
    // re-wire: branch children should reference 'p' only; 'p' keeps its own child
    const data = _state.get();
    data.nodes.find(n => n.id === 'work').children = ['p'];
    const c = computeWeekStats().global.counts;
    expect(c.total).toBe(1);       // only the leaf 'child'
    expect(c.plannedDone).toBe(1);
  });

  it('handles an empty week without dividing by zero', () => {
    setNodes([mkBranch('work')]);
    const g = computeWeekStats().global;
    expect(g.counts.total).toBe(0);
    expect(g.counts.completionPct).toBe(0);
    expect(g.weighted.percent).toBe(0);
  });

  it('gives a branch with no tasks a zeroed entry', () => {
    setNodes([mkBranch('work'), mkBranch('me'), mkAct('a1', 'work', { done: true })]);
    const me = computeWeekStats().perBranch.me;
    expect(me.counts.total).toBe(0);
    expect(me.weighted.total).toBe(0);
  });

  it('reports an all-planned week with zero unplanned', () => {
    setNodes([mkBranch('work'), mkAct('a1', 'work', { done: true }), mkAct('a2', 'work')]);
    const c = computeWeekStats().global.counts;
    expect(c.unplannedDone + c.unplannedOpen).toBe(0);
    expect(c.plannedDone + c.plannedOpen).toBe(2);
  });

  it('reports an all-unplanned week', () => {
    setNodes([
      mkBranch('work'),
      mkAct('a1', 'work', { done: true, unplanned: true }),
      mkAct('a2', 'work', { unplanned: true }),
    ]);
    const c = computeWeekStats().global.counts;
    expect(c.plannedDone + c.plannedOpen).toBe(0);
    expect(c.unplannedDone).toBe(1);
    expect(c.unplannedOpen).toBe(1);
  });
});
