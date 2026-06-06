import { describe, it, expect, beforeEach } from 'vitest';
import { _state, transferUnfinished, findNode, offsetWeek } from './setup.js';

describe('Data Transfer', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
  });

  it('transfers unfinished tasks from previous week', async () => {
    const prevWeek = '2026-17';
    const currWeek = '2026-18';
    _state.setWeekKey(currWeek);

    const prevData = {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', children: ['a1', 'a2'] },
        { id: 'a1', type: 'activity', parent: 'b1', label: 'Done Task', done: true },
        { id: 'a2', type: 'activity', parent: 'b1', label: 'Pending Task', done: false, children: ['c1'] },
        { id: 'c1', type: 'counter', parent: 'a2', val: 5, max: 10 }
      ]
    };
    _state.setLocalStorage('zenit-week-' + prevWeek, prevData);

    // Initial state of current week
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', children: [] }
      ]
    });

    await transferUnfinished();

    const data = _state.get();
    // Should have 'Pending Task' and its counter, but NOT 'Done Task'
    const pending = data.nodes.find(n => n.label === 'Pending Task');
    const done = data.nodes.find(n => n.label === 'Done Task');
    
    expect(pending).toBeDefined();
    expect(done).toBeUndefined();
    
    // Counter should also be transferred, but reset to 0
    const counter = data.nodes.find(n => n.parent === pending.id);
    expect(counter).toBeDefined();
    expect(counter.val).toBe(0);
  });

  it('merges into an existing same-name bridge container instead of duplicating (case-insensitive)', async () => {
    const prevWeek = '2026-17';
    const currWeek = '2026-18';
    _state.setWeekKey(currWeek);

    // Prev: Family > Together > Games
    _state.setLocalStorage('zenit-week-' + prevWeek, {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'fam', type: 'branch', parent: 'center', label: 'Family', children: ['tog'] },
        { id: 'tog', type: 'activity', parent: 'fam', label: 'Together', children: ['games'] },
        { id: 'games', type: 'activity', parent: 'tog', label: 'Games', done: false, children: [] }
      ]
    });

    // Current: Family > together (manual, different id, different case) > Trip
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'fam', type: 'branch', parent: 'center', label: 'Family', children: ['tog-manual'] },
        { id: 'tog-manual', type: 'activity', parent: 'fam', label: 'together', children: ['trip'] },
        { id: 'trip', type: 'activity', parent: 'tog-manual', label: 'Trip', children: [] }
      ]
    });

    await transferUnfinished();
    const data = _state.get();

    // Exactly one "together" container under the branch — no duplicate
    const togethers = data.nodes.filter(n => n.label?.toLowerCase() === 'together' && n.parent === 'fam');
    expect(togethers).toHaveLength(1);
    expect(togethers[0].id).toBe('tog-manual'); // reused the existing manual node

    // Games landed inside the reused container alongside Trip
    const games = data.nodes.find(n => n.label === 'Games');
    expect(games).toBeDefined();
    expect(games.parent).toBe('tog-manual');
    const kept = data.nodes.find(n => n.label === 'Trip');
    expect(kept.parent).toBe('tog-manual');
  });

  it('does not name-merge leaf activities (identity only)', async () => {
    const prevWeek = '2026-17';
    const currWeek = '2026-18';
    _state.setWeekKey(currWeek);

    _state.setLocalStorage('zenit-week-' + prevWeek, {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'fam', type: 'branch', parent: 'center', label: 'Family', children: ['games'] },
        { id: 'games', type: 'activity', parent: 'fam', label: 'Games', done: false, children: [] }
      ]
    });

    // Current already has a manual leaf with the same name under the same branch
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'fam', type: 'branch', parent: 'center', label: 'Family', children: ['games-manual'] },
        { id: 'games-manual', type: 'activity', parent: 'fam', label: 'Games', children: [] }
      ]
    });

    await transferUnfinished();
    const data = _state.get();

    // Leaves are not merged — both survive
    const games = data.nodes.filter(n => n.label === 'Games' && n.parent === 'fam');
    expect(games).toHaveLength(2);
  });

  it('keeps manual nodes on top — transferred nodes land below them, not at the top', async () => {
    const prevWeek = '2026-17';
    const currWeek = '2026-18';
    _state.setWeekKey(currWeek);

    // W0: Email/Meeting done, ZenitWeek (last) unfinished
    _state.setLocalStorage('zenit-week-' + prevWeek, {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'work', type: 'branch', parent: 'center', label: 'Work', children: ['email', 'mtg', 'zw'] },
        { id: 'email', type: 'activity', parent: 'work', label: 'Email', done: true, children: [] },
        { id: 'mtg', type: 'activity', parent: 'work', label: 'Meeting', done: true, children: [] },
        { id: 'zw', type: 'activity', parent: 'work', label: 'ZenitWeek', done: false, children: [] },
      ]
    });

    // W1 already has a manually-created node
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'work', type: 'branch', parent: 'center', label: 'Work', children: ['plan'] },
        { id: 'plan', type: 'activity', parent: 'work', label: 'Planning', children: [] },
      ]
    });

    await transferUnfinished();
    const data = _state.get();
    const work = data.nodes.find(n => n.id === 'work');
    const labels = work.children.map(id => data.nodes.find(n => n.id === id).label);

    expect(labels).toEqual(['Planning', 'ZenitWeek']);
  });

  it('preserves prev-week order among multiple transferred siblings', async () => {
    const prevWeek = '2026-17';
    const currWeek = '2026-18';
    _state.setWeekKey(currWeek);

    _state.setLocalStorage('zenit-week-' + prevWeek, {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'work', type: 'branch', parent: 'center', label: 'Work', children: ['a', 'b', 'c'] },
        { id: 'a', type: 'activity', parent: 'work', label: 'A', done: false, children: [] },
        { id: 'b', type: 'activity', parent: 'work', label: 'B', done: false, children: [] },
        { id: 'c', type: 'activity', parent: 'work', label: 'C', done: false, children: [] },
      ]
    });
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'work', type: 'branch', parent: 'center', label: 'Work', children: [] },
      ]
    });

    await transferUnfinished();
    const data = _state.get();
    const work = data.nodes.find(n => n.id === 'work');
    const labels = work.children.map(id => data.nodes.find(n => n.id === id).label);

    expect(labels).toEqual(['A', 'B', 'C']);
  });

  it('moves a single node to the next week', async () => {
    const currWeek = '2026-18';
    const nextWeek = '2026-19';
    _state.setWeekKey(currWeek);

    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', children: ['a1'], side: 'left' },
        { id: 'a1', type: 'activity', parent: 'b1', label: 'Move Me', branch: 'b1', children: [] }
      ]
    });

    // Mock next week in storage
    _state.setLocalStorage('zenit-week-' + nextWeek, {
      nodes: [
        { id: 'center', type: 'center' }
      ]
    });

    const { moveNodeToNextWeek } = await import('./setup.js');
    await moveNodeToNextWeek('a1');

    const nextDataRaw = _state.getLocalStorage('zenit-week-' + nextWeek);
    const nextData = JSON.parse(nextDataRaw);
    
    expect(nextData.nodes.find(n => n.label === 'Move Me')).toBeDefined();
    expect(nextData.nodes.find(n => n.id === 'b1')).toBeDefined(); // Branch should have been created
  });
});
