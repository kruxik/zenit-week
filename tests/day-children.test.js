import {
  parseTodoDays, stripDayGroups,
  commitEdit, migrateDayCounters, transferReusable,
  validateAndRepair, defaultWeekData,
  findNode, rebuildNodeMap, genId,
  isoWeekPos, getAgendaItems, getOverdueItems, getAnyDayItems, rescheduleNode,
  setStatus, localDateStr, tabDateString,
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

function triggerCommitEdit(nodeId, inputLabel, isNew = false) {
  const node = findNode(nodeId);
  _state.setEditState({ nodeId, isNew, originalLabel: node?.label ?? '' }, inputLabel);
  commitEdit('none');
}

// parseTodoDays returns a Set from a VM context — compare as sorted arrays
function days(label) { return [...parseTodoDays(label)].sort((a, b) => a - b); }

// ─── parseTodoDays ────────────────────────────────────────────────────────────

describe('parseTodoDays', () => {
  test('Running (mo, we, fr) → {1,3,5}', () => {
    expect(days('Running (mo, we, fr)')).toEqual([1, 3, 5]);
  });

  test('Duolingo (daily) → all 7 days', () => {
    expect(days('Duolingo (daily)')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('no groups → empty set', () => {
    expect(days('Running')).toEqual([]);
  });

  test('non-day group ignored', () => {
    expect(days('Sprint (v3)')).toEqual([]);
  });

  test('mixed: day group + non-day group', () => {
    expect(days('Sprint (v3) (mo)')).toEqual([1]);
  });
});

// ─── stripDayGroups ───────────────────────────────────────────────────────────

describe('stripDayGroups', () => {
  test('strips day group', () => {
    expect(stripDayGroups('Running (mo, fr)')).toBe('Running');
  });

  test('preserves non-day group', () => {
    expect(stripDayGroups('Sprint (v3) (mo)')).toBe('Sprint (v3)');
  });

  test('no groups → unchanged', () => {
    expect(stripDayGroups('No groups')).toBe('No groups');
  });

  test('strips daily', () => {
    expect(stripDayGroups('Duolingo (daily)')).toBe('Duolingo');
  });

  test('preserves empty parens (not a day group)', () => {
    // "()" has no tokens — not a day group
    expect(stripDayGroups('A ()')).toBe('A ()');
  });
});

// ─── commitEdit — day-child creation ─────────────────────────────────────────

describe('commitEdit — day-child creation', () => {
  function setupWithActivity(label, extra = {}) {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label, ...extra });
    setUp([b, a]);
    return 'a1';
  }

  test('Running (mo, fr) → parent label "Running", two day-children Mo/Fr', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Running (mo, fr)', true);
    const node = findNode(id);
    expect(node.label).toBe('Running');
    const kids = node.children.map(findNode);
    expect(kids).toHaveLength(2);
    expect(kids.every(k => k.dayChild === true)).toBe(true);
    const labels = kids.map(k => k.label).sort();
    expect(labels).toEqual(['Fr', 'Mo']);
  });

  test('day-children have correct dayIndex', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Running (mo, fr)', true);
    const kids = findNode(id).children.map(findNode);
    const indices = new Set(kids.map(k => k.dayIndex));
    expect(indices).toEqual(new Set([1, 5]));
  });

  test('day-children are sorted in ISO week order (Mon first, Sun last)', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Running (mo, we, fr)', true);
    const indices = findNode(id).children.map(findNode).map(k => k.dayIndex);
    expect(indices).toEqual([1, 3, 5]); // Mo, We, Fr
  });

  test('daily expansion produces Mon-Sun order', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Duolingo (daily)', true);
    const indices = findNode(id).children.map(findNode).map(k => k.dayIndex);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 0]); // Mon … Sat, Sun
  });

  test('appending new days re-sorts existing children', () => {
    // Start with Mo, We already present, then extend to daily
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Running', children: ['dc1', 'dc2'] });
    const mo = mkActivity('dc1', 'a1', 'work', { label: 'Mo', dayChild: true, dayIndex: 1 });
    const we = mkActivity('dc2', 'a1', 'work', { label: 'We', dayChild: true, dayIndex: 3 });
    setUp([b, a, mo, we]);
    triggerCommitEdit('a1', 'Running (daily)');
    const indices = findNode('a1').children.map(findNode).map(k => k.dayIndex);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 0]); // Mo … Sa, Su sorted
  });

  test('day-child type is activity', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Running (mo, fr)', true);
    const kid = findNode(id).children.map(findNode)[0];
    expect(kid.type).toBe('activity');
  });

  test('appends only missing day-children — existing Mo state preserved', () => {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Running', children: ['c1'] });
    const mo = mkActivity('c1', 'a1', 'work', { label: 'Mo', dayChild: true, dayIndex: 1, done: true });
    setUp([b, a, mo]);
    triggerCommitEdit('a1', 'Running (mo, fr)');
    const node = findNode('a1');
    expect(node.children).toContain('c1'); // Mo still there
    expect(findNode('c1').done).toBe(true); // state preserved
    const kids = node.children.map(findNode);
    expect(kids).toHaveLength(2); // Mo + Fr
    const frNode = kids.find(k => k.dayIndex === 5);
    expect(frNode).toBeDefined();
    expect(frNode.label).toBe('Fr');
  });

  test('single day indicator (mo) alone: no day-children, no counter, label unchanged', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Running (mo)', true);
    const node = findNode(id);
    expect(node.label).toBe('Running (mo)');
    expect(node.children).toHaveLength(0);
  });

  test('Nx + single day (mo): Nx wins, counter created, label unchanged', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 10x (mo)', true);
    const node = findNode(id);
    expect(node.label).toBe('Pushups 10x (mo)');
    const kids = node.children.map(findNode);
    expect(kids).toHaveLength(1);
    expect(kids[0].type).toBe('counter');
    expect(kids[0].max).toBe(10);
  });

  test('Nx + 2 day indicators: day wins, no counter, label stripped of both', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 10x (mo, fr)', true);
    const node = findNode(id);
    expect(node.label).toBe('Pushups');
    const kids = node.children.map(findNode);
    expect(kids).toHaveLength(2);
    expect(kids.every(k => k.dayChild === true)).toBe(true);
    expect(kids.some(k => k.type === 'counter')).toBe(false);
  });

  test('Nx pattern alone still creates counter', () => {
    const id = setupWithActivity('');
    triggerCommitEdit(id, 'Pushups 10x', true);
    const node = findNode(id);
    const kids = node.children.map(findNode);
    expect(kids).toHaveLength(1);
    expect(kids[0].type).toBe('counter');
    expect(kids[0].max).toBe(10);
  });

  test('existing counter removed when 2+ day pattern added', () => {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Pushups 10x', children: ['c1'] });
    const counter = mkCounter('c1', 'a1', 'work', 3, 10);
    setUp([b, a, counter]);
    triggerCommitEdit('a1', 'Pushups (mo, fr)');
    const node = findNode('a1');
    const kids = node.children.map(findNode);
    const hasCounter = kids.some(k => k.type === 'counter');
    expect(hasCounter).toBe(false);
    expect(kids.some(k => k.dayChild)).toBe(true);
  });
});

