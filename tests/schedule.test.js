import { describe, it, expect } from 'vitest';
import { nextOccurrence, occurrencesInRange } from './setup.js';

// Minimal entry factory — S1 only exercises the occurrence math, so nothing
// beyond anchor / repeat / end is needed here.
function entry(anchor, repeat = null, end = { type: 'never' }) {
  return { id: 'e1', label: 'Task', branch: 'work', anchor, repeat, end };
}

describe('Occurrence math — units', () => {
  it('repeat null yields exactly the anchor', () => {
    const e = entry('2026-03-31');
    expect(nextOccurrence(e, '2026-01-01')).toBe('2026-03-31');
    expect(nextOccurrence(e, '2026-03-31')).toBe('2026-03-31');
    expect(nextOccurrence(e, '2026-04-01')).toBeNull();
    expect(occurrencesInRange(e, '2026-01-01', '2027-01-01')).toEqual(['2026-03-31']);
  });

  it('steps by day', () => {
    const e = entry('2026-03-01', { every: 3, unit: 'day' });
    expect(occurrencesInRange(e, '2026-03-01', '2026-03-12'))
      .toEqual(['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10']);
  });

  it('steps by week', () => {
    const e = entry('2026-03-02', { every: 2, unit: 'week' });
    expect(occurrencesInRange(e, '2026-03-01', '2026-04-15'))
      .toEqual(['2026-03-02', '2026-03-16', '2026-03-30', '2026-04-13']);
  });

  it('steps by month', () => {
    const e = entry('2026-01-15', { every: 1, unit: 'month' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-04-30'))
      .toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('steps by year', () => {
    const e = entry('2026-03-31', { every: 1, unit: 'year' });
    expect(occurrencesInRange(e, '2026-01-01', '2029-12-31'))
      .toEqual(['2026-03-31', '2027-03-31', '2028-03-31', '2029-03-31']);
  });

  it('accepts any positive N', () => {
    const e = entry('2026-01-01', { every: 45, unit: 'day' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-05-01'))
      .toEqual(['2026-01-01', '2026-02-15', '2026-04-01']);
  });

  it('treats a non-positive or unknown repeat as no repeat', () => {
    expect(occurrencesInRange(entry('2026-01-01', { every: 0, unit: 'day' }), '2026-01-01', '2026-03-01'))
      .toEqual(['2026-01-01']);
    expect(occurrencesInRange(entry('2026-01-01', { every: 2, unit: 'fortnight' }), '2026-01-01', '2026-03-01'))
      .toEqual(['2026-01-01']);
  });
});

describe('Occurrence math — month-end clamping', () => {
  it('clamps 31 Jan into February and returns to 31 March', () => {
    const e = entry('2026-01-31', { every: 1, unit: 'month' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-06-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  });

  it('clamps into a leap February and still returns to 31 March', () => {
    const e = entry('2028-01-31', { every: 1, unit: 'month' });
    expect(occurrencesInRange(e, '2028-01-01', '2028-03-31'))
      .toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('never permanently shifts the anchor across a long run', () => {
    const e = entry('2026-01-31', { every: 1, unit: 'month' });
    const dates = occurrencesInRange(e, '2026-01-01', '2027-12-31');
    // Every 31-day month still lands on the 31st two years later.
    expect(dates).toContain('2027-01-31');
    expect(dates).toContain('2027-12-31');
    expect(dates).toContain('2027-02-28');
  });

  it('clamps a 29 February anchor on non-leap years', () => {
    const e = entry('2024-02-29', { every: 1, unit: 'year' });
    expect(occurrencesInRange(e, '2024-01-01', '2028-12-31'))
      .toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('handles a 2-year interval crossing a leap year', () => {
    const e = entry('2026-02-28', { every: 2, unit: 'year' });
    expect(occurrencesInRange(e, '2026-01-01', '2032-12-31'))
      .toEqual(['2026-02-28', '2028-02-28', '2030-02-28', '2032-02-28']);
    const leap = entry('2024-02-29', { every: 2, unit: 'year' });
    expect(occurrencesInRange(leap, '2024-01-01', '2030-12-31'))
      .toEqual(['2024-02-29', '2026-02-28', '2028-02-29', '2030-02-28']);
  });
});

describe('Occurrence math — end conditions', () => {
  it('never runs out with end never', () => {
    const e = entry('2026-01-01', { every: 1, unit: 'year' }, { type: 'never' });
    expect(nextOccurrence(e, '2126-01-01')).toBe('2126-01-01');
  });

  it('counts the anchor as the first of N', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'week' }, { type: 'count', n: 3 });
    expect(occurrencesInRange(e, '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(nextOccurrence(e, '2026-01-20')).toBeNull();
  });

  it('exhausts count mid-range', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'day' }, { type: 'count', n: 1 });
    expect(occurrencesInRange(e, '2026-01-01', '2026-01-31')).toEqual(['2026-01-05']);
  });

  it('yields nothing when count is below one', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'day' }, { type: 'count', n: 0 });
    expect(nextOccurrence(e, '2026-01-01')).toBeNull();
    expect(occurrencesInRange(e, '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('treats until as inclusive', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'week' }, { type: 'until', date: '2026-01-19' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(nextOccurrence(e, '2026-01-19')).toBe('2026-01-19');
    expect(nextOccurrence(e, '2026-01-20')).toBeNull();
  });
});

describe('Occurrence math — dates and robustness', () => {
  it('returns the anchor when fromDate precedes it', () => {
    const e = entry('2026-06-15', { every: 1, unit: 'month' });
    expect(nextOccurrence(e, '2020-01-01')).toBe('2026-06-15');
  });

  it('crosses both DST boundaries without losing or repeating a day', () => {
    // Europe/Prague springs forward on 2026-03-29 and falls back on 2026-10-25.
    const e = entry('2026-03-27', { every: 1, unit: 'day' });
    expect(occurrencesInRange(e, '2026-03-27', '2026-03-31'))
      .toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(occurrencesInRange(e, '2026-10-23', '2026-10-27'))
      .toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('walks a whole year of daily occurrences with no gap or repeat', () => {
    // 2028 is a leap year: 366 distinct, strictly ascending, contiguous dates.
    const dates = occurrencesInRange(entry('2028-01-01', { every: 1, unit: 'day' }), '2028-01-01', '2028-12-31');
    expect(dates).toHaveLength(366);
    expect(new Set(dates).size).toBe(366);
    expect(dates[59]).toBe('2028-02-29');
    expect(dates[365]).toBe('2028-12-31');
    for (let i = 1; i < dates.length; i++) expect(dates[i] > dates[i - 1]).toBe(true);
  });

  it('rejects an invalid anchor or bound instead of throwing', () => {
    expect(nextOccurrence(entry('2026-02-30'), '2026-01-01')).toBeNull();
    expect(nextOccurrence(entry('not-a-date'), '2026-01-01')).toBeNull();
    expect(nextOccurrence(null, '2026-01-01')).toBeNull();
    expect(nextOccurrence(entry('2026-01-01'), '2026-13-01')).toBeNull();
    expect(occurrencesInRange(entry('2026-01-01'), '2026-01-01', 'nope')).toEqual([]);
  });

  it('returns an empty range when the bounds are inverted', () => {
    const e = entry('2026-01-01', { every: 1, unit: 'day' });
    expect(occurrencesInRange(e, '2026-02-01', '2026-01-01')).toEqual([]);
  });

  it('returns a single-day range when from equals to', () => {
    const e = entry('2026-01-01', { every: 1, unit: 'day' });
    expect(occurrencesInRange(e, '2026-05-05', '2026-05-05')).toEqual(['2026-05-05']);
  });
});
