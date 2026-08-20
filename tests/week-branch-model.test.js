// A new week copies its branches from the week the user last shaped — the
// previous week is the role model. The lookup is nearest-first, so opening a
// week across a gap (or before every week that exists) still lands on the
// user's own branches instead of the defaults.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { _state, saveWeekIDB, deleteWeekIDB, listWeekKeysIDB, loadWeek, defaultWeekData, weekKeysByProximity } from './setup.js';

const mkBranch = (id, label, side = 'left') =>
  ({ id, type: 'branch', branch: id, label, children: [], side, _ts: 0 });

// The user's own layout: one renamed default, one branch of their own, and the
// rest of the defaults gone.
const shaped = () => ({
  nodes: [mkBranch('work', 'Job'), mkBranch('nb1', 'Garden', 'right')],
  tombstones: [],
  crdtVersion: 1,
});

describe('New week inherits the branches of the last shaped week', () => {
  beforeEach(async () => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.reset();
    _state.useRealIDB(true);
    // fake-indexeddb outlives a single test — start each one on an empty store.
    for (const wk of await listWeekKeysIDB()) await deleteWeekIDB(wk);
  });
  afterEach(() => _state.useRealIDB(false));

  test('copies the branches of the immediately previous week', async () => {
    await saveWeekIDB('2026-30', shaped());
    const fresh = await loadWeek('2026-31');
    expect(fresh.nodes.map(n => n.label)).toEqual(['Job', 'Garden']);
    expect(fresh.nodes.every(n => n.children.length === 0)).toBe(true);
  });

  test('reaches back across a gap of empty weeks', async () => {
    await saveWeekIDB('2026-30', shaped());
    const fresh = await loadWeek('2026-35');
    expect(fresh.nodes.map(n => n.id)).toEqual(['work', 'nb1']);
  });

  test('falls forward when every stored week is later', async () => {
    await saveWeekIDB('2026-30', shaped());
    const fresh = await loadWeek('2026-20');
    expect(fresh.nodes.map(n => n.id)).toEqual(['work', 'nb1']);
  });

  test('prefers the nearest earlier week over a nearer later one', async () => {
    await saveWeekIDB('2026-29', shaped());
    await saveWeekIDB('2026-31', {
      nodes: [mkBranch('later', 'Later')], tombstones: [], crdtVersion: 1,
    });
    const fresh = await loadWeek('2026-30');
    expect(fresh.nodes.map(n => n.id)).toEqual(['work', 'nb1']);
  });

  test('falls back to the playground defaults when nothing is stored', async () => {
    const fresh = await loadWeek('2026-30');
    expect(fresh.nodes.map(n => n.id)).toEqual(defaultWeekData().nodes.map(n => n.id));
  });
});

describe('weekKeysByProximity', () => {
  it('orders earlier weeks nearest-first, then later ones', () => {
    const keys = ['2026-20', '2026-28', '2026-32', '2026-40'];
    expect(weekKeysByProximity(keys, '2026-30')).toEqual(['2026-28', '2026-20', '2026-32', '2026-40']);
  });

  it('crosses a year boundary by rank, not by string', () => {
    expect(weekKeysByProximity(['2025-52', '2026-05'], '2026-01')).toEqual(['2025-52', '2026-05']);
  });

  it('drops the target week itself', () => {
    expect(weekKeysByProximity(['2026-30', '2026-31'], '2026-30')).toEqual(['2026-31']);
  });

  it('returns nothing for an unparseable target', () => {
    expect(weekKeysByProximity(['2026-30'], 'not-a-week')).toEqual([]);
  });
});
