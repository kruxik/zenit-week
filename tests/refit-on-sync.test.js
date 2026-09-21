import { describe, test, expect } from 'vitest';
import { shouldRefitForExtentChange } from './setup.js';

// A sync may move the viewport only when the map changed size enough that the
// user would otherwise be looking at the wrong part of it. The threshold is
// symmetric, so a first sync filling an empty week and a week losing most of
// its content behave the same.
describe('refit threshold', () => {
  const box = (w, h) => ({ w, h });

  test('leaves the viewport alone for an ordinary edit', () => {
    expect(shouldRefitForExtentChange(box(1000, 800), box(1050, 820))).toBe(false);
  });

  test('refits when the map grows by more than a fifth', () => {
    expect(shouldRefitForExtentChange(box(1000, 800), box(1300, 800))).toBe(true);
  });

  test('refits when the map shrinks by more than a fifth', () => {
    expect(shouldRefitForExtentChange(box(1300, 800), box(1000, 800))).toBe(true);
  });

  test('measures each axis on its own', () => {
    // Width barely moved; height nearly doubled. The longer axis decides.
    expect(shouldRefitForExtentChange(box(1000, 400), box(1010, 900))).toBe(true);
  });

  test('sits exactly on the ratio without refitting', () => {
    expect(shouldRefitForExtentChange(box(1000, 800), box(1200, 800))).toBe(false);
    expect(shouldRefitForExtentChange(box(1000, 800), box(1201, 800))).toBe(true);
  });

  test('a map appearing where there was none always refits', () => {
    expect(shouldRefitForExtentChange(null, box(900, 700))).toBe(true);
  });

  test('nothing to measure means nothing to do', () => {
    expect(shouldRefitForExtentChange(box(900, 700), null)).toBe(false);
    expect(shouldRefitForExtentChange(null, null)).toBe(false);
  });

  test('honours a caller-supplied ratio', () => {
    expect(shouldRefitForExtentChange(box(1000, 800), box(1100, 800), 1.05)).toBe(true);
    expect(shouldRefitForExtentChange(box(1000, 800), box(1100, 800), 1.5)).toBe(false);
  });
});
