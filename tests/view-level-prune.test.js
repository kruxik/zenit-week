import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { _state, computeLayout, rebuildNodeMap } from './setup.js';

// Rocks/Pebbles/Sand hide deep nodes by pruning them from the layout entirely
// (no position → render() skips them), which also lets the surviving parents
// pack together. These tests pin that pruning + repack behavior.
describe('view-level layout pruning', () => {
  beforeEach(() => _state.reset());
  afterEach(() => _state.setViewLevel('full'));

  // center → b1 → a1 (activity, depth 2) → s1 (sub-task, depth 3) → s2 (depth 4)
  function buildTree() {
    return {
      nodes: [
        { id: 'center', type: 'center', label: 'Week', children: ['b1'] },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a1'] },
        { id: 'a1', type: 'activity', parent: 'b1', branch: 'b1', label: 'Task', children: ['s1'] },
        { id: 's1', type: 'activity', parent: 'a1', branch: 'b1', label: 'Sub', children: ['s2'] },
        { id: 's2', type: 'activity', parent: 's1', branch: 'b1', label: 'Sub sub', children: [] },
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
    expect(pos['s2']).toBeDefined();
  });

  test('Pebbles prunes depth-4 sub-tasks but keeps the first sub-task level', () => {
    const pos = layoutAt('pebbles');
    expect(pos['a1']).toBeDefined();
    expect(pos['s1']).toBeDefined();
    expect(pos['s2']).toBeUndefined();
  });

  test('Rocks prunes everything below the branch activities', () => {
    const pos = layoutAt('rocks');
    expect(pos['b1']).toBeDefined();
    expect(pos['a1']).toBeDefined();
    expect(pos['s1']).toBeUndefined();
    expect(pos['s2']).toBeUndefined();
  });

  test('pruning sub-tasks packs sibling activities tighter', () => {
    // One branch with 3 activities, each carrying one sub-task that in turn holds
    // a stack of 3 depth-4 sub-tasks. In Sand each activity reserves height for
    // that whole stack, so the activities spread far apart; in Pebbles the
    // depth-4 nodes are pruned and the activities collapse together.
    const nodes = [
      { id: 'center', type: 'center', label: 'Week', children: ['R'] },
      { id: 'R', type: 'branch', parent: 'center', label: 'Work', side: 'right', children: ['a0', 'a1', 'a2'] },
    ];
    for (let i = 0; i < 3; i++) {
      const deepIds = [0, 1, 2].map(j => `d${i}_${j}`);
      nodes.push({ id: `a${i}`, type: 'activity', parent: 'R', branch: 'R', label: `Task ${i}`, children: [`s${i}`] });
      nodes.push({ id: `s${i}`, type: 'activity', parent: `a${i}`, branch: 'R', label: `Sub ${i}`, children: deepIds });
      deepIds.forEach(dId =>
        nodes.push({ id: dId, type: 'activity', parent: `s${i}`, branch: 'R', label: `Deep ${dId}`, children: [] }));
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
