// The Start view setting and the paths that used to knock the Vision off the
// remembered view: a fresh start opens the setting, view switches store
// nothing, a reload mid-swap comes back to its destination, the quiet update
// reload waits for a view that is still loading, and a week rollover on the
// Vision keeps the person on it.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  _state, switchView, sanitizeColorsData, isAppQuiescent, checkDateRollover,
  openDB, saveWeekIDB, saveValueIDB,
} from './setup.js';

const sb = _state.sandbox;

describe('Start view setting', () => {
  beforeEach(() => { _state.clearLocalStorage(); });

  test('defaults to the Vision', () => {
    expect(sb.startViewPref()).toBe('vision');
  });

  test('stores a known view and ignores anything else', () => {
    sb.setStartViewPref('agenda');
    expect(sb.startViewPref()).toBe('agenda');
    sb.setStartViewPref('settings');
    expect(sb.startViewPref()).toBe('agenda');
  });

  test('travels in the colors blob, unknown values dropped', () => {
    expect(sanitizeColorsData({ startView: 'stats' }).startView).toBe('stats');
    expect(sanitizeColorsData({ startView: 'bogus' }).startView).toBeUndefined();
  });

  test('the startView field is never read as a branch', () => {
    const out = sanitizeColorsData({ startView: 'stats', work: { main: '#F24E1E' } });
    expect(Object.keys(out).sort()).toEqual(['startView', 'work']);
  });
});

describe('quiet update reload', () => {
  test('waits while a view is still loading', () => {
    const r = isAppQuiescent({
      hasEditingNode: false, isPanning: false, atomicOpsDepth: 0,
      pendingUploadCount: 0, openPanel: null, viewLoading: true,
    });
    expect(r).toEqual({ quiescent: false, reason: 'view-loading' });
  });
});

describe('week rollover on the Vision', () => {
  const vb = (id) => ({ id, type: 'branch', branch: id, label: 'Area', children: [], side: 'left', _ts: 1 });
  const settle = async () => {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 2));
      const vision = _state.getCurrentView() === 'vision';
      if (vision === (_state.getMapKind() === 'vision') && !_state.isSwapPending()) return;
    }
  };

  beforeEach(async () => {
    _state.setTipsSeen({ vision: true });
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
    _state.setWindowInnerWidth(1280);
    _state.setWeekKey('2026-30');
    _state.clearTodayWeekKeyOverride();
    await saveWeekIDB('2026-30', { nodes: [vb('work')], tombstones: [], crdtVersion: 1 });
    await saveWeekIDB('2026-31', { nodes: [vb('home')], tombstones: [], crdtVersion: 1 });
    await saveValueIDB('vision', { nodes: [vb('nvb1')], tombstones: [], crdtVersion: 1 });
    _state.set({ nodes: [vb('work')], tombstones: [], crdtVersion: 1 });
  });

  afterEach(() => { _state.useRealIDB(false); _state.clearTodayWeekKeyOverride(); });

  test('keeps the Vision, moves the week bar, and opens the new week on the way back', async () => {
    await switchView('vision');
    await settle();
    _state.setLastKnownDate(1, '2026-30');
    _state.setTodayWeekKey('2026-31');
    checkDateRollover();
    expect(_state.getCurrentView()).toBe('vision');
    expect(_state.getMapKind()).toBe('vision');
    expect(_state.getWeekKey()).toBe('2026-31');

    await switchView('mindmap');
    await settle();
    expect(_state.getMapKind()).toBe('week');
    expect(_state.sandbox.findNode('home')).toBeTruthy();
  });
});
