import { describe, it, expect, beforeEach } from 'vitest';
import { _state, deleteNode, applyDayReschedule, moveNodeToWeek } from './setup.js';

// A task left with one day leaf goes back to wearing that day in its label,
// whichever path took the other leaf away.
const branch = (children = []) => ({
  id: 'work', type: 'branch', parent: 'center', label: 'Work', branch: 'work',
  side: 'left', children, _ts: 0,
});
const task = (id, label, extra = {}) => ({
  id, type: 'activity', parent: 'work', label, branch: 'work',
  done: false, unplanned: false, children: [], _ts: 0, ...extra,
});
const leaf = (id, dayIndex, extra = {}) =>
  task(id, id, { parent: 't', dayChild: true, dayIndex, ...extra });

function seed(weExtra = {}) {
  _state.set({ nodes: [
    { id: 'center', type: 'center' }, branch(['t']),
    task('t', 'Test', { children: ['mo', 'we'] }), leaf('mo', 1), leaf('we', 3, weExtra),
  ] });
  _state.setLocalStorage('zenit-week-2026-19', { nodes: [branch()] });
}
const nodes = () => _state.get().nodes;
const expectCollapsed = () => {
  const t = nodes().find(n => n.id === 't');
  expect(t.label).toBe('Test (We)');
  expect(t.children).toEqual([]);
  expect(nodes().some(n => n.dayChild)).toBe(false);
  return t;
};

describe('a lone day leaf collapses into the label', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey('2026-18');
  });

  it('on Delete', () => {
    seed();
    deleteNode('mo');
    expectCollapsed();
  });

  it('on unticking a day in Reschedule', () => {
    seed();
    applyDayReschedule('t', 'leaf', { currentDays: new Set([1, 3]), currentDayIndex: 1, newDayIndex: 1 });
    expectCollapsed();
  });

  it('on moving a day leaf to another week', async () => {
    seed();
    await moveNodeToWeek('mo');
    expectCollapsed();
  });

  it('the task wears the remaining leaf outcome', () => {
    seed({ done: true, doneAt: 'x' });
    deleteNode('mo');
    const t = expectCollapsed();
    expect(t.done).toBe(true);
    expect(t.doneAt).toBe('x');
  });

  it('keeps two remaining days as leaves', () => {
    _state.set({ nodes: [
      { id: 'center', type: 'center' }, branch(['t']),
      task('t', 'Test', { children: ['mo', 'we', 'fr'] }), leaf('mo', 1), leaf('we', 3), leaf('fr', 5),
    ] });
    deleteNode('mo');
    expect(nodes().find(n => n.id === 't').children).toEqual(['we', 'fr']);
  });
});
