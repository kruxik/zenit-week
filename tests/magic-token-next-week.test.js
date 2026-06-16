import { describe, test, expect } from 'vitest';
import { magicTokenResolvesToNextWeek } from './setup.js';

// ISO weeks run Monday→Sunday. "tomorrow" only crosses into the next week when
// evaluated on a Sunday (tomorrow = next Monday). Every other day stays put, and
// "today"/"now" never cross.

// Fixed reference dates (local time) by weekday:
const SUNDAY    = new Date(2026, 5, 14); // 2026-06-14 is a Sunday (getDay() === 0)
const MONDAY    = new Date(2026, 5, 15); // Monday
const SATURDAY  = new Date(2026, 5, 13); // Saturday

describe('magicTokenResolvesToNextWeek', () => {
  test('Sunday + (tomorrow) → crosses', () => {
    expect(magicTokenResolvesToNextWeek('Task (tomorrow)', SUNDAY)).toBe(true);
  });

  test('Sunday + Czech (zítra) → crosses', () => {
    expect(magicTokenResolvesToNextWeek('Úkol (zítra)', SUNDAY)).toBe(true);
  });

  test('Sunday + ascii (zitra) → crosses', () => {
    expect(magicTokenResolvesToNextWeek('Úkol (zitra)', SUNDAY)).toBe(true);
  });

  test('Sunday + (today) → does NOT cross', () => {
    expect(magicTokenResolvesToNextWeek('Task (today)', SUNDAY)).toBe(false);
  });

  test('Sunday + (now) → does NOT cross', () => {
    expect(magicTokenResolvesToNextWeek('Task (now)', SUNDAY)).toBe(false);
  });

  test('Saturday + (tomorrow) → does NOT cross (tomorrow is Sunday, same week)', () => {
    expect(magicTokenResolvesToNextWeek('Task (tomorrow)', SATURDAY)).toBe(false);
  });

  test('Monday + (tomorrow) → does NOT cross', () => {
    expect(magicTokenResolvesToNextWeek('Task (tomorrow)', MONDAY)).toBe(false);
  });

  test('no (…) group → false', () => {
    expect(magicTokenResolvesToNextWeek('Plain task', SUNDAY)).toBe(false);
  });

  test('concrete day token, no magic → false', () => {
    expect(magicTokenResolvesToNextWeek('Task (Mo)', SUNDAY)).toBe(false);
  });

  test('mixed group with tomorrow → crosses', () => {
    expect(magicTokenResolvesToNextWeek('Task (tomorrow, fr)', SUNDAY)).toBe(true);
  });

  test('case-insensitive token match', () => {
    expect(magicTokenResolvesToNextWeek('Task (Tomorrow)', SUNDAY)).toBe(true);
  });

  test('null / empty label → false', () => {
    expect(magicTokenResolvesToNextWeek('', SUNDAY)).toBe(false);
    expect(magicTokenResolvesToNextWeek(null, SUNDAY)).toBe(false);
  });
});
