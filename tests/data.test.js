import { getISOWeek, weeksInYear, offsetWeek, weekKey, parseWeekKey, genId, defaultWeekData, validateAndRepair } from './setup.js';

describe('getISOWeek', () => {
  test('returns correct week and year for a mid-year date', () => {
    expect(getISOWeek(new Date('2026-04-10'))).toEqual({ week: 15, year: 2026 });
  });

  test('Jan 1 that belongs to the last week of the previous year', () => {
    // 2023-01-01 is ISO week 52 of 2022
    expect(getISOWeek(new Date('2023-01-01'))).toEqual({ week: 52, year: 2022 });
  });

  test('Dec 31 that belongs to week 1 of the next year', () => {
    // 2018-12-31 is ISO week 1 of 2019
    expect(getISOWeek(new Date('2018-12-31'))).toEqual({ week: 1, year: 2019 });
  });

  test('correctly identifies week 53 in a 53-week year', () => {
    // 2020-12-31 is ISO week 53 of 2020
    expect(getISOWeek(new Date('2020-12-31'))).toEqual({ week: 53, year: 2020 });
  });
});

describe('weeksInYear', () => {
  test('returns 52 for a regular year', () => {
    expect(weeksInYear(2025)).toBe(52);
  });

  test('returns 53 for 2020 (53-week year)', () => {
    expect(weeksInYear(2020)).toBe(53);
  });

  test('returns 53 for 2026 (53-week year)', () => {
    expect(weeksInYear(2026)).toBe(53);
  });

  test('returns 53 for 2015 (53-week year)', () => {
    expect(weeksInYear(2015)).toBe(53);
  });

  // Timezone-safety: weeksInYear internally constructs Date.UTC(year, 11, 28).
  // In UTC-negative timezones that midnight UTC timestamp reads as Dec 27 locally,
  // which is week 52 — wrong for 53-week years like 2020.
  // The fix (noon UTC) ensures Dec 28 is always read as Dec 28 in any timezone.
  // This test verifies getISOWeek is given a date that is unambiguously Dec 28 UTC.
  test('getISOWeek on Dec 28 noon UTC of a 53-week year always returns week 53', () => {
    const dec28Noon = new Date(Date.UTC(2020, 11, 28, 12, 0, 0));
    expect(getISOWeek(dec28Noon).week).toBe(53);
  });

  test('getISOWeek on Dec 28 noon UTC of a 52-week year always returns week 52', () => {
    const dec28Noon = new Date(Date.UTC(2025, 11, 28, 12, 0, 0));
    expect(getISOWeek(dec28Noon).week).toBe(52);
  });
});

describe('weekKey', () => {
  test('pads single-digit week with a leading zero', () => {
    expect(weekKey(2026, 1)).toBe('2026-01');
  });

  test('does not pad double-digit week', () => {
    expect(weekKey(2026, 15)).toBe('2026-15');
  });
});

describe('parseWeekKey', () => {
  test('parses a zero-padded key', () => {
    expect(parseWeekKey('2026-01')).toEqual({ year: 2026, week: 1 });
  });

  test('parses a double-digit week key', () => {
    expect(parseWeekKey('2026-15')).toEqual({ year: 2026, week: 15 });
  });

  test('round-trips with weekKey', () => {
    const key = weekKey(2026, 7);
    expect(parseWeekKey(key)).toEqual({ year: 2026, week: 7 });
  });
});

describe('offsetWeek', () => {
  test('moves forward within the same year', () => {
    expect(offsetWeek('2026-10', 3)).toBe('2026-13');
  });

  test('moves backward within the same year', () => {
    expect(offsetWeek('2026-10', -3)).toBe('2026-07');
  });

  test('wraps forward across a year boundary (52-week year)', () => {
    // 2025 has 52 weeks → week 52 + 1 = week 1 of 2026
    expect(offsetWeek('2025-52', 1)).toBe('2026-01');
  });

  test('wraps forward across a year boundary (53-week year)', () => {
    // 2026 has 53 weeks → week 53 + 1 = week 1 of 2027
    expect(offsetWeek('2026-53', 1)).toBe('2027-01');
  });

  test('wraps backward across a year boundary into a 52-week year', () => {
    // week 1 of 2025 − 1 = week 52 of 2024
    expect(offsetWeek('2025-01', -1)).toBe('2024-52');
  });

  test('wraps backward across a year boundary into a 53-week year', () => {
    // week 1 of 2021 − 1 = week 53 of 2020
    expect(offsetWeek('2021-01', -1)).toBe('2020-53');
  });

  test('delta of 0 returns the same key', () => {
    expect(offsetWeek('2026-15', 0)).toBe('2026-15');
  });
});

