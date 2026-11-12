import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _state,
  openDB,
  saveWeekIDB,
  loadWeekIDB,
  saveValueIDB,
  loadValueIDB,
  switchView,
  saveMapRecord,
  isWeekInMemory,
  mergeWeekData,
  weekContentHash,
  applyRemoteMerge,
  onPeerWeekSaved,
  takeSnapshot,
} from './setup.js';

// The Vision's first-open tip is the coachmarks' to test; here it would only
// sit over the view and take the first Esc.
beforeEach(() => _state.setTipsSeen({ vision: true }));

// R1: weekData holds the vision if and only if the Vision is the view, and the
// swap happens before anything is drawn. R2: nothing else puts a week into
// weekData while the Vision is open.

const WK = '2026-45';
const vb = (id, children = []) => ({ id, type: 'branch', branch: id, label: 'Area', children, side: 'left', _ts: 1 });
const act = (id, parent, extra = {}) => ({ id, type: 'activity', branch: parent, parent, label: id, children: [], _ts: 1, ...extra });
const weekRec = (extra = []) => ({ nodes: [vb('work', ['w1', ...extra.map(n => n.id)]), act('w1', 'work'), ...extra], tombstones: [], crdtVersion: 1, savedAt: 1 });
const visionRec = () => ({ nodes: [vb('nvb1', ['v1']), act('v1', 'nvb1')], tombstones: [], crdtVersion: 1, savedAt: 1 });
const ids = () => _state.get().nodes.map(n => n.id).sort();

beforeEach(async () => {
  // Real IndexedDB (fake-indexeddb): loadWeek, saveWeek and the Drive merge
  // must all meet in one store for "leaving reloads from IDB" to mean anything.
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
  _state.resetSyncState();
  _state.setMapKind('week');
  _state.setCurrentView('mindmap');
  _state.clearPendingRemoteMerge();
  _state.setWindowInnerWidth(1280);
  _state.setWeekKey(WK);
  await saveWeekIDB(WK, weekRec());
  await saveValueIDB('vision', visionRec());
  _state.set(weekRec());
});

afterEach(() => _state.useRealIDB(false));

describe('R1 - the record follows the view', () => {
  it('entering the Vision puts the vision in weekData in the same step as the view', async () => {
    const p = switchView('vision');
    // Not yet: the view has not flipped either.
    expect(_state.getCurrentView()).toBe('mindmap');
    expect(ids()).toContain('w1');
    await p;
    expect(_state.getCurrentView()).toBe('vision');
    expect(_state.getMapKind()).toBe('vision');
    expect(ids()).toEqual(['nvb1', 'v1']);
  });

  it('leaving the Vision for any week view brings the week back', async () => {
    for (const view of ['mindmap', 'agenda']) {
      await switchView('vision');
      await switchView(view);
      expect(_state.getCurrentView()).toBe(view);
      expect(_state.getMapKind()).toBe('week');
      expect(ids()).toEqual(['w1', 'work']);
    }
  });

  it('switching between week views does not swap and stays synchronous', () => {
    expect(switchView('agenda')).toBeUndefined();
    expect(_state.getMapKind()).toBe('week');
  });

  it('leaving reloads the week from IndexedDB, not from what was in memory', async () => {
    await switchView('vision');
    await saveWeekIDB(WK, weekRec([act('w2', 'work')]));
    await switchView('mindmap');
    expect(ids()).toEqual(['w1', 'w2', 'work']);
  });

  it('a later switch overtakes an earlier one still loading', async () => {
    const a = switchView('vision');
    const b = switchView('mindmap');
    await Promise.all([a, b]);
    expect(_state.getCurrentView()).toBe('mindmap');
    expect(_state.getMapKind()).toBe('week');
    expect(ids()).toEqual(['w1', 'work']);
  });

  it('currentWeekKey is untouched by the Vision', async () => {
    await switchView('vision');
    expect(_state.getWeekKey()).toBe(WK);
    await switchView('mindmap');
    expect(_state.getWeekKey()).toBe(WK);
  });
});

describe('saveMapRecord', () => {
  it('saves the week on a week view', async () => {
    _state.get().nodes.find(n => n.id === 'w1').label = 'edited';
    await saveMapRecord();
    expect((await loadWeekIDB(WK)).nodes.find(n => n.id === 'w1').label).toBe('edited');
  });

  it('saves the vision on the Vision and never writes the week', async () => {
    await switchView('vision');
    const weekBefore = JSON.stringify(await loadWeekIDB(WK));
    _state.get().nodes.find(n => n.id === 'v1').label = 'why';
    await saveMapRecord();
    expect((await loadValueIDB('vision')).nodes.find(n => n.id === 'v1').label).toBe('why');
    expect(JSON.stringify(await loadWeekIDB(WK))).toBe(weekBefore);
  });
});

describe('R2 - week writers while the Vision is open', () => {
  it('isWeekInMemory is false for the current week while the Vision is open', async () => {
    expect(isWeekInMemory(WK)).toBe(true);
    await switchView('vision');
    expect(isWeekInMemory(WK)).toBe(false);
  });

  it('a Drive week merge goes to IndexedDB only and is on the map after leaving', async () => {
    await switchView('vision');
    const remote = weekRec([act('w9', 'work', { _ts: 50 })]);
    const merged = mergeWeekData(structuredClone(await loadWeekIDB(WK)), remote, WK);
    await applyRemoteMerge(WK, merged, JSON.stringify(merged), weekContentHash(merged), false, remote);
    expect(ids()).toEqual(['nvb1', 'v1']);
    expect((await loadWeekIDB(WK)).nodes.some(n => n.id === 'w9')).toBe(true);
    await switchView('mindmap');
    expect(ids()).toContain('w9');
  });

  it('a peer tab saving the current week never merges into the vision', async () => {
    await switchView('vision');
    await saveWeekIDB(WK, weekRec([act('w3', 'work')]));
    await onPeerWeekSaved({ type: 'week-saved', wk: WK, sig: 'peer' });
    expect(ids()).toEqual(['nvb1', 'v1']);
  });

  it('the week stacks take nothing while the Vision is open', async () => {
    await switchView('vision');
    const before = _state.getUndoStack ? _state.getUndoStack().length : null;
    takeSnapshot();
    if (before !== null) expect(_state.getUndoStack().length).toBe(before);
  });
});
