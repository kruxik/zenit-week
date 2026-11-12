import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { _state, openDB, saveWeekIDB, saveValueIDB, switchView } from './setup.js';

// The Vision's first-open tip is the coachmarks' to test; here it would only
// sit over the view and take the first Esc.
beforeEach(() => _state.setTipsSeen({ vision: true }));

// V opens the Vision and W cycles the view level - the letter moved in the
// same change, so neither is ever unbound or doubly bound. Week navigation and
// the day digits are inert on the Vision, and Esc backs out of it.

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');
const WK = '2026-45';
const vb = (id, children = []) => ({ id, type: 'branch', branch: id, label: 'Area', children, side: 'left', _ts: 1 });

function press(key, extra = {}) {
  _state.triggerKeydown({
    key, preventDefault: () => {}, stopPropagation: () => {},
    target: { tagName: 'DIV' },
    metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra,
  });
}
// The swap reads IndexedDB, so a hotkey's switch lands a few macrotasks later.
// Waits until no swap is in flight (the record and the view agree), bounded.
const settle = async () => {
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 2));
    const vision = _state.getCurrentView() === 'vision';
    if (vision === (_state.getMapKind() === 'vision') && !_state.isSwapPending()) return;
  }
};

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
  _state.resetSyncState();
  _state.setMapKind('week');
  _state.setCurrentView('mindmap');
  _state.setEditState(null);
  _state.setHoveredNode(null);
  _state.setWindowInnerWidth(1280);
  _state.setWeekKey(WK);
  _state.setViewLevel('full');
  _state.setDayFilter(null);
  await saveWeekIDB(WK, { nodes: [vb('work')], tombstones: [], crdtVersion: 1 });
  await saveValueIDB('vision', { nodes: [vb('nvb1')], tombstones: [], crdtVersion: 1 });
  _state.set({ nodes: [vb('work')], tombstones: [], crdtVersion: 1 });
});

afterEach(() => _state.useRealIDB(false));

describe('V and W', () => {
  it('V opens the Vision from the Mindmap, the Agenda and Stats', async () => {
    for (const from of ['mindmap', 'agenda', 'stats']) {
      if (from !== 'mindmap') { switchView(from); }
      press('v');
      await settle();
      expect(_state.getCurrentView()).toBe('vision');
      expect(_state.getMapKind()).toBe('vision');
      await switchView('mindmap');
    }
  });

  it('M and A leave the Vision', async () => {
    await switchView('vision');
    press('m');
    await settle();
    expect(_state.getCurrentView()).toBe('mindmap');
    await switchView('vision');
    press('a');
    await settle();
    expect(_state.getCurrentView()).toBe('agenda');
    expect(_state.getMapKind()).toBe('week');
  });

  it('V no longer cycles the view level', () => {
    press('v');
    expect(_state.getViewLevel()).toBe('full');
  });

  it('W cycles the view level on the Mindmap and on the Vision', async () => {
    press('w');
    expect(_state.getViewLevel()).toBe('rocks');
    _state.setViewLevel('full');
    await switchView('vision');
    press('w');
    expect(_state.getViewLevel()).toBe('rocks');
  });

  it('Help and the tips name W for the view level and V for the Vision', () => {
    expect(SRC).toMatch(/data-i18n="help\.cycleViewLevel">[^<]*<\/span> <kbd>W<\/kbd>/);
    expect(SRC).toMatch(/data-i18n="help\.visionView">[^<]*<\/span> <kbd>V<\/kbd>/);
    expect(SRC).toMatch(/\{ k: 'W', labelKey: 'help\.cycleViewLevel' \}/);
    expect(SRC).not.toMatch(/\{ k: 'V', labelKey: 'help\.cycleViewLevel' \}/);
  });
});

describe('inert on the Vision', () => {
  beforeEach(async () => { await switchView('vision'); });

  it('[, ], Shift+arrows and T do not move the week', async () => {
    _state.setTodayWeekKey('2026-50');
    for (const [k, extra] of [['['], [']'], ['ArrowLeft', { shiftKey: true }], ['ArrowRight', { shiftKey: true }], ['t']]) {
      press(k, extra);
      await settle();
      expect(_state.getWeekKey()).toBe(WK);
      expect(_state.getCurrentView()).toBe('vision');
    }
    _state.clearTodayWeekKeyOverride();
  });

  it('the day digits set no filter', () => {
    for (const d of ['0', '1', '5', '8']) press(d);
    expect(_state.getDayFilter()).toBeNull();
  });
});

describe('Esc', () => {
  it('backs out of the Vision to the Mindmap, with the week', async () => {
    await switchView('vision');
    press('Escape');
    await settle();
    expect(_state.getCurrentView()).toBe('mindmap');
    expect(_state.getMapKind()).toBe('week');
  });

  it('clears the focus ring before leaving the Vision', async () => {
    await switchView('vision');
    _state.setKbFocusId('nvb1');
    press('Escape');
    expect(_state.getCurrentView()).toBe('vision');
    press('Escape');
    await settle();
    expect(_state.getCurrentView()).toBe('mindmap');
  });
});

describe('view persistence', () => {
  it('the Vision is persisted as the view', async () => {
    await switchView('vision');
    expect(_state.getLocalStorage('zenit-week-view')).toBe('vision');
  });
});
