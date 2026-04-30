import {
  getDayFilterOpacity,
  findNode, rebuildNodeMap, genId,
  _state,
} from './setup.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkBranch(id) {
  return { id, type: 'branch', branch: id, label: id, children: [], side: 'left', _ts: 0 };
}

function mkActivity(id, parentId, branchId, extra = {}) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0, ...extra };
}

function mkDayChild(id, parentId, branchId, dayIndex) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: String(dayIndex),
    dayChild: true, dayIndex, done: false, unplanned: false, children: [], _ts: 0 };
}

function mkCounter(id, parentId, branchId, val = 0, max = 5) {
  return { id, type: 'counter', branch: branchId, parent: parentId, label: String(val),
    val, max, done: val >= max, children: [], ticks: [], _ts: 0 };
}

function setUp(nodes) {
  _state.set({ nodes });
  _state.setWeekKey('2026-01');
  _state.reset();
  _state.setLang('en');
  _state.setActiveDayFilter(null);
}

// ─── No filter (null) ─────────────────────────────────────────────────────────

describe('getDayFilterOpacity — no filter', () => {
  test('center → 1', () => {
    setUp([mkBranch('b1')]);
    expect(getDayFilterOpacity('center')).toBe(1);
  });

  test('branch → 1', () => {
    setUp([mkBranch('b1')]);
    expect(getDayFilterOpacity('b1')).toBe(1);
  });

  test('activity → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    b.children = ['a1'];
    setUp([b, a]);
    expect(getDayFilterOpacity('a1')).toBe(1);
  });

  test('day-child → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    expect(getDayFilterOpacity('dc1')).toBe(1);
  });

  test('counter → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['c1'];
    b.children = ['a1'];
    setUp([b, a, c]);
    expect(getDayFilterOpacity('c1')).toBe(1);
  });
});

// ─── Day filter d=1 (Monday) ──────────────────────────────────────────────────

describe('getDayFilterOpacity — day filter 1 (Mon)', () => {
  test('day-child dayIndex=1 → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('dc1')).toBe(1);
  });

  test('day-child dayIndex=2 → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc2', 'a1', 'b1', 2);
    a.children = ['dc2'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('dc2')).toBe(0.12);
  });

  test('activity with day-child dayIndex=1 → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('a1')).toBe(1);
  });

  test('activity with only day-child dayIndex=2 → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc2', 'a1', 'b1', 2);
    a.children = ['dc2'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('a1')).toBe(0.12);
  });

  test('activity label="Yoga (mo)", no day-children → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1', { label: 'Yoga (mo)' });
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('a1')).toBe(1);
  });

  test('activity with no day-children, no label days → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1', { label: 'Yoga' });
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('a1')).toBe(0.12);
  });

  test('counter whose parent has day-child dayIndex=1 → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['dc1', 'c1'];
    b.children = ['a1'];
    setUp([b, a, dc, c]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('c1')).toBe(1);
  });

  test('counter whose parent has only day-child dayIndex=2 → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc2', 'a1', 'b1', 2);
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['dc2', 'c1'];
    b.children = ['a1'];
    setUp([b, a, dc, c]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('c1')).toBe(0.12);
  });

  test('branch → 1', () => {
    const b = mkBranch('b1');
    setUp([b]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('b1')).toBe(1);
  });

  test('center → 1', () => {
    setUp([mkBranch('b1')]);
    _state.setActiveDayFilter(1);
    expect(getDayFilterOpacity('center')).toBe(1);
  });
});

// ─── Unscheduled filter ───────────────────────────────────────────────────────

describe('getDayFilterOpacity — unscheduled filter', () => {
  test('activity with no day-children, no counter, no label days → 1', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter('unscheduled');
    expect(getDayFilterOpacity('a1')).toBe(1);
  });

  test('activity with label day "(Mo)", no day-children → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1', { label: 'Running (Mo)' });
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter('unscheduled');
    expect(getDayFilterOpacity('a1')).toBe(0.12);
  });

  test('activity with day-child → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('unscheduled');
    expect(getDayFilterOpacity('a1')).toBe(0.12);
  });

  test('activity with counter (no day-children) → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['c1'];
    b.children = ['a1'];
    setUp([b, a, c]);
    _state.setActiveDayFilter('unscheduled');
    expect(getDayFilterOpacity('a1')).toBe(0.12);
  });

  test('day-child node → 0.12', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('unscheduled');
    expect(getDayFilterOpacity('dc1')).toBe(0.12);
  });

  test('branch → 1', () => {
    const b = mkBranch('b1');
    setUp([b]);
    _state.setActiveDayFilter('unscheduled');
    expect(getDayFilterOpacity('b1')).toBe(1);
  });
});

// ─── Branch Visibility ───────────────────────────────────────────────────────

describe('getDayFilterOpacity — Branch Visibility', () => {
  test('Activity should be visible if its grandchild matches the day filter', () => {
    // Week -> Me (branch) -> Sports (a1) -> Running (a2) -> We (dc)
    const b = mkBranch('me');
    const a1 = mkActivity('a1', 'me', 'me', { label: 'Sports' });
    const a2 = mkActivity('a2', 'a1', 'me', { label: 'Running' });
    const dc = mkDayChild('dc', 'a2', 'me', 3); // Wednesday

    b.children = ['a1'];
    a1.children = ['a2'];
    a2.children = ['dc'];

    setUp([b, a1, a2, dc]);
    _state.setActiveDayFilter(3);

    // dc should be visible
    expect(getDayFilterOpacity('dc')).toBe(1);
    // a2 (Running) should be visible (direct parent)
    expect(getDayFilterOpacity('a2')).toBe(1);
    // a1 (Sports) should be visible (ancestor - the bug was here)
    expect(getDayFilterOpacity('a1')).toBe(1);
    // me (Branch) should be visible
    expect(getDayFilterOpacity('me')).toBe(1);
  });

  test('Activity should NOT be visible if none of its descendants match the day filter', () => {
    // Week -> Me (branch) -> Sports (a1) -> Running (a2) -> Mo (dc)
    const b = mkBranch('me');
    const a1 = mkActivity('a1', 'me', 'me', { label: 'Sports' });
    const a2 = mkActivity('a2', 'a1', 'me', { label: 'Running' });
    const dc = mkDayChild('dc', 'a2', 'me', 1); // Monday

    b.children = ['a1'];
    a1.children = ['a2'];
    a2.children = ['dc'];

    setUp([b, a1, a2, dc]);
    _state.setActiveDayFilter(3); // Filter for Wednesday

    expect(getDayFilterOpacity('dc')).toBe(0.12);
    expect(getDayFilterOpacity('a2')).toBe(0.12);
    expect(getDayFilterOpacity('a1')).toBe(0.12);
    expect(getDayFilterOpacity('me')).toBe(1); // Branch always 1
  });
});
