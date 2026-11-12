import { switchView, _state, viewTabTarget, setViewTabPress } from './setup.js';

describe('switchView', () => {
  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setWindowInnerWidth(1280);
  });

  test('switching to agenda sets currentView', () => {
    switchView('agenda');
    expect(_state.getCurrentView()).toBe('agenda');
  });

  test('switching to mindmap sets currentView', () => {
    switchView('agenda');
    switchView('mindmap');
    expect(_state.getCurrentView()).toBe('mindmap');
  });

  test('switching views leaves the Start view setting alone', () => {
    _state.sandbox.localStorage.setItem('zenit-week-start-view', 'stats');
    switchView('agenda');
    switchView('mindmap');
    expect(_state.getLocalStorage('zenit-week-start-view')).toBe('stats');
    expect(_state.getLocalStorage('zenit-week-view')).toBeUndefined();
  });

  test('agenda sets documentElement dataset.view', () => {
    switchView('agenda');
    expect(_state.getDocument().documentElement.dataset.view).toBe('agenda');
  });

  test('agenda on desktop shows canvas (display not none)', () => {
    _state.setWindowInnerWidth(1280);
    switchView('agenda');
    const canvas = _state.getElement('canvas-container');
    expect(canvas.style.display).not.toBe('none');
  });

  test('agenda on mobile hides canvas', () => {
    _state.setWindowInnerWidth(640);
    switchView('agenda');
    const canvas = _state.getElement('canvas-container');
    expect(canvas.style.display).toBe('none');
  });

  test('agenda activates agenda button, deactivates mindmap button', () => {
    switchView('agenda');
    const btnAG = _state.getElement('vtb-agenda');
    const btnMM = _state.getElement('vtb-mindmap');
    expect(btnAG.classList.contains('active')).toBe(true);
    expect(btnMM.classList.contains('active')).toBe(false);
  });

  test('mindmap activates mindmap button, deactivates agenda button', () => {
    switchView('agenda');
    switchView('mindmap');
    const btnAG = _state.getElement('vtb-agenda');
    const btnMM = _state.getElement('vtb-mindmap');
    expect(btnMM.classList.contains('active')).toBe(true);
    expect(btnAG.classList.contains('active')).toBe(false);
  });

  test('mindmap view sets agenda-view inactive', () => {
    switchView('agenda');
    switchView('mindmap');
    const agendaEl = _state.getElement('agenda-view');
    expect(agendaEl.classList.contains('active')).toBe(false);
  });
});

describe('view tabs (VIEW_TABS)', () => {
  const VIEW_TABS = _state.getViewTabs();
  beforeEach(() => {
    _state.setCurrentView('mindmap');
    _state.setWindowInnerWidth(1280);
  });

  test('every tab has a button and exactly the view in place is active', () => {
    switchView('stats');
    for (const tab of VIEW_TABS) {
      expect(_state.getElement('vtb-' + tab.view).classList.contains('active')).toBe(tab.view === 'stats');
    }
  });

  test('applying a view clears the press, whichever tab was pressed', () => {
    for (const tab of VIEW_TABS) {
      setViewTabPress(tab.view);
      switchView('agenda');
      for (const t of VIEW_TABS) {
        expect(_state.getElement('vtb-' + t.view).classList.contains('pressed')).toBe(false);
      }
    }
  });

  test('a click on the tab in view does its `again`', () => {
    switchView('stats');
    expect(viewTabTarget('stats')).toBe('mindmap');
    switchView('mindmap');
    expect(viewTabTarget('mindmap')).toBe('levels');
    expect(viewTabTarget('agenda')).toBe('agenda');
    switchView('agenda');
    expect(viewTabTarget('agenda')).toBe('agenda');
  });

  test('both map tabs disclose the level row', () => {
    const mapTabs = VIEW_TABS.filter(t => t.again === 'levels').map(t => t.view).sort();
    expect(mapTabs).toEqual(['mindmap', 'vision']);
  });
});
