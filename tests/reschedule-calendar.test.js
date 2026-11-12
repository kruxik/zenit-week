import { describe, it, expect, beforeEach } from 'vitest';
import { _state, moveNodeToWeek, undo, parseTodoDays, rescheduleTargetKind, rescheduleWeekMoves, weekDistance } from './setup.js';

// Today is Tuesday 3 Nov 2026, in week 2026-45.
const TODAY = '2026-11-03';
const ctx = (openWeek, canLater = true) => ({ openWeek, todayWeek: '2026-45', today: TODAY, canLater });

describe('rescheduleTargetKind - what a calendar click does', () => {
  it('retags a day of the open week, past days included', () => {
    expect(rescheduleTargetKind('2026-11-05', ctx('2026-45'))).toBe('retag');
    expect(rescheduleTargetKind('2026-11-02', ctx('2026-45'))).toBe('retag');
  });

  it('moves into the next week rather than scheduling it', () => {
    expect(rescheduleTargetKind('2026-11-10', ctx('2026-45'))).toBe('move');
  });

  it('turns two weeks out and beyond into a Later entry', () => {
    expect(rescheduleTargetKind('2026-11-16', ctx('2026-45'))).toBe('later');
    expect(rescheduleTargetKind('2027-03-01', ctx('2026-45'))).toBe('later');
  });

  it('greys Later for a node that cannot be sent (a tick or a day leaf)', () => {
    expect(rescheduleTargetKind('2026-11-16', ctx('2026-45', false))).toBe('disabled');
    expect(rescheduleTargetKind('2026-11-10', ctx('2026-45', false))).toBe('move');
  });

  it('moves back to any week from today\'s week on', () => {
    expect(rescheduleTargetKind('2026-11-04', ctx('2026-47'))).toBe('move');
    expect(rescheduleTargetKind('2026-11-11', ctx('2026-47'))).toBe('move');
  });

  it('greys weeks before today\'s week', () => {
    expect(rescheduleTargetKind('2026-10-28', ctx('2026-45'))).toBe('disabled');
    expect(rescheduleTargetKind('2026-10-28', ctx('2026-47'))).toBe('disabled');
  });

  it('from a past open week, the next week still moves and a past Later date is greyed', () => {
    expect(rescheduleTargetKind('2026-10-27', ctx('2026-43'))).toBe('move');
    expect(rescheduleTargetKind('2026-11-02', ctx('2026-43'))).toBe('disabled');
    expect(rescheduleTargetKind('2026-11-05', ctx('2026-43'))).toBe('later');
  });

  it('crosses a year boundary (2026 has 53 ISO weeks)', () => {
    const c = { openWeek: '2026-53', todayWeek: '2026-53', today: '2026-12-29', canLater: true };
    expect(rescheduleTargetKind('2027-01-05', c)).toBe('move');
    expect(rescheduleTargetKind('2027-01-12', c)).toBe('later');
  });

  it('greys a malformed date', () => {
    expect(rescheduleTargetKind('2026-13-01', ctx('2026-45'))).toBe('disabled');
  });
});

describe('rescheduleWeekMoves - which week numbers take a task on Any day', () => {
  it('takes the next week and weeks back to today\'s, never the open week or a Later week', () => {
    const c = { openWeek: '2026-47', todayWeek: '2026-45' };
    expect(rescheduleWeekMoves('2026-48', c)).toBe(true);
    expect(rescheduleWeekMoves('2026-46', c)).toBe(true);
    expect(rescheduleWeekMoves('2026-45', c)).toBe(true);
    expect(rescheduleWeekMoves('2026-47', c)).toBe(false);
    expect(rescheduleWeekMoves('2026-49', c)).toBe(false);
    expect(rescheduleWeekMoves('2026-44', c)).toBe(false);
  });
});

describe('weekDistance', () => {
  it('counts whole weeks in both directions and across years', () => {
    expect(weekDistance('2026-45', '2026-46')).toBe(1);
    expect(weekDistance('2026-47', '2026-45')).toBe(-2);
    expect(weekDistance('2026-53', '2027-01')).toBe(1);
    expect(weekDistance('2026-45', '2026-45')).toBe(0);
  });
});

describe('moveNodeToWeek - more than one week back', () => {
  const OPEN = '2026-47';
  const DEST = '2026-45';
  const readDest = () => JSON.parse(_state.getLocalStorage('zenit-week-' + DEST));
  const branch = (children = []) => ({
    id: 'work', type: 'branch', parent: 'center', label: 'Work', branch: 'work', side: 'left', children, _ts: 0,
  });

  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey(OPEN);
    _state.set({ nodes: [
      { id: 'center', type: 'center' }, branch(['a1']),
      { id: 'a1', type: 'activity', parent: 'work', label: 'Call mum (we)', branch: 'work',
        done: false, unplanned: false, children: [], _ts: 0 },
    ] });
    _state.setLocalStorage('zenit-week-' + DEST, { nodes: [branch()] });
  });

  it('lands two weeks back on the chosen day and leaves the open week', async () => {
    await moveNodeToWeek('a1', { offset: -2, day: 4 });
    const dest = readDest().nodes;
    const moved = dest.find(n => n.prevId === 'a1');
    expect(moved).toBeTruthy();
    // A task's days in either stored form: its label annotation or its day leaves.
    const days = [
      ...parseTodoDays(moved.label),
      ...moved.children.map(id => dest.find(x => x.id === id)).filter(c => c?.dayChild).map(c => c.dayIndex),
    ];
    expect(days).toEqual([4]);
    expect(_state.get().nodes.some(n => n.id === 'a1')).toBe(false);
  });

  it('one undo brings it back to the open week', async () => {
    await moveNodeToWeek('a1', { offset: -2, day: 4 });
    await undo();
    expect(_state.get().nodes.find(n => n.id === 'a1')?.label).toBe('Call mum (we)');
  });

  it('a week number lands it on Any day', async () => {
    await moveNodeToWeek('a1', { offset: -2, day: null });
    const dest = readDest().nodes;
    const moved = dest.find(n => n.prevId === 'a1');
    expect(moved).toBeTruthy();
    expect(parseTodoDays(moved.label).size).toBe(0);
    expect(moved.children.some(id => dest.find(x => x.id === id)?.dayChild)).toBe(false);
  });
});
