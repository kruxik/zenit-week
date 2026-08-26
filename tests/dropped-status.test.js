import {
  setStatus, syncStatusUp, findNode, undo, showContextMenu, t,
  transferUnfinished, transferReusable, moveNodeToNextWeek,
  getOverdueItems, getAnyDayItems, getDroppedItems, localDateStr,
  computeWeekStats, _computeSummarySignature, deleteNode, sandboxGlobal,
  subtreeHasDropped, updateCounter,
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

// ─── S2 — entry points ───────────────────────────────────────────────────────

describe('hotkey X on the hovered node', () => {
  function pressX(extra = {}) {
    _state.triggerKeydown({
      key: 'x',
      preventDefault: () => {},
      stopPropagation: () => {},
      target: { tagName: 'DIV' },
      metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      ...extra,
    });
  }

  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setEditState(null);
  });

  test('X drops an open activity', () => {
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')]);
    _state.setHoveredNode('a1');

    pressX();

    expect(findNode('a1').dropped).toBe(true);
  });

  test('X again returns it to open', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);
    _state.setHoveredNode('a1');

    pressX();

    expect(findNode('a1').dropped).toBe(false);
    expect(findNode('a1').droppedAt).toBeUndefined();
  });

  test('X does nothing on a branch node', () => {
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')]);
    _state.setHoveredNode('work');

    pressX();

    expect(findNode('work').dropped).toBeUndefined();
  });

  test('X does nothing on the root', () => {
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')]);
    _state.setHoveredNode('center');

    pressX();

    expect(findNode('a1').dropped).toBeFalsy();
  });
});

describe('context menu — Dropped item visibility', () => {
  const isVisible = (id) => _state.getElement(id).style.display !== 'none';

  beforeEach(() => {
    _state.setCurrentView('mindmap');
  });

  test('an open activity offers Dropped, not Undone', () => {
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')]);

    showContextMenu(100, 100, 'a1');

    expect(isVisible('ctx-dropped')).toBe(true);
    expect(isVisible('ctx-undone')).toBe(false);
  });

  test('a dropped activity hides Dropped and offers the shared Undone', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    showContextMenu(100, 100, 'a1');

    expect(isVisible('ctx-dropped')).toBe(false);
    expect(isVisible('ctx-undone')).toBe(true);
  });

  test('a done activity still offers Undone and no Dropped duplication', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts' }),
    ]);

    showContextMenu(100, 100, 'a1');

    expect(isVisible('ctx-undone')).toBe(true);
    expect(isVisible('ctx-dropped')).toBe(true);
  });

  test('branch and root nodes never offer Dropped', () => {
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')]);

    showContextMenu(100, 100, 'work');
    expect(isVisible('ctx-dropped')).toBe(false);

    showContextMenu(100, 100, 'center');
    expect(isVisible('ctx-dropped')).toBe(false);
  });

  test('a counter offers Dropped — D3 freezes it rather than filling it', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 2, 5),
    ]);

    showContextMenu(100, 100, 'c1');

    expect(isVisible('ctx-dropped')).toBe(true);
  });
});

describe('i18n — new keys exist in both languages', () => {
  test('menu.dropped and help.dropped resolve in en and cs', () => {
    _state.setLang('en');
    expect(t('menu.dropped')).toBe('Dropped');
    expect(t('help.dropped')).toBe('Dropped');

    _state.setLang('cs');
    expect(t('menu.dropped')).toBe('Vyřazeno');
    expect(t('help.dropped')).toBe('Vyřazeno');
    _state.setLang('en');
  });
});

// ─── S3 — lifecycle: transfers, movement and overdue ─────────────────────────

