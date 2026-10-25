// A tab left open across midnight went stale in two different ways.
//
// The day index was only re-read when the tab was hidden and came back, so a
// tab that stayed visible kept yesterday's agenda tab selected. The ISO week
// was never re-read at all: nothing compared currentWeekKey against today's
// week while the app sat open, so a tab open across Sunday night kept showing
// last week - with a "today" that no longer existed in it - until the user
// navigated, reset the view or reloaded.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { _state, sandboxGlobal, checkDateRollover } from './setup.js';

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

describe('week rollover - following the new week', () => {
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

describe('week rollover - the day index', () => {
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

describe('week rollover - deferring to the user', () => {
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

// Pins `new Date()` (no arguments) to one instant; the sandbox reads the host
// Date on every access, so the app sees the frozen clock too.
function withFrozenDate(when, fn) {
  const RealDate = global.Date;
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(when.getTime());
      return new RealDate(...args);
    }
    static now() { return when.getTime(); }
  };
  try { return fn(); } finally { global.Date = RealDate; }
}

// The strip carries the today dot and, on the current week only, the Overdue
// tab and weekday faces. It is only rebuilt when its staleness key moves, and
// the key once left out the two things it reads from the clock: today's
// weekday and whether the open week is today's. A tab left open across
// midnight with the new today's tab already selected kept the dot on yesterday
// until the user clicked another tab.
describe('date rollover - the agenda strip', () => {
  const SATURDAY = new Date(2026, 9, 24, 12, 0);   // ISO week 2026-43
  const SUNDAY   = new Date(2026, 9, 25, 21, 30);  // same week, the night DST ended
  const MONDAY   = new Date(2026, 9, 26, 9, 0);    // ISO week 2026-44
  const realStrip = sandboxGlobal.renderAgendaStrip;
  const realContent = sandboxGlobal.renderAgendaTabContent;
  const realLoadAndRender = sandboxGlobal.loadAndRender;
  let stripBuilds;

  beforeEach(() => {
    reset();
    _state.set({ nodes: [] });
    stripBuilds = 0;
    sandboxGlobal.renderAgendaStrip = () => { stripBuilds++; };
    sandboxGlobal.renderAgendaTabContent = () => {};
    sandboxGlobal.loadAndRender = () => Promise.resolve();
  });
  afterEach(() => {
    sandboxGlobal.renderAgendaStrip = realStrip;
    sandboxGlobal.renderAgendaTabContent = realContent;
    sandboxGlobal.loadAndRender = realLoadAndRender;
    _state.setCurrentView('mindmap');
  });

  // requestAnimationFrame is a no-op in the harness, so the frame the agenda
  // render waits for is run by hand.
  const flush = () => sandboxGlobal._renderAgendaFlush();

  test('moves the today dot when the new today was already the selected tab', () => {
    _state.setCurrentView('agenda');
    _state.setWeekKey('2026-43');
    _state.setTodayWeekKey('2026-43');
    withFrozenDate(SATURDAY, () => {
      _state.setLastKnownDate(6, '2026-43');
      _state.setAgendaActiveTab(0);            // looked ahead to Sunday
      flush();
    });
    stripBuilds = 0;
    withFrozenDate(SUNDAY, () => {
      checkDateRollover();
      flush();
    });
    expect(_state.getAgendaActiveTab()).toBe(0);
    expect(stripBuilds).toBe(1);
  });

  test('rebuilds when the browsed week becomes the current one', () => {
    _state.setCurrentView('agenda');
    _state.setWeekKey('2026-44');              // planning next week on Sunday
    _state.setTodayWeekKey('2026-43');
    withFrozenDate(SUNDAY, () => {
      _state.setLastKnownDate(0, '2026-43');
      _state.setAgendaActiveTab(1);
      flush();
    });
    stripBuilds = 0;
    withFrozenDate(MONDAY, () => {
      _state.setTodayWeekKey('2026-44');
      checkDateRollover();
      flush();
    });
    expect(_state.getWeekKey()).toBe('2026-44');
    expect(stripBuilds).toBe(1);
  });

  test('rebuilds on the first agenda render after a rollover seen from another view', () => {
    _state.setWeekKey('2026-43');
    _state.setTodayWeekKey('2026-43');
    withFrozenDate(SATURDAY, () => {
      _state.setCurrentView('agenda');
      _state.setLastKnownDate(6, '2026-43');
      _state.setAgendaActiveTab(0);
      flush();
      _state.setCurrentView('mindmap');
    });
    stripBuilds = 0;
    withFrozenDate(SUNDAY, () => {
      checkDateRollover();
      _state.setCurrentView('agenda');
      sandboxGlobal.renderAgenda();
      flush();
    });
    expect(stripBuilds).toBe(1);
  });
});

// A refused check (inline editor open) must keep retrying until it settles.
// It used to retry once from the midnight timer and not at all from the
// visibility handler - both fell back to waiting for the next midnight.
describe('date rollover - retrying a refused check', () => {
  const realSetTimeout = sandboxGlobal.setTimeout;
  const realClearTimeout = sandboxGlobal.clearTimeout;
  let armed;

  const editing = () => _state.set({ nodes: [{ id: 'n1', type: 'activity', branch: 'work', label: '', parent: null, children: [], _editing: true }] });
  const typed = () => _state.set({ nodes: [{ id: 'n1', type: 'activity', branch: 'work', label: 'done typing', parent: null, children: [] }] });
  const fireArmed = () => { const { fn } = armed.pop(); fn(); };

  beforeEach(() => {
    reset();
    armed = [];
    sandboxGlobal.setTimeout = (fn, delay) => { armed.push({ fn, delay }); return armed.length; };
    sandboxGlobal.clearTimeout = () => {};
    captureNavigation();
    _state.setWeekKey('2026-30');
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
  });
  afterEach(() => {
    sandboxGlobal.setTimeout = realSetTimeout;
    sandboxGlobal.clearTimeout = realClearTimeout;
  });

  test('a refused check re-arms in a minute, not at midnight', () => {
    editing();
    sandboxGlobal.runDateCheck();
    expect(armed.at(-1).delay).toBe(60000);
  });

  test('keeps retrying every minute while the editor stays open', () => {
    editing();
    sandboxGlobal.runDateCheck();
    fireArmed();
    fireArmed();
    expect(armed.at(-1).delay).toBe(60000);
    expect(_state.getLastKnownDate().weekKey).toBe('2026-30');
  });

  test('settles once the editor closes and goes back to waiting for midnight', () => {
    editing();
    sandboxGlobal.runDateCheck();
    typed();
    fireArmed();
    expect(_state.getLastKnownDate().weekKey).toBe('2026-31');
    expect(armed.at(-1).delay).not.toBe(60000);
  });
});
