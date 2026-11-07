// The snapshot-free action bodies the map UI and the agent bridge share
// (docs/specs/agent-bridge.md, sections 7.3 and 8.2). Each one mutates the open
// week and nothing else: no undo entry, so a caller can run several inside the
// one snapshot it took itself.
import { describe, test, expect, beforeEach } from 'vitest';
import {
  _state, genId, defaultWeekData, findNode, rebuildNodeMap, BRANCH_COLORS,
  createTask, applyLabelEdit, applyStatus, setStatus, setPriority, cyclePriority,
  setReusable, toggleReusableNode, createBranch, setBranchColor, writeComment,
  computeAgendaGroups, liveOccurrenceEntry, getTickInfo, setActivityDays, tabDateString,
} from './setup.js';

function branchId() {
  return _state.get().nodes.find(n => n.type === 'branch').id;
}

function addActivity(label, props = {}, parentId = branchId()) {
  const id = genId();
  const parent = findNode(parentId);
  const node = {
    id, type: 'activity', branch: parent.branch || parent.id, label, parent: parentId,
    children: [], done: false, unplanned: false, priority: null, reusable: false,
    _ts: 1, ...props,
  };
  _state.get().nodes.push(node);
  parent.children.push(id);
  rebuildNodeMap();
  return id;
}

const childrenOf = id => findNode(id).children.map(findNode);
const dayLeaves = id => childrenOf(id).filter(c => c.dayChild).map(c => c.dayIndex).sort();

beforeEach(() => {
  _state.reset();
  _state.clearLocalStorage();
  _state.set(defaultWeekData());
  _state.setWeekKey('2026-45');
  _state.setActiveDayFilter(null);
});

describe('createTask', () => {
  test('an Nx label makes one activity with N tick leaves and no undo entry', () => {
    const node = createTask(branchId(), 'Pushups 10x');
    expect(node.type).toBe('activity');
    expect(node.parent).toBe(branchId());
    expect(findNode(branchId()).children).toContain(node.id);
    expect(getTickInfo(node).total).toBe(10);
    expect(_state.getUndoStack()).toHaveLength(0);
  });

  test('day tokens make one day leaf per day', () => {
    const node = createTask(branchId(), 'Run (mo, we, fr)');
    expect(dayLeaves(node.id)).toEqual([1, 3, 5]);
  });

  test('the day filter stamps only when asked to', () => {
    _state.setActiveDayFilter(2);
    const plain = createTask(branchId(), 'Call mum');
    expect(dayLeaves(plain.id)).toEqual([]);
    const stamped = createTask(branchId(), 'Call dad', { stampFilterDay: true });
    expect(dayLeaves(stamped.id)).toEqual([2]);
  });

  test('a child under a done parent reopens it, as the editor does', () => {
    const parent = addActivity('Trip', { done: true, doneAt: '2026-11-02T10:00:00Z' });
    createTask(parent, 'Pack');
    expect(findNode(parent).done).toBe(false);
  });

  test('refuses a parent that cannot take a child', () => {
    const task = createTask(branchId(), 'Squats 3x');
    const tick = childrenOf(task.id)[0];
    expect(createTask(tick.id, 'nope')).toBeNull();
    expect(createTask('missing', 'nope')).toBeNull();
  });
});

describe('applyLabelEdit', () => {
  test('replaceDays makes the label the whole schedule', () => {
    const id = addActivity('Swim');
    setActivityDays(id, new Set([1, 2, 3]));
    applyLabelEdit(id, 'Swim (fr)', { replaceDays: true });
    expect(dayLeaves(id)).toEqual([5]);
  });

  test('a rename to Nx turns a plain task into ticks', () => {
    const id = addActivity('Plank');
    applyLabelEdit(id, 'Plank 3x');
    expect(getTickInfo(findNode(id)).total).toBe(3);
  });
});