// ─── commitEdit — day-child rename ───────────────────────────────────────────

describe('commitEdit — day-child rename', () => {
  function setupDayChild(dayIndex, label) {
    const b = mkBranch('work', ['a1']);
    const a = mkActivity('a1', 'work', 'work', { label: 'Running', children: ['dc1'] });
    const dc = mkActivity('dc1', 'a1', 'work', { label, dayChild: true, dayIndex });
    setUp([b, a, dc]);
    return 'dc1';
  }

  test('rename to canonical token → label + dayIndex both update', () => {
    const id = setupDayChild(1, 'Mo');
    triggerCommitEdit(id, 'fr');
    const node = findNode(id);
    expect(node.label).toBe('Fr');
    expect(node.dayIndex).toBe(5);
  });

  test('rename to invalid (non-day) string → label reverts, dayIndex unchanged', () => {
    const id = setupDayChild(1, 'Mo');
    triggerCommitEdit(id, 'Morning run');
    const node = findNode(id);
    expect(node.label).toBe('Mo');       // reverted
    expect(node.dayIndex).toBe(1);       // unchanged
  });

  test('day-child rename to valid token does NOT create grandchildren', () => {
    const id = setupDayChild(1, 'Mo');
    triggerCommitEdit(id, 'we'); // valid canonical token — becomes We, no children
    expect(findNode(id).children).toHaveLength(0);
    expect(findNode(id).label).toBe('We');
  });

  test('invalid token reverts — no change to children', () => {
    const id = setupDayChild(1, 'Mo');
    triggerCommitEdit(id, 'TT');
    expect(findNode(id).label).toBe('Mo');
    expect(findNode(id).children).toHaveLength(0);
  });
});

