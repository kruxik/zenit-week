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
