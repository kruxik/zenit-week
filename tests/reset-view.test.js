import { _state } from './setup.js';

function mkBranch(id) {
  return { id, type: 'branch', branch: id, label: id, children: [], side: 'right', _ts: 0 };
}

function setUp({ weekKey = '2026-01', view = 'mindmap', todayKey = null } = {}) {
  _state.set({ nodes: [mkBranch('work')] });
  _state.setWeekKey(weekKey);
  _state.setCurrentView(view);
  _state.reset();
  _state.setActiveDayFilter(null);
  _state.setAgendaActiveTab(null);
  if (todayKey) {
    _state.setTodayWeekKey(todayKey);
  } else {
    _state.clearTodayWeekKeyOverride();
  }
}

afterEach(() => {
  _state.clearTodayWeekKeyOverride();
});

// ─── Mindmap ──────────────────────────────────────────────────────────────────

describe('resetView — mindmap', () => {
  test('clears activeDayFilter when already on current week', async () => {
    setUp({ weekKey: '2026-05', view: 'mindmap' });
    _state.setActiveDayFilter(3);

    await _state.resetView();

    expect(_state.getActiveDayFilter()).toBeNull();
  });

  test('stays on same week when already on current week', async () => {
    setUp({ weekKey: '2026-05', view: 'mindmap' });

    await _state.resetView();

    expect(_state.getWeekKey()).toBe('2026-05');
  });

  test('navigates to current week when on a different week', async () => {
    setUp({ weekKey: '2026-01', view: 'mindmap', todayKey: '2026-05' });
    _state.setLocalStorage('zenit-week-2026-05', { nodes: [mkBranch('work')] });

    await _state.resetView();

    expect(_state.getWeekKey()).toBe('2026-05');
  });

  test('clears activeDayFilter even when navigating to a different week', async () => {
    setUp({ weekKey: '2026-01', view: 'mindmap', todayKey: '2026-05' });
    _state.setActiveDayFilter(2);
    _state.setLocalStorage('zenit-week-2026-05', { nodes: [mkBranch('work')] });

    await _state.resetView();

    expect(_state.getActiveDayFilter()).toBeNull();
  });
});

// ─── Agenda ───────────────────────────────────────────────────────────────────

describe('resetView — agenda', () => {
  test('sets agendaActiveTab to current day of week', async () => {
    setUp({ weekKey: '2026-05', view: 'agenda' });
    _state.setAgendaActiveTab(4);

    await _state.resetView();

    // resetView sets tab to null; renderAgenda (live) then sets it to new Date().getDay()
    expect(_state.getAgendaActiveTab()).toBe(new Date().getDay());
  });

  test('stays on same week when already on current week', async () => {
    setUp({ weekKey: '2026-05', view: 'agenda' });

    await _state.resetView();

    expect(_state.getWeekKey()).toBe('2026-05');
  });

  test('navigates to current week when on a different week', async () => {
    setUp({ weekKey: '2026-01', view: 'agenda', todayKey: '2026-05' });
    _state.setLocalStorage('zenit-week-2026-05', { nodes: [mkBranch('work')] });

    await _state.resetView();

    expect(_state.getWeekKey()).toBe('2026-05');
  });

  test('resets to current day tab even when navigating to a different week', async () => {
    setUp({ weekKey: '2026-01', view: 'agenda', todayKey: '2026-05' });
    _state.setAgendaActiveTab(4);
    _state.setLocalStorage('zenit-week-2026-05', { nodes: [mkBranch('work')] });

    await _state.resetView();

    expect(_state.getAgendaActiveTab()).toBe(new Date().getDay());
  });
});