// ─── migrateDayCounters ───────────────────────────────────────────────────────

describe('migrateDayCounters', () => {
  test('activity with (mo, fr) + counter → counter removed, Mo/Fr children created, label stripped', () => {
    const data = {
      nodes: [
        mkBranch('work', ['a1']),
        mkActivity('a1', 'work', 'work', { label: 'Running (mo, fr)', children: ['c1'] }),
        mkCounter('c1', 'a1', 'work', 2, 2),
      ],
    };
    migrateDayCounters(data);
    const counter = data.nodes.find(n => n.id === 'c1');
    expect(counter).toBeUndefined();
    const parent = data.nodes.find(n => n.id === 'a1');
    expect(parent.label).toBe('Running');
    const kids = parent.children.map(id => data.nodes.find(n => n.id === id));
    expect(kids).toHaveLength(2);
    expect(kids.every(k => k.dayChild === true)).toBe(true);
    const labels = kids.map(k => k.label).sort();
    expect(labels).toEqual(['Fr', 'Mo']);
  });

  test('already migrated (no counter child) → no change', () => {
    const data = {
      nodes: [
        mkBranch('work', ['a1']),
        mkActivity('a1', 'work', 'work', { label: 'Running', children: ['dc1'] }),
        mkActivity('dc1', 'a1', 'work', { label: 'Mo', dayChild: true, dayIndex: 1 }),
      ],
    };
    const originalLength = data.nodes.length;
    migrateDayCounters(data);
    expect(data.nodes).toHaveLength(originalLength);
    expect(data.nodes.find(n => n.id === 'dc1')).toBeDefined();
  });

  test('activity without day pattern → untouched', () => {
    const data = {
      nodes: [
        mkBranch('work', ['a1']),
        mkActivity('a1', 'work', 'work', { label: 'Pushups 10x', children: ['c1'] }),
        mkCounter('c1', 'a1', 'work', 0, 10),
      ],
    };
    migrateDayCounters(data);
    expect(data.nodes.find(n => n.id === 'c1')).toBeDefined(); // counter untouched
    expect(data.nodes.find(n => n.id === 'a1').label).toBe('Pushups 10x');
  });

  test('migrated parent done is reset to false', () => {
    const data = {
      nodes: [
        mkBranch('work', ['a1']),
        { ...mkActivity('a1', 'work', 'work', { label: 'Running (mo, fr)', children: ['c1'] }), done: true },
        mkCounter('c1', 'a1', 'work', 2, 2),
      ],
    };
    migrateDayCounters(data);
    expect(data.nodes.find(n => n.id === 'a1').done).toBe(false);
  });
});

// ─── validateAndRepair — dayChild/dayIndex preserved ─────────────────────────

describe('validateAndRepair — dayChild/dayIndex fields preserved', () => {
  test('dayChild and dayIndex survive repair', () => {
    const data = defaultWeekData();
    data.nodes[0].children = ['a1', 'dc1'];
    data.nodes.push(mkActivity('a1', 'work', 'work', { children: ['dc1'] }));
    data.nodes.push(mkActivity('dc1', 'a1', 'work', { label: 'Mo', dayChild: true, dayIndex: 1 }));
    validateAndRepair(data);
    const dc = data.nodes.find(n => n.id === 'dc1');
    expect(dc).toBeDefined();
    expect(dc.dayChild).toBe(true);
    expect(dc.dayIndex).toBe(1);
  });

  test('invalid dayIndex (out of range) is set to null', () => {
    const data = defaultWeekData();
    data.nodes[0].children = ['a1', 'dc1'];
    data.nodes.push(mkActivity('a1', 'work', 'work', { children: ['dc1'] }));
    data.nodes.push(mkActivity('dc1', 'a1', 'work', { label: 'Mo', dayChild: true, dayIndex: 9 }));
    validateAndRepair(data);
    const dc = data.nodes.find(n => n.id === 'dc1');
    expect(dc.dayIndex).toBeNull();
  });

  test('dayIndex null is preserved as null', () => {
    const data = defaultWeekData();
    data.nodes[0].children = ['a1', 'dc1'];
    data.nodes.push(mkActivity('a1', 'work', 'work', { children: ['dc1'] }));
    data.nodes.push(mkActivity('dc1', 'a1', 'work', { label: 'Morning run', dayChild: true, dayIndex: null }));
    validateAndRepair(data);
    const dc = data.nodes.find(n => n.id === 'dc1');
    expect(dc.dayIndex).toBeNull();
  });
});

