import {
  dayFilterMatches,
  computeLayout,
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

describe('dayFilterMatches — no filter', () => {
  test('center → true', () => {
    setUp([mkBranch('b1')]);
    expect(dayFilterMatches('center')).toBe(true);
  });

  test('branch → true', () => {
    setUp([mkBranch('b1')]);
    expect(dayFilterMatches('b1')).toBe(true);
  });

  test('activity → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    b.children = ['a1'];
    setUp([b, a]);
    expect(dayFilterMatches('a1')).toBe(true);
  });

  test('day-child → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    expect(dayFilterMatches('dc1')).toBe(true);
  });

  test('counter → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['c1'];
    b.children = ['a1'];
    setUp([b, a, c]);
    expect(dayFilterMatches('c1')).toBe(true);
  });
});

// ─── Day filter d=1 (Monday) ──────────────────────────────────────────────────

describe('dayFilterMatches — day filter 1 (Mon)', () => {
  test('day-child dayIndex=1 → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('dc1')).toBe(true);
  });

  test('day-child dayIndex=2 → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc2', 'a1', 'b1', 2);
    a.children = ['dc2'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('dc2')).toBe(false);
  });

  test('activity with day-child dayIndex=1 → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('a1')).toBe(true);
  });

  test('activity with only day-child dayIndex=2 → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc2', 'a1', 'b1', 2);
    a.children = ['dc2'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('a1')).toBe(false);
  });

  test('activity label="Yoga (mo)", no day-children → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1', { label: 'Yoga (mo)' });
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('a1')).toBe(true);
  });

  test('activity with no day-children, no label days → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1', { label: 'Yoga' });
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('a1')).toBe(false);
  });

  test('counter whose parent has day-child dayIndex=1 → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['dc1', 'c1'];
    b.children = ['a1'];
    setUp([b, a, dc, c]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('c1')).toBe(true);
  });

  test('counter whose parent has only day-child dayIndex=2 → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc2', 'a1', 'b1', 2);
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['dc2', 'c1'];
    b.children = ['a1'];
    setUp([b, a, dc, c]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('c1')).toBe(false);
  });

  test('branch carrying nothing for the day → false (it gets pruned)', () => {
    const b = mkBranch('b1');
    setUp([b]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('b1')).toBe(false);
  });

  test('center → true', () => {
    setUp([mkBranch('b1')]);
    _state.setActiveDayFilter(1);
    expect(dayFilterMatches('center')).toBe(true);
  });
});

// ─── Unscheduled filter ───────────────────────────────────────────────────────

describe('dayFilterMatches — unscheduled filter', () => {
  test('activity with no day-children, no counter, no label days → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('a1')).toBe(true);
  });

  test('activity with label day "(Mo)", no day-children → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1', { label: 'Running (Mo)' });
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('a1')).toBe(false);
  });

  test('activity with day-child → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('a1')).toBe(false);
  });

  test('activity with counter (no day-children) → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const c = mkCounter('c1', 'a1', 'b1');
    a.children = ['c1'];
    b.children = ['a1'];
    setUp([b, a, c]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('a1')).toBe(false);
  });

  test('day-child node → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', 1);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('dc1')).toBe(false);
  });

  test('branch with an unscheduled activity → true', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    b.children = ['a1'];
    setUp([b, a]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('b1')).toBe(true);
  });

  test('empty branch → false', () => {
    const b = mkBranch('b1');
    setUp([b]);
    _state.setActiveDayFilter('unscheduled');
    expect(dayFilterMatches('b1')).toBe(false);
  });
});

// ─── Ancestor / branch visibility ────────────────────────────────────────────

describe('dayFilterMatches — ancestor visibility', () => {
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

    expect(dayFilterMatches('dc')).toBe(true);
    expect(dayFilterMatches('a2')).toBe(true);
    expect(dayFilterMatches('a1')).toBe(true);
    expect(dayFilterMatches('me')).toBe(true);
  });

  test('Nothing in the subtree matches → the whole chain, branch included, is out', () => {
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

    expect(dayFilterMatches('dc')).toBe(false);
    expect(dayFilterMatches('a2')).toBe(false);
    expect(dayFilterMatches('a1')).toBe(false);
    // The branch carries nothing for Wednesday, so it goes too.
    expect(dayFilterMatches('me')).toBe(false);
  });
});

