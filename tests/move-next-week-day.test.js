import { describe, it, expect, beforeEach } from 'vitest';
import { _state, moveNodeToWeek, canMoveToPrevWeek, undo, parseTodoDays } from './setup.js';

const CURR = '2026-18';
const NEXT = '2026-19';
const PREV = '2026-17';
const readNext = () => JSON.parse(_state.getLocalStorage('zenit-week-' + NEXT));
const readPrev = () => JSON.parse(_state.getLocalStorage('zenit-week-' + PREV));

const branch = (children = []) => ({
  id: 'work', type: 'branch', parent: 'center', label: 'Work', branch: 'work',
  side: 'left', children, _ts: 0,
});
const task = (id, label, extra = {}) => ({
  id, type: 'activity', parent: 'work', label, branch: 'work',
  done: false, unplanned: false, children: [], _ts: 0, ...extra,
});

function seed(label, children = [], extra = []) {
  _state.set({ nodes: [
    { id: 'center', type: 'center' }, branch(['a1']), task('a1', label, { children }), ...extra,
  ] });
  _state.setLocalStorage('zenit-week-' + NEXT, { nodes: [branch()] });
}

const tick = (id, tickIndex, extra = {}) =>
  task(id, String(tickIndex), { parent: 'a1', tickChild: true, tickIndex, ...extra });
const dayLeaf = (id, dayIndex) =>
  task(id, id, { parent: 'a1', dayChild: true, dayIndex });

describe('moveNodeToWeek - day option', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey(CURR);
  });

  it('keeps the day the task already wears when no day is given', async () => {
    seed('Call mum (we)');
    await moveNodeToWeek('a1');
    const moved = readNext().nodes.find(n => n.prevId === 'a1');
    expect([...parseTodoDays(moved.label)]).toEqual([3]);
  });

  it('lands on the chosen weekday', async () => {
    seed('Call mum (we)');
    await moveNodeToWeek('a1', { day: 5 });
    const moved = readNext().nodes.find(n => n.prevId === 'a1');
    expect([...parseTodoDays(moved.label)]).toEqual([5]);
    expect(moved.label.startsWith('Call mum')).toBe(true);
  });

  it('clears the day to Any day with null', async () => {
    seed('Call mum (we)');
    await moveNodeToWeek('a1', { day: null });
    const moved = readNext().nodes.find(n => n.prevId === 'a1');
    expect(parseTodoDays(moved.label).size).toBe(0);
    expect(moved.label).toBe('Call mum');
  });

  it('one undo restores the task with its original day', async () => {
    seed('Call mum (we)');
    await moveNodeToWeek('a1', { day: 1 });
    await undo();
    const back = _state.get().nodes.find(n => n.id === 'a1');
    expect(back?.label).toBe('Call mum (we)');
  });

  it('sets the day of a moved tick', async () => {
    seed('Pushups 2x', ['t1', 't2'], [tick('t1', 1), tick('t2', 2)]);
    await moveNodeToWeek('t1', { day: 2 });
    const moved = readNext().nodes.find(n => n.prevId === 't1');
    expect(moved.tickChild).toBe(true);
    expect(moved.dayIndex).toBe(2);
  });

  it('leaves a tick with no day unchanged on Any', async () => {
    seed('Pushups 2x', ['t1', 't2'], [tick('t1', 1), tick('t2', 2)]);
    await moveNodeToWeek('t1', { day: null });
    const moved = readNext().nodes.find(n => n.prevId === 't1');
    expect(moved.dayIndex).toBeUndefined();
  });

  it('collapses a multi-day task to the one chosen day', async () => {
    seed('Run', ['d1', 'd3'], [dayLeaf('d1', 1), dayLeaf('d3', 3)]);
    await moveNodeToWeek('a1', { day: 4 });
    const next = readNext().nodes;
    const moved = next.find(n => n.prevId === 'a1');
    expect([...parseTodoDays(moved.label)]).toEqual([4]);
    expect(next.some(n => n.dayChild)).toBe(false);
  });

  it('moves one day leaf to the chosen weekday, the parent keeps its other days', async () => {
    seed('Water', ['d6', 'd0'], [dayLeaf('d6', 6), dayLeaf('d0', 0)]);
    await moveNodeToWeek('d0', { day: 3 });
    const moved = readNext().nodes.find(n => n.prevId === 'd0');
    expect(moved.dayChild).toBe(true);
    expect(moved.dayIndex).toBe(3);
    const src = _state.get().nodes;
    expect(src.some(n => n.id === 'd0')).toBe(false);
    expect(src.find(n => n.id === 'a1').children).toEqual(['d6']);
    expect(src.find(n => n.id === 'd6').dayIndex).toBe(6);
  });

  it('refuses a day leaf onto a day its parent already holds in the destination', async () => {
    seed('Water', ['d6', 'd0'], [dayLeaf('d6', 6), dayLeaf('d0', 0)]);
    await moveNodeToWeek('d0', { day: 6 });
    await moveNodeToWeek('d6', { day: 6 });
    const next = readNext().nodes;
    expect(next.filter(n => n.dayChild && n.dayIndex === 6)).toHaveLength(1);
    expect(_state.get().nodes.some(n => n.id === 'd6')).toBe(true);
  });

  it('Any lands a day leaf as its parent task with no day', async () => {
    seed('Water', ['d6', 'd0'], [dayLeaf('d6', 6), dayLeaf('d0', 0)]);
    await moveNodeToWeek('d0', { day: null });
    const next = readNext().nodes;
    const moved = next.find(n => n.prevId === 'd0');
    expect(moved.label).toBe('Water');
    expect(moved.dayChild).toBeUndefined();
    expect(moved.parent).toBe('work');
    expect(moved.children).toEqual([]);
    expect(next.find(n => n.id === 'work').children).toEqual([moved.id]);
    expect(_state.get().nodes.find(n => n.id === 'a1').children).toEqual(['d6']);
  });

  it('Any lands beside a destination parent that has days', async () => {
    seed('Water', ['d6', 'd0'], [dayLeaf('d6', 6), dayLeaf('d0', 0)]);
    await moveNodeToWeek('d6');
    await moveNodeToWeek('d0', { day: null });
    const next = readNext().nodes;
    expect(next.filter(n => n.label === 'Water')).toHaveLength(2);
    expect(next.find(n => n.id === 'work').children).toHaveLength(2);
  });

  it('refuses Any when the destination already has the undated task', async () => {
    seed('Water', ['d6', 'd0'], [dayLeaf('d6', 6), dayLeaf('d0', 0)]);
    await moveNodeToWeek('d0', { day: null });
    await moveNodeToWeek('d6', { day: null });
    expect(readNext().nodes.filter(n => n.label === 'Water')).toHaveLength(1);
    expect(_state.get().nodes.some(n => n.id === 'd6')).toBe(true);
  });

  it('refuses Keep day when the destination parent already holds that day', async () => {
    seed('Water', ['d6', 'd0'], [dayLeaf('d6', 6), dayLeaf('d0', 0)]);
    await moveNodeToWeek('d0', { day: 6 });
    await moveNodeToWeek('d6');
    expect(readNext().nodes.filter(n => n.dayChild && n.dayIndex === 6)).toHaveLength(1);
    expect(_state.get().nodes.some(n => n.id === 'd6')).toBe(true);
  });
});

