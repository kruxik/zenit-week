import { describe, it, expect, beforeEach } from 'vitest';
import { _state, touchNode, setStatus } from './setup.js';

// Build a small seeded-style week: one branch with two demo activities.
function seededWeek() {
  return {
    nodes: [
      { id: 'work', type: 'branch', branch: 'work', label: 'Work', side: 'left', children: ['a1', 'a2'] },
      { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'A1', _demo: true, _ts: 1, children: [] },
      { id: 'a2', type: 'activity', branch: 'work', parent: 'work', label: 'A2', _demo: true, _ts: 1, children: [] },
    ],
    tombstones: [],
    crdtVersion: 0,
  };
}

describe('Onboarding _demo drop-on-touch (S2)', () => {
  beforeEach(() => {
    _state.reset();
    _state.setWeekKey('2026-20');
    _state.set(seededWeek());
  });

  it('touchNode drops _demo and bumps _ts on the affected node', () => {
    const before = _state.get().nodes.find(n => n.id === 'a1');
    expect(before._demo).toBe(true);
    touchNode('a1');
    const after = _state.get().nodes.find(n => n.id === 'a1');
    expect(after._demo).toBeUndefined();
    expect(typeof after._ts).toBe('number');
    expect(after._ts).toBeGreaterThan(1);
  });

  it('touchNode({keepDemo:true}) preserves _demo for bulk layout ops, still bumps _ts', () => {
    touchNode('a1', { keepDemo: true });
    const a1 = _state.get().nodes.find(n => n.id === 'a1');
    expect(a1._demo).toBe(true);
    expect(a1._ts).toBeGreaterThan(1);
  });

  it('does not touch unrelated nodes', () => {
    touchNode('a1');
    const a2 = _state.get().nodes.find(n => n.id === 'a2');
    expect(a2._demo).toBe(true);
  });

  it('marking a seed node done (a real mutator) drops its _demo; siblings keep theirs', () => {
    setStatus('a1', 'done');
    const a1 = _state.get().nodes.find(n => n.id === 'a1');
    const a2 = _state.get().nodes.find(n => n.id === 'a2');
    expect(a1.done).toBe(true);
    expect(a1._demo).toBeUndefined();
    expect(a2._demo).toBe(true);
  });

  it('changing priority on a seed node drops its _demo', () => {
    setStatus('a2', 'prio-high');
    const a2 = _state.get().nodes.find(n => n.id === 'a2');
    expect(a2.priority).toBe('high');
    expect(a2._demo).toBeUndefined();
  });

  it('marking unplanned on a seed node drops its _demo', () => {
    setStatus('a1', 'unplanned');
    const a1 = _state.get().nodes.find(n => n.id === 'a1');
    expect(a1.unplanned).toBe(true);
    expect(a1._demo).toBeUndefined();
  });
});