// ─── Overdue filter ──────────────────────────────────────────────────────────

describe('dayFilterMatches — overdue filter', () => {
  let todayIdx, todayPos;

  beforeEach(() => {
    todayIdx = new Date().getDay();
    todayPos = todayIdx === 0 ? 7 : todayIdx;
  });

  test('undone past day activity → true', () => {
    if (todayPos === 1) return; // Skip if it's Monday, no past days in current week

    const pastDayIdx = todayIdx === 1 ? 0 : (todayIdx === 0 ? 6 : todayIdx - 1);
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', pastDayIdx);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('overdue');
    expect(dayFilterMatches('a1')).toBe(true);
  });

  test('undone today activity → false', () => {
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', todayIdx);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('overdue');
    expect(dayFilterMatches('a1')).toBe(false);
  });

  test('undone future day activity → false', () => {
    if (todayPos === 7) return; // Skip if it's Sunday, no future days in current week

    const futureDayIdx = todayIdx === 6 ? 0 : todayIdx + 1;
    const b = mkBranch('b1');
    const a = mkActivity('a1', 'b1', 'b1');
    const dc = mkDayChild('dc1', 'a1', 'b1', futureDayIdx);
    a.children = ['dc1'];
    b.children = ['a1'];
    setUp([b, a, dc]);
    _state.setActiveDayFilter('overdue');
    expect(dayFilterMatches('a1')).toBe(false);
  });
});

// ─── Layout pruning ──────────────────────────────────────────────────────────
// The day filter hides through the same mechanism as Rocks/Pebbles/Sand: a
// non-matching node gets no position from computeLayout, so render() skips it
// and the survivors pack tight. These tests pin that, and the composition of the
// two filters.

describe('day-filter layout pruning', () => {
  afterEach(() => {
    _state.setActiveDayFilter(null);
    _state.setViewLevel('full');
  });

  // center → work → [mon (Mon leaf), tue (Tue leaf)]
  //        → play → [wed (Wed leaf)]
  function buildTree() {
    const center = { id: 'center', type: 'center', label: 'Week', children: ['work', 'play'] };
    const work = { ...mkBranch('work'), parent: 'center', side: 'right', children: ['aMon', 'aTue'] };
    const play = { ...mkBranch('play'), parent: 'center', side: 'left', children: ['aWed'] };
    const aMon = mkActivity('aMon', 'work', 'work', { children: ['dMon'] });
    const aTue = mkActivity('aTue', 'work', 'work', { children: ['dTue'] });
    const aWed = mkActivity('aWed', 'play', 'play', { children: ['dWed'] });
    return [center, work, play, aMon, aTue, aWed,
      mkDayChild('dMon', 'aMon', 'work', 1),
      mkDayChild('dTue', 'aTue', 'work', 2),
      mkDayChild('dWed', 'aWed', 'play', 3)];
  }

  function layoutWith(day, level = 'full') {
    setUp(buildTree());
    rebuildNodeMap();
    _state.setViewLevel(level);
    _state.setActiveDayFilter(day);
    return computeLayout();
  }

  test('no filter positions every node', () => {
    const pos = layoutWith(null);
    ['work', 'play', 'aMon', 'aTue', 'aWed', 'dMon', 'dTue', 'dWed']
      .forEach(id => expect(pos[id]).toBeDefined());
  });

  test('Monday keeps only the Monday chain', () => {
    const pos = layoutWith(1);
    expect(pos['aMon']).toBeDefined();
    expect(pos['dMon']).toBeDefined();
    expect(pos['aTue']).toBeUndefined();
    expect(pos['dTue']).toBeUndefined();
  });

  test('a branch with nothing for the day is pruned too', () => {
    const pos = layoutWith(1);
    expect(pos['work']).toBeDefined();
    expect(pos['play']).toBeUndefined(); // only carries Wednesday
    expect(pos['aWed']).toBeUndefined();
  });

  test('the center always survives, even on a day with nothing on it', () => {
    const pos = layoutWith(5); // Friday — nothing scheduled
    expect(pos['center']).toBeDefined();
    expect(pos['work']).toBeUndefined();
    expect(pos['play']).toBeUndefined();
  });

  test('filtering to one day packs the surviving branches tighter', () => {
    const sand = layoutWith(null);
    const monday = layoutWith(1);
    // 'work' keeps 2 activities unfiltered and 1 under the Monday filter, so its
    // subtree shrinks and the branch re-centers.
    expect(Math.abs(monday['work'].y - monday['aMon'].y))
      .toBeLessThanOrEqual(Math.abs(sand['work'].y - sand['aMon'].y));
  });

  test('composes with the view level — Rocks still wins on depth', () => {
    const pos = layoutWith(1, 'rocks');
    expect(pos['work']).toBeDefined();   // matches Monday, depth 1
    expect(pos['aMon']).toBeUndefined(); // matches Monday, but Rocks hides depth 2
    expect(pos['play']).toBeUndefined(); // pruned by the day filter
  });
});

