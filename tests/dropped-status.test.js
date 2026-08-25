import {
  setStatus, syncStatusUp, findNode, undo,
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
  _state.reset();
  _state.set({ nodes });
  _state.setWeekKey('2026-01');
}

// ─── T1 — set and clear ──────────────────────────────────────────────────────

describe('T1 – setStatus dropped / undropped', () => {
  test("'dropped' sets the flag and the timestamp", () => {
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')]);

    setStatus('a1', 'dropped');

    expect(findNode('a1').dropped).toBe(true);
    expect(findNode('a1').droppedAt).toBeDefined();
  });

  test("'undropped' clears both", () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    setStatus('a1', 'undropped');

    expect(findNode('a1').dropped).toBe(false);
    expect(findNode('a1').droppedAt).toBeUndefined();
  });
});

// ─── T2 — D1, mutual exclusion in both directions ────────────────────────────

describe('T2 – D1: dropped and done are mutually exclusive', () => {
  test('dropping a done node clears done, doneAt and donedOn', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', donedOn: '2026-01-01' }),
    ]);

    setStatus('a1', 'dropped');

    const n = findNode('a1');
    expect(n.dropped).toBe(true);
    expect(n.done).toBe(false);
    expect(n.doneAt).toBeUndefined();
    expect(n.donedOn).toBeUndefined();
  });

  test('marking a dropped node done clears dropped and droppedAt', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    setStatus('a1', 'done');

    const n = findNode('a1');
    expect(n.done).toBe(true);
    expect(n.dropped).toBe(false);
    expect(n.droppedAt).toBeUndefined();
  });

  test('a cascading done clears dropped on descendants too', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2'] }),
      mkActivity('a2', 'a1', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    setStatus('a1', 'done');

    expect(findNode('a2').done).toBe(true);
    expect(findNode('a2').dropped).toBe(false);
    expect(findNode('a2').droppedAt).toBeUndefined();
  });
});

// ─── T3 — D2, independence from unplanned ────────────────────────────────────

describe('T3 – D2: unplanned survives a drop/undrop round trip', () => {
  test('unplanned and unplannedAt are untouched', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { unplanned: true, unplannedAt: 'ts' }),
    ]);

    setStatus('a1', 'dropped');
    expect(findNode('a1').unplanned).toBe(true);
    expect(findNode('a1').unplannedAt).toBe('ts');

    setStatus('a1', 'undropped');
    expect(findNode('a1').unplanned).toBe(true);
    expect(findNode('a1').unplannedAt).toBe('ts');
  });
});

// ─── T4 — D3, counter freeze ─────────────────────────────────────────────────

describe('T4 – D3: dropping a counter freezes val', () => {
  test('dropping a counter directly leaves val where it stands', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 3, 10),
    ]);

    setStatus('c1', 'dropped');

    const c = findNode('c1');
    expect(c.dropped).toBe(true);
    expect(c.val).toBe(3);   // not max, unlike 'done'
    expect(c.ticks).toEqual([]);
  });

  test('a cascading drop leaves a counter child at its current val', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 4, 10),
    ]);

    setStatus('a1', 'dropped');

    expect(findNode('c1').dropped).toBe(true);
    expect(findNode('c1').val).toBe(4);
  });
});

// ─── T5 — cascade down ───────────────────────────────────────────────────────

describe('T5 – dropping a parent drops the whole subtree', () => {
  test('every descendant gains dropped and droppedAt', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2'] }),
      mkActivity('a2', 'a1', 'work', { children: ['a3'] }),
      mkActivity('a3', 'a2', 'work'),
    ]);

    setStatus('a1', 'dropped');

    ['a1', 'a2', 'a3'].forEach(id => {
      expect(findNode(id).dropped).toBe(true);
      expect(findNode(id).droppedAt).toBeDefined();
    });
  });

  test('undropping a parent clears the whole subtree', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts', children: ['a2'] }),
      mkActivity('a2', 'a1', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    setStatus('a1', 'undropped');

    expect(findNode('a2').dropped).toBe(false);
    expect(findNode('a2').droppedAt).toBeUndefined();
  });
});

// ─── T6 / T7 / T8 — roll-up ──────────────────────────────────────────────────

describe('T6 – roll-up: every child dropped → parent dropped, never done', () => {
  test('parent gains dropped and droppedAt, and stays not-done', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2', 'a3'] }),
      mkActivity('a2', 'a1', 'work', { dropped: true, droppedAt: 'ts' }),
      mkActivity('a3', 'a1', 'work'),
    ]);

    setStatus('a3', 'dropped');

    const p = findNode('a1');
    expect(p.dropped).toBe(true);
    expect(p.droppedAt).toBeDefined();
    expect(p.done).toBe(false);
    expect(p.doneAt).toBeUndefined();
  });

  test('an all-dropped subtree rolls up to the branch', () => {
    setUp([
      mkBranch('work', ['a1', 'a2']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
      mkActivity('a2', 'work', 'work'),
    ]);

    setStatus('a2', 'dropped');

    expect(findNode('work').dropped).toBe(true);
    // The branch was created without a `done` field; D4 says nothing invents one.
    expect(findNode('work').done).toBeFalsy();
  });
});

