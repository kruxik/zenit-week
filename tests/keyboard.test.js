import { _state, openStatsPanel, closeStatsPanel } from './setup.js';

function esc(extra = {}) {
  _state.triggerKeydown({
    key: 'Escape',
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { tagName: 'DIV' },
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...extra,
  });
}

describe('ESC key — closes Agenda on desktop', () => {
  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setWindowInnerWidth(1280);
    _state.setEditState(null);
    // ensure no overlay panels are open
    _state.getElement('context-menu').classList.remove('visible');
    _state.getElement('settings-dropdown').classList.remove('visible');
    _state.getElement('help-panel').classList.remove('visible');
    closeStatsPanel();
  });

  test('ESC in agenda on desktop switches to mindmap', () => {
    _state.setCurrentView('agenda');
    esc();
    expect(_state.getCurrentView()).toBe('mindmap');
  });

  test('ESC in agenda on mobile (< 768px) does not switch view', () => {
    _state.setCurrentView('agenda');
    _state.setWindowInnerWidth(375);
    esc();
    expect(_state.getCurrentView()).toBe('agenda');
  });

  test('ESC in mindmap view leaves view unchanged', () => {
    _state.setCurrentView('mindmap');
    esc();
    expect(_state.getCurrentView()).toBe('mindmap');
  });

  test('ESC closes settings dropdown before acting on agenda', () => {
    _state.setCurrentView('agenda');
    const settings = _state.getElement('settings-dropdown');
    settings.classList.add('visible');
    esc();
    expect(settings.classList.contains('visible')).toBe(false);
    expect(_state.getCurrentView()).toBe('agenda');
  });

  test('ESC closes the stats panel and lands on the default mindmap view', () => {
    _state.setCurrentView('agenda');
    _state.set({ nodes: [{ id: 'center', type: 'center' }] });
    openStatsPanel();
    const panel = _state.getElement('stats-panel');
    expect(panel.classList.contains('visible')).toBe(true);
    esc();
    expect(panel.classList.contains('visible')).toBe(false);
    // Stats is a transient overlay; leaving it returns to the default view.
    expect(_state.getCurrentView()).toBe('mindmap');
  });

  test('ESC does nothing when editState is active', () => {
    _state.setCurrentView('agenda');
    _state.setEditState({ nodeId: 'x', isNew: false, originalLabel: 'test', initialNodeW: 0 });
    esc();
    expect(_state.getCurrentView()).toBe('agenda');
    _state.setEditState(null);
  });
});

function press(key, extra = {}) {
  _state.triggerKeydown({
    key,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { tagName: 'DIV' },
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });
}

describe('Node hotkeys on the hovered node', () => {
  const branch = () => ({ id: 'work', type: 'branch', branch: 'work', label: 'work', children: ['a1'], side: 'left', _ts: 0 });
  const activity = () => ({ id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Task', children: [], done: false, _ts: 0 });

  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setEditState(null);
    _state.set({ nodes: [branch(), activity()] });
    _state.setHoveredNode('a1');
    _state.getElement('help-panel').classList.remove('visible');
    _state.getElement('comment-panel').classList.remove('visible');
  });

  afterEach(() => _state.setHoveredNode(null));

  test('P cycles Normal → High → Critical → Normal', () => {
    press('p');
    expect(_state.get().nodes.find(n => n.id === 'a1').priority).toBe('high');
    press('p');
    expect(_state.get().nodes.find(n => n.id === 'a1').priority).toBe('critical');
    press('p');
    expect(_state.get().nodes.find(n => n.id === 'a1').priority).toBeNull();
  });

  test('R toggles reusable, and cascades to the subtree', () => {
    const nodes = [branch(), activity(), { id: 'a2', type: 'activity', branch: 'work', parent: 'a1', label: 'Step', children: [], done: false, _ts: 0 }];
    nodes[1].children = ['a2'];
    _state.set({ nodes });
    press('r');
    expect(_state.get().nodes.find(n => n.id === 'a1').reusable).toBe(true);
    expect(_state.get().nodes.find(n => n.id === 'a2').reusable).toBe(true);
    press('r');
    expect(_state.get().nodes.find(n => n.id === 'a1').reusable).toBe(false);
  });

  test('C opens the comment dialog for an activity', () => {
    press('c');
    expect(_state.getElement('comment-panel').classList.contains('visible')).toBe(true);
    _state.getElement('comment-panel').classList.remove('visible');
  });

  test('P is a no-op on a branch', () => {
    _state.setHoveredNode('work');
    press('p');
    expect(_state.get().nodes.find(n => n.id === 'work').priority).toBeUndefined();
  });
});

