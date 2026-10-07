import { _state } from './setup.js';

// Clicking the logo fits the whole week to the viewport (resetView), as the
// Help panel promises ("Click the logo to fit everything to the view"). It is
// not a reload: a reload restores the saved pan/zoom, which is the opposite.

function mkBranch(id, side) {
  return { id, type: 'branch', branch: id, label: id, children: [], side, _ts: 0 };
}

function fireLogoClick() {
  const handlers = _state.getElement('logo')._listeners.click || [];
  expect(handlers).toHaveLength(1);
  return handlers[0]({ type: 'click' });
}

describe('logo click', () => {
  beforeEach(() => {
    _state.set({ nodes: [mkBranch('work', 'right'), mkBranch('family', 'left'), mkBranch('me', 'right')] });
    _state.setWeekKey('2026-05');
    _state.setTodayWeekKey('2026-05');
    _state.setCurrentView('mindmap');
    _state.setActiveDayFilter(null);
  });

  afterEach(() => {
    _state.clearTodayWeekKeyOverride();
  });

  test('fits the map to the viewport, exactly as resetView does', async () => {
    _state.setZoom(0.17);
    _state.setPan(-999, 4321);
    await fireLogoClick();
    const afterLogo = { zoom: _state.getZoom(), pan: _state.getPan() };

    expect(afterLogo.zoom).not.toBe(0.17);
    expect(afterLogo.pan).not.toEqual({ x: -999, y: 4321 });

    _state.setZoom(0.17);
    _state.setPan(-999, 4321);
    await _state.resetView();
    expect({ zoom: _state.getZoom(), pan: _state.getPan() }).toEqual(afterLogo);
  });

  test('clears a day filter that would hide part of the week', async () => {
    _state.setActiveDayFilter(3);
    await fireLogoClick();
    expect(_state.getActiveDayFilter()).toBeNull();
  });
});
