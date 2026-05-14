import {
  resolveMagicDayTokens, parseTodoDays,
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
