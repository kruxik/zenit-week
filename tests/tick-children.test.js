import {
  commitEdit, applyMagicLabel,
  findNode, rebuildNodeMap,
  setStatus, isLeafActivity,
  getCounterChild, getTickInfo,
  getAgendaItems, getAnyDayItems,
  computeLayout,
  _state,
} from './setup.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  _state.setLang('en');
}

function setupWithActivity(label) {
  const b = mkBranch('work', ['a1']);
  const a = mkActivity('a1', 'work', 'work', { label });
  setUp([b, a]);
  return 'a1';
}

function triggerCommitEdit(nodeId, inputLabel, isNew = false) {
  const node = findNode(nodeId);
  _state.setEditState({ nodeId, isNew, originalLabel: node?.label ?? '' }, inputLabel);
  commitEdit('none');
}

function tickKids(nodeId) {
  const node = findNode(nodeId);
  return (node?.children || [])
    .map(findNode)
    .filter(c => c?.tickChild)
    .sort((a, b) => (a.tickIndex || 0) - (b.tickIndex || 0));
}

// ─── Creation ────────────────────────────────────────────────────────────────

describe('applyMagicLabel — tick-children creation', () => {
  test('"Pushups 3x" creates 3 tick-children labelled 1..3', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);

    const parent = findNode(id);
    expect(parent.label).toBe('Pushups');

    const ticks = tickKids(id);
    expect(ticks).toHaveLength(3);
    expect(ticks.map(t => t.tickIndex)).toEqual([1, 2, 3]);
    expect(ticks.map(t => t.label)).toEqual(['1', '2', '3']);
    expect(ticks.every(t => !t.done)).toBe(true);
  });

  test('1x does not create tick-children (threshold N >= 2)', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 1x', true);
    expect(tickKids(id)).toHaveLength(0);
  });

  test('N is capped at 100 — anything higher silently clamps', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 250x', true);
    expect(tickKids(id)).toHaveLength(100);
    expect(findNode(id).label).toBe('Pushups');
  });

  test('100x creates exactly 100 ticks (boundary)', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 100x', true);
    expect(tickKids(id)).toHaveLength(100);
  });

  test('tick-children inherit parent priority and reusable', () => {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', {
      label: '', priority: 'high', reusable: true, unplanned: true,
    });
    setUp([b, a]);
    triggerCommitEdit('a1', 'Pushups 3x', true);

    const ticks = tickKids('a1');
    expect(ticks.every(t => t.priority === 'high')).toBe(true);
    expect(ticks.every(t => t.reusable === true)).toBe(true);
    expect(ticks.every(t => t.unplanned === true)).toBe(true);
  });
});

// ─── Grow / shrink ───────────────────────────────────────────────────────────

describe('applyMagicLabel — tick-children grow / shrink', () => {
  test('editing 3x → 5x adds tickIndex 4 and 5', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    triggerCommitEdit(id, 'Pushups 5x');

    const ticks = tickKids(id);
    expect(ticks).toHaveLength(5);
    expect(ticks.map(t => t.tickIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  test('editing 5x → 2x removes highest tickIndices first', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 5x', true);
    triggerCommitEdit(id, 'Pushups 2x');

    const ticks = tickKids(id);
    expect(ticks).toHaveLength(2);
    expect(ticks.map(t => t.tickIndex)).toEqual([1, 2]);
  });

  test('grow preserves existing done-state on kept tickIndices', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    // Mark tick 2 done
    const tick2 = tickKids(id).find(t => t.tickIndex === 2);
    setStatus(tick2.id, 'done');

    triggerCommitEdit(id, 'Pushups 5x');
    const ticks = tickKids(id);
    expect(ticks).toHaveLength(5);
    expect(ticks.find(t => t.tickIndex === 2).done).toBe(true);
    expect(ticks.filter(t => t.tickIndex !== 2).every(t => !t.done)).toBe(true);
  });

  test('renaming parent without Nx preserves tick-children', () => {
    // "Clean 3x" → "Clean" + 3 ticks. Then rename to "Clean house" — ticks stay.
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Clean 3x', true);
    const initialTickIds = tickKids(id).map(t => t.id);
    expect(initialTickIds).toHaveLength(3);

    triggerCommitEdit(id, 'Clean house');
    expect(findNode(id).label).toBe('Clean house');
    const afterTickIds = tickKids(id).map(t => t.id);
    expect(afterTickIds).toEqual(initialTickIds); // exact same nodes
  });

  test('rename preserves done-state of individual ticks', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Clean 3x', true);
    const tick2 = tickKids(id).find(t => t.tickIndex === 2);
    setStatus(tick2.id, 'done');

    triggerCommitEdit(id, 'Clean house');
    expect(tickKids(id).find(t => t.tickIndex === 2).done).toBe(true);
  });
});

