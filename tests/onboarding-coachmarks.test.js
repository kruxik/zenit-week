import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state,
  tipsEnabled,
  setTipsEnabled,
  isHintSeen,
  markHintSeen,
  shouldShowHint,
  hoverHintId,
  hintIdsByPriority,
  replayTips,
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

  it('replayTips clears seen-flags and re-enables tips', () => {
    markHintSeen('hover-keys');
    markHintSeen('counter');
    setTipsEnabled(false);
    replayTips();
    expect(isHintSeen('hover-keys')).toBe(false);
    expect(isHintSeen('counter')).toBe(false);
    expect(tipsEnabled()).toBe(true);
    expect(shouldShowHint('hover-keys')).toBe(true);
  });

  it('counter, days, views, unplanned and done hints are registered', () => {
    expect(shouldShowHint('counter')).toBe(true);
    expect(shouldShowHint('days')).toBe(true);
    expect(shouldShowHint('views')).toBe(true);
    expect(shouldShowHint('unplanned')).toBe(true);
    expect(shouldShowHint('done')).toBe(true);
    expect(shouldShowHint('priority')).toBe(true);
  });

  describe('hoverHintId (which hint a node teaches on hover)', () => {
    const mk = (overrides) => ({ id: 'x', type: 'activity', children: ['c'], ...overrides });

    it('returns "counter" for a node with tick children, and for a tick child itself', () => {
      _state.set({ nodes: [mk(), { id: 'c', type: 'counter', parent: 'x', tickChild: true, children: [] }] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('counter');
      expect(hoverHintId(_state.get().nodes[1])).toBe('counter');
    });

    it('returns "days" for a node with day children, and for a day child itself', () => {
      _state.set({ nodes: [mk(), { id: 'c', type: 'activity', parent: 'x', dayChild: true, dayIndex: 0, children: [] }] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('days');
      expect(hoverHintId(_state.get().nodes[1])).toBe('days');
    });

    it('returns "days" for a single-day inline token (no day-children)', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Workout (tu)' })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('days');
    });

    it('returns "unplanned" for an unplanned task', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Fix the boiler', unplanned: true })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('unplanned');
    });

    it('orders the competing hints by priority, lowest first', () => {
      expect(hintIdsByPriority()).toEqual(['done', 'unplanned', 'counter', 'days', 'priority', 'hover-keys']);
    });

    it('state outranks syntax: an unplanned counter or day task teaches unplanned', () => {
      _state.set({ nodes: [
        mk({ unplanned: true }),
        { id: 'c', type: 'counter', parent: 'x', tickChild: true, children: [] },
      ] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('unplanned');
      _state.set({ nodes: [mk({ children: [], label: 'Workout (tu)', unplanned: true })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('unplanned');
    });

    it('returns "done" for a finished task', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Call grandma', done: true })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('done');
    });

    it('teaches done over unplanned when a task is both', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Fix the boiler', unplanned: true, done: true })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('done');
    });

    it('state outranks syntax: a done counter teaches done', () => {
      _state.set({ nodes: [
        mk({ done: true }),
        { id: 'c', type: 'counter', parent: 'x', tickChild: true, children: [] },
      ] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('done');
    });

    it('returns "priority" for a high or critical task', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Q1 OKR draft', priority: 'critical' })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('priority');
      _state.set({ nodes: [mk({ children: [], label: 'Claude Design', priority: 'high' })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('priority');
    });

    it('does not treat a normal-priority task as a priority hint', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Plain', priority: null })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('hover-keys');
    });

    it('syntax outranks priority: a critical counter teaches Nx', () => {
      _state.set({ nodes: [
        mk({ priority: 'critical' }),
        { id: 'c', type: 'counter', parent: 'x', tickChild: true, children: [] },
      ] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('counter');
    });

    it('falls back to the generic hotkey card for a plain task', () => {
      _state.set({ nodes: [mk({ children: [], label: 'Workout' })] });
      expect(hoverHintId(_state.get().nodes[0])).toBe('hover-keys');
    });

    it('teaches nothing for branches, the centre, or a missing node', () => {
      _state.set({ nodes: [{ id: 'work', type: 'branch', children: [] }] });
      expect(hoverHintId(_state.get().nodes[0])).toBe(null);
      expect(hoverHintId(null)).toBe(null);
    });
  });
});