describe('T7 – roll-up: mixed done + dropped, none open → parent done', () => {
  test('parent becomes done and not dropped', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2', 'a3'] }),
      mkActivity('a2', 'a1', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a3', 'a1', 'work'),
    ]);

    setStatus('a3', 'dropped');

    const p = findNode('a1');
    expect(p.done).toBe(true);
    expect(p.doneAt).toBeDefined();
    expect(p.dropped).toBeFalsy();
    expect(p.droppedAt).toBeUndefined();
  });

  test('undropping the dropped sibling re-opens the parent', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', children: ['a2', 'a3'] }),
      mkActivity('a2', 'a1', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a3', 'a1', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    setStatus('a3', 'undropped');

    expect(findNode('a1').done).toBe(false);
    expect(findNode('a1').dropped).toBeFalsy();
  });

  test('a dropped parent flips to done when a child is marked done', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts', children: ['a2', 'a3'] }),
      mkActivity('a2', 'a1', 'work', { dropped: true, droppedAt: 'ts' }),
      mkActivity('a3', 'a1', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    setStatus('a3', 'done');

    const p = findNode('a1');
    expect(p.done).toBe(true);
    expect(p.dropped).toBe(false);
    expect(p.droppedAt).toBeUndefined();
  });
});

describe('T8 – roll-up: one child still open → parent is neither', () => {
  test('parent stays open when a sibling is untouched', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2', 'a3', 'a4'] }),
      mkActivity('a2', 'a1', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a3', 'a1', 'work'),
      mkActivity('a4', 'a1', 'work'),
    ]);

    setStatus('a3', 'dropped');

    const p = findNode('a1');
    expect(p.done).toBe(false);
    expect(p.dropped).toBeFalsy();
  });
});

// ─── T9 — regression: a week with no dropped nodes ───────────────────────────

describe('T9 – no dropped nodes: the done roll-up is unchanged', () => {
  test('all children done → parent and branch done, no dropped field invented', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2', 'a3'] }),
      mkActivity('a2', 'a1', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a3', 'a1', 'work'),
    ]);

    setStatus('a3', 'done');

    expect(findNode('a1').done).toBe(true);
    expect(findNode('a1').doneAt).toBeDefined();
    expect(findNode('work').done).toBe(true);
    expect(findNode('a1').dropped).toBeUndefined();
    expect(findNode('work').dropped).toBeUndefined();
  });

  test('undoing one child re-opens parent and branch', () => {
    setUp([
      mkBranch('work', ['a1', 'a2']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a2', 'work', 'work', { done: true, doneAt: 'ts' }),
    ]);
    syncStatusUp('a1', 'done');
    expect(findNode('work').done).toBe(true);

    setStatus('a2', 'undone');

    expect(findNode('work').done).toBe(false);
    expect(findNode('work').doneAt).toBeUndefined();
    expect(findNode('work').dropped).toBeUndefined();
  });

  test('an empty branch never becomes done or dropped', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkBranch('me', []),
      mkActivity('a1', 'work', 'work'),
    ]);

    setStatus('a1', 'done');

    expect(findNode('me').done).toBeUndefined();
    expect(findNode('me').dropped).toBeUndefined();
  });
});

// ─── T17 — undo ──────────────────────────────────────────────────────────────

describe('T17 – undo restores the pre-drop state', () => {
  test('undo clears dropped and restores done with its timestamps', async () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: '2026-01-02T10:00:00.000Z', donedOn: '2026-01-02' }),
    ]);

    setStatus('a1', 'dropped');
    expect(findNode('a1').dropped).toBe(true);

    await undo();

    const n = findNode('a1');
    expect(n.dropped).toBeFalsy();
    expect(n.droppedAt).toBeUndefined();
    expect(n.done).toBe(true);
    expect(n.doneAt).toBe('2026-01-02T10:00:00.000Z');
    expect(n.donedOn).toBe('2026-01-02');
  });

  test('undo restores a whole cascaded subtree', async () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['a2'] }),
      mkActivity('a2', 'a1', 'work'),
    ]);

    setStatus('a1', 'dropped');
    expect(findNode('a2').dropped).toBe(true);

    await undo();

    expect(findNode('a1').dropped).toBeFalsy();
    expect(findNode('a2').dropped).toBeFalsy();
  });
});