// ─── transferReusable — day-children carry over ───────────────────────────────

describe('transferReusable — day-children of reusable parents carry over', () => {
  beforeEach(() => { _state.clearLocalStorage(); });

  test('day-children of reusable parent are transferred with done reset', async () => {
    const curKey = '2026-01';
    const prevKey = '2025-52';

    // Prev week: branch → reusable parent → Mo (done), Fr (not done)
    const prevBranch = mkBranch('work', ['a1']);
    const prevParent = mkActivity('a1', 'work', 'work', { label: 'Running', reusable: true, children: ['dc1', 'dc2'] });
    const prevMo     = mkActivity('dc1', 'a1', 'work', { label: 'Mo', dayChild: true, dayIndex: 1, done: true, doneAt: '2025-12-22' });
    const prevFr     = mkActivity('dc2', 'a1', 'work', { label: 'Fr', dayChild: true, dayIndex: 5 });
    _state.setLocalStorage(`zenit-week-${prevKey}`, {
      nodes: [prevBranch, prevParent, prevMo, prevFr],
      crdtVersion: 1, tombstones: [],
    });

    // Current week: only the branch
    _state.set({ nodes: [mkBranch('work', [])], crdtVersion: 0, tombstones: [] });
    _state.setWeekKey(curKey);
    _state.reset();

    await transferReusable();

    const nodes = _state.get().nodes;
    const parent = nodes.find(n => n.label === 'Running');
    expect(parent).toBeDefined();
    expect(parent.reusable).toBe(true);

    const children = parent.children.map(id => nodes.find(n => n.id === id));
    expect(children).toHaveLength(2);
    expect(children.every(k => k.dayChild === true)).toBe(true);

    const mo = children.find(k => k.dayIndex === 1);
    expect(mo).toBeDefined();
    expect(mo.done).toBe(false); // reset on transfer
    expect(mo.doneAt).toBeUndefined();

    const fr = children.find(k => k.dayIndex === 5);
    expect(fr).toBeDefined();
    expect(fr.label).toBe('Fr');
  });
});

// ─── isoWeekPos ───────────────────────────────────────────────────────────────

describe('isoWeekPos', () => {
  test('Monday(1) → 1', () => expect(isoWeekPos(1)).toBe(1));
  test('Friday(5) → 5', () => expect(isoWeekPos(5)).toBe(5));
  test('Saturday(6) → 6', () => expect(isoWeekPos(6)).toBe(6));
  test('Sunday(0) → 7', () => expect(isoWeekPos(0)).toBe(7));
});

// ─── getAgendaItems ───────────────────────────────────────────────────────────

describe('getAgendaItems', () => {
  function mkDayChild(id, parentId, dayIndex, done = false) {
    return { id, type: 'activity', dayChild: true, dayIndex, branch: 'work',
      parent: parentId, label: id, done, unplanned: false, children: [], _ts: 0 };
  }

  test('returns day-leaf nodes matching dayIndex', () => {
    const branch = mkBranch('work', ['p1', 'p2']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo', 'we'] });
    const p2 = mkActivity('p2', 'work', 'work', { children: ['mo2'] });
    const mo  = mkDayChild('mo',  'p1', 1);
    const we  = mkDayChild('we',  'p1', 3);
    const mo2 = mkDayChild('mo2', 'p2', 1);
    setUp([branch, p1, p2, mo, we, mo2]);
    const result = getAgendaItems(1);
    expect(result.map(n => n.id).sort()).toEqual(['mo', 'mo2'].sort());
  });

  test('returns empty when no items for that day', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['we'] });
    const we = mkDayChild('we', 'p1', 3);
    setUp([branch, p1, we]);
    expect(getAgendaItems(1)).toEqual([]);
  });

  test('includes done items', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo'] });
    const mo = mkDayChild('mo', 'p1', 1, true);
    setUp([branch, p1, mo]);
    expect(getAgendaItems(1)).toHaveLength(1);
  });

  test('single-day annotated activity with no day-leaf children is included', () => {
    const branch = mkBranch('work', ['p1']);
    // "Yoga (tu)" — single-day hint, no day-child leaves
    const p1 = mkActivity('p1', 'work', 'work', { label: 'Yoga (tu)', children: [] });
    setUp([branch, p1]);
    expect(getAgendaItems(2).map(n => n.id)).toEqual(['p1']); // tu = dayIndex 2
    expect(getAgendaItems(1)).toEqual([]);  // not on Monday
  });

  test('single-day activity with day-leaf children is excluded (leaf handles it)', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { label: 'Running (mo)', children: ['mo'] });
    // If someone created a leaf manually, the parent should not double-appear
    const mo = mkDayChild('mo', 'p1', 1);
    setUp([branch, p1, mo]);
    // leaf 'mo' is returned; parent 'p1' is not (it has a day-child)
    expect(getAgendaItems(1).map(n => n.id)).toEqual(['mo']);
  });
});

