import { describe, it, expect, beforeEach } from 'vitest';
import { _state, updateCounter, findNode } from './setup.js';

describe('Counter Logic', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.set({
      nodes: [
        { id: 'center', type: 'center', label: '2026-W18' },
        { id: 'b1', type: 'branch', label: 'Work', parent: 'center', children: ['a1'] },
        { id: 'a1', type: 'activity', label: 'Pushups 10x', parent: 'b1', children: ['c1'] },
        { id: 'c1', type: 'counter', label: '10x', parent: 'a1', val: 0, max: 10, ticks: [] }
      ]
    });
  });

  it('increments counter and adds tick', () => {
    updateCounter('c1', 1);
    const node = findNode('c1');
    expect(node.val).toBe(1);
    expect(node.ticks.length).toBe(1);
    expect(node.done).toBe(false);
  });

  it('decrements counter and removes tick', () => {
    updateCounter('c1', 1);
    updateCounter('c1', 1);
    updateCounter('c1', -1);
    const node = findNode('c1');
    expect(node.val).toBe(1);
    expect(node.ticks.length).toBe(1);
  });

  it('does not decrement below 0', () => {
    updateCounter('c1', -1);
    const node = findNode('c1');
    expect(node.val).toBe(0);
    expect(node.ticks.length).toBe(0);
  });

  it('marks node as done when reaching max', () => {
    // Set to 9
    const node = findNode('c1');
    node.val = 9;
    updateCounter('c1', 1);
    
    const updated = findNode('c1');
    expect(updated.val).toBe(10);
    expect(updated.done).toBe(true);
    expect(updated.doneAt).toBeDefined();
    // Ticks are for intermediate increments, not the final one that marks it done (per code logic)
    expect(updated.ticks.length).toBe(0); 
  });

  it('unmarks done when decrementing from max', () => {
    const node = findNode('c1');
    node.val = 10;
    node.done = true;
    node.doneAt = 'some-date';
    
    updateCounter('c1', -1);
    
    const updated = findNode('c1');
    expect(updated.val).toBe(9);
    expect(updated.done).toBe(false);
    expect(updated.doneAt).toBeUndefined();
  });

  it('propagates status up to parent activity', () => {
    const node = findNode('c1');
    node.val = 9;
    
    updateCounter('c1', 1);
    
    const parent = findNode('a1');
    expect(parent.done).toBe(true);
  });
});
