import { describe, it, expect, beforeEach } from 'vitest';
import { _state, orderedInsertIndex } from './setup.js';

const NEXT = '2026-19';
const CURR = '2026-18';
const key = wk => 'zenit-week-' + wk;

const readNext = () => JSON.parse(_state.getLocalStorage(key(NEXT)));

async function move(id) {
  const { moveNodeToNextWeek } = await import('./setup.js');
  await moveNodeToNextWeek(id);
}

describe('orderedInsertIndex', () => {
  // Destination sibling ids double as their source ordinal, as a string.
  const ordOf = id => (id === 'native' ? null : Number(id));

  it('appends when the arriving node has no source ordinal', () => {
    expect(orderedInsertIndex(['0', '2'], -1, ordOf)).toBe(2);
    expect(orderedInsertIndex(['0', '2'], null, ordOf)).toBe(2);
  });

  it('inserts before the first sibling that sat later in the source', () => {
    expect(orderedInsertIndex(['0', '2'], 1, ordOf)).toBe(1);
  });

  it('appends when every sibling sat earlier', () => {
    expect(orderedInsertIndex(['0', '1'], 5, ordOf)).toBe(2);
  });

  it('goes first when every sibling sat later', () => {
    expect(orderedInsertIndex(['3', '4'], 0, ordOf)).toBe(0);
  });

  it('keeps an equal ordinal after the sibling already placed', () => {
    // Indices slide down as siblings leave the source week, so a tie means the
    // arriving node sat later — it must not jump ahead.
    expect(orderedInsertIndex(['1'], 1, ordOf)).toBe(1);
  });

  it('is transparent to siblings with no source ordinal', () => {
    expect(orderedInsertIndex(['native', '2'], 1, ordOf)).toBe(1);
    expect(orderedInsertIndex(['native'], 1, ordOf)).toBe(1);
  });
});

describe('moveNodeToNextWeek — source-week ordering', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setWeekKey(CURR);
  });

  it('keeps sub-branch order instead of ordering by when each was sent', async () => {
    // Source week: Networking sits above Home under Work.
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['net', 'home'] },
        { id: 'net', type: 'activity', parent: 'b1', branch: 'b1', label: 'Networking', children: ['net-task'] },
        { id: 'net-task', type: 'activity', parent: 'net', branch: 'b1', label: 'Ping Alex', children: [] },
        { id: 'home', type: 'activity', parent: 'b1', branch: 'b1', label: 'Home', children: ['home-task'] },
        { id: 'home-task', type: 'activity', parent: 'home', branch: 'b1', label: 'Fix sink', children: [] },
      ],
    });
    _state.setLocalStorage(key(NEXT), {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: [] },
      ],
    });

    // Home is sent first, Networking second — the reverse of the source order.
    await move('home-task');
    await move('net-task');

    const work = readNext().nodes.find(n => n.id === 'b1');
    expect(work.children).toEqual(['net', 'home']);
  });

  it('places a bridged branch among the destination branches, not last', async () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['a1'] },
        { id: 'b2', type: 'branch', parent: 'center', label: 'Family', branch: 'b2', side: 'right', children: [] },
        { id: 'b3', type: 'branch', parent: 'center', label: 'Me', branch: 'b3', side: 'right', children: [] },
        { id: 'a1', type: 'activity', parent: 'b1', branch: 'b1', label: 'Move Me', children: [] },
      ],
    });
    // Next week already has the outer two branches but not Work.
    _state.setLocalStorage(key(NEXT), {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b2', type: 'branch', parent: 'center', label: 'Family', branch: 'b2', side: 'right', children: [] },
        { id: 'b3', type: 'branch', parent: 'center', label: 'Me', branch: 'b3', side: 'right', children: [] },
      ],
    });

    await move('a1');

    const branchIds = readNext().nodes.filter(n => n.type === 'branch').map(n => n.id);
    expect(branchIds).toEqual(['b1', 'b2', 'b3']);
  });

  it('appends when the destination shares no sibling with the source', async () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['a1'] },
        { id: 'a1', type: 'activity', parent: 'b1', branch: 'b1', label: 'Move Me', children: [] },
      ],
    });
    _state.setLocalStorage(key(NEXT), {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['keep'] },
        { id: 'keep', type: 'activity', parent: 'b1', branch: 'b1', label: 'Already here', children: [] },
      ],
    });

    await move('a1');

    const next = readNext();
    const work = next.nodes.find(n => n.id === 'b1');
    const moved = next.nodes.find(n => n.label === 'Move Me');
    expect(work.children).toEqual(['keep', moved.id]);
  });

  it('stamps prevId so a later move can anchor against the copy', async () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['a1', 'a2'] },
        { id: 'a1', type: 'activity', parent: 'b1', branch: 'b1', label: 'First', children: [] },
        { id: 'a2', type: 'activity', parent: 'b1', branch: 'b1', label: 'Second', children: [] },
      ],
    });
    _state.setLocalStorage(key(NEXT), {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: [] },
      ],
    });

    // Second goes first; First must still land above it.
    await move('a2');
    await move('a1');

    const next = readNext();
    const work = next.nodes.find(n => n.id === 'b1');
    const labels = work.children.map(cid => next.nodes.find(n => n.id === cid).label);
    expect(labels).toEqual(['First', 'Second']);
    expect(next.nodes.find(n => n.label === 'First').prevId).toBe('a1');
  });

  it('never inserts an ordinary node among tick-children', async () => {
    _state.set({
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['a1', 'a2'] },
        { id: 'a1', type: 'activity', parent: 'b1', branch: 'b1', label: 'First', children: [] },
        { id: 'a2', type: 'activity', parent: 'b1', branch: 'b1', label: 'Second', children: [] },
      ],
    });
    _state.setLocalStorage(key(NEXT), {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', branch: 'b1', side: 'left', children: ['a2', 't1'] },
        { id: 'a2', type: 'activity', parent: 'b1', branch: 'b1', label: 'Second', children: [] },
        { id: 't1', type: 'activity', parent: 'b1', branch: 'b1', label: '1', tickChild: true, tickIndex: 1, children: [] },
      ],
    });

    await move('a1');

    const next = readNext();
    const work = next.nodes.find(n => n.id === 'b1');
    expect(work.children[work.children.length - 1]).toBe('t1');
  });
});
