import {
  localizeDayGroups, nodeDisplayLabel, dayAbbr,
  parseTodoDays, getAgendaNodeLabel, getNodeSize, computeLayout,
  findNode, _state,
} from './setup.js';

function mkBranch(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}

function mkActivity(id, parentId, branchId, extra = {}) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0, ...extra };
}

function setUp(nodes, lang = 'en') {
  _state.set({ nodes });
  _state.setWeekKey('2026-01');
  _state.reset();
  _state.setLang(lang);
}

describe('localizeDayGroups', () => {
  test('EN tokens render as CS abbrs when the UI is Czech', () => {
    _state.setLang('cs');
    expect(localizeDayGroups('Gym (mo)')).toBe('Gym (Po)');
    expect(localizeDayGroups('Gym (mo, we)')).toBe('Gym (Po, St)');
  });

  test('CS tokens render as EN abbrs when the UI is English', () => {
    _state.setLang('en');
    expect(localizeDayGroups('Kolo (po)')).toBe('Kolo (Mo)');
    expect(localizeDayGroups('Kolo (út, čt)')).toBe('Kolo (Tu, Th)');
    expect(localizeDayGroups('Kolo (ut, ct)')).toBe('Kolo (Tu, Th)');
  });

  test('ranges keep their dash and localize both ends', () => {
    _state.setLang('cs');
    expect(localizeDayGroups('Stand-up (mo-we)')).toBe('Stand-up (Po-St)');
    _state.setLang('en');
    expect(localizeDayGroups('Stand-up (po-st)')).toBe('Stand-up (Mo-We)');
  });

  test('spacing around a range dash survives verbatim', () => {
    _state.setLang('cs');
    expect(localizeDayGroups('Task (mo - we)')).toBe('Task (Po - St)');
  });

  test('daily indicator follows the language', () => {
    _state.setLang('cs');
    expect(localizeDayGroups('Vitamins (daily)')).toBe('Vitamins (denně)');
    _state.setLang('en');
    expect(localizeDayGroups('Vitamins (denně)')).toBe('Vitamins (daily)');
    expect(localizeDayGroups('Vitamins (denne)')).toBe('Vitamins (daily)');
  });

  test('non-day groups are left untouched', () => {
    _state.setLang('cs');
    expect(localizeDayGroups('Release (v3)')).toBe('Release (v3)');
    expect(localizeDayGroups('Release (v3) (mo)')).toBe('Release (v3) (Po)');
    // A group with one unknown token disqualifies the whole group
    expect(localizeDayGroups('Trip (mo, xx)')).toBe('Trip (mo, xx)');
  });

  test('unfrozen magic tokens are left to resolveMagicDayTokens', () => {
    _state.setLang('cs');
    expect(localizeDayGroups('Call (today)')).toBe('Call (today)');
    expect(localizeDayGroups('Call (tomorrow)')).toBe('Call (tomorrow)');
  });

  test('is idempotent and round-trips through parseTodoDays', () => {
    _state.setLang('cs');
    const once = localizeDayGroups('Gym (mo, we, fr)');
    expect(once).toBe('Gym (Po, St, Pá)');
    expect(localizeDayGroups(once)).toBe(once);
    expect([...parseTodoDays(once)].sort()).toEqual([1, 3, 5]);
    _state.setLang('en');
    expect([...parseTodoDays(once)].sort()).toEqual([1, 3, 5]);
  });

  test('empty and missing labels are safe', () => {
    expect(localizeDayGroups('')).toBe('');
    expect(localizeDayGroups(undefined)).toBe('');
    expect(localizeDayGroups(null)).toBe('');
  });
});

describe('nodeDisplayLabel', () => {
  test('day-child renders from dayIndex, ignoring a stale stored label', () => {
    const child = mkActivity('d1', 'a1', 'work', { dayChild: true, dayIndex: 1, label: 'Mo' });
    setUp([mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work', { children: ['d1'] }), child], 'cs');
    expect(nodeDisplayLabel(child)).toBe('Po');
    _state.setLang('en');
    expect(nodeDisplayLabel(child)).toBe('Mo');
  });

  test('activity keeps its text and localizes only the day group', () => {
    const a = mkActivity('a1', 'work', 'work', { label: 'Gym 3x (mo)' });
    setUp([mkBranch('work', ['a1']), a], 'cs');
    expect(nodeDisplayLabel(a)).toBe('Gym 3x (Po)');
  });

  test('storage is never mutated by display', () => {
    const a = mkActivity('a1', 'work', 'work', { label: 'Gym (mo)' });
    setUp([mkBranch('work', ['a1']), a], 'cs');
    nodeDisplayLabel(a);
    expect(findNode('a1').label).toBe('Gym (mo)');
    expect(findNode('a1')._ts).toBe(0);
  });
});

describe('day abbreviations follow the active language', () => {
  test('dayAbbr falls back to EN for an unknown language', () => {
    _state.setLang('de');
    expect(dayAbbr(1)).toBe('Mo');
  });

  test('agenda day hint and day-child label switch language', () => {
    const child = mkActivity('d1', 'a1', 'work', { dayChild: true, dayIndex: 2, label: 'Tu' });
    setUp([
      mkBranch('work', ['a1']),
      mkActivity('a1', 'work', 'work', { label: 'Gym', children: ['d1'] }),
      child,
    ], 'en');
    expect(getAgendaNodeLabel(child, true).main).toBe('Gym · Tu');
    _state.setLang('cs');
    expect(getAgendaNodeLabel(child, true).main).toBe('Gym · Út');
  });

  test('an activity labelled only by its day group still shows a day name', () => {
    const a = mkActivity('a1', 'work', 'work', { label: '(mo)' });
    setUp([mkBranch('work', ['a1']), a], 'cs');
    // stripDayGroups leaves nothing, so the display label carries the abbr
    expect(getAgendaNodeLabel(a, false).main).toBe('(Po)');
  });

  test('node width is measured from the localized label', () => {
    const a = mkActivity('a1', 'work', 'work', { label: 'Gym (mo)' });
    setUp([mkBranch('work', ['a1']), a], 'cs');
    expect(getNodeSize('a1').lines).toEqual(['Gym (Po)']);
    _state.setLang('en');
    computeLayout(); // a language switch re-renders, which drops the size cache
    expect(getNodeSize('a1').lines).toEqual(['Gym (Mo)']);
  });
});
