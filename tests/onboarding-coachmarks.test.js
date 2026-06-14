import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state,
  tipsEnabled,
  setTipsEnabled,
  isHintSeen,
  markHintSeen,
  shouldShowHint,
} from './setup.js';

describe('Coachmark hints — engine + seam (PB1)', () => {
  beforeEach(() => {
    _state.resetTips();
  });

  it('defaults: tips enabled, nothing seen', () => {
    expect(tipsEnabled()).toBe(true);
    expect(isHintSeen('hover-keys')).toBe(false);
  });

  it('shows a registered, unseen hint when tips are on and none is visible', () => {
    expect(shouldShowHint('hover-keys')).toBe(true);
  });

  it('does not show an unknown (unregistered) hint', () => {
    expect(shouldShowHint('does-not-exist')).toBe(false);
  });

  it('does not re-show a hint once seen', () => {
    markHintSeen('hover-keys');
    expect(isHintSeen('hover-keys')).toBe(true);
    expect(shouldShowHint('hover-keys')).toBe(false);
  });

  it('suppresses hints while tips are disabled, restores when re-enabled', () => {
    setTipsEnabled(false);
    expect(tipsEnabled()).toBe(false);
    expect(shouldShowHint('hover-keys')).toBe(false);
    setTipsEnabled(true);
    expect(shouldShowHint('hover-keys')).toBe(true);
  });

  it('shows only one coachmark at a time', () => {
    _state.setCoachmarkVisible(true);
    expect(shouldShowHint('hover-keys')).toBe(false);
    _state.setCoachmarkVisible(false);
    expect(shouldShowHint('hover-keys')).toBe(true);
  });

  it('markHintSeen is idempotent', () => {
    markHintSeen('hover-keys');
    markHintSeen('hover-keys');
    expect(isHintSeen('hover-keys')).toBe(true);
  });
});
