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
