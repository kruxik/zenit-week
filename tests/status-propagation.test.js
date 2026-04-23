import {
  addNode, startAddNode, cancelEdit, deleteNode,
  setStatus, syncStatusUp, findNode,
  _state,
} from './setup.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mkBranch(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}

function mkActivity(id, parentId, branchId, extra = {}) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0, ...extra };
}

function mkCounter(id, parentId, branchId, val, max) {
  return { id, type: 'counter', branch: branchId, parent: parentId, label: String(val),
    val, max, done: val >= max, children: [], ticks: [], _ts: 0 };
}

function setUp(nodes) {
  _state.set({ nodes });
  _state.setWeekKey('2026-01');
  _state.reset();
}

// ─── Fix #1: Adding a child to a done parent clears parent done ───────────────

describe('fix #1 – adding a child to a done parent clears parent done', () => {
  // Tree: branch(work) → a1[done] → a2[done]
  function donedTree() {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', children: ['a2'] });
    const a2 = mkActivity('a2', 'a1',   'work', { done: true, doneAt: 'ts' });
    return [b, a1, a2];
  }

  test('addNode — parent becomes undone immediately', () => {
    setUp(donedTree());
    addNode('a1', 'new task');
    expect(findNode('a1').done).toBe(false);
  });

  test('startAddNode — parent becomes undone while editing', () => {
    setUp(donedTree());
    startAddNode('a1');
    expect(findNode('a1').done).toBe(false);
  });

  test('cancelling startAddNode restores parent to done', () => {
    setUp(donedTree());
    startAddNode('a1');
    cancelEdit();
    expect(findNode('a1').done).toBe(true);
  });
});

// ─── Fix #2: Deleting a child re-syncs parent done/unplanned ─────────────────

describe('fix #2 – deleting a child re-syncs parent done/unplanned', () => {
  test('deleting the only undone child makes parent done', () => {
    // a1[done:false] → [a2 done, a3 undone]; delete a3 → a1 should become done
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: false, children: ['a2', 'a3'] });
    const a2 = mkActivity('a2', 'a1',   'work', { done: true, doneAt: 'ts' });
    const a3 = mkActivity('a3', 'a1',   'work', { done: false });
    setUp([b, a1, a2, a3]);

    deleteNode('a3');

    expect(findNode('a1').done).toBe(true);
  });

  test('deleting a done child does not make parent done when other children are undone', () => {
    // a1[done:false] → [a2 done, a3 undone]; delete a2 → a1 should stay undone
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: false, children: ['a2', 'a3'] });
    const a2 = mkActivity('a2', 'a1',   'work', { done: true, doneAt: 'ts' });
    const a3 = mkActivity('a3', 'a1',   'work', { done: false });
    setUp([b, a1, a2, a3]);

    deleteNode('a2');

    expect(findNode('a1').done).toBe(false);
  });

  test('deleting the only non-unplanned child makes parent unplanned', () => {
    // a1[unplanned:false] → [a2 unplanned, a3 planned]; delete a3 → a1 unplanned
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { unplanned: false, children: ['a2', 'a3'] });
    const a2 = mkActivity('a2', 'a1',   'work', { unplanned: true, unplannedAt: 'ts' });
    const a3 = mkActivity('a3', 'a1',   'work', { unplanned: false });
    setUp([b, a1, a2, a3]);

    deleteNode('a3');

    expect(findNode('a1').unplanned).toBe(true);
  });
});

// ─── Fix #3: Drag reparent re-syncs done/unplanned on both parents ────────────

describe('fix #3 – reparenting re-syncs done/unplanned on old and new parent', () => {
  // Helper: simulate what the drag rebind handler now does
  function simulateReparent(nodeId, newParentId) {
    const node      = findNode(nodeId);
    const oldParent = findNode(node.parent);

    // Remove from old parent
    oldParent.children = oldParent.children.filter(id => id !== nodeId);
    // Re-sync old parent (node.parent still points to old parent)
    syncStatusUp(nodeId, 'done');
    syncStatusUp(nodeId, 'unplanned');

    // Attach to new parent
    const newParent = findNode(newParentId);
    node.parent = newParentId;
    newParent.children.push(nodeId);
    // Re-sync new parent
    syncStatusUp(nodeId, 'done');
    syncStatusUp(nodeId, 'unplanned');
  }

  test('moving a done node into a done parent keeps new parent done', () => {
    const b  = mkBranch('work', ['p1', 'p2']);
    const p1 = mkActivity('p1', 'work', 'work', { done: false, children: ['a1'] });
    const a1 = mkActivity('a1', 'p1',   'work', { done: true, doneAt: 'ts' });
    const p2 = mkActivity('p2', 'work', 'work', { done: true, doneAt: 'ts', children: ['a2'] });
    const a2 = mkActivity('a2', 'p2',   'work', { done: true, doneAt: 'ts' });
    setUp([b, p1, a1, p2, a2]);

    simulateReparent('a1', 'p2');

    expect(findNode('p2').done).toBe(true);
  });

  test('moving an undone node into a done parent makes new parent undone', () => {
    const b  = mkBranch('work', ['p1', 'p2']);
    const p1 = mkActivity('p1', 'work', 'work', { done: false, children: ['a1', 'a2'] });
    const a1 = mkActivity('a1', 'p1',   'work', { done: false }); // the node being moved
    const a2 = mkActivity('a2', 'p1',   'work', { done: true, doneAt: 'ts' });
    const p2 = mkActivity('p2', 'work', 'work', { done: true, doneAt: 'ts', children: ['a3'] });
    const a3 = mkActivity('a3', 'p2',   'work', { done: true, doneAt: 'ts' });
    setUp([b, p1, a1, a2, p2, a3]);

    simulateReparent('a1', 'p2');

    expect(findNode('p2').done).toBe(false);
  });

  test('moving the only undone node out of a parent makes old parent done', () => {
    const b  = mkBranch('work', ['p1', 'p2']);
    const p1 = mkActivity('p1', 'work', 'work', { done: false, children: ['a1', 'a2'] });
    const a1 = mkActivity('a1', 'p1',   'work', { done: false }); // the only undone child
    const a2 = mkActivity('a2', 'p1',   'work', { done: true, doneAt: 'ts' });
    const p2 = mkActivity('p2', 'work', 'work', { done: false, children: [] });
    setUp([b, p1, a1, a2, p2]);

    simulateReparent('a1', 'p2');

    expect(findNode('p1').done).toBe(true);
  });
});