describe('setPriority', () => {
  test('is absolute: high on a high task stays high and reports no change', () => {
    const id = addActivity('Report', { priority: 'high' });
    expect(setPriority(id, 'high')).toBe(false);
    expect(findNode(id).priority).toBe('high');
  });

  test('cascades to descendants and stores normal as null', () => {
    const id = addActivity('Report');
    const sub = addActivity('Draft', {}, id);
    expect(setPriority(id, 'critical')).toBe(true);
    expect(findNode(sub).priority).toBe('critical');
    setPriority(id, 'normal');
    expect(findNode(id).priority).toBeNull();
    expect(findNode(sub).priority).toBeNull();
  });

  test("treats quick add's 'normal' string as normal", () => {
    const id = addActivity('Inbox thing', { priority: 'normal', _ts: 5 });
    expect(setPriority(id, 'normal')).toBe(false);
    expect(findNode(id)._ts).toBe(5);
  });

  test('the menu still toggles, and cyclePriority is one undo entry', () => {
    const id = addActivity('Report', { priority: 'high' });
    setStatus(id, 'prio-high');
    expect(findNode(id).priority).toBeNull();
    cyclePriority(id);
    expect(findNode(id).priority).toBe('high');
    expect(_state.getUndoStack()).toHaveLength(2);
  });
});

describe('applyStatus', () => {
  test('cascades without an undo entry; setStatus adds exactly one', () => {
    const id = addActivity('Clean');
    const sub = addActivity('Kitchen', {}, id);
    applyStatus(id, 'done');
    expect(findNode(sub).done).toBe(true);
    expect(_state.getUndoStack()).toHaveLength(0);
    setStatus(id, 'undone');
    expect(findNode(sub).done).toBe(false);
    expect(_state.getUndoStack()).toHaveLength(1);
  });
});

describe('setReusable', () => {
  test('is idempotent and cascades', () => {
    const id = addActivity('Laundry');
    const sub = addActivity('Fold', {}, id);
    expect(setReusable(id, true)).toBe(true);
    expect(findNode(sub).reusable).toBe(true);
    expect(setReusable(id, true)).toBe(false);
    toggleReusableNode(id);
    expect(findNode(id).reusable).toBe(false);
    expect(findNode(sub).reusable).toBe(false);
  });
});

describe('createBranch / setBranchColor', () => {
  test('a named branch carries no editing flag and lands after the last branch', () => {
    const node = createBranch({ side: 'left', label: 'Health' });
    expect(node._editing).toBeUndefined();
    expect(node.label).toBe('Health');
    const types = _state.get().nodes.map(n => n.type);
    expect(types.lastIndexOf('branch')).toBe(_state.get().nodes.indexOf(node));
    setBranchColor(node.id, '#00aa55');
    expect(BRANCH_COLORS[node.id]).toBeTruthy();
    expect(_state.getUndoStack()).toHaveLength(0);
  });
});

describe('writeComment', () => {
  test('stores byte for byte, clears on empty, stamps the node', () => {
    const id = addActivity('Read', { _ts: 1 });
    const text = '# Notes\n- [ ] one  \n*odd* [x](javascript:alert(1))';
    writeComment(id, text);
    expect(findNode(id).comments).toBe(text);
    expect(findNode(id)._ts).toBeGreaterThan(1);
    writeComment(id, '');
    expect('comments' in findNode(id)).toBe(false);
  });
});

describe('computeAgendaGroups', () => {
  test('a weekday tab returns its groups in render order', () => {
    const sched = addActivity('Gym (we)');
    const any = addActivity('Read');
    const dropped = addActivity('Old idea');
    applyStatus(dropped, 'dropped');
    findNode(dropped).droppedAt = `${tabDateString(3)}T12:00:00`;
    const { groups, empty } = computeAgendaGroups(3);
    expect(empty).toBe(false);
    expect(groups.map(g => g.key)).toEqual(['pending', 'done', 'anyday', 'dropped']);
    const ids = key => groups.find(g => g.key === key).rows.map(r => r.id);
    expect(ids('pending')).toContain(sched);
    expect(ids('anyday')).toContain(any);
    expect(ids('dropped')).toEqual([dropped]);
  });

  test('an empty day says so', () => {
    expect(computeAgendaGroups(1).empty).toBe(true);
  });
});

describe('liveOccurrenceEntry', () => {
  test('an ordinary task has none', () => {
    expect(liveOccurrenceEntry(findNode(addActivity('Plain')))).toBeNull();
  });
});