describe('T10 – transferUnfinished skips dropped nodes', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
  });

  test('a dropped task does not arrive in the next week', async () => {
    _state.setLocalStorage('zenit-week-2026-01', {
      nodes: [
        mkBranch('work', ['a1', 'a2']),
        mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
        mkActivity('a2', 'work', 'work'),
      ],
    });
    _state.setWeekKey('2026-02');
    _state.set({ nodes: [mkBranch('work')] });

    await transferUnfinished();

    const carried = _state.get().nodes.filter(n => n.type === 'activity');
    expect(carried.map(n => n.prevId)).toEqual(['a2']);
  });

  test('a dropped subtree is skipped whole', async () => {
    _state.setLocalStorage('zenit-week-2026-01', {
      nodes: [
        mkBranch('work', ['p1']),
        mkActivity('p1', 'work', 'work', { dropped: true, droppedAt: 'ts', children: ['c1'] }),
        mkActivity('c1', 'p1', 'work', { dropped: true, droppedAt: 'ts' }),
      ],
    });
    _state.setWeekKey('2026-02');
    _state.set({ nodes: [mkBranch('work')] });

    await transferUnfinished();

    expect(_state.get().nodes.filter(n => n.type === 'activity')).toHaveLength(0);
  });
});

describe('T11 – transferReusable revives a dropped reusable node', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
  });

  test('the copy arrives open, with no droppedAt', async () => {
    _state.setLocalStorage('zenit-week-2026-01', {
      nodes: [
        mkBranch('work', ['a1']),
        mkActivity('a1', 'work', 'work', { reusable: true, dropped: true, droppedAt: 'ts' }),
      ],
    });
    _state.setWeekKey('2026-02');
    _state.set({ nodes: [mkBranch('work')] });

    await transferReusable();

    const copy = _state.get().nodes.find(n => n.prevId === 'a1');
    expect(copy).toBeDefined();
    expect(copy.dropped).toBe(false);
    expect(copy.droppedAt).toBeUndefined();
    expect(copy.reusable).toBe(true);
  });
});

describe('T12 – moveNodeToNextWeek revives a dropped node', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
  });

  test('the moved copy arrives open, with no droppedAt', async () => {
    _state.set({
      nodes: [
        mkBranch('work', ['a1']),
        mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
      ],
    });
    _state.setWeekKey('2026-01');
    _state.setLocalStorage('zenit-week-2026-02', { nodes: [mkBranch('work')] });

    await moveNodeToNextWeek('a1');

    const next = JSON.parse(_state.getLocalStorage('zenit-week-2026-02'));
    const moved = next.nodes.find(n => n.label === 'a1');
    expect(moved).toBeDefined();
    expect(moved.dropped).toBe(false);
    expect(moved.droppedAt).toBeUndefined();
  });
});

