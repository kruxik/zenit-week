import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state,
  shouldShowPlaygroundNudge,
  playgroundUserNodeCount,
  dismissPlaygroundNudge,
} from './setup.js';

// Week with `userCount` user-created activities, `demoCount` untouched demo
// activities, all under a single demo branch.
function week({ userCount, demoCount }) {
  const nodes = [{ id: 'work', type: 'branch', branch: 'work', label: 'Work', side: 'left', _demo: true, children: [] }];
  for (let i = 0; i < userCount; i++) {
    const id = `u${i}`;
    nodes[0].children.push(id);
    nodes.push({ id, type: 'activity', branch: 'work', parent: 'work', label: `U${i}`, children: [] });
  }
  for (let i = 0; i < demoCount; i++) {
    const id = `d${i}`;
    nodes[0].children.push(id);
    nodes.push({ id, type: 'activity', branch: 'work', parent: 'work', label: `D${i}`, _demo: true, children: [] });
  }
  return { nodes, tombstones: [], crdtVersion: 0 };
}

describe('Onboarding auto-nudge (S4)', () => {
  beforeEach(() => {
    _state.reset();
    _state.setWeekKey('2026-20');
    _state.resetPlaygroundNudge();
  });

  it('counts only the user\'s own committed (non-branch, non-demo) nodes', () => {
    _state.set(week({ userCount: 3, demoCount: 5 }));
    expect(playgroundUserNodeCount()).toBe(3);
  });

  it('does not count in-progress placeholder (_editing) nodes', () => {
    const w = week({ userCount: 5, demoCount: 1 });
    // Simulate the placeholder created on commit / before ESC.
    w.nodes[0].children.push('placeholder');
    w.nodes.push({ id: 'placeholder', type: 'activity', branch: 'work', parent: 'work', label: '', _editing: true, children: [] });
    _state.set(w);
    expect(playgroundUserNodeCount()).toBe(5);          // placeholder excluded
    expect(shouldShowPlaygroundNudge()).toBe(true);     // 5 real, not 6
  });

  it('does not nudge below the 5-user-node threshold', () => {
    _state.set(week({ userCount: 4, demoCount: 5 }));
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });

  it('nudges at >=5 user nodes while demo tasks remain', () => {
    _state.set(week({ userCount: 5, demoCount: 1 }));
    expect(shouldShowPlaygroundNudge()).toBe(true);
  });

  it('does not nudge when no demo tasks remain', () => {
    _state.set(week({ userCount: 6, demoCount: 0 }));
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });

  it('does not nudge once the persisted flag is set', () => {
    _state.set(week({ userCount: 5, demoCount: 2 }));
    _state.setPlaygroundNudgeDone(true);
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });

  it('does not nudge again after dismissal (within the session)', () => {
    _state.set(week({ userCount: 5, demoCount: 2 }));
    expect(shouldShowPlaygroundNudge()).toBe(true);
    dismissPlaygroundNudge(true);
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });
});