// ─── Done cascade ────────────────────────────────────────────────────────────

describe('tick-children done cascade', () => {
  test('marking every tick done promotes parent to done', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    const ticks = tickKids(id);

    ticks.forEach(t => setStatus(t.id, 'done'));
    expect(findNode(id).done).toBe(true);
  });

  test('growing tick count on done parent demotes parent back to undone', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 2x', true);
    tickKids(id).forEach(t => setStatus(t.id, 'done'));
    expect(findNode(id).done).toBe(true);

    triggerCommitEdit(id, 'Pushups 4x');
    expect(findNode(id).done).toBe(false);
  });

  test('shrinking so remaining ticks are all done promotes parent', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 4x', true);
    const ticks = tickKids(id);
    // Mark only ticks 1 and 2 done
    setStatus(ticks[0].id, 'done');
    setStatus(ticks[1].id, 'done');
    expect(findNode(id).done).toBe(false);

    triggerCommitEdit(id, 'Pushups 2x');
    expect(findNode(id).done).toBe(true);
  });
});

// ─── Day vs Nx interaction ───────────────────────────────────────────────────

describe('tick-children vs day-children', () => {
  test('adding multi-day token to Nx node drops tick-children', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    expect(tickKids(id)).toHaveLength(3);

    triggerCommitEdit(id, 'Pushups 3x (mo, we)');
    expect(tickKids(id)).toHaveLength(0);
    const dayKids = findNode(id).children.map(findNode).filter(c => c.dayChild);
    expect(dayKids).toHaveLength(2);
  });

  test('Nx + single day token does NOT create tick-children', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x (mo)', true);
    expect(tickKids(id)).toHaveLength(0);
  });

  test('day-children → Nx mode switch: drops days, creates ticks', () => {
    // Sequence: "Pushups 3x" → ticks
    //         → "Pushups (mo, we)" → days replace ticks
    //         → "Pushups 3x" → ticks should replace days (regression)
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    expect(tickKids(id)).toHaveLength(3);

    triggerCommitEdit(id, 'Pushups (mo, we)');
    expect(tickKids(id)).toHaveLength(0);
    expect(findNode(id).children.map(findNode).filter(c => c.dayChild)).toHaveLength(2);

    triggerCommitEdit(id, 'Pushups 3x');
    const ticks = tickKids(id);
    expect(ticks).toHaveLength(3);
    expect(ticks.map(t => t.tickIndex)).toEqual([1, 2, 3]);
    expect(findNode(id).children.map(findNode).filter(c => c.dayChild)).toHaveLength(0);
    expect(findNode(id).label).toBe('Pushups');
  });

  test('day-children + label re-typed with day token + Nx keeps days, strips token, label remains "X Nx"', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups (mo, we)', true);
    expect(findNode(id).children.map(findNode).filter(c => c.dayChild)).toHaveLength(2);

    triggerCommitEdit(id, 'Pushups 3x (mo, we)');
    expect(findNode(id).label).toBe('Pushups 3x'); // day group stripped
    expect(findNode(id).children.map(findNode).filter(c => c.dayChild)).toHaveLength(2);
    expect(tickKids(id)).toHaveLength(0); // day wins
  });
});

// ─── Legacy counter coexistence ──────────────────────────────────────────────