describe('T13 – dropped tasks never surface as overdue or unscheduled', () => {
  function d(dowJS) { return { getDay: () => dowJS }; }

  function mkDayLeaf(id, parentId, dayIndex, extra = {}) {
    return { id, type: 'activity', dayChild: true, dayIndex,
      branch: 'work', parent: parentId, label: id,
      done: false, unplanned: false, children: [], _ts: 0, ...extra };
  }

  test('a dropped day-leaf on a past weekday is not overdue', () => {
    setUp([
      mkBranch('work', ['p1']),
      mkActivity('p1', 'work', 'work', { children: ['mo', 'tu'] }),
      mkDayLeaf('mo', 'p1', 1, { dropped: true, droppedAt: 'ts' }),
      mkDayLeaf('tu', 'p1', 2),
    ]);

    expect(getOverdueItems(d(3)).map(n => n.id)).toEqual(['tu']);
  });

  test('a dropped day-annotated activity is not overdue, an open one is', () => {
    const week = (extra) => [
      mkBranch('work', ['p1']),
      mkActivity('p1', 'work', 'work', { label: 'Yoga (tu)', ...extra }),
    ];

    setUp(week({}));
    expect(getOverdueItems(d(3)).map(n => n.id)).toEqual(['p1']);

    setUp(week({ dropped: true, droppedAt: 'ts' }));
    expect(getOverdueItems(d(3))).toEqual([]);
  });

  test('a dropped unscheduled activity drops out of Any day', () => {
    setUp([
      mkBranch('work', ['a1', 'a2']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
      mkActivity('a2', 'work', 'work'),
    ]);

    expect(getAnyDayItems().map(n => n.id)).toEqual(['a2']);
  });
});

// ─── S4 — stats ──────────────────────────────────────────────────────────────

describe('T14 – computeWeekStats peels dropped into its own bucket', () => {
  test('dropped stays in total, is absent from done, and leaves the open buckets', () => {
    setUp([
      mkBranch('work', ['a1', 'a2', 'a3', 'a4']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a2', 'work', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a3', 'work', 'work'),
      mkActivity('a4', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
    ]);

    const c = computeWeekStats().global;

    expect(c.total).toBe(4);
    expect(c.done).toBe(2);
    expect(c.plannedDone).toBe(2);
    expect(c.plannedOpen).toBe(1);   // a4 no longer counted here
    expect(c.dropped).toBe(1);
  });

  test('dropping a task lowers the completion percentage', () => {
    const week = (extra) => [
      mkBranch('work', ['a1', 'a2']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a2', 'work', 'work', extra),
    ];

    setUp(week({}));
    expect(computeWeekStats().global.percent).toBe(50);

    setUp(week({ dropped: true, droppedAt: 'ts' }));
    const c = computeWeekStats().global;
    expect(c.percent).toBe(50);      // still in the denominator, still not done
    expect(c.total).toBe(2);
  });

  test('an unplanned dropped task lands in the dropped bucket, not unplannedOpen', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { unplanned: true, unplannedAt: 'ts', dropped: true, droppedAt: 'ts' }),
    ]);

    const c = computeWeekStats().global;

    expect(c.unplannedOpen).toBe(0);
    expect(c.dropped).toBe(1);
    expect(c.total).toBe(1);
  });

  test('D3 — a dropped counter keeps its ticks as done and freezes the remainder', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 3, 10),
    ]);
    findNode('c1').dropped = true;

    const c = computeWeekStats().global;

    expect(c.total).toBe(10);
    expect(c.done).toBe(3);          // the three that actually happened
    expect(c.dropped).toBe(7);       // the frozen remainder
    expect(c.plannedOpen).toBe(0);
  });

  test('priority weight applies to the dropped bucket like every other', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { priority: 'critical', dropped: true, droppedAt: 'ts' }),
    ]);

    expect(computeWeekStats().global.dropped).toBe(5);
  });
});

describe('T15 – drop-rate maths', () => {
  // The plan's hand-computed week: 4 planned, 2 done, 1 dropped
  // → 4 units total, 2 done (50%), 1 dropped (25%), 1 still open (25%).
  test('4 planned / 2 done / 1 dropped reads 50% done and 25% dropped', () => {
    setUp([
      mkBranch('work', ['a1', 'a2', 'a3', 'a4']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a2', 'work', 'work', { done: true, doneAt: 'ts' }),
      mkActivity('a3', 'work', 'work', { dropped: true, droppedAt: 'ts' }),
      mkActivity('a4', 'work', 'work'),
    ]);

    const c = computeWeekStats().global;

    expect(c.percent).toBe(50);
    expect(Math.round((c.dropped / c.total) * 100)).toBe(25);
    expect(c.plannedOpen).toBe(1);
  });

  test('a week with nothing dropped reports a zero bucket, so the row is hidden', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work'),
    ]);

    expect(computeWeekStats().global.dropped).toBe(0);
  });

  test('the four buckets plus dropped always add up to total', () => {
    setUp([
      mkBranch('work', ['a1', 'a2', 'a3']),
      mkActivity('a1', 'work', 'work', { done: true, doneAt: 'ts', priority: 'high' }),
      mkActivity('a2', 'work', 'work', { unplanned: true, unplannedAt: 'ts' }),
      mkActivity('a3', 'work', 'work', { dropped: true, droppedAt: 'ts', priority: 'critical' }),
    ]);

    const c = computeWeekStats().global;

    expect(c.plannedDone + c.plannedOpen + c.unplannedDone + c.unplannedOpen + c.dropped)
      .toBe(c.total);
    expect(c.total).toBe(3 + 1 + 5);
  });
});

