import { describe, it, expect, beforeEach } from 'vitest';
import { _state, computeLayout, nodeDisplayLabel, setCollapsed, focusBranch, clearBranchFocus,
  focusedNodeIds, mindmapNodeBounds, collapsedCount, edgeEndpoints } from './setup.js';

// The Vision's map vocabulary: collapse prunes a subtree and counts it, focus
// covers exactly one branch, and the horizon rides on the label.

const vb = (id, children, side) => ({ id, type: 'branch', branch: id, label: 'Area ' + id, children, side, _ts: 1 });
const act = (id, parent, branch, children = [], extra = {}) =>
  ({ id, type: 'activity', branch, parent, label: 'I ' + id, children, _ts: 1, ...extra });

function vision() {
  return {
    nodes: [
      vb('nva', ['a1', 'a2'], 'left'),
      act('a1', 'nva', 'nva', ['a11', 'a12']),
      act('a11', 'a1', 'nva', ['a111']),
      act('a111', 'a11', 'nva'),
      act('a12', 'a1', 'nva'),
      act('a2', 'nva', 'nva'),
      vb('nvb', ['b1'], 'right'),
      act('b1', 'nvb', 'nvb'),
    ],
    tombstones: [], crdtVersion: 1,
  };
}

beforeEach(() => {
  _state.clearIDBStore();
  _state.reset();
  _state.setViewLevel('full');
  _state.setDayFilter(null);
  _state.setMapKind('vision');
  _state.set(vision());
  clearBranchFocus();
});

describe('collapse', () => {
  it('prunes the whole subtree from layout and keeps the node itself', () => {
    expect(setCollapsed('a1', true)).toBe(true);
    const pos = computeLayout();
    expect(pos.a1).toBeTruthy();
    for (const hidden of ['a11', 'a12', 'a111']) expect(pos[hidden]).toBeUndefined();
    expect(pos.a2).toBeTruthy();
    expect(pos.b1).toBeTruthy();
  });

  it('counts every hidden descendant, not just the children', () => {
    expect(collapsedCount('a1')).toBe(3);
    expect(collapsedCount('nva')).toBe(5);
  });

  it('is layout: _posTs moves, _ts does not, and no undo entry', () => {
    const n = _state.get().nodes.find(x => x.id === 'a1');
    const ts = n._ts;
    setCollapsed('a1', true);
    expect(n._ts).toBe(ts);
    expect(n._posTs).toBeGreaterThan(0);
    expect(_state.getVisionUndoStack()).toHaveLength(0);
  });

  it('a leaf cannot collapse, and expanding brings the subtree back', () => {
    expect(setCollapsed('a2', true)).toBe(false);
    setCollapsed('a1', true);
    setCollapsed('a1', false);
    expect(computeLayout().a111).toBeTruthy();
    expect(_state.get().nodes.find(x => x.id === 'a1')).not.toHaveProperty('collapsed');
  });

  it('is refused on a week', () => {
    _state.setMapKind('week');
    expect(setCollapsed('a1', true)).toBe(false);
  });
});

describe('focus', () => {
  it('covers the branch and all of its descendants, nothing else', () => {
    focusBranch('nva');
    const ids = focusedNodeIds();
    expect([...ids].sort()).toEqual(['a1', 'a11', 'a111', 'a12', 'a2', 'nva']);
  });

  it('the fit box is exactly the focused branch', () => {
    focusBranch('nva');
    const pos = computeLayout();
    const box = mindmapNodeBounds(pos, focusedNodeIds());
    const own = ['nva', 'a1', 'a11', 'a111', 'a12', 'a2'].map(id => pos[id]);
    expect(box.minX).toBeCloseTo(Math.min(...own.map(p => p.x - p.w / 2)));
    expect(box.maxX).toBeCloseTo(Math.max(...own.map(p => p.x + p.w / 2)));
    expect(box.maxX).toBeLessThan(pos.nvb.x - pos.nvb.w / 2);
  });

  it('another branch replaces the focus; clearing ends it', () => {
    focusBranch('nva');
    focusBranch('nvb');
    expect([...focusedNodeIds()].sort()).toEqual(['b1', 'nvb']);
    expect(clearBranchFocus()).toBe(true);
    expect(focusedNodeIds()).toBeNull();
  });

  it('an intention cannot be focused, only a branch', () => {
    focusBranch('a1');
    expect(focusedNodeIds()).toBeNull();
  });
});

describe('horizon annotation', () => {
  it('rides on the display label and never on the label', () => {
    const n = _state.get().nodes.find(x => x.id === 'a2');
    n.horizon = 'someday';
    expect(nodeDisplayLabel(n)).toBe('I a2 · someday');
    expect(n.label).toBe('I a2');
  });

  it('Czech uses its own words', () => {
    const n = _state.get().nodes.find(x => x.id === 'a2');
    n.horizon = 'years';
    _state.setLang('cs');
    expect(nodeDisplayLabel(n)).toBe('I a2 · za pár let');
    _state.setLang('en');
  });
});

describe('root lines', () => {
  it('reach the plate on the Vision, where there is no ring, and the ring on a week', () => {
    const pos = computeLayout();
    const at = id => pos[id];
    const vision = edgeEndpoints('center', 'nvb', at).x1;
    _state.setMapKind('week');
    const week = edgeEndpoints('center', 'nvb', at).x1;
    expect(vision).toBeGreaterThan(0);
    expect(vision).toBeLessThan(week);
  });
});
