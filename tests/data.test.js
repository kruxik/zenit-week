import { getISOWeek, weeksInYear, offsetWeek, weekKey, parseWeekKey, genId } from './setup.js';

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