describe('moveNodeToWeek - Previous week', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey(CURR);
    _state.setLocalStorage('zenit-week-' + PREV, { nodes: [branch()] });
  });

  it('is offered only from a week after this one', () => {
    _state.setTodayWeekKey(PREV);
    expect(canMoveToPrevWeek()).toBe(true);
    _state.setTodayWeekKey(CURR);
    expect(canMoveToPrevWeek()).toBe(false);
    _state.setTodayWeekKey(NEXT);
    expect(canMoveToPrevWeek()).toBe(false);
    _state.clearTodayWeekKeyOverride();
  });

  it('moves the task to the previous week on the chosen day', async () => {
    seed('Call mum (we)');
    await moveNodeToWeek('a1', { offset: -1, day: 2 });
    const moved = readPrev().nodes.find(n => n.prevId === 'a1');
    expect([...parseTodoDays(moved.label)]).toEqual([2]);
    expect(_state.get().nodes.some(n => n.id === 'a1')).toBe(false);
  });

  it('a child moved back rejoins the parent it was copied from', async () => {
    _state.set({ nodes: [
      { id: 'center', type: 'center' }, branch(['p2']),
      task('p2', 'Trip', { children: ['c2'], prevId: 'p1' }),
      task('c2', 'Pack', { parent: 'p2', prevId: 'c1' }),
    ] });
    _state.setLocalStorage('zenit-week-' + PREV, { nodes: [
      branch(['p1']), task('p1', 'Trip', { children: ['x1'] }), task('x1', 'Book', { parent: 'p1' }),
    ] });
    await moveNodeToWeek('c2', { offset: -1 });
    const prev = readPrev().nodes;
    expect(prev.filter(n => n.label === 'Trip')).toHaveLength(1);
    const moved = prev.find(n => n.prevId === 'c2');
    expect(moved.parent).toBe('p1');
  });
});
