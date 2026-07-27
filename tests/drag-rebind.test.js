import { describe, it, expect, beforeEach } from 'vitest';
import { _state, handleNodeDrop, findNode } from './setup.js';

// Work → Family rebind of a subtree:
//   work → "Test Work" → { Alfa, Beta }
// Dragging "Test Work" onto the Family branch must recolor the whole subtree,
// not just the dragged node — colors, summary stats and CFD filters all read
// each node's own `branch` field rather than walking up to its parent.
describe('Drag rebind across branches', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.set({
      nodes: [
        { id: 'center', type: 'center', label: '2026-W01', children: ['work', 'family'] },
        { id: 'work',   type: 'branch', branch: 'work',   label: 'Work',   children: ['t1'] },
        { id: 'family', type: 'branch', branch: 'family', label: 'Family', children: [] },
        { id: 't1', type: 'activity', branch: 'work', label: 'Test Work', parent: 'work', children: ['a1', 'b1'] },
        { id: 'a1', type: 'activity', branch: 'work', label: 'Alfa', parent: 't1', children: ['a2'] },
        { id: 'a2', type: 'activity', branch: 'work', label: 'Alfa child', parent: 'a1', children: [] },
        { id: 'b1', type: 'activity', branch: 'work', label: 'Beta', parent: 't1', children: [] },
      ]
    });
  });

  // Stage a drag of `t1` so that the drop point lands exactly on `family`.
  // Viewport is pinned to 1:1 so client coordinates equal world coordinates.
  function stageDrag() {
    _state.setViewport({ panX: 0, panY: 0, zoom: 1 });
    _state.setDragState({
      activeNodeId: 't1',
      layoutPositions: {
        work:   { x: -400, y: 0,   w: 160, h: 64 },
        family: { x: -400, y: 200, w: 160, h: 64 },
        t1:     { x: 0,    y: 0,   w: 160, h: 64 },
        a1:     { x: 200,  y: -40, w: 160, h: 64 },
        a2:     { x: 400,  y: -40, w: 160, h: 64 },
        b1:     { x: 200,  y: 40,  w: 160, h: 64 },
      },
      descendantSet: new Set(['t1', 'a1', 'a2', 'b1']),
    });
  }

  it('reparents the dragged node onto the drop target', () => {
    stageDrag();
    handleNodeDrop(-400, 200);

    const t1 = findNode('t1');
    expect(t1.parent).toBe('family');
    expect(t1.branch).toBe('family');
    expect(findNode('family').children).toContain('t1');
    expect(findNode('work').children).not.toContain('t1');
  });

  it('cascades the new branch to every descendant', () => {
    stageDrag();
    handleNodeDrop(-400, 200);

    for (const id of ['a1', 'a2', 'b1']) {
      expect(findNode(id).branch, `${id} should follow its parent to Family`).toBe('family');
    }
  });

  it('bumps _ts on rebranded descendants so Drive merge keeps the move', () => {
    stageDrag();
    const before = ['a1', 'a2', 'b1'].map(id => findNode(id)._ts || 0);
    handleNodeDrop(-400, 200);

    ['a1', 'a2', 'b1'].forEach((id, i) => {
      expect(findNode(id)._ts, `${id} must be touched`).toBeGreaterThan(before[i]);
    });
  });

  it('leaves branch untouched when rebinding within the same branch', () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center', label: '2026-W01', children: ['work'] },
        { id: 'work', type: 'branch', branch: 'work', label: 'Work', children: ['t1', 'x1'] },
        { id: 't1', type: 'activity', branch: 'work', label: 'Test Work', parent: 'work', children: ['a1'] },
        { id: 'a1', type: 'activity', branch: 'work', label: 'Alfa', parent: 't1', children: [] },
        { id: 'x1', type: 'activity', branch: 'work', label: 'Other', parent: 'work', children: [] },
      ]
    });
    _state.setViewport({ panX: 0, panY: 0, zoom: 1 });
    _state.setDragState({
      activeNodeId: 't1',
      layoutPositions: {
        work: { x: -400, y: 0,   w: 160, h: 64 },
        t1:   { x: 0,    y: 0,   w: 160, h: 64 },
        a1:   { x: 200,  y: 0,   w: 160, h: 64 },
        x1:   { x: 0,    y: 200, w: 160, h: 64 },
      },
      descendantSet: new Set(['t1', 'a1']),
    });
    const beforeTs = findNode('a1')._ts || 0;

    handleNodeDrop(0, 200); // drop onto x1

    expect(findNode('t1').parent).toBe('x1');
    expect(findNode('t1').branch).toBe('work');
    expect(findNode('a1').branch).toBe('work');
    expect(findNode('a1')._ts || 0).toBe(beforeTs); // no needless touch
  });
});
