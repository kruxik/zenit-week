import { switchView, _state } from './setup.js';

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

  test('agenda persists view to localStorage', () => {
    switchView('agenda');
    expect(_state.getLocalStorage('zenit-week-view')).toBe('agenda');
  });

  test('mindmap persists view to localStorage', () => {
    switchView('mindmap');
    expect(_state.getLocalStorage('zenit-week-view')).toBe('mindmap');
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