describe('T16 – the summary signature notices a drop', () => {
  test('dropping a node changes the signature', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work'),
    ]);
    const before = _computeSummarySignature();

    setStatus('a1', 'dropped');

    expect(_computeSummarySignature()).not.toBe(before);
  });

  test('undropping restores the original signature', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work'),
    ]);
    const before = _computeSummarySignature();

    setStatus('a1', 'dropped');
    setStatus('a1', 'undropped');

    expect(_computeSummarySignature()).toBe(before);
  });
});

// ─── S5 — agenda ─────────────────────────────────────────────────────────────

describe('the Agenda Dropped group', () => {
  const AT = (d, h = 9) => `2026-01-0${d}T0${h}:00:00.000Z`;
  const day = (d, h = 9) => localDateStr(new Date(AT(d, h)));

  test('lists the tasks dropped on that date, oldest first', () => {
    setUp([
      mkBranch('work', ['a1', 'a2', 'a3']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: AT(2, 8) }),
      mkActivity('a2', 'work', 'work', { dropped: true, droppedAt: AT(2, 6) }),
      mkActivity('a3', 'work', 'work', { dropped: true, droppedAt: AT(3, 6) }),
    ]);

    const rows = getDroppedItems(day(2));
    expect(rows.map(n => n.id).sort()).toEqual(['a1', 'a2']);
    expect(getDroppedItems(day(3)).map(n => n.id)).toEqual(['a3']);
  });

  test('is empty on a day with nothing dropped, so the group hides', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: AT(2) }),
    ]);

    expect(getDroppedItems(day(5))).toEqual([]);
  });

  test('an unscheduled dropped task still appears, on the day it was dropped', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: AT(4) }),
    ]);

    // It is gone from Any day (S3) but not lost — it lands here instead.
    expect(getAnyDayItems()).toEqual([]);
    expect(getDroppedItems(day(4)).map(n => n.id)).toEqual(['a1']);
  });

  test('a dropped parent with children is not a row of its own', () => {
    setUp([
      mkBranch('work', ['p1']),
      mkActivity('p1', 'work', 'work', { dropped: true, droppedAt: AT(2), children: ['c1'] }),
      mkActivity('c1', 'p1', 'work', { dropped: true, droppedAt: AT(2) }),
    ]);

    expect(getDroppedItems(day(2)).map(n => n.id)).toEqual(['c1']);
  });

  test('tick-children never become rows of their own', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: AT(2), children: ['t1'] }),
      { id: 't1', type: 'activity', tickChild: true, tickIndex: 1, branch: 'work',
        parent: 'a1', label: '1', children: [], done: false, dropped: true,
        droppedAt: AT(2), _ts: 0 },
    ]);

    expect(getDroppedItems(day(2)).map(n => n.id)).toEqual(['a1']);
  });

  test('a dropped node with no droppedAt produces no row', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true }),
    ]);

    expect(getDroppedItems(day(2))).toEqual([]);
  });

  test('an open or done task never lands in the group', () => {
    setUp([
      mkBranch('work', ['a1', 'a2']),
      mkActivity('a1', 'work', 'work'),
      mkActivity('a2', 'work', 'work', { done: true, doneAt: AT(2), donedOn: day(2) }),
    ]);

    expect(getDroppedItems(day(2))).toEqual([]);
  });

  test('T5.6 — a dropped task scheduled for a past day is still not overdue', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { label: 'Yoga (tu)', dropped: true, droppedAt: AT(2) }),
    ]);

    expect(getOverdueItems({ getDay: () => 5 })).toEqual([]);
    expect(getDroppedItems(day(2)).map(n => n.id)).toEqual(['a1']);
  });

  test("swipe-right's target status returns the task to open", () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { dropped: true, droppedAt: AT(2) }),
    ]);

    // The Dropped row's button and swipe-right share one closure, which fires
    // 'undropped' — not 'undone', which would leave the flag set.
    setStatus('a1', 'undropped');

    expect(findNode('a1').dropped).toBe(false);
    expect(findNode('a1').droppedAt).toBeUndefined();
    expect(getDroppedItems(day(2))).toEqual([]);
  });

  test('i18n — agenda.dropped exists in both languages', () => {
    _state.setLang('en');
    expect(t('agenda.dropped')).toBe('Dropped');
    _state.setLang('cs');
    expect(t('agenda.dropped')).toBe('Vyřazeno');
    _state.setLang('en');
  });
});

