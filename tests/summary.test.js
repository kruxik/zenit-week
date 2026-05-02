import { describe, it, expect, beforeEach } from 'vitest';
import { _state, updateSummary } from './setup.js';

describe('Summary Logic', () => {
  beforeEach(() => {
    _state.reset();
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', children: ['a1', 'a2'] },
        { id: 'a1', type: 'activity', branch: 'b1', parent: 'b1', done: true },
        { id: 'a2', type: 'activity', branch: 'b1', parent: 'b1', done: false },
        { id: 'a3', type: 'activity', branch: 'b1', parent: 'b1', priority: 'high', done: false }
      ]
    });
    // a1 is done, a2 and a3 are not.
    // children of b1: a1, a2, a3. 
    // Wait, children of b1 should be ['a1', 'a2', 'a3'] if I want them all counted.
    const data = _state.get();
    data.nodes.find(n => n.id === 'b1').children = ['a1', 'a2', 'a3'];
  });

  it('calculates global completion correctly', () => {
    updateSummary();
    const el = _state.getElement('summary-main');
    // a1: weight 1, done: 1
    // a2: weight 1, done: 0
    // a3: weight 3, done: 0
    // Total: 1+1+3 = 5
    // Done: 1
    // Percent: 1/5 = 20%
    expect(el.innerHTML).toContain('20&nbsp;%');
    expect(el.innerHTML).toContain('1 '); // Done count
    expect(el.innerHTML).toContain('5'); // Total count
  });

  it('handles counters in summary', () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', children: ['c1'] },
        { id: 'c1', type: 'counter', branch: 'b1', parent: 'b1', val: 5, max: 10 }
      ]
    });
    updateSummary();
    const el = _state.getElement('summary-main');
    // Counter c1: val 5, max 10. weight 1.
    // Total: 10
    // Done: 5
    // Percent: 50%
    expect(el.innerHTML).toContain('50&nbsp;%');
    expect(el.innerHTML).toContain('5 ');
    expect(el.innerHTML).toContain('10');
  });
});
