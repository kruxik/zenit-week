import { describe, it, expect, beforeEach } from 'vitest';
import { _state, computeWeekStats } from './setup.js';

// The top-of-mindmap mini-stats box was removed; its completion math lives in
// computeWeekStats (which now feeds the Stats panel), so assert that directly.
describe('Week completion stats', () => {
  beforeEach(() => {
    _state.reset();
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', children: ['a1', 'a2', 'a3'] },
        { id: 'a1', type: 'activity', branch: 'b1', parent: 'b1', done: true },
        { id: 'a2', type: 'activity', branch: 'b1', parent: 'b1', done: false },
        { id: 'a3', type: 'activity', branch: 'b1', parent: 'b1', priority: 'high', done: false }
      ]
    });
  });

  it('calculates global completion correctly', () => {
    // a1: weight 1, done; a2: weight 1; a3: weight 3 (high). Total 5, done 1 → 20%.
    const { global } = computeWeekStats();
    expect(global.done).toBe(1);
    expect(global.total).toBe(5);
    expect(global.percent).toBe(20);
  });

  it('handles counters in completion', () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', children: ['c1'] },
        { id: 'c1', type: 'counter', branch: 'b1', parent: 'b1', val: 5, max: 10 }
      ]
    });
    // Counter c1: val 5 of max 10 → done 5, total 10, 50%.
    const { global } = computeWeekStats();
    expect(global.done).toBe(5);
    expect(global.total).toBe(10);
    expect(global.percent).toBe(50);
  });
});
