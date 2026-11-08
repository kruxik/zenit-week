import { describe, it, expect, beforeEach } from 'vitest';
import { _state, computeLayout, horizonFilterMatchSet, effectiveHorizon, createTask } from './setup.js';

// The Vision's horizon filter: the day filter's pruning, read on horizons.

const vb = (id, children) => ({ id, type: 'branch', branch: id, label: 'Area ' + id, children, _ts: 1 });
const act = (id, parent, branch, children = [], extra = {}) =>
  ({ id, type: 'activity', branch, parent, label: 'I ' + id, children, _ts: 1, ...extra });

function vision() {
  return {
    nodes: [
      { id: 'center', type: 'center', children: ['nva', 'nvb'] },
      vb('nva', ['a1', 'a2']),
      act('a1', 'nva', 'nva', ['a11'], { horizon: 'year' }),
      act('a11', 'a1', 'nva'),                          // inherits 'year'
      act('a2', 'nva', 'nva', [], { horizon: 'someday' }),
      vb('nvb', ['b1']),
      act('b1', 'nvb', 'nvb'),                          // no horizon
    ],
    tombstones: [], crdtVersion: 1,
  };
}

beforeEach(() => {
  _state.clearIDBStore();
  _state.reset();
  _state.setViewLevel('full');
  _state.setDayFilter(null);
  _state.setHorizonFilter(null);
  _state.setMapKind('vision');
  _state.set(vision());
});

const node = id => _state.get().nodes.find(n => n.id === id);

describe('horizon filter', () => {
  it('is off by default: nothing pruned', () => {
    expect(horizonFilterMatchSet()).toBeNull();
  });

  it('a sub-intention inherits its parent\'s horizon', () => {
    expect(effectiveHorizon(node('a11'))).toBe('year');
    expect(effectiveHorizon(node('b1'))).toBeNull();
  });

  it('This year keeps the matching intention, its steps and its branch', () => {
    _state.setHorizonFilter('year');
    const pos = computeLayout();
    for (const id of ['nva', 'a1', 'a11']) expect(pos[id]).toBeTruthy();
    for (const id of ['a2', 'nvb', 'b1']) expect(pos[id]).toBeUndefined();
  });

  it('No horizon keeps only intentions with none of their own or inherited', () => {
    _state.setHorizonFilter('none');
    const set = horizonFilterMatchSet();
    expect([...set].sort()).toEqual(['b1', 'center', 'nvb']);
  });

  it('a new intention added under a horizon filter takes that horizon', () => {
    _state.setHorizonFilter('someday');
    const n = createTask('nvb', 'Sail across', { stampFilterDay: true });
    expect(n.horizon).toBe('someday');
    expect(horizonFilterMatchSet().has(n.id)).toBe(true);
  });

  it('a step under a matching intention is not stamped, it inherits', () => {
    _state.setHorizonFilter('year');
    const n = createTask('a1', 'Step', { stampFilterDay: true });
    expect(n.horizon).toBeUndefined();
    expect(horizonFilterMatchSet().has(n.id)).toBe(true);
  });

  it('an agent add (no stamp) rides along until the filter changes', () => {
    _state.setHorizonFilter('year');
    const n = createTask('nvb', 'Agent idea', { stampFilterDay: false });
    expect(n.horizon).toBeUndefined();
    expect(horizonFilterMatchSet().has(n.id)).toBe(true);
  });

  it('a week ignores the horizon filter', () => {
    _state.setHorizonFilter('year');
    _state.setMapKind('week');
    _state.set({ nodes: [{ id: 'center', type: 'center', children: ['w'] }, vb('w', [])] });
    expect(computeLayout().w).toBeTruthy();
  });
});
