import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _state,
  openDB,
  loadWeekIDB,
  saveWeekIDB,
  listWeekKeysIDB,
  loadValueIDB,
  maybeSeedPlayground,
  BRANCH_COLORS,
} from './setup.js';

const TODAY = '2026-20';

async function clearDb() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['weeks', 'misc'], 'readwrite');
    tx.objectStore('weeks').clear();
    tx.objectStore('misc').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('Onboarding playground seed (S1)', () => {
  beforeEach(async () => {
    _state.useRealIDB(true);
    await clearDb();
    _state.clearLocalStorage();
    _state.setTodayWeekKey(TODAY);
    _state.sandbox.location.hash = '';
  });

  afterEach(() => {
    _state.sandbox.location.hash = '';
    _state.clearTodayWeekKeyOverride();
    _state.useRealIDB(false);
  });

  it('seeds the current week on an empty database', async () => {
    const seeded = await maybeSeedPlayground();
    expect(seeded).toBe(true);

    const keys = await listWeekKeysIDB();
    expect(keys).toEqual([TODAY]);

    const week = await loadWeekIDB(TODAY);
    expect(week.nodes.length).toBe(46);
    expect(week.nodes.every(n => n._demo === true)).toBe(true);
    expect(week.nodes.every(n => typeof n._ts === 'number')).toBe(true);
    expect(week.tombstones).toEqual([]);
    expect(week.crdtVersion).toBe(0);
  });

  it('applies branch colors including the custom Growth green', async () => {
    await maybeSeedPlayground();
    expect(BRANCH_COLORS.growth.main).toBe('#0ACF83');
    expect(BRANCH_COLORS.work.main).toBe('#F24E1E');
    const saved = await loadValueIDB('zenit-week-colors');
    expect(saved.growth.main).toBe('#0ACF83');
  });

  it('sets the onboarded flag and does not re-seed on a second call', async () => {
    expect(await maybeSeedPlayground()).toBe(true);
    expect(await loadValueIDB('zenit-week-onboarded')).toBe(true);

    // Second call is a no-op even though the DB now has exactly the seeded week.
    expect(await maybeSeedPlayground()).toBe(false);
    const keys = await listWeekKeysIDB();
    expect(keys).toEqual([TODAY]);
  });

  it('does not seed when the database already has weeks (no #playground)', async () => {
    await saveWeekIDB('2026-19', { nodes: [], tombstones: [], crdtVersion: 1 });
    const seeded = await maybeSeedPlayground();
    expect(seeded).toBe(false);
    expect(await loadWeekIDB(TODAY)).toBeNull();
  });

  it('seeds via #playground when the current week is absent (existing other weeks)', async () => {
    await saveWeekIDB('2026-19', { nodes: [], tombstones: [], crdtVersion: 1 });
    _state.sandbox.location.hash = '#playground';
    const seeded = await maybeSeedPlayground();
    expect(seeded).toBe(true);
    const week = await loadWeekIDB(TODAY);
    expect(week.nodes.length).toBe(46);
  });

  it('does not clobber existing current-week data, even with #playground', async () => {
    const mine = { nodes: [{ id: 'x', type: 'activity', branch: 'work', label: 'My task' }], tombstones: [], crdtVersion: 3 };
    await saveWeekIDB(TODAY, mine);
    _state.sandbox.location.hash = '#playground';

    const seeded = await maybeSeedPlayground();
    expect(seeded).toBe(false);
    const week = await loadWeekIDB(TODAY);
    expect(week.nodes).toHaveLength(1);
    expect(week.nodes[0].label).toBe('My task');
    expect(await loadValueIDB('zenit-week-onboarded')).toBeFalsy();
  });
});
