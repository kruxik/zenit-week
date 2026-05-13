import { describe, it, expect } from 'vitest';
import { computeDayReschedule } from './setup.js';

const days = (...arr) => new Set(arr);

describe('computeDayReschedule', () => {
  describe("mode 'clear'", () => {
    it('returns null when no days assigned', () => {
      expect(computeDayReschedule('clear', { currentDays: days() })).toBeNull();
    });
    it('wipes all when at least one day assigned', () => {
      const r = computeDayReschedule('clear', { currentDays: days(1, 3, 5) });
      expect([...r.newDays].sort()).toEqual([]);
      expect(r.keepAsChildren).toBe(false);
    });
  });

  describe("mode 'leaf'", () => {
    it('toggles off when picking the same day (others remain)', () => {
      const r = computeDayReschedule('leaf', {
        currentDays: days(1, 3, 5),
        currentDayIndex: 3,
        newDayIndex: 3,
      });
      expect([...r.newDays].sort()).toEqual([1, 5]);
      expect(r.keepAsChildren).toBe(true);
    });
    it('toggles off the only assigned day → keepAsChildren=false', () => {
      const r = computeDayReschedule('leaf', {
        currentDays: days(3),
        currentDayIndex: 3,
        newDayIndex: 3,
      });
      expect([...r.newDays]).toEqual([]);
      expect(r.keepAsChildren).toBe(false);
    });
    it('reassigns to a new day → deletes old, adds new', () => {
      const r = computeDayReschedule('leaf', {
        currentDays: days(1, 5),
        currentDayIndex: 5,
        newDayIndex: 6,
      });
      expect([...r.newDays].sort()).toEqual([1, 6]);
      expect(r.keepAsChildren).toBe(true);
    });
    it('returns null on collision (target day held by sibling)', () => {
      const r = computeDayReschedule('leaf', {
        currentDays: days(1, 3, 5),
        currentDayIndex: 5,
        newDayIndex: 3,
      });
      expect(r).toBeNull();
    });
  });

  describe("mode 'activity-checkbox'", () => {
    it('adds the day when absent', () => {
      const r = computeDayReschedule('activity-checkbox', {
        currentDays: days(1, 3),
        newDayIndex: 5,
      });
      expect([...r.newDays].sort()).toEqual([1, 3, 5]);
      expect(r.keepAsChildren).toBe(true);
    });
    it('removes the day when already present', () => {
      const r = computeDayReschedule('activity-checkbox', {
        currentDays: days(1, 3, 5),
        newDayIndex: 3,
      });
      expect([...r.newDays].sort()).toEqual([1, 5]);
      expect(r.keepAsChildren).toBe(true);
    });
  });

  describe("mode 'activity-radio'", () => {
    it('replaces with single day when different', () => {
      const r = computeDayReschedule('activity-radio', {
        currentDays: days(2),
        newDayIndex: 5,
      });
      expect([...r.newDays]).toEqual([5]);
      expect(r.keepAsChildren).toBe(false);
    });
    it('toggles off when same day clicked', () => {
      const r = computeDayReschedule('activity-radio', {
        currentDays: days(5),
        newDayIndex: 5,
      });
      expect([...r.newDays]).toEqual([]);
      expect(r.keepAsChildren).toBe(false);
    });
    it('sets a day when none assigned', () => {
      const r = computeDayReschedule('activity-radio', {
        currentDays: days(),
        newDayIndex: 5,
      });
      expect([...r.newDays]).toEqual([5]);
      expect(r.keepAsChildren).toBe(false);
    });
  });

  it('returns null for unknown mode', () => {
    expect(computeDayReschedule('bogus', { currentDays: days() })).toBeNull();
  });
});
