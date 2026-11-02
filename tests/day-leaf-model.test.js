import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state, findNode, rebuildNodeMap, setActivityDays, createDayChild, dayLeafNodeId,
  taskDayMode, nodeDisplayLabel, computeLayout, validateAndRepair, mergeWeekData,
  transferUnfinished, commitEdit,
} from './setup.js';

// A task's own days are always day leaves, a single day included; the map
// shows a lone leaf on the task itself. A label annotation is the form older
// versions wrote.
const branch = (children = []) => ({
  id: 'work', type: 'branch', parent: 'center', label: 'Work', branch: 'work',
  side: 'left', children, _ts: 0,
});
const task = (id, label, extra = {}) => ({
  id, type: 'activity', parent: 'work', label, branch: 'work',
  done: false, unplanned: false, children: [], _ts: 0, ...extra,
});
const leaf = (id, parent, dayIndex, extra = {}) =>
  task(id, id, { parent, dayChild: true, dayIndex, ...extra });
const seed = nodes => {
  _state.set({ nodes: [{ id: 'center', type: 'center', children: ['work'] }, ...nodes] });
  rebuildNodeMap();
};
const leavesOf = id => findNode(id).children.map(findNode).filter(c => c?.dayChild);

describe('day leaves', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey('2026-18');
    _state.setLang('en');
  });

  it('a single day becomes one leaf, shown on the task and not drawn', () => {
    seed([branch(['a']), task('a', 'Run (mo)')]);
    setActivityDays('a', new Set([1]));
    const a = findNode('a');
    expect(a.label).toBe('Run');
    expect(leavesOf('a').map(c => c.dayIndex)).toEqual([1]);
    expect(nodeDisplayLabel(a)).toBe('Run (Mo)');
    const pos = computeLayout();
    expect(pos.a).toBeDefined();
    expect(pos[a.children[0]]).toBeUndefined();
  });

  it('an older single-day label hands its outcome to the leaf', () => {
    seed([branch(['a']), task('a', 'Run (mo)', { done: true, doneAt: 'x' })]);
    setActivityDays('a', new Set([3]));
    const [we] = leavesOf('a');
    expect(we.dayIndex).toBe(3);
    expect(we.done).toBe(true);
    expect(findNode('a').done).toBe(true);
  });

  it('two devices creating the same day make the same leaf id', () => {
    seed([branch(['a']), task('a', 'Run')]);
    const first = createDayChild('a', 1);
    seed([branch(['a']), task('a', 'Run')]);
    expect(createDayChild('a', 1)).toBe(first);
  });

  it('a buried day leaf id is stepped past, the same way everywhere', () => {
    const isTaken0 = () => false;
    const gen0 = dayLeafNodeId('a', 1, isTaken0);
    const gen1 = dayLeafNodeId('a', 1, id => id === gen0);
    expect(gen1).not.toBe(gen0);
    expect(dayLeafNodeId('a', 1, id => id === gen0)).toBe(gen1);
  });

  it('kept days keep their leaf, id and outcome', () => {
    seed([branch(['a']), task('a', 'Run', { children: ['m', 'w'] }),
      leaf('m', 'a', 1, { done: true, doneAt: 'x' }), leaf('w', 'a', 3)]);
    setActivityDays('a', new Set([1, 5]));
    const kids = leavesOf('a');
    expect(kids.map(c => c.dayIndex)).toEqual([1, 5]);
    expect(kids[0].id).toBe('m');
    expect(kids[0].done).toBe(true);
    expect(findNode('w')).toBeUndefined();
  });

  it('a lone day moved to another day keeps its outcome', () => {
    seed([branch(['a']), task('a', 'Run', { children: ['m'], done: true }),
      leaf('m', 'a', 1, { done: true, doneAt: 'x' })]);
    setActivityDays('a', new Set([4]));
    const [th] = leavesOf('a');
    expect(th.dayIndex).toBe(4);
    expect(th.done).toBe(true);
  });

  it('a single day on a task with sub-tasks stays in the label (they inherit it)', () => {
    seed([branch(['p']), task('p', 'Trip', { children: ['c'] }), task('c', 'Pack', { parent: 'p' })]);
    setActivityDays('p', new Set([2]));
    expect(findNode('p').label).toBe('Trip (Tu)');
    expect(leavesOf('p')).toHaveLength(0);
  });

  it('a pick moves a single-day task and toggles a several-day one', () => {
    seed([branch(['a', 'b']), task('a', 'Run', { children: ['m'] }), leaf('m', 'a', 1),
      task('b', 'Swim', { children: ['x', 'y'] }), leaf('x', 'b', 1), leaf('y', 'b', 3)]);
    expect(taskDayMode(findNode('a'))).toBe('activity-radio');
    expect(taskDayMode(findNode('b'))).toBe('activity-checkbox');
  });

  it('an edit that showed the days replaces them with the typed ones', () => {
    seed([branch(['a']), task('a', 'Run', { children: ['m', 'w'] }), leaf('m', 'a', 1), leaf('w', 'a', 3)]);
    _state.setEditState({ nodeId: 'a', isNew: false, originalLabel: 'Run', daysShown: true }, 'Run (mo)');
    commitEdit();
    expect(leavesOf('a').map(c => c.id)).toEqual(['m']);
  });

  it('typing a single day makes a leaf', () => {
    seed([branch(['a']), task('a', 'x')]);
    _state.setEditState({ nodeId: 'a', isNew: false, originalLabel: 'x' }, 'Run (fr)');
    commitEdit();
    expect(findNode('a').label).toBe('Run');
    expect(leavesOf('a').map(c => c.dayIndex)).toEqual([5]);
  });
});

