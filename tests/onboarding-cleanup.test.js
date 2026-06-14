import { describe, it, expect, beforeEach } from 'vitest';
import { _state, clearExampleTasks, hasDemoActivityNodes, setStatus, undo } from './setup.js';

// Seed-style week:
//   work (branch, _demo)
//     a1 (_demo)            ← untouched demo leaf
//     a2 (_demo)            ← will be touched (marked done)
//   family (branch, _demo)
//     p (_demo)             ← demo parent…
//       c1 (_demo)          ← …with a child the user marks done (c1 survives → p kept)
//   me (branch, _demo)
//     mine (NOT demo)       ← user-created node
function seededWeek() {
  return {
    nodes: [
      { id: 'work', type: 'branch', branch: 'work', label: 'Work', side: 'left', _demo: true, children: ['a1', 'a2'] },
      { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'A1', _demo: true, children: [] },
      { id: 'a2', type: 'activity', branch: 'work', parent: 'work', label: 'A2', _demo: true, children: [] },
      { id: 'family', type: 'branch', branch: 'family', label: 'Family', side: 'right', _demo: true, children: ['p'] },
      { id: 'p', type: 'activity', branch: 'family', parent: 'family', label: 'P', _demo: true, children: ['c1'] },
      { id: 'c1', type: 'activity', branch: 'family', parent: 'p', label: 'C1', _demo: true, children: [] },
      { id: 'me', type: 'branch', branch: 'me', label: 'Me', side: 'right', _demo: true, children: ['mine'] },
      { id: 'mine', type: 'activity', branch: 'me', parent: 'me', label: 'Mine', children: [] },
    ],
    tombstones: [],
    crdtVersion: 0,
  };
}

const ids = () => _state.get().nodes.map(n => n.id).sort();

describe('Onboarding cleanup — Clear example tasks (S3)', () => {
  beforeEach(() => {
    _state.reset();
    _state.setWeekKey('2026-20');
    _state.set(seededWeek());
  });

  it('removes fully-untouched demo subtrees only', () => {
    setStatus('a2', 'done'); // touch a2 → no longer demo
    setStatus('c1', 'done'); // touch c1 → keeps its demo parent p alive

    const count = clearExampleTasks();

    // a1 (untouched demo leaf) is gone; a2 stays (touched).
    // p stays because c1 (its child) was touched; c1 stays.
    // mine stays (user-created). All branches stay.
    expect(count).toBe(1);
    expect(ids()).toEqual(['a2', 'c1', 'family', 'me', 'mine', 'p', 'work'].sort());
  });

  it('keeps all branches even when every child was demo', () => {
    const count = clearExampleTasks();
    // Every activity here is fully-demo except `mine`. a1, a2, p, c1 removed.
    expect(count).toBe(4);
    const remaining = ids();
    expect(remaining).toContain('work');
    expect(remaining).toContain('family');
    expect(remaining).toContain('me');
    expect(remaining).toContain('mine'); // user-created survives
    expect(remaining).not.toContain('a1');
    expect(remaining).not.toContain('p');
    expect(remaining).not.toContain('c1');
  });

  it('detaches removed nodes from their parent children arrays', () => {
    clearExampleTasks();
    const work = _state.get().nodes.find(n => n.id === 'work');
    const family = _state.get().nodes.find(n => n.id === 'family');
    expect(work.children).toEqual([]);
    expect(family.children).toEqual([]);
  });

  it('is undoable — snapshot restores the removed nodes', async () => {
    const before = ids();
    clearExampleTasks();
    expect(ids()).not.toEqual(before);
    await undo();
    expect(ids()).toEqual(before);
  });

  it('no-op when there are no demo nodes', () => {
    // Strip all demo flags first.
    const w = _state.get();
    w.nodes.forEach(n => { delete n._demo; });
    _state.set(w);
    expect(hasDemoActivityNodes()).toBe(false);
    expect(clearExampleTasks()).toBe(0);
  });

  it('hasDemoActivityNodes ignores branches', () => {
    // Remove every non-branch demo node; only demo branches remain.
    setStatus('a2', 'done');
    clearExampleTasks(); // removes a1, p, c1 (a2 touched, mine not demo)
    // Touch remaining demo activity nodes away
    const w = _state.get();
    w.nodes.forEach(n => { if (n.type !== 'branch') delete n._demo; });
    _state.set(w);
    expect(hasDemoActivityNodes()).toBe(false);
  });
});
