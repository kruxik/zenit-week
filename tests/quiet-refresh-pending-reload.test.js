import { describe, it, expect } from 'vitest';
import { isPendingReloadOwed } from './setup.js';

const V = '2026.08.21';

describe('isPendingReloadOwed', () => {
  it('is not owed when no record was ever written', () => {
    expect(isPendingReloadOwed(null, V)).toBe(false);
    expect(isPendingReloadOwed(undefined, V)).toBe(false);
  });

  it('is owed while the launch is still the build the record named', () => {
    expect(isPendingReloadOwed({ v: V, n: 0 }, V)).toBe(true);
    expect(isPendingReloadOwed({ v: V, n: 2 }, V)).toBe(true);
  });

  it('is spent once the launch already carries a different build', () => {
    expect(isPendingReloadOwed({ v: '2026.08.20', n: 0 }, V)).toBe(false);
  });

  it('gives up after the attempt cap, so a reload cannot loop', () => {
    expect(isPendingReloadOwed({ v: V, n: 3 }, V)).toBe(false);
    expect(isPendingReloadOwed({ v: V, n: 9 }, V)).toBe(false);
  });

  it('honours an explicit cap', () => {
    expect(isPendingReloadOwed({ v: V, n: 1 }, V, 1)).toBe(false);
    expect(isPendingReloadOwed({ v: V, n: 0 }, V, 1)).toBe(true);
  });

  it('treats a malformed record as no record', () => {
    expect(isPendingReloadOwed({}, V)).toBe(false);
    expect(isPendingReloadOwed({ v: 7, n: 0 }, V)).toBe(false);
    expect(isPendingReloadOwed('nonsense', V)).toBe(false);
  });

  it('treats a missing or non-numeric attempt count as zero', () => {
    expect(isPendingReloadOwed({ v: V }, V)).toBe(true);
    expect(isPendingReloadOwed({ v: V, n: 'many' }, V)).toBe(true);
  });
});