// ─── getOverdueItems ──────────────────────────────────────────────────────────

describe('getOverdueItems', () => {
  function mkDayLeaf(id, parentId, dayIndex, { done = false, nullIndex = false } = {}) {
    return { id, type: 'activity', dayChild: true,
      dayIndex: nullIndex ? null : dayIndex,
      branch: 'work', parent: parentId, label: id,
      done, unplanned: false, children: [], _ts: 0 };
  }

  // Inject a fake Date with a specific getDay() value
  function d(dowJS) { return { getDay: () => dowJS }; }

  test('today=Wednesday(3): returns Mon+Tue undone nodes', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo', 'tu', 'we'] });
    const mo = mkDayLeaf('mo', 'p1', 1);  // Monday — overdue
    const tu = mkDayLeaf('tu', 'p1', 2);  // Tuesday — overdue
    const we = mkDayLeaf('we', 'p1', 3);  // Wednesday — today, not overdue
    setUp([branch, p1, mo, tu, we]);
    const result = getOverdueItems(d(3)); // inject Wednesday
    expect(result.map(n => n.id).sort()).toEqual(['mo', 'tu'].sort());
  });

  test('done node is excluded', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo'] });
    const mo = mkDayLeaf('mo', 'p1', 1, { done: true });
    setUp([branch, p1, mo]);
    expect(getOverdueItems(d(3))).toEqual([]);
  });

  test('today=Monday(1): no past days → empty', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['su'] });
    const su = mkDayLeaf('su', 'p1', 0); // Sunday — isoWeekPos=7, not before Mon=1
    setUp([branch, p1, su]);
    expect(getOverdueItems(d(1))).toEqual([]); // inject Monday
  });

  test('today=Sunday(0→pos 7): returns Mon–Sat undone nodes', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo', 'fr', 'su'] });
    const mo = mkDayLeaf('mo', 'p1', 1);  // isoWeekPos=1 < 7
    const fr = mkDayLeaf('fr', 'p1', 5);  // isoWeekPos=5 < 7
    const su = mkDayLeaf('su', 'p1', 0);  // today — not overdue
    setUp([branch, p1, mo, fr, su]);
    const result = getOverdueItems(d(0)); // inject Sunday
    expect(result.map(n => n.id).sort()).toEqual(['fr', 'mo'].sort());
  });

  test('node with dayIndex=null is excluded', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['x'] });
    const x = mkDayLeaf('x', 'p1', 1, { nullIndex: true });
    setUp([branch, p1, x]);
    expect(getOverdueItems(d(3))).toEqual([]);
  });

  test('single-day annotated activity with no leaves is included when overdue', () => {
    // "Yoga (tu)" is a Monday-less single-day hint; today=Wednesday → Tuesday is overdue
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { label: 'Yoga (tu)', children: [] });
    setUp([branch, p1]);
    expect(getOverdueItems(d(3)).map(n => n.id)).toEqual(['p1']); // Wed: tu is past
    expect(getOverdueItems(d(2))).toEqual([]);  // Tue: tu is today, not past
  });

  test('single-day activity with day-leaf children is not double-counted in overdue', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { label: 'Running (mo)', children: ['mo'] });
    const mo = mkDayLeaf('mo', 'p1', 1);
    setUp([branch, p1, mo]);
    // Only the leaf 'mo' is overdue, not the parent 'p1'
    const result = getOverdueItems(d(3));
    expect(result.map(n => n.id)).toEqual(['mo']);
  });
});

