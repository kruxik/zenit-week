import {
  resolveMagicDayTokens, parseTodoDays, hasNowToken,
  commitEdit, defaultWeekData, findNode,
  _state,
} from './setup.js';

function mkBranch(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}

function mkActivity(id, parentId, branchId, extra = {}) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0, ...extra };
}

function setUp(nodes) {
  _state.set({ nodes });
  _state.setWeekKey('2026-01');
  _state.reset();
  _state.setLang('en');
}

function triggerCommitEdit(nodeId, inputLabel) {
  const node = findNode(nodeId);
  _state.setEditState({ nodeId, isNew: false, originalLabel: node?.label ?? '' }, inputLabel);
  commitEdit('none');
}

// Thursday in 2026 — Date.getDay() returns 4
const THURSDAY = new Date('2026-05-14T12:00:00');
// Saturday — wraps tomorrow to Sunday (0)
const SATURDAY = new Date('2026-05-16T12:00:00');

describe('resolveMagicDayTokens', () => {
  test('(today) on Thursday EN → (Th)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Workout (today)', THURSDAY)).toBe('Workout (Th)');
  });

  test('(today) on Thursday CS → (Čt)', () => {
    _state.setLang('cs');
    expect(resolveMagicDayTokens('Workout (today)', THURSDAY)).toBe('Workout (Čt)');
  });

  test('(dnes) on Thursday EN → (Th) (CS token works in EN locale)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Workout (dnes)', THURSDAY)).toBe('Workout (Th)');
  });

  test('(tomorrow) on Thursday EN → (Fr)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Workout (tomorrow)', THURSDAY)).toBe('Workout (Fr)');
  });

  test('(zítra) on Thursday CS → (Pá)', () => {
    _state.setLang('cs');
    expect(resolveMagicDayTokens('Workout (zítra)', THURSDAY)).toBe('Workout (Pá)');
  });

  test('(zitra) without diacritic on Thursday CS → (Pá)', () => {
    _state.setLang('cs');
    expect(resolveMagicDayTokens('Workout (zitra)', THURSDAY)).toBe('Workout (Pá)');
  });

  test('(tomorrow) on Saturday wraps to (Su)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Workout (tomorrow)', SATURDAY)).toBe('Workout (Su)');
  });

  test('case-insensitive: (TODAY)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Workout (TODAY)', THURSDAY)).toBe('Workout (Th)');
  });

  test('mixed group: (today, mo) on Thursday → (Th, mo)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Run (today, mo)', THURSDAY)).toBe('Run (Th, mo)');
  });

  test('two groups: (today)(tomorrow) both resolved', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('A (today) B (tomorrow)', THURSDAY))
      .toBe('A (Th) B (Fr)');
  });

  test('idempotent — already-frozen label passes through unchanged', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Run (Th)', THURSDAY)).toBe('Run (Th)');
  });

  test('non-magic group untouched', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Sprint (v3)', THURSDAY)).toBe('Sprint (v3)');
  });

  test('preserves separator style: comma+space', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Run (today, tomorrow)', THURSDAY))
      .toBe('Run (Th, Fr)');
  });

  test('preserves separator style: spaces only', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Run (today tomorrow)', THURSDAY))
      .toBe('Run (Th Fr)');
  });
});

describe('resolveMagicDayTokens — (now)/(teď)', () => {
  test('(now) on Thursday EN → (Th)', () => {
    _state.setLang('en');
    expect(resolveMagicDayTokens('Call mom (now)', THURSDAY)).toBe('Call mom (Th)');
  });

  test('(teď) on Thursday CS → (Čt)', () => {
    _state.setLang('cs');
    expect(resolveMagicDayTokens('Call mom (teď)', THURSDAY)).toBe('Call mom (Čt)');
  });

  test('(ted) without diacritic on Thursday CS → (Čt)', () => {
    _state.setLang('cs');
    expect(resolveMagicDayTokens('Call mom (ted)', THURSDAY)).toBe('Call mom (Čt)');
  });
});

describe('hasNowToken', () => {
  test('detects (now)', () => { expect(hasNowToken('A (now)')).toBe(true); });
  test('detects (teď)', () => { expect(hasNowToken('A (teď)')).toBe(true); });
  test('detects (ted)', () => { expect(hasNowToken('A (ted)')).toBe(true); });
  test('detects case-insensitive', () => { expect(hasNowToken('A (NOW)')).toBe(true); });
  test('detects in mixed group', () => { expect(hasNowToken('A (mo, now)')).toBe(true); });
  test('no match on (today)', () => { expect(hasNowToken('A (today)')).toBe(false); });
  test('no match outside group', () => { expect(hasNowToken('Snow plow')).toBe(false); });
});

// Test helper to install a deterministic Date during commitEdit
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

function mkBranchT(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}
function mkActivityT(id, parentId, branchId, extra = {}) {
  return { id, type: 'activity', branch: branchId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0, ...extra };
}
function setUpT(nodes, weekKey) {
  _state.set({ nodes });
  _state.setWeekKey(weekKey);
  _state.reset();
  _state.setLang('en');
}
function triggerCommitEditT(nodeId, inputLabel) {
  const node = findNode(nodeId);
  _state.setEditState({ nodeId, isNew: false, originalLabel: node?.label ?? '' }, inputLabel);
  commitEdit('none');
}