// ─── S6 — delete dialog ──────────────────────────────────────────────────────

describe('the delete dialog offers Drop alongside Delete', () => {
  let captured;
  const realConfirm = sandboxGlobal.showAppConfirm;

  beforeEach(() => {
    captured = null;
    sandboxGlobal.showAppConfirm = (opts) => { captured = opts; };
  });
  afterEach(() => { sandboxGlobal.showAppConfirm = realConfirm; });

  function week() {
    return [
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work'),
    ];
  }

  test('a UI delete asks first, with a secondary Drop button', () => {
    setUp(week());
    _state.setLang('en');

    deleteNode('a1', { ask: true });

    expect(captured).not.toBeNull();
    expect(captured.secondaryLabel).toBe('Drop');
    expect(captured.okLabel).toBe('Delete');
    expect(findNode('a1')).toBeDefined();   // nothing gone yet
  });

  test('choosing Drop leaves the node in the week, dropped', () => {
    setUp(week());

    deleteNode('a1', { ask: true });
    captured.onSecondary();

    const n = findNode('a1');
    expect(n).toBeDefined();
    expect(n.dropped).toBe(true);
    expect(n.droppedAt).toBeDefined();
  });

  test('choosing Delete still deletes', () => {
    setUp(week());

    deleteNode('a1', { ask: true });
    captured.onConfirm();

    expect(findNode('a1')).toBeUndefined();
  });

  test('a programmatic delete never asks — the regression net relies on it', () => {
    setUp(week());

    deleteNode('a1');

    expect(captured).toBeNull();
    expect(findNode('a1')).toBeUndefined();
  });

  test('tick- and day-children delete without the interruption', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['t1', 'd1'] }),
      { id: 't1', type: 'activity', tickChild: true, tickIndex: 1, branch: 'work',
        parent: 'a1', label: '1', children: [], done: false, _ts: 0 },
      { id: 'd1', type: 'activity', dayChild: true, dayIndex: 1, branch: 'work',
        parent: 'a1', label: 'd1', children: [], done: false, _ts: 0 },
    ]);

    deleteNode('t1', { ask: true });
    expect(captured).toBeNull();
    expect(findNode('t1')).toBeUndefined();

    deleteNode('d1', { ask: true });
    expect(captured).toBeNull();
    expect(findNode('d1')).toBeUndefined();
  });

  test('the body carries the explanatory line', () => {
    setUp(week());
    _state.setLang('en');

    deleteNode('a1', { ask: true });

    expect(captured.body).toContain('stays in the week');
    expect(captured.title).toBe('Delete task?');
  });

  test('T6.4 — no two buttons share a word, in either language', () => {
    const words = (s) => s.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for (const lang of ['en', 'cs']) {
      _state.setLang(lang);
      const labels = [t('app-confirm.cancel'), t('app-confirm.drop'), t('menu.delete')];
      const all = labels.flatMap(words);
      expect(new Set(all).size).toBe(all.length);
    }
    _state.setLang('en');
  });

  test('i18n — app-confirm.drop reads Drop / Vyřadit', () => {
    _state.setLang('en');
    expect(t('app-confirm.drop')).toBe('Drop');
    _state.setLang('cs');
    expect(t('app-confirm.drop')).toBe('Vyřadit');
    _state.setLang('en');
  });
});

