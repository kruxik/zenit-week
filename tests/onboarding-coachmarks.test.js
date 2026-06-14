import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state,
  tipsEnabled,
  setTipsEnabled,
  isHintSeen,
  markHintSeen,
  shouldShowHint,
  magicHintId,
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

  it('counter, days and views hints are registered', () => {
    expect(shouldShowHint('counter')).toBe(true);
    expect(shouldShowHint('days')).toBe(true);
    expect(shouldShowHint('views')).toBe(true);
  });

  describe('magicHintId (counter/days trigger logic)', () => {
    const mk = (overrides) => ({ id: 'x', type: 'activity', children: ['c'], ...overrides });

    it('returns "counter" when a child is a tickChild', () => {
      _state.set({ nodes: [mk(), { id: 'c', type: 'counter', parent: 'x', tickChild: true, children: [] }] });
      expect(magicHintId(_state.get().nodes[0])).toBe('counter');
    });

    it('returns "days" when a child is a dayChild', () => {
      _state.set({ nodes: [mk(), { id: 'c', type: 'activity', parent: 'x', dayChild: true, dayIndex: 0, children: [] }] });
      expect(magicHintId(_state.get().nodes[0])).toBe('days');
    });

    it('returns "days" for a single-day inline token (no day-children)', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Workout (tu)' })] });
      expect(magicHintId(_state.get().nodes[0])).toBe('days');
    });

    it('returns null for a plain task', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Workout' })] });
      expect(magicHintId(_state.get().nodes[0])).toBe(null);
    });
  });
});