describe('(now) pins to top of today\'s agenda group', () => {
  // ISO week containing Thursday 2026-05-14 = 2026-W20
  const CURRENT_WEEK = '2026-20';

  test('pending node prepended to pending group on today\'s tab', () => {
    setUpT([
      mkBranchT('me', ['a1', 'a2']),
      mkActivityT('a1', 'me', 'me'),
      mkActivityT('a2', 'me', 'me'),
    ], CURRENT_WEEK);
    // Pre-seed agendaOrder with a2 first
    const wd = _state.get();
    wd.agendaOrder = { '4-pending': { ids: ['a2'], ts: 1 } };
    _state.set(wd);

    withFrozenDate(THURSDAY, () => triggerCommitEditT('a1', 'Workout (now)'));

    const order = _state.get().agendaOrder['4-pending'];
    expect(order.ids).toEqual(['a1', 'a2']);
  });

  test('done node prepended to done group, not pending', () => {
    setUpT([
      mkBranchT('me', ['a1']),
      mkActivityT('a1', 'me', 'me', { done: true }),
    ], CURRENT_WEEK);

    withFrozenDate(THURSDAY, () => triggerCommitEditT('a1', 'Workout (now)'));

    const orders = _state.get().agendaOrder || {};
    expect(orders['4-done']?.ids).toEqual(['a1']);
    expect(orders['4-pending']?.ids ?? []).not.toContain('a1');
  });

  test('label is also frozen to (Th) — same as (today)', () => {
    setUpT([mkBranchT('me', ['a1']), mkActivityT('a1', 'me', 'me')], CURRENT_WEEK);
    withFrozenDate(THURSDAY, () => triggerCommitEditT('a1', 'Workout (now)'));
    expect(findNode('a1').label).toBe('Workout (Th)');
  });

  test('cross-week edit does NOT pin', () => {
    // Edit a node in a DIFFERENT week than real-world today.
    // todayWeekKey is stubbed in test setup to fall back to currentWeekKey
    // when no override is set — so to simulate "today is W20, editing W22"
    // we set the override explicitly.
    setUpT([mkBranchT('me', ['a1']), mkActivityT('a1', 'me', 'me')], '2026-22');
    _state.setTodayWeekKey('2026-20');
    try {
      withFrozenDate(THURSDAY, () => triggerCommitEditT('a1', 'Workout (now)'));
      // Label still freezes
      expect(findNode('a1').label).toBe('Workout (Th)');
      // No agendaOrder entry created
      const orders = _state.get().agendaOrder || {};
      expect(orders['4-pending']).toBeUndefined();
      expect(orders['4-done']).toBeUndefined();
    } finally {
      _state.clearTodayWeekKeyOverride();
    }
  });

  test('mixed (now, mo) freezes both tokens; pins only on today\'s tab', () => {
    setUpT([mkBranchT('me', ['a1']), mkActivityT('a1', 'me', 'me')], CURRENT_WEEK);
    withFrozenDate(THURSDAY, () => triggerCommitEditT('a1', 'Run (now, mo)'));
    // Multi-day annotation: applyMagicLabel strips the group and creates day-children
    // — so the parent label loses the group, but two day-children appear under it.
    const a1 = findNode('a1');
    expect(a1.label).toBe('Run');
    const dayChildren = a1.children.map(findNode).filter(n => n?.dayChild);
    expect(dayChildren.map(n => n.dayIndex).sort()).toEqual([1, 4]);
    // Pinning still targets today (Th = index 4) only — Monday tab unaffected
    const orders = _state.get().agendaOrder;
    expect(orders['4-pending']?.ids).toEqual(['a1']);
    expect(orders['1-pending']).toBeUndefined();
  });

  test('re-edit moves node back to top, deduped', () => {
    setUpT([
      mkBranchT('me', ['a1', 'a2']),
      mkActivityT('a1', 'me', 'me'),
      mkActivityT('a2', 'me', 'me'),
    ], CURRENT_WEEK);
    const wd = _state.get();
    // Existing order: a2, a1 (a1 second)
    wd.agendaOrder = { '4-pending': { ids: ['a2', 'a1'], ts: 1 } };
    _state.set(wd);

    withFrozenDate(THURSDAY, () => triggerCommitEditT('a1', 'Workout (now)'));

    const order = _state.get().agendaOrder['4-pending'];
    expect(order.ids).toEqual(['a1', 'a2']);
  });
});

describe('commitEdit freezes magic relative-day tokens', () => {
  test('(today) rename on Thursday EN becomes single-day annotation (Th)', () => {
    setUp([mkBranch('me', ['a1']), mkActivity('a1', 'me', 'me')]);
    _state.setLang('en');
    // commitEdit reads real time; force it by stubbing Date momentarily
    const RealDate = global.Date;
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate(THURSDAY.getTime());
        return new RealDate(...args);
      }
      static now() { return THURSDAY.getTime(); }
    };
    try {
      triggerCommitEdit('a1', 'Workout (today)');
    } finally {
      global.Date = RealDate;
    }
    const node = findNode('a1');
    expect(node.label).toBe('Workout (Th)');
    // Day annotation is parseable post-freeze
    expect([...parseTodoDays(node.label)]).toEqual([4]);
  });
});
