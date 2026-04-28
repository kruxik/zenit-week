import {
  parseTodoDays, stripDayGroups,
  commitEdit, migrateDayCounters, transferReusable,
  validateAndRepair, defaultWeekData,
  findNode, rebuildNodeMap, genId,
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

  test('day-children of reusable parent are transferred with done reset', () => {
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

    transferReusable();

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
