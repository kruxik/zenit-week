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

  it('does not count day children, tick children or the counter node', () => {
    const w = week({ userCount: 3, demoCount: 5 });
    // One of the user's tasks gets days assigned and a counter with ticks —
    // all app-created bookkeeping under a task that already counts as one.
    w.nodes.push(
      { id: 'day1', type: 'activity', dayChild: true, dayIndex: 1, branch: 'work', parent: 'u0', label: 'Mo', children: [] },
      { id: 'day2', type: 'activity', dayChild: true, dayIndex: 2, branch: 'work', parent: 'u0', label: 'Tu', children: [] },
      { id: 'cnt',  type: 'counter',  branch: 'work', parent: 'u1', label: '0/3', children: [] },
      { id: 'tick1', type: 'activity', tickChild: true, tickIndex: 1, branch: 'work', parent: 'u1', label: '1', children: [] },
    );
    _state.set(w);
    expect(playgroundUserNodeCount()).toBe(3);
    expect(shouldShowPlaygroundNudge()).toBe(false);   // still under the threshold
  });

  it('counts an example task once the user ticks one of its day children', () => {
    const w = week({ userCount: 6, demoCount: 5 });
    // d0 keeps its _demo flag; its Monday child was ticked off, so touchNode
    // has already cleared _demo there.
    w.nodes.push(
      { id: 'd0-mo', type: 'activity', dayChild: true, dayIndex: 1, branch: 'work', parent: 'd0', label: 'Mo', done: true, children: [] },
      { id: 'd1-tu', type: 'activity', dayChild: true, dayIndex: 2, branch: 'work', parent: 'd1', label: 'Tu', _demo: true, children: [] },
    );
    _state.set(w);
    expect(playgroundUserNodeCount()).toBe(7);         // 6 own + d0, claimed by its tick
    expect(shouldShowPlaygroundNudge()).toBe(true);
  });

  it('does not count in-progress placeholder (_editing) nodes', () => {
    const w = week({ userCount: 7, demoCount: 1 });
    // Simulate the placeholder created on commit / before ESC.
    w.nodes[0].children.push('placeholder');
    w.nodes.push({ id: 'placeholder', type: 'activity', branch: 'work', parent: 'work', label: '', _editing: true, children: [] });
    _state.set(w);
    expect(playgroundUserNodeCount()).toBe(7);          // placeholder excluded
    expect(shouldShowPlaygroundNudge()).toBe(true);     // 7 real, not 8
  });

  it('does not nudge below the 7-user-node threshold', () => {
    _state.set(week({ userCount: 6, demoCount: 5 }));
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });

  it('nudges at >=7 user nodes while demo tasks remain', () => {
    _state.set(week({ userCount: 7, demoCount: 1 }));
    expect(shouldShowPlaygroundNudge()).toBe(true);
  });

  it('does not nudge when no demo tasks remain', () => {
    _state.set(week({ userCount: 8, demoCount: 0 }));
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });

  it('does not nudge once the persisted flag is set', () => {
    _state.set(week({ userCount: 7, demoCount: 2 }));
    _state.setPlaygroundNudgeDone(true);
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });

  it('does not nudge again after dismissal (within the session)', () => {
    _state.set(week({ userCount: 7, demoCount: 2 }));
    expect(shouldShowPlaygroundNudge()).toBe(true);
    dismissPlaygroundNudge(true);
    expect(shouldShowPlaygroundNudge()).toBe(false);
  });
});