describe('mixed form after a merge', () => {
  it('a newer task node: its single-day label is the schedule and its done mark reaches the leaf', () => {
    const data = { nodes: [
      { id: 'center', type: 'center', children: ['work'] }, branch(['a']),
      task('a', 'Run (mo)', { children: ['m'], done: true, doneAt: 'x', _ts: 20 }),
      leaf('m', 'a', 1, { _ts: 10 }),
    ] };
    const out = validateAndRepair(data);
    const a = out.nodes.find(n => n.id === 'a');
    const m = out.nodes.find(n => n.id === 'm');
    expect(a.label).toBe('Run');
    expect(m.done).toBe(true);
  });

  it('a newer task node naming another day replaces the leaf', () => {
    const data = { nodes: [
      { id: 'center', type: 'center', children: ['work'] }, branch(['a']),
      task('a', 'Run (we)', { children: ['m'], _ts: 20 }), leaf('m', 'a', 1, { _ts: 10 }),
    ], tombstones: [] };
    const out = validateAndRepair(data);
    const a = out.nodes.find(n => n.id === 'a');
    const kids = a.children.map(id => out.nodes.find(n => n.id === id));
    expect(kids.map(c => c.dayIndex)).toEqual([3]);
    expect(out.tombstones).toContain('m');
    expect(kids[0].id).toBe(dayLeafNodeId('a', 3, () => false));
  });

  it('newer leaves: the annotation is stale and only stripped', () => {
    const data = { nodes: [
      { id: 'center', type: 'center', children: ['work'] }, branch(['a']),
      task('a', 'Run (we)', { children: ['m'], _ts: 10 }), leaf('m', 'a', 1, { _ts: 20 }),
    ] };
    const out = validateAndRepair(data);
    const a = out.nodes.find(n => n.id === 'a');
    expect(a.label).toBe('Run');
    expect(a.children).toEqual(['m']);
  });

  it('two devices converge: one converted the task, the other marked the old form done', () => {
    const converted = { nodes: [
      { id: 'center', type: 'center', children: ['work'] }, branch(['a']),
      task('a', 'Run', { children: ['m'], _ts: 10 }), leaf('m', 'a', 1, { _ts: 10 }),
    ], tombstones: [] };
    const doneOld = { nodes: [
      { id: 'center', type: 'center', children: ['work'] }, branch(['a']),
      task('a', 'Run (mo)', { done: true, doneAt: 'x', _ts: 30 }),
    ], tombstones: [] };
    const ab = mergeWeekData(JSON.parse(JSON.stringify(converted)), JSON.parse(JSON.stringify(doneOld)));
    const ba = mergeWeekData(JSON.parse(JSON.stringify(doneOld)), JSON.parse(JSON.stringify(converted)));
    for (const out of [ab, ba]) {
      const a = out.nodes.find(n => n.id === 'a');
      expect(a.label).toBe('Run');
      const kids = a.children.map(id => out.nodes.find(n => n.id === id));
      expect(kids.map(c => c.dayIndex)).toEqual([1]);
      expect(kids[0].done).toBe(true);
    }
  });
});

describe('Transfer Unfinished', () => {
  it('a task with one open day arrives holding that day as its lone leaf', async () => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setLocalStorage('zenit-week-2026-17', { nodes: [
      branch(['t']), task('t', 'Test', { children: ['mo', 'we'] }),
      leaf('mo', 't', 1, { done: true, doneAt: 'x' }), leaf('we', 't', 3),
    ] });
    _state.setWeekKey('2026-18');
    _state.set({ nodes: [{ id: 'center', type: 'center' }, branch()] });
    rebuildNodeMap();
    await transferUnfinished();
    const t = _state.get().nodes.find(n => n.type === 'activity' && !n.dayChild);
    expect(nodeDisplayLabel(t)).toBe('Test (We)');
    expect(t.done).toBe(false);
  });
});
