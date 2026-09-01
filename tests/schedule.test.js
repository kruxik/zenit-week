import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  nextOccurrence,
  occurrencesInRange,
  emptySchedule,
  occurrenceNodeId,
  validateAndRepairSchedule,
  loadSchedule,
  saveSchedule,
  materialiseWeek,
  weekDayStrings,
  validateAndRepair,
  migrateCrdt,
  mergeWeekData,
  genId,
  openDB,
  loadWeekIDB,
  saveWeekIDB,
  listWeekKeysIDB,
  loadValueIDB,
  saveValueIDB,
  _state,
} from './setup.js';

// Minimal entry factory — S1 only exercises the occurrence math, so nothing
// beyond anchor / repeat / end is needed here.
function entry(anchor, repeat = null, end = { type: 'never' }) {
  return { id: 'e1', label: 'Task', branch: 'work', anchor, repeat, end };
}

describe('Occurrence math — units', () => {
  it('repeat null yields exactly the anchor', () => {
    const e = entry('2026-03-31');
    expect(nextOccurrence(e, '2026-01-01')).toBe('2026-03-31');
    expect(nextOccurrence(e, '2026-03-31')).toBe('2026-03-31');
    expect(nextOccurrence(e, '2026-04-01')).toBeNull();
    expect(occurrencesInRange(e, '2026-01-01', '2027-01-01')).toEqual(['2026-03-31']);
  });

  it('steps by day', () => {
    const e = entry('2026-03-01', { every: 3, unit: 'day' });
    expect(occurrencesInRange(e, '2026-03-01', '2026-03-12'))
      .toEqual(['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10']);
  });

  it('steps by week', () => {
    const e = entry('2026-03-02', { every: 2, unit: 'week' });
    expect(occurrencesInRange(e, '2026-03-01', '2026-04-15'))
      .toEqual(['2026-03-02', '2026-03-16', '2026-03-30', '2026-04-13']);
  });

  it('steps by month', () => {
    const e = entry('2026-01-15', { every: 1, unit: 'month' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-04-30'))
      .toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('steps by year', () => {
    const e = entry('2026-03-31', { every: 1, unit: 'year' });
    expect(occurrencesInRange(e, '2026-01-01', '2029-12-31'))
      .toEqual(['2026-03-31', '2027-03-31', '2028-03-31', '2029-03-31']);
  });

  it('accepts any positive N', () => {
    const e = entry('2026-01-01', { every: 45, unit: 'day' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-05-01'))
      .toEqual(['2026-01-01', '2026-02-15', '2026-04-01']);
  });

  it('treats a non-positive or unknown repeat as no repeat', () => {
    expect(occurrencesInRange(entry('2026-01-01', { every: 0, unit: 'day' }), '2026-01-01', '2026-03-01'))
      .toEqual(['2026-01-01']);
    expect(occurrencesInRange(entry('2026-01-01', { every: 2, unit: 'fortnight' }), '2026-01-01', '2026-03-01'))
      .toEqual(['2026-01-01']);
  });
});

describe('Occurrence math — month-end clamping', () => {
  it('clamps 31 Jan into February and returns to 31 March', () => {
    const e = entry('2026-01-31', { every: 1, unit: 'month' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-06-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  });

  it('clamps into a leap February and still returns to 31 March', () => {
    const e = entry('2028-01-31', { every: 1, unit: 'month' });
    expect(occurrencesInRange(e, '2028-01-01', '2028-03-31'))
      .toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('never permanently shifts the anchor across a long run', () => {
    const e = entry('2026-01-31', { every: 1, unit: 'month' });
    const dates = occurrencesInRange(e, '2026-01-01', '2027-12-31');
    // Every 31-day month still lands on the 31st two years later.
    expect(dates).toContain('2027-01-31');
    expect(dates).toContain('2027-12-31');
    expect(dates).toContain('2027-02-28');
  });

  it('clamps a 29 February anchor on non-leap years', () => {
    const e = entry('2024-02-29', { every: 1, unit: 'year' });
    expect(occurrencesInRange(e, '2024-01-01', '2028-12-31'))
      .toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('handles a 2-year interval crossing a leap year', () => {
    const e = entry('2026-02-28', { every: 2, unit: 'year' });
    expect(occurrencesInRange(e, '2026-01-01', '2032-12-31'))
      .toEqual(['2026-02-28', '2028-02-28', '2030-02-28', '2032-02-28']);
    const leap = entry('2024-02-29', { every: 2, unit: 'year' });
    expect(occurrencesInRange(leap, '2024-01-01', '2030-12-31'))
      .toEqual(['2024-02-29', '2026-02-28', '2028-02-29', '2030-02-28']);
  });
});

describe('Occurrence math — end conditions', () => {
  it('never runs out with end never', () => {
    const e = entry('2026-01-01', { every: 1, unit: 'year' }, { type: 'never' });
    expect(nextOccurrence(e, '2126-01-01')).toBe('2126-01-01');
  });

  it('counts the anchor as the first of N', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'week' }, { type: 'count', n: 3 });
    expect(occurrencesInRange(e, '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(nextOccurrence(e, '2026-01-20')).toBeNull();
  });

  it('exhausts count mid-range', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'day' }, { type: 'count', n: 1 });
    expect(occurrencesInRange(e, '2026-01-01', '2026-01-31')).toEqual(['2026-01-05']);
  });

  it('yields nothing when count is below one', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'day' }, { type: 'count', n: 0 });
    expect(nextOccurrence(e, '2026-01-01')).toBeNull();
    expect(occurrencesInRange(e, '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('treats until as inclusive', () => {
    const e = entry('2026-01-05', { every: 1, unit: 'week' }, { type: 'until', date: '2026-01-19' });
    expect(occurrencesInRange(e, '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(nextOccurrence(e, '2026-01-19')).toBe('2026-01-19');
    expect(nextOccurrence(e, '2026-01-20')).toBeNull();
  });
});

describe('Occurrence math — dates and robustness', () => {
  it('returns the anchor when fromDate precedes it', () => {
    const e = entry('2026-06-15', { every: 1, unit: 'month' });
    expect(nextOccurrence(e, '2020-01-01')).toBe('2026-06-15');
  });

  it('crosses both DST boundaries without losing or repeating a day', () => {
    // Europe/Prague springs forward on 2026-03-29 and falls back on 2026-10-25.
    const e = entry('2026-03-27', { every: 1, unit: 'day' });
    expect(occurrencesInRange(e, '2026-03-27', '2026-03-31'))
      .toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(occurrencesInRange(e, '2026-10-23', '2026-10-27'))
      .toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('walks a whole year of daily occurrences with no gap or repeat', () => {
    // 2028 is a leap year: 366 distinct, strictly ascending, contiguous dates.
    const dates = occurrencesInRange(entry('2028-01-01', { every: 1, unit: 'day' }), '2028-01-01', '2028-12-31');
    expect(dates).toHaveLength(366);
    expect(new Set(dates).size).toBe(366);
    expect(dates[59]).toBe('2028-02-29');
    expect(dates[365]).toBe('2028-12-31');
    for (let i = 1; i < dates.length; i++) expect(dates[i] > dates[i - 1]).toBe(true);
  });

  it('rejects an invalid anchor or bound instead of throwing', () => {
    expect(nextOccurrence(entry('2026-02-30'), '2026-01-01')).toBeNull();
    expect(nextOccurrence(entry('not-a-date'), '2026-01-01')).toBeNull();
    expect(nextOccurrence(null, '2026-01-01')).toBeNull();
    expect(nextOccurrence(entry('2026-01-01'), '2026-13-01')).toBeNull();
    expect(occurrencesInRange(entry('2026-01-01'), '2026-01-01', 'nope')).toEqual([]);
  });

  it('returns an empty range when the bounds are inverted', () => {
    const e = entry('2026-01-01', { every: 1, unit: 'day' });
    expect(occurrencesInRange(e, '2026-02-01', '2026-01-01')).toEqual([]);
  });

  it('returns a single-day range when from equals to', () => {
    const e = entry('2026-01-01', { every: 1, unit: 'day' });
    expect(occurrencesInRange(e, '2026-05-05', '2026-05-05')).toEqual(['2026-05-05']);
  });
});

describe('Schedule store — validate and repair', () => {
  const good = () => ({
    id: 's1', label: 'Tax return', branch: 'work', priority: 'high',
    anchor: '2026-03-31', repeat: { every: 1, unit: 'year' }, end: { type: 'never' },
    plantedThrough: '2026-03-29', planted: ['2026-03-31'], _ts: 1234,
  });

  it('returns an empty schedule for a missing or junk record', () => {
    expect(validateAndRepairSchedule(null, ['work'])).toEqual(emptySchedule());
    expect(validateAndRepairSchedule(undefined, ['work'])).toEqual(emptySchedule());
    expect(validateAndRepairSchedule('nope', ['work'])).toEqual(emptySchedule());
    expect(validateAndRepairSchedule({}, ['work'])).toEqual(emptySchedule());
  });

  it('keeps a well-formed entry verbatim', () => {
    const out = validateAndRepairSchedule({ entries: [good()], tombstones: [], crdtVersion: 3 }, ['work', 'me']);
    expect(out.entries).toEqual([good()]);
    expect(out.crdtVersion).toBe(3);
  });

  it('drops entries with no label or no valid anchor', () => {
    const raw = { entries: [
      good(),
      { ...good(), id: 's2', label: '' },
      { ...good(), id: 's3', label: '   ' },
      { ...good(), id: 's4', label: 42 },
      { ...good(), id: 's5', anchor: '2026-02-30' },
      { ...good(), id: 's6', anchor: 'whenever' },
      { ...good(), id: 's7', anchor: undefined },
      { ...good(), id: undefined },
      null,
    ] };
    expect(validateAndRepairSchedule(raw, ['work']).entries.map(e => e.id)).toEqual(['s1']);
  });

  it('re-homes an entry whose branch no longer exists onto the first branch', () => {
    const raw = { entries: [{ ...good(), branch: 'deleted-branch' }] };
    expect(validateAndRepairSchedule(raw, ['me', 'work']).entries[0].branch).toBe('me');
  });

  it('leaves the branch alone when the branch list is unknown', () => {
    const raw = { entries: [{ ...good(), branch: 'deleted-branch' }] };
    expect(validateAndRepairSchedule(raw, []).entries[0].branch).toBe('deleted-branch');
  });

  it('never deletes an entry just because its branch went away', () => {
    const raw = { entries: [{ ...good(), branch: 'gone' }, { ...good(), id: 's2', branch: 7 }] };
    const out = validateAndRepairSchedule(raw, ['work']);
    expect(out.entries.map(e => e.id)).toEqual(['s1', 's2']);
    expect(out.entries.every(e => e.branch === 'work')).toBe(true);
  });

  it('coerces repeat.every to a positive integer', () => {
    const cases = [
      [{ every: 3, unit: 'day' }, { every: 3, unit: 'day' }],
      [{ every: '4', unit: 'week' }, { every: 4, unit: 'week' }],
      [{ every: 2.9, unit: 'month' }, { every: 2, unit: 'month' }],
      [{ every: 0, unit: 'year' }, { every: 1, unit: 'year' }],
      [{ every: -5, unit: 'day' }, { every: 1, unit: 'day' }],
      [{ every: 'lots', unit: 'day' }, { every: 1, unit: 'day' }],
      [{ unit: 'day' }, { every: 1, unit: 'day' }],
    ];
    for (const [input, want] of cases) {
      expect(validateAndRepairSchedule({ entries: [{ ...good(), repeat: input }] }, ['work']).entries[0].repeat)
        .toEqual(want);
    }
  });

  it('drops a repeat with an unknown unit down to a one-off', () => {
    for (const repeat of [{ every: 2, unit: 'fortnight' }, { every: 2 }, 'weekly', 5]) {
      expect(validateAndRepairSchedule({ entries: [{ ...good(), repeat }] }, ['work']).entries[0].repeat)
        .toBeNull();
    }
  });

  it('normalises end conditions and falls back to never', () => {
    const end = (v) => validateAndRepairSchedule({ entries: [{ ...good(), end: v }] }, ['work']).entries[0].end;
    expect(end({ type: 'count', n: 5 })).toEqual({ type: 'count', n: 5 });
    expect(end({ type: 'count', n: '5' })).toEqual({ type: 'count', n: 5 });
    expect(end({ type: 'until', date: '2030-01-01' })).toEqual({ type: 'until', date: '2030-01-01' });
    expect(end({ type: 'count', n: 0 })).toEqual({ type: 'never' });
    expect(end({ type: 'until', date: '2030-02-31' })).toEqual({ type: 'never' });
    expect(end({ type: 'forever' })).toEqual({ type: 'never' });
    expect(end(undefined)).toEqual({ type: 'never' });
  });

  it('normalises the cursor fields', () => {
    const out = validateAndRepairSchedule({ entries: [{
      ...good(),
      plantedThrough: 'someday',
      planted: ['2026-05-05', 'nope', '2026-01-01', '2026-05-05', 17],
      _ts: 'recently',
    }] }, ['work']).entries[0];
    expect(out.plantedThrough).toBeNull();
    expect(out.planted).toEqual(['2026-01-01', '2026-05-05']);
    expect(out._ts).toBe(0);
  });

  it('sanitises priority and clips an over-long label', () => {
    const out = validateAndRepairSchedule({ entries: [
      { ...good(), priority: 'urgent' },
      { ...good(), id: 's2', label: 'x'.repeat(500) },
    ] }, ['work']).entries;
    expect(out[0].priority).toBe('normal');
    expect(out[1].label).toHaveLength(200);
  });

  it('drops tombstoned and duplicate entries', () => {
    const raw = {
      entries: [good(), { ...good(), label: 'Dupe' }, { ...good(), id: 's2' }],
      tombstones: ['s2', 's2', 3, ''],
    };
    const out = validateAndRepairSchedule(raw, ['work']);
    expect(out.entries.map(e => e.id)).toEqual(['s1']);
    expect(out.entries[0].label).toBe('Tax return');
    expect(out.tombstones).toEqual(['s2']);
  });

  it('carries no unknown fields through from a tampered record', () => {
    // JSON.parse, not a literal: a literal __proto__ key sets the prototype
    // instead of creating the own property a tampered Drive file would carry.
    const tampered = JSON.parse('{"__proto__":{"polluted":true},"evil":"<img onerror=1>"}');
    const raw = { entries: [Object.assign(tampered, good())] };
    const out = validateAndRepairSchedule(raw, ['work']).entries[0];
    expect(out.evil).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual([
      '_ts', 'anchor', 'branch', 'end', 'id', 'label', 'planted', 'plantedThrough', 'priority', 'repeat',
    ]);
  });
});

describe('Schedule store — occurrenceNodeId', () => {
  it('is deterministic for the same inputs', () => {
    expect(occurrenceNodeId('s1', '2026-03-31')).toBe(occurrenceNodeId('s1', '2026-03-31'));
  });

  it('is shaped exactly like a genId() result', () => {
    const shape = /^n[0-9a-f]{12}$/;
    expect(occurrenceNodeId('s1', '2026-03-31')).toMatch(shape);
    expect(genId()).toMatch(shape);
    for (const d of ['2026-01-01', '2026-12-31', '2030-06-15']) {
      expect(occurrenceNodeId('entry-with-a-very-long-identifier', d)).toMatch(shape);
    }
  });

  it('separates the entry id from the date so neighbours cannot collide', () => {
    expect(occurrenceNodeId('s1', '2026-03-31')).not.toBe(occurrenceNodeId('s1 2026', '-03-31'));
    expect(occurrenceNodeId('s1', '2026-03-31')).not.toBe(occurrenceNodeId('s2', '2026-03-31'));
    expect(occurrenceNodeId('s1', '2026-03-31')).not.toBe(occurrenceNodeId('s1', '2026-04-01'));
  });

  it('produces distinct ids across a decade of daily occurrences', () => {
    const ids = new Set();
    let n = 0;
    for (const entryId of ['s1', 's2', 's3']) {
      for (const date of occurrencesInRange(
        { id: entryId, anchor: '2026-01-01', repeat: { every: 1, unit: 'day' }, end: { type: 'never' } },
        '2026-01-01', '2035-12-31')) {
        ids.add(occurrenceNodeId(entryId, date));
        n++;
      }
    }
    expect(n).toBeGreaterThan(3000);
    expect(ids.size).toBe(n);
  });
});

describe('Schedule store — persistence', () => {
  beforeEach(async () => {
    _state.useRealIDB(true);
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['weeks', 'misc'], 'readwrite');
      tx.objectStore('weeks').clear();
      tx.objectStore('misc').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    _state.clearLocalStorage();
    _state.setSchedule(emptySchedule());
    _state.set({ nodes: [
      { id: 'center', type: 'center' },
      { id: 'work', type: 'branch', parent: 'center', label: 'Work', children: [] },
      { id: 'me', type: 'branch', parent: 'center', label: 'Me', children: [] },
    ] });
  });

  afterEach(() => {
    _state.useRealIDB(false);
    _state.setSchedule(emptySchedule());
  });

  it('returns an empty schedule when no record exists, without throwing', async () => {
    await expect(loadSchedule()).resolves.toEqual(emptySchedule());
  });

  it('round-trips entries through IndexedDB', async () => {
    const entry = {
      id: 's1', label: 'Roadworthy check', branch: 'me', priority: 'critical',
      anchor: '2026-09-14', repeat: { every: 2, unit: 'year' }, end: { type: 'count', n: 5 },
      plantedThrough: null, planted: [], _ts: 99,
    };
    expect(await saveSchedule({ entries: [entry], tombstones: [], crdtVersion: 1 })).toBe(true);
    _state.setSchedule(emptySchedule());
    const loaded = await loadSchedule();
    expect(loaded.entries).toEqual([entry]);
    expect(loaded.crdtVersion).toBe(1);
  });

  it('repairs a corrupt stored record instead of throwing', async () => {
    await saveValueIDB('schedule', { entries: [
      { id: 's1', label: 'Keep me', branch: 'ghost', anchor: '2026-05-01', repeat: { every: '2', unit: 'week' } },
      { id: 's2', label: '', anchor: '2026-05-01' },
    ], tombstones: 'not an array' });
    const loaded = await loadSchedule();
    expect(loaded.entries.map(e => e.id)).toEqual(['s1']);
    expect(loaded.entries[0].branch).toBe('work'); // re-homed onto the first branch
    expect(loaded.entries[0].repeat).toEqual({ every: 2, unit: 'week' });
    expect(loaded.tombstones).toEqual([]);
  });

  it('turns a stored value that is not a record into an empty schedule', async () => {
    await saveValueIDB('schedule', 'garbage');
    expect(await loadSchedule()).toEqual(emptySchedule());
    await saveValueIDB('schedule', 42);
    expect(await loadSchedule()).toEqual(emptySchedule());
  });

  it('writes the schedule without writing any week record', async () => {
    await saveWeekIDB('2026-20', { nodes: [{ id: 'center', type: 'center' }] });
    const before = await loadWeekIDB('2026-20');
    await saveSchedule({ entries: [{
      id: 's1', label: 'Bill', branch: 'work', priority: 'normal', anchor: '2026-05-20',
      repeat: null, end: { type: 'never' }, plantedThrough: null, planted: [], _ts: 1,
    }], tombstones: [], crdtVersion: 0 });
    expect(await loadWeekIDB('2026-20')).toEqual(before);
    expect(await listWeekKeysIDB()).toEqual(['2026-20']);
  });

  it('writes a week record without touching the schedule', async () => {
    await saveSchedule({ entries: [{
      id: 's1', label: 'Bill', branch: 'work', priority: 'normal', anchor: '2026-05-20',
      repeat: null, end: { type: 'never' }, plantedThrough: null, planted: [], _ts: 1,
    }], tombstones: [], crdtVersion: 0 });
    const before = await loadValueIDB('schedule');
    await saveWeekIDB('2026-21', { nodes: [{ id: 'center', type: 'center' }] });
    expect(await loadValueIDB('schedule')).toEqual(before);
  });
});

describe('Materialisation on week open', () => {
  // 2026-W20 runs Mon 2026-05-11 … Sun 2026-05-17.
  const WK = '2026-20';

  const week = () => ({
    nodes: [
      { id: 'center', type: 'center', children: ['work', 'me'] },
      { id: 'work', type: 'branch', branch: 'work', parent: 'center', label: 'Work', children: [], side: 'left' },
      { id: 'me', type: 'branch', branch: 'me', parent: 'center', label: 'Me', children: [], side: 'right' },
    ],
    tombstones: [],
    crdtVersion: 0,
  });

  const entry = (over = {}) => ({
    id: 's1', label: 'Tax return', branch: 'work', priority: 'normal',
    anchor: '2026-05-13', repeat: null, end: { type: 'never' },
    plantedThrough: null, planted: [], _ts: 1,
    ...over,
  });

  const seed = (...entries) => _state.setSchedule({ entries, tombstones: [], crdtVersion: 0 });
  const occurrences = (data) => data.nodes.filter(n => n.schedId);

  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
    _state.setSchedule(emptySchedule());
    _state.setWeekKey(WK);
  });

  afterEach(() => _state.setSchedule(emptySchedule()));

  it('knows the seven local dates of a week, Monday first', () => {
    expect(weekDayStrings(WK)).toEqual([
      '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17',
    ]);
  });

  it('plants a due occurrence under its branch on the right weekday', () => {
    seed(entry());
    const data = week();
    expect(materialiseWeek(WK, data)).toBe(true);

    const node = data.nodes.find(n => n.schedId === 's1');
    expect(node.type).toBe('activity');
    expect(node.label).toBe('Tax return');
    expect(node.parent).toBe('work');
    expect(node.schedDate).toBe('2026-05-13');
    expect(data.nodes.find(n => n.id === 'work').children).toContain(node.id);

    const leaf = data.nodes.find(n => n.dayChild);
    expect(leaf.parent).toBe(node.id);
    expect(leaf.dayIndex).toBe(3); // 2026-05-13 is a Wednesday
    expect(node.children).toEqual([leaf.id]);
  });

  it('carries the entry priority onto the occurrence', () => {
    seed(entry({ priority: 'critical' }));
    const data = week();
    materialiseWeek(WK, data);
    expect(data.nodes.find(n => n.schedId === 's1').priority).toBe('critical');
    expect(data.nodes.find(n => n.dayChild).priority).toBe('critical');
  });

  it('plants nothing when the occurrence falls outside the week', () => {
    seed(entry({ anchor: '2026-05-18' }));
    const data = week();
    expect(materialiseWeek(WK, data)).toBe(false);
    expect(occurrences(data)).toEqual([]);
  });

  it('leaves a week with no entries byte-identical', () => {
    const data = week();
    const before = JSON.stringify(data);
    expect(materialiseWeek(WK, data)).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('plants every occurrence of a repeating entry that falls in the week', () => {
    seed(entry({ anchor: '2026-05-11', repeat: { every: 2, unit: 'day' } }));
    const data = week();
    materialiseWeek(WK, data);
    expect(occurrences(data).map(n => n.schedDate))
      .toEqual(['2026-05-11', '2026-05-13', '2026-05-15', '2026-05-17']);
  });

  it('is idempotent: a second pass plants nothing', () => {
    seed(entry());
    const data = week();
    materialiseWeek(WK, data);
    const after = JSON.stringify(data);
    expect(materialiseWeek(WK, data)).toBe(false);
    expect(JSON.stringify(data)).toBe(after);
    expect(occurrences(data)).toHaveLength(1);
  });

  it('never returns a tombstoned occurrence', () => {
    seed(entry());
    const data = week();
    materialiseWeek(WK, data);
    const node = data.nodes.find(n => n.schedId === 's1');
    const leaf = data.nodes.find(n => n.dayChild);
    data.nodes = data.nodes.filter(n => n.id !== node.id && n.id !== leaf.id);
    data.tombstones = [node.id, leaf.id];

    expect(materialiseWeek(WK, data)).toBe(false);
    expect(occurrences(data)).toEqual([]);
  });

  it('re-homes an occurrence whose branch is missing from this week', () => {
    seed(entry({ branch: 'deleted' }));
    const data = week();
    materialiseWeek(WK, data);
    const node = data.nodes.find(n => n.schedId === 's1');
    expect(node.parent).toBe('work');
    expect(data.nodes.find(n => n.id === 'work').children).toContain(node.id);
  });

  it('plants nothing into a week that has no branches at all', () => {
    seed(entry());
    const data = { nodes: [{ id: 'center', type: 'center', children: [] }], tombstones: [], crdtVersion: 0 };
    expect(materialiseWeek(WK, data)).toBe(false);
  });

  it('records the date in planted without advancing plantedThrough', () => {
    const e = entry();
    seed(e);
    materialiseWeek(WK, week());
    expect(e.planted).toEqual(['2026-05-13']);
    expect(e.plantedThrough).toBeNull();
  });

  it('does not re-record a date already listed as planted', () => {
    const e = entry({ planted: ['2026-05-13'] });
    seed(e);
    materialiseWeek(WK, week());
    expect(e.planted).toEqual(['2026-05-13']);
  });

  it('lets the day win over an Nx label, as a hand-typed "(we)" would', () => {
    seed(entry({ label: 'Pushups 10x' }));
    const data = week();
    materialiseWeek(WK, data);
    const node = data.nodes.find(n => n.schedId === 's1');
    expect(node.label).toBe('Pushups 10x');
    expect(data.nodes.filter(n => n.tickChild)).toEqual([]);
    expect(data.nodes.filter(n => n.dayChild)).toHaveLength(1);
  });

  it('converges on one node when two devices materialise the same week alone', () => {
    seed(entry());
    const a = week();
    const b = week();
    materialiseWeek(WK, a);
    materialiseWeek(WK, b);
    a.savedAt = 1000;
    b.savedAt = 2000;

    const merged = mergeWeekData(a, b);
    expect(merged.nodes.filter(n => n.schedId === 's1')).toHaveLength(1);
    expect(merged.nodes.filter(n => n.dayChild)).toHaveLength(1);
    const node = merged.nodes.find(n => n.schedId === 's1');
    expect(node.schedDate).toBe('2026-05-13');
    expect(node.children).toHaveLength(1);
  });

  it('carries schedId and schedDate through validateAndRepair', () => {
    seed(entry());
    const data = week();
    materialiseWeek(WK, data);
    const repaired = validateAndRepair(JSON.parse(JSON.stringify(data)));
    const node = repaired.nodes.find(n => n.id === data.nodes.find(x => x.schedId).id);
    expect(node.schedId).toBe('s1');
    expect(node.schedDate).toBe('2026-05-13');
    expect(repaired.nodes.find(n => n.dayChild).dayIndex).toBe(3);
  });

  it('carries schedId and schedDate through a Drive round-trip', () => {
    seed(entry());
    const data = week();
    materialiseWeek(WK, data);
    data.savedAt = 1000;
    // Serialise → parse → migrate → merge, the shape a Drive pull takes.
    const remote = migrateCrdt(JSON.parse(JSON.stringify(data)));
    const merged = mergeWeekData(week(), remote);
    const node = merged.nodes.find(n => n.schedId === 's1');
    expect(node).toBeDefined();
    expect(node.schedDate).toBe('2026-05-13');
    expect(node._ts).toBeGreaterThan(0);
  });

  it('takes no undo snapshot', () => {
    seed(entry());
    _state.reset();
    materialiseWeek(WK, week());
    expect(_state.getUndoStack()).toHaveLength(0);
  });

  it('plants once no matter how the week is opened, and saves the week', async () => {
    seed(entry());
    _state.setLocalStorage('zenit-week-' + WK, week());
    _state.setWeekKey('2026-19');

    await _state.loadAndRender(WK);
    expect(occurrences(_state.get())).toHaveLength(1);

    // Reopening from the persisted record must not plant a second copy.
    await _state.loadAndRender('2026-19');
    await _state.loadAndRender(WK);
    expect(occurrences(_state.get())).toHaveLength(1);
    expect(_state.get().nodes.filter(n => n.dayChild)).toHaveLength(1);
  });

  it('leaves a week untouched on open when the schedule is empty', async () => {
    _state.setLocalStorage('zenit-week-' + WK, week());
    _state.setWeekKey('2026-19');
    await _state.loadAndRender(WK);
    expect(occurrences(_state.get())).toEqual([]);
    expect(_state.get().nodes.filter(n => n.dayChild)).toEqual([]);
  });
});