// ─── getAnyDayItems ───────────────────────────────────────────────────────────

describe('getAnyDayItems', () => {
  test('activity with counter child and no dayChild → included', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['c1'] });
    const c1 = mkCounter('c1', 'p1', 'work', 0, 3);
    setUp([branch, p1, c1]);
    expect(getAnyDayItems().map(n => n.id)).toEqual(['p1']);
  });

  test('activity with dayChild children → excluded', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo', 'c1'] });
    const mo = { id: 'mo', type: 'activity', dayChild: true, dayIndex: 1,
      branch: 'work', parent: 'p1', label: 'Mo', done: false, children: [], _ts: 0 };
    const c1 = mkCounter('c1', 'p1', 'work', 0, 3);
    setUp([branch, p1, mo, c1]);
    expect(getAnyDayItems()).toEqual([]);
  });

  test('plain activity (no counter, no dayChild) → excluded', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work');
    setUp([branch, p1]);
    expect(getAnyDayItems()).toEqual([]);
  });

  test('branch/counter nodes → excluded', () => {
    const branch = mkBranch('work', ['c1']);
    const c1 = mkCounter('c1', 'work', 'work', 1, 3);
    setUp([branch, c1]);
    expect(getAnyDayItems()).toEqual([]);
  });
});

// ─── rescheduleNode ───────────────────────────────────────────────────────────

describe('rescheduleNode', () => {
  function mkDayChild(id, parentId, dayIndex) {
    return { id, type: 'activity', dayChild: true, dayIndex,
      branch: 'work', parent: parentId, label: id,
      done: false, unplanned: false, children: [], _ts: 0 };
  }

  test('happy path: moves Mo→Tu when Tu slot is free', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo', 'fr'] });
    const mo = mkDayChild('mo', 'p1', 1);
    const fr = mkDayChild('fr', 'p1', 5);
    setUp([branch, p1, mo, fr]);
    const result = rescheduleNode('mo', 2);
    expect(result).toBe(true);
    const moNode = findNode('mo');
    expect(moNode.dayIndex).toBe(2);
    expect(moNode.label).toBe('Tu');
  });

  test('sibling conflict: returns false, node unchanged', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo', 'tu'] });
    const mo = mkDayChild('mo', 'p1', 1);
    const tu = mkDayChild('tu', 'p1', 2);
    setUp([branch, p1, mo, tu]);
    const result = rescheduleNode('mo', 2); // Tu already exists
    expect(result).toBe(false);
    expect(findNode('mo').dayIndex).toBe(1);
  });

  test('same day: returns false', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { children: ['mo'] });
    const mo = mkDayChild('mo', 'p1', 1);
    setUp([branch, p1, mo]);
    expect(rescheduleNode('mo', 1)).toBe(false);
  });

  test('non-dayChild node: returns false', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work');
    setUp([branch, p1]);
    expect(rescheduleNode('p1', 2)).toBe(false);
  });
});

// ─── crossDayDone filter — scenario coverage ──────────────────────────────────
// These tests verify the filter logic used in renderAgendaTabContent to build
// the Done section.  A done item belongs to the day it was marked done (doneAt),
// not its scheduled day.

