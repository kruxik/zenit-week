import { describe, it, expect } from 'vitest';
import { _weekCompletion } from './setup.js';

// _weekCompletion powers the 4-week Cumulative Flow Diagram. It must compute the
// SAME weighted planned/unplanned × done/open split as computeWeekStats()'s
// statsOf(), but on an arbitrary week object (historical weeks loaded from IDB), so
// it is fully self-contained (no global nodeMap).

describe('_weekCompletion (4-week CFD)', () => {
  it('returns null for missing / malformed data', () => {
    expect(_weekCompletion(null)).toBe(null);
    expect(_weekCompletion({})).toBe(null);
    expect(_weekCompletion({ nodes: 'nope' })).toBe(null);
  });

  it('returns null for a blank week (no leaves → an empty column)', () => {
    expect(_weekCompletion({ nodes: [{ id: 'center', type: 'center' }] })).toBe(null);
  });

  it('splits leaves into planned/unplanned × done/open, weighted by priority', () => {
    const data = { nodes: [
      { id: 'center', type: 'center' },
      { id: 'b1', type: 'branch', parent: 'center', children: ['a1', 'a2', 'a3', 'a4'] },
      { id: 'a1', type: 'activity', branch: 'b1', parent: 'b1', done: true },                          // planned done w1
      { id: 'a2', type: 'activity', branch: 'b1', parent: 'b1', priority: 'high', done: false },        // planned open w3
      { id: 'a3', type: 'activity', branch: 'b1', parent: 'b1', unplanned: true, priority: 'critical', done: true }, // unpl done w5
      { id: 'a4', type: 'activity', branch: 'b1', parent: 'b1', unplanned: true, done: false },         // unpl open w1
    ] };
    expect(_weekCompletion(data)).toEqual({
      plannedDone: 1, plannedOpen: 3, unplannedDone: 5, unplannedOpen: 1,
      total: 10, done: 6, percent: 60,
    });
  });

  it('counts only leaves — a parent with active children is excluded', () => {
    const data = { nodes: [
      { id: 'center', type: 'center' },
      { id: 'b1', type: 'branch', parent: 'center', children: ['a1'] },
      { id: 'a1', type: 'activity', branch: 'b1', parent: 'b1', children: ['c1'], done: true }, // not a leaf
      { id: 'c1', type: 'counter', branch: 'b1', parent: 'a1', val: 2, max: 4 },                 // leaf
    ] };
    // only c1 counts: planned done 2, planned open 2 → 50%
    expect(_weekCompletion(data)).toEqual({
      plannedDone: 2, plannedOpen: 2, unplannedDone: 0, unplannedOpen: 0,
      total: 4, done: 2, percent: 50,
    });
  });

  it('counts counters fractionally and applies their weight', () => {
    const data = { nodes: [
      { id: 'center', type: 'center' },
      { id: 'b1', type: 'branch', parent: 'center', children: ['c1'] },
      { id: 'c1', type: 'counter', branch: 'b1', parent: 'b1', priority: 'high', val: 1, max: 4 },
    ] };
    // weight 3 → done 1*3=3, open 3*3=9, total 12 → 25%
    expect(_weekCompletion(data)).toEqual({
      plannedDone: 3, plannedOpen: 9, unplannedDone: 0, unplannedOpen: 0,
      total: 12, done: 3, percent: 25,
    });
  });

  it('ignores nodes being edited', () => {
    const data = { nodes: [
      { id: 'center', type: 'center' },
      { id: 'b1', type: 'branch', parent: 'center', children: ['a1', 'a2'] },
      { id: 'a1', type: 'activity', branch: 'b1', parent: 'b1', done: true },
      { id: 'a2', type: 'activity', branch: 'b1', parent: 'b1', done: false, _editing: true },
    ] };
    // a2 skipped → planned done 1, total 1 → 100%
    expect(_weekCompletion(data)).toEqual({
      plannedDone: 1, plannedOpen: 0, unplannedDone: 0, unplannedOpen: 0,
      total: 1, done: 1, percent: 100,
    });
  });
});