describe('legacy counter coexistence', () => {
  test('legacy counter node from prior data still renders untouched', () => {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Pushups', children: ['c1'] });
    const counter = mkCounter('c1', 'a1', 'work', 2, 5);
    setUp([b, a, counter]);

    expect(getCounterChild(findNode('a1'))).toBeTruthy();
    expect(tickKids('a1')).toHaveLength(0);
  });

  test('re-editing Nx label on legacy week swaps counter for tick-children', () => {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Pushups', children: ['c1'] });
    const counter = mkCounter('c1', 'a1', 'work', 2, 5);
    setUp([b, a, counter]);

    triggerCommitEdit('a1', 'Pushups 3x');
    const parent = findNode('a1');
    expect(getCounterChild(parent)).toBeNull();
    expect(tickKids('a1')).toHaveLength(3);
    expect(parent.label).toBe('Pushups');
  });
});

// ─── Agenda integration ──────────────────────────────────────────────────────

describe('agenda integration — tick-children parent', () => {
  test('parent activity with tick-children is treated as a leaf-activity', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    expect(isLeafActivity(findNode(id))).toBe(true);
  });

  test('getTickInfo returns done/total counts', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);
    setStatus(tickKids(id)[0].id, 'done');

    const info = getTickInfo(findNode(id));
    expect(info).not.toBeNull();
    expect(info.total).toBe(3);
    expect(info.done).toBe(1);
  });

  test('getTickInfo returns null for nodes without tick-children', () => {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Walk' });
    setUp([b, a]);
    expect(getTickInfo(findNode('a1'))).toBeNull();
  });

  test('parent with mixed children (ticks + regular) appears as agenda row alongside the regular child', () => {
    // Build: Pushups 3x  +  warmup (added via Tab as a regular sub-task)
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);

    const nodes = _state.get().nodes;
    const warmup = mkActivity('warmup', id, 'work', { label: 'warmup' });
    _state.set({ nodes: [...nodes, warmup] });
    findNode(id).children.push('warmup');
    rebuildNodeMap();

    // Any-day items should include BOTH the parent (for its tick pill) and
    // the regular sub-task (for its standalone row).
    const anyDay = getAnyDayItems().map(n => n.id);
    expect(anyDay).toContain(id);
    expect(anyDay).toContain('warmup');

    // Tick-children themselves still never surface individually.
    tickKids(id).forEach(tk => expect(anyDay).not.toContain(tk.id));
  });

  test('tick-children never appear as their own agenda items', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);

    // Parent activity appears in any-day items; ticks never individually
    const anyDay = getAnyDayItems().map(n => n.id);
    expect(anyDay).toContain(id);
    tickKids(id).forEach(tk => {
      expect(anyDay).not.toContain(tk.id);
    });

    // Same for day-scheduled agenda — tick-children must not surface as rows.
    for (let d = 0; d <= 6; d++) {
      const items = getAgendaItems(d).map(n => n.id);
      tickKids(id).forEach(tk => {
        expect(items).not.toContain(tk.id);
      });
    }
  });
});

// ─── Layout integration ──────────────────────────────────────────────────────

describe('layout — tick-children zigzag', () => {
  test('3 tick-children occupy alternating columns (zigzag x-positions)', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);

    const positions = computeLayout();
    const ticks = tickKids(id);
    const xs = ticks.map(t => positions[t.id].x);

    // Index 0 and 2 share one column; index 1 staggers to the other.
    expect(xs[0]).toBe(xs[2]);
    expect(xs[0]).not.toBe(xs[1]);
  });

  test('regular sibling added to tick-children parent stacks above zigzag', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 3x', true);

    // Inject a regular non-tick sibling under the tick-children parent.
    const parent = findNode(id);
    const regular = mkActivity('reg1', id, 'work', { label: 'note' });
    _state.set({ nodes: [..._state.get().nodes, regular] });
    parent.children.unshift('reg1');
    rebuildNodeMap();

    const positions = computeLayout();
    const ticks = tickKids(id);
    // Regular sibling sits above (smaller y) than every zigzag tick.
    expect(ticks.every(t => positions['reg1'].y < positions[t.id].y)).toBe(true);
  });
});