describe('crossDayDone filter logic', () => {
  // Replicate the filter used in renderAgendaTabContent
  function computeCrossDayDone(tabDate, tabDayIndex) {
    const items = getAgendaItems(tabDayIndex);
    const scheduledIds = new Set(items.map(n => n.id));
    const nodes = _state.get().nodes;
    const doneOnTab = n => n.done && (n.donedOn === tabDate || n.doneAt?.startsWith(tabDate));
    return nodes.filter(n => {
      if (n.type !== 'activity') return false;
      if (!doneOnTab(n)) return false;
      if (scheduledIds.has(n.id)) return false;
      const hasNoDayLeaves = !(n.children || []).some(id => {
        const c = nodes.find(x => x.id === id);
        return c?.dayChild;
      });
      return n.dayChild === true || (hasNoDayLeaves && parseTodoDays(n.label || '').size > 0);
    });
  }

  test('S1: single-day "Running (mo)" done on Wednesday appears in Wed crossDayDone', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (mo)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29', children: [],
    });
    setUp([branch, p1]);
    const result = computeCrossDayDone('2026-04-29', 3); // Wednesday tab
    expect(result.map(n => n.id)).toContain('p1');
  });

  test('S1: "Running (mo)" done Wed does NOT appear in Mon crossDayDone', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (mo)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29', children: [],
    });
    setUp([branch, p1]);
    const result = computeCrossDayDone('2026-04-27', 1); // Monday tab (Apr 27)
    expect(result.map(n => n.id)).not.toContain('p1');
  });

  test('S1: day-leaf "Mo" done on Wednesday appears in Wed crossDayDone', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { label: 'Running', children: ['mo'] });
    const mo = mkActivity('mo', 'p1', 'work', {
      label: 'Mo', dayChild: true, dayIndex: 1,
      done: true, doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29',
    });
    setUp([branch, p1, mo]);
    const result = computeCrossDayDone('2026-04-29', 3); // Wednesday tab
    expect(result.map(n => n.id)).toContain('mo');
  });

  test('S2: "Running (we)" done on Wednesday appears in scheduledDone, not crossDayDone', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (we)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29', children: [],
    });
    setUp([branch, p1]);
    // p1 IS in getAgendaItems(3) → in scheduledIds → excluded from crossDayDone
    const cross = computeCrossDayDone('2026-04-29', 3);
    expect(cross.map(n => n.id)).not.toContain('p1');
    expect(getAgendaItems(3).map(n => n.id)).toContain('p1');
  });

  test('S3: "Running (fr)" done on Wednesday appears in Wed crossDayDone', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (fr)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29', children: [],
    });
    setUp([branch, p1]);
    const result = computeCrossDayDone('2026-04-29', 3); // Wednesday tab
    expect(result.map(n => n.id)).toContain('p1');
  });

  test('S3: "Running (fr)" done Wednesday NOT in Fri crossDayDone (date mismatch)', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (fr)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29', children: [],
    });
    setUp([branch, p1]);
    const result = computeCrossDayDone('2026-05-01', 5); // Friday tab (May 1)
    expect(result.map(n => n.id)).not.toContain('p1');
  });

  test('parent activity does NOT appear in crossDayDone when it has day-leaf children', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29', children: ['mo'],
    });
    const mo = mkActivity('mo', 'p1', 'work', {
      label: 'Mo', dayChild: true, dayIndex: 1,
      done: true, doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29',
    });
    setUp([branch, p1, mo]);
    const result = computeCrossDayDone('2026-04-29', 3); // Wednesday tab
    expect(result.map(n => n.id)).toContain('mo');
    expect(result.map(n => n.id)).not.toContain('p1');
  });

  // donedOn via legacy doneAt only (backward compat — no donedOn field)
  test('legacy node with only doneAt (no donedOn) still matches via doneAt prefix', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (mo)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z',   // no donedOn
      children: [],
    });
    setUp([branch, p1]);
    const result = computeCrossDayDone('2026-04-29', 3);
    expect(result.map(n => n.id)).toContain('p1');
  });
});

// ─── donedOn + setStatus integration ──────────────────────────────────────────

describe('setStatus donedOn integration', () => {
  test('setStatus done sets donedOn to today local date', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', { label: 'Running (mo)' });
    setUp([branch, p1]);
    setStatus('p1', 'done');
    const node = _state.get().nodes.find(n => n.id === 'p1');
    expect(node.done).toBe(true);
    expect(node.donedOn).toBe(localDateStr());
  });

  test('setStatus undone removes donedOn', () => {
    const branch = mkBranch('work', ['p1']);
    const p1 = mkActivity('p1', 'work', 'work', {
      label: 'Running (mo)', done: true,
      doneAt: '2026-04-29T09:00:00.000Z', donedOn: '2026-04-29',
    });
    setUp([branch, p1]);
    setStatus('p1', 'undone');
    const node = _state.get().nodes.find(n => n.id === 'p1');
    expect(node.done).toBe(false);
    expect(node.donedOn).toBeUndefined();
  });

  test('tabDateString returns correct date for week 2026-18 Wednesday (dayIndex 3)', () => {
    _state.setWeekKey('2026-18');
    expect(tabDateString(3)).toBe('2026-04-29');
    _state.setWeekKey('2026-01'); // restore
  });

  test('tabDateString returns correct date for week 2026-18 Monday (dayIndex 1)', () => {
    _state.setWeekKey('2026-18');
    expect(tabDateString(1)).toBe('2026-04-27');
    _state.setWeekKey('2026-01');
  });
});