describe('genId', () => {
  test('starts with "n"', () => {
    expect(genId().startsWith('n')).toBe(true);
  });

  test('matches expected format: n + 12 hex characters', () => {
    expect(genId()).toMatch(/^n[0-9a-f]{12}$/);
  });

  test('1000 generated IDs are all unique', () => {
    const ids = Array.from({ length: 1000 }, genId);
    expect(new Set(ids).size).toBe(1000);
  });
});

describe('defaultWeekData', () => {
  test('returns exactly three branch nodes', () => {
    expect(defaultWeekData().nodes).toHaveLength(3);
  });

  test('branch ids are work, family, me', () => {
    const ids = defaultWeekData().nodes.map(n => n.id);
    expect(ids).toEqual(['work', 'family', 'me']);
  });

  test('every node has type "branch" and an empty children array', () => {
    defaultWeekData().nodes.forEach(n => {
      expect(n.type).toBe('branch');
      expect(n.children).toEqual([]);
    });
  });
});

describe('validateAndRepair', () => {
  test('null input returns default week data shape', () => {
    const result = validateAndRepair(null);
    expect(result.nodes.map(n => n.id)).toEqual(['work', 'family', 'me']);
  });

  test('object without nodes array returns default week data shape', () => {
    const result = validateAndRepair({});
    expect(result.nodes.map(n => n.id)).toEqual(['work', 'family', 'me']);
  });

  test('strips _editing flag from all nodes', () => {
    const data = defaultWeekData();
    data.nodes[0]._editing = true;
    validateAndRepair(data);
    expect(data.nodes[0]._editing).toBeUndefined();
  });

  test('removes dead child references', () => {
    const data = defaultWeekData();
    data.nodes[0].children = ['ghost-id'];
    validateAndRepair(data);
    expect(data.nodes[0].children).toEqual([]);
  });

  test('removes orphaned nodes not reachable from any branch', () => {
    const data = defaultWeekData();
    data.nodes.push({ id: 'orphan', type: 'activity', parent: null, children: [] });
    validateAndRepair(data);
    const ids = data.nodes.map(n => n.id);
    expect(ids).not.toContain('orphan');
  });

  test('valid data passes through unchanged', () => {
    const data = defaultWeekData();
    data.nodes[0].children = ['task-1'];
    data.nodes.push({ id: 'task-1', type: 'activity', parent: 'work', label: 'Write tests', children: [] });
    validateAndRepair(data);
    const ids = data.nodes.map(n => n.id);
    expect(ids).toContain('task-1');
  });

  test('repairs dangling parent ref when parent exists in the tree', () => {
    const data = defaultWeekData();
    data.nodes[0].children = ['task-1'];
    data.nodes.push({ id: 'task-1', type: 'activity', parent: 'WRONG', label: 'Task', children: [] });
    validateAndRepair(data);
    const task = data.nodes.find(n => n.id === 'task-1');
    expect(task.parent).toBe('work');
  });

  test('reconstructs a missing branch node', () => {
    const data = defaultWeekData();
    data.nodes = data.nodes.filter(n => n.id !== 'work');
    validateAndRepair(data);
    expect(data.nodes.find(n => n.id === 'work')).toBeDefined();
  });

  test('reconstructed missing branch has correct type and empty children', () => {
    const data = defaultWeekData();
    data.nodes = data.nodes.filter(n => n.id !== 'family');
    validateAndRepair(data);
    const family = data.nodes.find(n => n.id === 'family');
    expect(family.type).toBe('branch');
    expect(family.children).toEqual([]);
  });

  test('children of a missing branch are not silently lost', () => {
    // If the branch node itself is gone but its children are still in data,
    // the repair must not garbage-collect those children once the branch is restored.
    // (Current behaviour GCs them — this test documents the expectation after the fix.)
    const data = defaultWeekData();
    data.nodes[0].children = ['task-1'];
    data.nodes.push({ id: 'task-1', type: 'activity', parent: 'work', label: 'Task', children: [] });
    data.nodes = data.nodes.filter(n => n.id !== 'work'); // drop the branch
    validateAndRepair(data);
    expect(data.nodes.find(n => n.id === 'task-1')).toBeDefined();
  });
});