// A multi-day activity lays its day leaves out as a staggered zigzag block once
// there are 3+ of them. Filtering to one day leaves a single survivor, which must
// land exactly where a lone day leaf lands — the zigzag metrics have to be built
// from the filtered child set, not the raw one, or the survivor is staggered
// against siblings that aren't on screen and stranded inside a block sized for
// all seven days.
describe('day-filter zigzag positioning', () => {
  afterEach(() => _state.setActiveDayFilter(null));

  // One wide pruned sibling, so a stale maxW1/staggerX would show up loudly in x.
  function build(dayIndexes) {
    const center = { id: 'center', type: 'center', label: 'Week', children: ['b'] };
    const b = { ...mkBranch('b'), parent: 'center', side: 'right', children: ['act'] };
    const act = mkActivity('act', 'b', 'b', { label: 'Task', children: dayIndexes.map(d => `d${d}`) });
    const leaves = dayIndexes.map(d => {
      const leaf = mkDayChild(`d${d}`, 'act', 'b', d);
      if (d === 1) leaf.label = 'MondayWideWideWideWide';
      return leaf;
    });
    return [center, b, act, ...leaves];
  }

  function offsetOfWednesdayLeaf(dayIndexes, day) {
    _state.set({ nodes: build(dayIndexes) });
    _state.setWeekKey('2026-01');
    _state.setLang('en');
    _state.setViewLevel('full');
    _state.setActiveDayFilter(day);
    rebuildNodeMap();
    const pos = computeLayout();
    expect(pos['d3']).toBeDefined();
    return { dx: pos['d3'].x - pos['act'].x, dy: pos['d3'].y - pos['act'].y };
  }

  test('the lone survivor of a 5-day block sits where a lone day leaf sits', () => {
    const filtered = offsetOfWednesdayLeaf([1, 2, 3, 4, 5], 3);
    const control  = offsetOfWednesdayLeaf([3], null);
    expect(filtered.dx).toBeCloseTo(control.dx, 5);
    expect(filtered.dy).toBeCloseTo(control.dy, 5);
  });

  test('a single survivor is vertically centred on its parent', () => {
    expect(offsetOfWednesdayLeaf([1, 2, 3, 4, 5, 6, 0], 3).dy).toBeCloseTo(0, 5);
  });

  test('unfiltered, 5 day leaves still zigzag', () => {
    // Guards the other direction: filtering the metrics input must not disable the
    // stagger when every leaf is on screen.
    _state.set({ nodes: build([1, 2, 3, 4, 5]) });
    _state.setWeekKey('2026-01');
    _state.setLang('en');
    _state.setViewLevel('full');
    _state.setActiveDayFilter(null);
    rebuildNodeMap();
    const pos = computeLayout();
    expect(pos['d2'].x).not.toBeCloseTo(pos['d1'].x, 1); // odd slots are staggered out
    expect(pos['d3'].x).toBeCloseTo(pos['d1'].x, 5);     // even slots share a column
  });
});