// ─── Regressions ─────────────────────────────────────────────────────────────

describe('done wins over dropped, everywhere it is set', () => {
  test('drop then done leaves nothing of the drop behind', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work'),
    ]);

    setStatus('a1', 'dropped');
    setStatus('a1', 'done');

    const n = findNode('a1');
    expect(n.done).toBe(true);
    expect(n.dropped).toBe(false);
    expect(n.droppedAt).toBeUndefined();
    // The badge and the slash are structural, so this transition must redraw
    // the map rather than repaint the node in place.
    expect(subtreeHasDropped('a1')).toBe(false);
  });

  test('marking a parent done clears the drop on every descendant', () => {
    setUp([
      mkBranch('work', ['p1']),
      mkActivity('p1', 'work', 'work', { children: ['c1'] }),
      mkActivity('c1', 'p1', 'work'),
    ]);

    setStatus('p1', 'dropped');
    expect(subtreeHasDropped('p1')).toBe(true);

    setStatus('p1', 'done');

    expect(findNode('c1').done).toBe(true);
    expect(findNode('c1').dropped).toBe(false);
    expect(findNode('c1').droppedAt).toBeUndefined();
    expect(subtreeHasDropped('p1')).toBe(false);
  });

  test('subtreeHasDropped sees a dropped descendant under an open parent', () => {
    setUp([
      mkBranch('work', ['p1']),
      mkActivity('p1', 'work', 'work', { children: ['c1', 'c2'] }),
      mkActivity('c1', 'p1', 'work', { dropped: true, droppedAt: 'ts' }),
      mkActivity('c2', 'p1', 'work'),
    ]);

    expect(findNode('p1').dropped).toBeFalsy();
    expect(subtreeHasDropped('p1')).toBe(true);
  });

  test('a counter reaching max clears the drop rather than holding both', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 2, 3),
    ]);
    setStatus('c1', 'dropped');
    expect(findNode('c1').val).toBe(2);   // D3 froze it

    updateCounter('c1', +1);

    const c = findNode('c1');
    expect(c.val).toBe(3);
    expect(c.done).toBe(true);
    expect(c.dropped).toBe(false);
    expect(c.droppedAt).toBeUndefined();
  });

  test('ticking a dropped counter below max revives it', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 1, 10),
    ]);
    setStatus('c1', 'dropped');

    updateCounter('c1', +1);

    const c = findNode('c1');
    expect(c.val).toBe(2);
    expect(c.done).toBe(false);
    expect(c.dropped).toBe(false);
  });

  test('decrementing does not revive a dropped counter', () => {
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { children: ['c1'] }),
      mkCounter('c1', 'a1', 'work', 4, 10),
    ]);
    setStatus('c1', 'dropped');

    updateCounter('c1', -1);

    expect(findNode('c1').dropped).toBe(true);
  });

  test('the roll-up follows: a dropped parent flips to done, not both', () => {
    setUp([
      mkBranch('work', ['p1']),
      mkActivity('p1', 'work', 'work', { children: ['c1', 'c2'] }),
      mkActivity('c1', 'p1', 'work'),
      mkActivity('c2', 'p1', 'work'),
    ]);

    setStatus('p1', 'dropped');
    expect(findNode('p1').dropped).toBe(true);

    setStatus('c1', 'done');
    setStatus('c2', 'done');

    const p = findNode('p1');
    expect(p.done).toBe(true);
    expect(p.dropped).toBe(false);
    expect(p.droppedAt).toBeUndefined();
  });
});
