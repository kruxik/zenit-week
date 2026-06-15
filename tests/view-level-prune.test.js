import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { _state, computeLayout, rebuildNodeMap } from './setup.js';

// Rocks/Pebbles/Sand hide deep nodes by pruning them from the layout entirely
// (no position → render() skips them), which also lets the surviving parents
// pack together. These tests pin that pruning + repack behavior.
describe('view-level layout pruning', () => {
  beforeEach(() => _state.reset());
  afterEach(() => _state.setViewLevel('full'));

  // center → b1 → a1 (activity, depth 2) → s1 (sub-task, depth 3)
  function buildTree() {
    return {
      nodes: [
        { id: 'center', type: 'center', label: 'Week', children: ['b1'] },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a1'] },
        { id: 'a1', type: 'activity', parent: 'b1', branch: 'b1', label: 'Task', children: ['s1'] },
        { id: 's1', type: 'activity', parent: 'a1', branch: 'b1', label: 'Sub', children: [] },
      ],
    };
  }

  function layoutAt(level) {
    _state.set(buildTree());
    rebuildNodeMap();
    _state.setViewLevel(level);
    return computeLayout();
  }

  test('Sand (full) keeps every node positioned', () => {
    const pos = layoutAt('full');
    expect(pos['b1']).toBeDefined();
    expect(pos['a1']).toBeDefined();
    expect(pos['s1']).toBeDefined();
  });

  test('Pebbles prunes depth-3 sub-tasks but keeps activities', () => {
    const pos = layoutAt('pebbles');
    expect(pos['a1']).toBeDefined();
    expect(pos['s1']).toBeUndefined();
  });

  test('Rocks prunes everything below the branches', () => {
    const pos = layoutAt('rocks');
    expect(pos['b1']).toBeDefined();
    expect(pos['a1']).toBeUndefined();
    expect(pos['s1']).toBeUndefined();
  });

  test('pruning sub-tasks packs sibling activities tighter', () => {
    // One branch with 3 activities, each carrying a stack of 3 sub-tasks. In Sand
    // each activity reserves height for its whole sub-task stack, so the
    // activities spread far apart; in Pebbles the sub-tasks are pruned and the
    // activities collapse together.
    const nodes = [
      { id: 'center', type: 'center', label: 'Week', children: ['R'] },
      { id: 'R', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a0', 'a1', 'a2'] },
    ];
    for (let i = 0; i < 3; i++) {
      const subIds = [0, 1, 2].map(j => `s${i}_${j}`);
      nodes.push({ id: `a${i}`, type: 'activity', parent: 'R', branch: 'R', label: `Task ${i}`, children: subIds });
      subIds.forEach(sId =>
        nodes.push({ id: sId, type: 'activity', parent: `a${i}`, branch: 'R', label: `Sub ${sId}`, children: [] }));
    }
    _state.set({ nodes });
    rebuildNodeMap();

    _state.setViewLevel('full');
    const sand = computeLayout();
    const sandSpan = sand['a2'].y - sand['a0'].y;

    _state.setViewLevel('pebbles');
    const pebbles = computeLayout();
    const pebblesSpan = pebbles['a2'].y - pebbles['a0'].y;

    expect(pebblesSpan).toBeLessThan(sandSpan);
  });
});
