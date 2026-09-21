import { describe, test, expect, beforeEach } from 'vitest';
import { _state, triggerKeydown, setHoveredNode, getHoveredNode, findNode } from './setup.js';

// The hovered-node hotkeys act on the map, and the map is not what a typing
// user is looking at. Quick add keeps focus in its field between entries so the
// mobile keyboard never dismisses, and whatever was dragged last stays hovered
// — so a Backspace aimed at the text was deleting that node instead.
describe('hovered-node hotkeys while typing', () => {
  const mkBranch = (id) => ({ id, type: 'branch', branch: id, label: id, children: ['a1'], side: 'left', _ts: 0 });
  const mkActivity = (id, parent) => ({
    id, type: 'activity', branch: 'work', parent, label: id,
    children: [], done: false, unplanned: false, _ts: 0,
  });

  const key = (k, tagName) => ({
    key: k,
    target: tagName ? { tagName } : { tagName: 'BODY' },
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {},
  });

  beforeEach(() => {
    _state.set({ nodes: [mkBranch('work'), mkActivity('a1', 'work')] });
    _state.setCurrentView('mindmap');
    setHoveredNode('a1');
  });

  test('Backspace typed in an input leaves the hovered node alone', () => {
    triggerKeydown(key('Backspace', 'INPUT'));
    expect(findNode('a1')).toBeTruthy();
  });

  test('Backspace typed in a textarea leaves the hovered node alone', () => {
    triggerKeydown(key('Backspace', 'TEXTAREA'));
    expect(findNode('a1')).toBeTruthy();
  });

  test('Delete typed in an input leaves the hovered node alone', () => {
    triggerKeydown(key('Delete', 'INPUT'));
    expect(findNode('a1')).toBeTruthy();
  });

  test('Backspace outside a field still deletes the hovered node', () => {
    // The guard must not cost the hotkey its actual job.
    triggerKeydown(key('Backspace'));
    expect(findNode('a1')).toBeFalsy();
  });

  test('status hotkeys typed in a field do not reach the node', () => {
    // Quieter than the delete, and the reason a stray one goes unnoticed for
    // days: the task is still there, just done, dropped or re-prioritised.
    for (const k of ['d', 'u', 'x', 'p', 'r']) {
      triggerKeydown(key(k, 'INPUT'));
    }
    const node = findNode('a1');
    expect(node.done).toBe(false);
    expect(node.unplanned).toBe(false);
    expect(node.dropped).toBeFalsy();
    expect(node.priority ?? null).toBe(null);
    expect(node.reusable ?? false).toBe(false);
  });

  test('the hovered node itself is not disturbed by a guarded key', () => {
    triggerKeydown(key('Backspace', 'INPUT'));
    expect(getHoveredNode()).toBe('a1');
  });
});