// ─── Fix #4: Cascade undone resets counter to 0 ──────────────────────────────

describe('fix #4 – cascading undone resets counter val to 0', () => {
  test('marking a parent undone resets a done counter child to val=0', () => {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', children: ['c1'] });
    const c1 = mkCounter('c1', 'a1', 'work', 5, 5); // val=max → done
    setUp([b, a1, c1]);

    setStatus('a1', 'undone');

    const counter = findNode('c1');
    expect(counter.val).toBe(0);
    expect(counter.done).toBe(false);
    expect(counter.ticks).toEqual([]);
    expect(counter.doneAt).toBeUndefined();
  });

  test('cascade does not decrement — resets to 0 regardless of prior val', () => {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', children: ['c1'] });
    const c1 = mkCounter('c1', 'a1', 'work', 10, 10); // larger counter
    setUp([b, a1, c1]);

    setStatus('a1', 'undone');

    expect(findNode('c1').val).toBe(0);
  });
});

// ─── Fix #5: Cascade done sets doneAt on all activity descendants ─────────────

describe('fix #5 – cascading done sets doneAt on all activity nodes, not just leaves', () => {
  // Tree: branch → a1 → a2[intermediate] → a3[leaf]
  function threeLevel() {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: false, children: ['a2'] });
    const a2 = mkActivity('a2', 'a1',   'work', { done: false, children: ['a3'] });
    const a3 = mkActivity('a3', 'a2',   'work', { done: false });
    return [b, a1, a2, a3];
  }

  test('cascading done sets doneAt on intermediate activity a2', () => {
    setUp(threeLevel());
    setStatus('a1', 'done');
    expect(findNode('a2').done).toBe(true);
    expect(findNode('a2').doneAt).toBeDefined();
  });

  test('cascading done sets doneAt on leaf activity a3', () => {
    setUp(threeLevel());
    setStatus('a1', 'done');
    expect(findNode('a3').doneAt).toBeDefined();
  });

  test('cascading undone deletes doneAt from intermediate activity a2', () => {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', children: ['a2'] });
    const a2 = mkActivity('a2', 'a1',   'work', { done: true, doneAt: 'ts', children: ['a3'] });
    const a3 = mkActivity('a3', 'a2',   'work', { done: true, doneAt: 'ts' });
    setUp([b, a1, a2, a3]);

    setStatus('a1', 'undone');

    expect(findNode('a2').doneAt).toBeUndefined();
    expect(findNode('a3').doneAt).toBeUndefined();
  });
});

// ─── Fixes #6 & #7: syncStatusUp manages unplannedAt like doneAt ─────────────

describe('fix #6 – all children unplanned → parent gains unplannedAt', () => {
  test('parent gets unplannedAt when last planned child becomes unplanned', () => {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { unplanned: false, children: ['a2', 'a3'] });
    const a2 = mkActivity('a2', 'a1',   'work', { unplanned: true, unplannedAt: 'ts' });
    const a3 = mkActivity('a3', 'a1',   'work', { unplanned: false });
    setUp([b, a1, a2, a3]);

    setStatus('a3', 'unplanned');

    expect(findNode('a1').unplanned).toBe(true);
    expect(findNode('a1').unplannedAt).toBeDefined();
  });
});

describe('fix #7 – any child becomes planned → parent loses unplannedAt', () => {
  test('parent loses unplannedAt when a child reverts to planned', () => {
    const b  = mkBranch('work', ['a1']);
    const a1 = mkActivity('a1', 'work', 'work', { unplanned: true, unplannedAt: 'ts', children: ['a2', 'a3'] });
    const a2 = mkActivity('a2', 'a1',   'work', { unplanned: true, unplannedAt: 'ts' });
    const a3 = mkActivity('a3', 'a1',   'work', { unplanned: true, unplannedAt: 'ts' });
    setUp([b, a1, a2, a3]);

    setStatus('a3', 'planned');

    expect(findNode('a1').unplanned).toBe(false);
    expect(findNode('a1').unplannedAt).toBeUndefined();
  });
});
