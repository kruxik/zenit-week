import { showContextMenu, _state } from './setup.js';

// "Find in mindmap" is the Agenda's way to a task on the map. On the map the
// node is already in view, so the item is offered in the Agenda only, and only
// for a task.

function mkBranch(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}

function mkActivity(id, parentId, branchId) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0 };
}

const isVisible = (id) => _state.getElement(id).style.display !== 'none';

beforeEach(() => {
  _state.reset();
  _state.set({ nodes: [mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')] });
  _state.setWeekKey('2026-01');
});

describe('context menu - Find in mindmap', () => {
  test('the Agenda offers it on a task', () => {
    _state.setCurrentView('agenda');
    showContextMenu(100, 100, 'a1');
    expect(isVisible('ctx-find-in-map')).toBe(true);
  });

  test('the map does not offer it', () => {
    _state.setCurrentView('mindmap');
    showContextMenu(100, 100, 'a1');
    expect(isVisible('ctx-find-in-map')).toBe(false);
  });

  test('a branch never offers it', () => {
    _state.setCurrentView('agenda');
    showContextMenu(100, 100, 'work');
    expect(isVisible('ctx-find-in-map')).toBe(false);
  });
});