describe('Global hotkeys', () => {
  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setEditState(null);
    _state.setHoveredNode(null);
    _state.getElement('help-panel').classList.remove('visible');
    _state.getElement('comment-panel').classList.remove('visible');
  });

  test('H toggles the help panel', () => {
    press('h');
    expect(_state.getElement('help-panel').classList.contains('visible')).toBe(true);
    press('h');
    expect(_state.getElement('help-panel').classList.contains('visible')).toBe(false);
  });

  test('? opens help too', () => {
    press('?', { shiftKey: true });
    expect(_state.getElement('help-panel').classList.contains('visible')).toBe(true);
    press('h');
  });

  test('[ and ] step the week, T returns to the current one', async () => {
    _state.setWeekKey('2026-10');
    _state.setTodayWeekKey('2026-10');
    press('[');
    await Promise.resolve();
    expect(_state.getWeekKey()).toBe('2026-09');
    press(']');
    await Promise.resolve();
    expect(_state.getWeekKey()).toBe('2026-10');
    press('[');
    await Promise.resolve();
    press('t');
    await Promise.resolve();
    expect(_state.getWeekKey()).toBe('2026-10');
    _state.clearTodayWeekKeyOverride();
  });

  test('Shift+arrows step the week as well', async () => {
    _state.setWeekKey('2026-10');
    press('ArrowRight', { shiftKey: true });
    await Promise.resolve();
    expect(_state.getWeekKey()).toBe('2026-11');
    press('ArrowLeft', { shiftKey: true });
    await Promise.resolve();
    expect(_state.getWeekKey()).toBe('2026-10');
  });

  test('V cycles the view level', () => {
    _state.setViewLevel('full');
    press('v');
    expect(_state.getViewLevel()).toBe('pebbles');
    press('v');
    expect(_state.getViewLevel()).toBe('rocks');
    press('v');
    expect(_state.getViewLevel()).toBe('full');
  });

  test('week hotkeys stand down while Help is open', async () => {
    _state.setWeekKey('2026-10');
    press('h');
    press('[');
    await Promise.resolve();
    expect(_state.getWeekKey()).toBe('2026-10');
    press('h');
  });
});

describe('Mindmap keyboard focus', () => {
  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setEditState(null);
    _state.setHoveredNode(null);
    _state.set({
      nodes: [
        { id: 'work', type: 'branch', branch: 'work', label: 'work', children: [], side: 'left', _ts: 0 },
        { id: 'me', type: 'branch', branch: 'me', label: 'me', children: [], side: 'right', _ts: 0 },
      ],
    });
  });

  test('the first arrow press lands on the root', () => {
    press('ArrowRight');
    expect(_state.getKbFocus()).toBe('center');
    expect(_state.getHoveredNode()).toBe('center');
  });

  test('arrows walk to the branch on the side pressed', () => {
    press('ArrowRight');
    press('ArrowRight');
    expect(_state.getKbFocus()).toBe('me');
    press('ArrowLeft');
    expect(_state.getKbFocus()).toBe('center');
  });

  test('ESC drops the ring and the hover it stood in for', () => {
    press('ArrowRight');
    press('Escape');
    expect(_state.getKbFocus()).toBeNull();
    expect(_state.getHoveredNode()).toBeNull();
  });
});
