import { describe, it, expect, beforeEach } from 'vitest';
import { _state, clearWeek, BRANCH_COLORS } from './setup.js';

const mkBranch = (id) => ({ id, type: 'branch', branch: id, label: `My ${id}`, children: [], side: 'left', _ts: 0 });
const mkActivity = (id, parent) => ({ id, type: 'activity', branch: parent, parent, label: id, children: [], done: false, _ts: 0 });

describe('Clear the Week', () => {
  beforeEach(() => {
    const work = mkBranch('work');
    work.children = ['a1'];
    _state.set({ nodes: [work, mkBranch('custom'), mkActivity('a1', 'work')], tombstones: [] });
  });

  it('blank canvas removes every task and keeps the branches', async () => {
    await clearWeek(false);
    const week = _state.get();
    expect(week.nodes.map(n => n.id).sort()).toEqual(['custom', 'work']);
    expect(week.nodes.every(n => n.children.length === 0)).toBe(true);
    expect(week.tombstones).toContain('a1');
  });

  it('playground refills the week with the seed under fresh ids', async () => {
    await clearWeek(true);
    const week = _state.get();
    const seed = _state.getPlaygroundSeed().week.nodes;
    const seedTasks = seed.filter(n => n.type !== 'branch');
    const tasks = week.nodes.filter(n => n.type !== 'branch');

    expect(tasks.length).toBe(seedTasks.length);
    expect(tasks.some(n => n.id === 'a1')).toBe(false);
    // No seed id survives, so no tombstone can ever swallow a task.
    const seedIds = new Set(seedTasks.map(n => n.id));
    expect(tasks.some(n => seedIds.has(n.id))).toBe(false);
    expect(tasks.some(n => n._demo)).toBe(false);

    // Kept branch reused as it was; user's own branch untouched.
    const work = week.nodes.find(n => n.id === 'work');
    expect(work.label).toBe('My work');
    expect(work.children.length).toBe(seed.find(n => n.id === 'work').children.length);
    expect(week.nodes.find(n => n.id === 'custom').children).toEqual([]);

    // Every link resolves inside the week.
    const ids = new Set(week.nodes.map(n => n.id));
    week.nodes.forEach(n => {
      n.children.forEach(c => expect(ids.has(c)).toBe(true));
      if (n.parent) expect(ids.has(n.parent)).toBe(true);
      if (n.type !== 'branch') expect(ids.has(n.branch)).toBe(true);
    });

    // A seed branch the week lacked arrives under a new id with its color.
    const growth = week.nodes.find(n => n.type === 'branch' && n.id !== 'work' && n.id !== 'custom'
      && !['family', 'me'].includes(n.id) && n.label === 'Growth');
    expect(growth).toBeDefined();
    expect(BRANCH_COLORS[growth.id].main).toBe('#0ACF83');
  });
});
