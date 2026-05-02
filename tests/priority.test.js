import { describe, it, expect, beforeEach } from 'vitest';
import { _state, findNode, getPriorityWeight, getPriorityScale } from './setup.js';

describe('Priority Logic', () => {
  beforeEach(() => {
    _state.reset();
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'a1', type: 'activity', parent: 'center', priority: 'normal' },
        { id: 'a2', type: 'activity', parent: 'center', priority: 'high' },
        { id: 'a3', type: 'activity', parent: 'center', priority: 'critical' }
      ]
    });
  });

  it('calculates correct weights for priorities', () => {
    expect(getPriorityWeight('a1')).toBe(1);
    expect(getPriorityWeight('a2')).toBe(3);
    expect(getPriorityWeight('a3')).toBe(5);
  });

  it('calculates correct visual scales for priorities', () => {
    expect(getPriorityScale('a1')).toBe(1.0);
    expect(getPriorityScale('a2')).toBe(1.5);
    expect(getPriorityScale('a3')).toBe(2.0);
  });
});
