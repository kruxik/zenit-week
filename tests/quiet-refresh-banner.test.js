import { describe, it, expect } from 'vitest';
import { shouldShowUpdateBanner } from './setup.js';

const MIN = 60 * 1000;

function state(overrides = {}) {
  return {
    pending:      true,
    dismissed:    false,
    nudgeVisible: false,
    owedForMs:    10 * MIN,
    ...overrides,
  };
}

describe('shouldShowUpdateBanner', () => {
  it('shows once a reload has been deferred long enough', () => {
    expect(shouldShowUpdateBanner(state())).toBe(true);
  });

  it('stays quiet while no reload is owed', () => {
    expect(shouldShowUpdateBanner(state({ pending: false }))).toBe(false);
  });

  it('stays quiet during the grace period, so the silent reload goes first', () => {
    expect(shouldShowUpdateBanner(state({ owedForMs: 0 }))).toBe(false);
    expect(shouldShowUpdateBanner(state({ owedForMs: 4 * MIN }))).toBe(false);
    expect(shouldShowUpdateBanner(state({ owedForMs: 5 * MIN }))).toBe(true);
  });

  it('stays quiet once dismissed', () => {
    expect(shouldShowUpdateBanner(state({ dismissed: true }))).toBe(false);
  });

  it('yields the slot to the onboarding nudge', () => {
    expect(shouldShowUpdateBanner(state({ nudgeVisible: true }))).toBe(false);
  });

  it('takes the slot back when the nudge goes away', () => {
    expect(shouldShowUpdateBanner(state({ nudgeVisible: false }))).toBe(true);
  });
});
