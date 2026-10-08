import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { _state, computeLayout, rebuildNodeMap, stepPebbles, cycleViewLevel } from './setup.js';

// Rocks/Pebbles/Sand hide deep nodes by pruning them from the layout entirely
// (no position → render() skips them), which also lets the surviving parents
// pack together. These tests pin that pruning + repack behavior.
// Remove a leaf from the current tree so Pebbles has nothing left to hide.
function removeLeaf(id) {
  const data = _state.get();
  const node = data.nodes.find(n => n.id === id);
  const parent = data.nodes.find(n => n.id === node.parent);
  parent.children = parent.children.filter(c => c !== id);
  data.nodes = data.nodes.filter(n => n.id !== id);
  rebuildNodeMap();
}

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

  test('pressing Pebbles again reveals one more level; the step that would show everything is Sand', () => {
    // add depth 5 so Pebbles has one real step deeper
    const tree = buildTree();
    tree.nodes.find(n => n.id === 's2').children = ['s3'];
    tree.nodes.push({ id: 's3', type: 'activity', parent: 's2', branch: 'b1', label: 'Deep', children: [] });
    _state.set(tree);
    rebuildNodeMap();
    _state.setViewLevel('full');
    stepPebbles(); // Sand → Pebbles: base depth
    expect(computeLayout()['s2']).toBeUndefined();
    stepPebbles(); // one level deeper, s3 still hidden
    expect(_state.getViewLevel()).toBe('pebbles');
    expect(computeLayout()['s2']).toBeDefined();
    expect(computeLayout()['s3']).toBeUndefined();
    stepPebbles(); // next step would hide nothing → Sand
    expect(_state.getViewLevel()).toBe('full');
  });

  test('V walks Sand → Rocks → Pebbles → Sand, never a Pebbles step equal to Sand', () => {
    layoutAt('full');
    cycleViewLevel();
    expect(_state.getViewLevel()).toBe('rocks');
    cycleViewLevel();
    expect(_state.getViewLevel()).toBe('pebbles');
    expect(computeLayout()['s2']).toBeUndefined();
    cycleViewLevel(); // one level deeper would show all → Sand
    expect(_state.getViewLevel()).toBe('full');
  });

  test('Rocks → Pebbles goes straight to Sand when Pebbles would hide nothing', () => {
    _state.set(buildTree());
    rebuildNodeMap();
    _state.setViewLevel('rocks');
    removeLeaf('s2');
    stepPebbles();
    expect(_state.getViewLevel()).toBe('full');
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
