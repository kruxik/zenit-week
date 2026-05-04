import { _state } from './setup.js';

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
    _state.getElement('placeholder-panel').classList.remove('expanded');
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

  test('ESC collapses summary panel before acting on agenda', () => {
    _state.setCurrentView('agenda');
    const summary = _state.getElement('placeholder-panel');
    summary.classList.add('expanded');
    esc();
    expect(summary.classList.contains('expanded')).toBe(false);
    expect(_state.getCurrentView()).toBe('agenda');
  });

  test('ESC does nothing when editState is active', () => {
    _state.setCurrentView('agenda');
    _state.setEditState({ nodeId: 'x', isNew: false, originalLabel: 'test', initialNodeW: 0 });
    esc();
    expect(_state.getCurrentView()).toBe('agenda');
    _state.setEditState(null);
  });
});
