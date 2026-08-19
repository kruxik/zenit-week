// A tab left open across midnight went stale in two different ways.
//
// The day index was only re-read when the tab was hidden and came back, so a
// tab that stayed visible kept yesterday's agenda tab selected. The ISO week
// was never re-read at all: nothing compared currentWeekKey against today's
// week while the app sat open, so a tab open across Sunday night kept showing
// last week — with a "today" that no longer existed in it — until the user
// navigated, reset the view or reloaded.
import { describe, test, expect, beforeEach } from 'vitest';
import { _state, checkDateRollover } from './setup.js';

function reset() {
  _state.clearLocalStorage();
  _state.clearIDBStore();
  _state.reset();
  _state.clearTodayWeekKeyOverride();
}

// checkDateRollover navigates by calling loadAndRender; the harness stubs the
// renderers already, so only the navigation needs capturing.
function captureNavigation() {
  const calls = [];
  _state.sandbox.loadAndRender = wk => { calls.push(wk); return Promise.resolve(); };
  return calls;
}

describe('week rollover — following the new week', () => {
  beforeEach(reset);

  test('moves a tab sitting on last week onto the new one', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    checkDateRollover();
    expect(nav).toEqual(['2026-31']);
  });

  test('leaves a user who deliberately browsed elsewhere where they are', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-25');          // browsing an old week on purpose
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    checkDateRollover();
    expect(nav).toEqual([]);
  });

  test('records the new week so the next check is a no-op', () => {
    captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    checkDateRollover();
    expect(_state.getLastKnownDate().weekKey).toBe('2026-31');
  });

  test('does not navigate twice for one rollover', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    checkDateRollover();
    checkDateRollover();
    expect(nav).toEqual(['2026-31']);
  });

  test('crosses a year boundary like any other week change', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-53');
    _state.setLastKnownDate(0, '2026-53');
    _state.setTodayWeekKey('2027-01');
    checkDateRollover();
    expect(nav).toEqual(['2027-01']);
  });
});

describe('week rollover — the day index', () => {
  beforeEach(reset);

  test('re-defaults the agenda to the new today', () => {
    captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setTodayWeekKey('2026-30');     // same week, new day
    _state.setAgendaActiveTab(1);
    // -1 forces a day change without touching the clock: the check compares
    // against the stored day, and no real weekday can equal it.
    _state.setLastKnownDate(-1, '2026-30');
    checkDateRollover();
    expect(_state.getAgendaActiveTab()).toBeNull();
  });

  test('a mid-week day change does not move the week', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(-1, '2026-30');
    _state.setTodayWeekKey('2026-30');
    checkDateRollover();
    expect(nav).toEqual([]);
  });

  test('nothing happens when neither the day nor the week moved', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setTodayWeekKey('2026-30');
    _state.setLastKnownDate(new Date().getDay(), '2026-30');
    _state.setAgendaActiveTab(3);
    checkDateRollover();
    expect(nav).toEqual([]);
    expect(_state.getAgendaActiveTab()).toBe(3);   // selection left alone
  });
});

describe('week rollover — deferring to the user', () => {
  beforeEach(reset);

  test('refuses to move the week out from under an open inline editor', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    _state.set({ nodes: [{ id: 'n1', type: 'activity', branch: 'work', label: '', parent: null, children: [], _editing: true }] });
    expect(checkDateRollover()).toBe(false);
    expect(nav).toEqual([]);
  });

  test('leaves the rollover pending so the retry still catches it', () => {
    captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    _state.set({ nodes: [{ id: 'n1', type: 'activity', branch: 'work', label: '', parent: null, children: [], _editing: true }] });
    checkDateRollover();
    expect(_state.getLastKnownDate().weekKey).toBe('2026-30');
  });

  test('follows through once the editor closes', () => {
    const nav = captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    _state.set({ nodes: [{ id: 'n1', type: 'activity', branch: 'work', label: '', parent: null, children: [], _editing: true }] });
    checkDateRollover();
    _state.set({ nodes: [{ id: 'n1', type: 'activity', branch: 'work', label: 'done typing', parent: null, children: [] }] });
    expect(checkDateRollover()).toBe(true);
    expect(nav).toEqual(['2026-31']);
  });
});
