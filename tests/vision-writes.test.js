import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _state, openDB, saveWeekIDB, saveValueIDB, switchView,
  setStatus, toggleReusableNode, setActivityDays, setTickDay, sendNodeToDate,
  moveNodeToWeek, transferUnfinished, transferReusable, clearWeek, weekActionClearWeek,
  openBaselinePanel, applyDayReschedule, updateCounter, createTask, applyLabelEdit,
  setHorizon, nodeDisplayLabel, showContextMenu,
} from './setup.js';

// The Vision's first-open tip is the coachmarks' to test; here it would only
// sit over the view and take the first Esc.
beforeEach(() => _state.setTipsSeen({ vision: true }));

// What the week map offers that has no meaning on the Vision is refused at the
// function: no change, no snapshot, no toast. Label magic is off. Drop and
// Undone are Let go and Take back, and horizon is a Vision-only content field.

const WK = '2026-45';
const vb = (id, children = []) => ({ id, type: 'branch', branch: id, label: 'Area', children, side: 'left', _ts: 1 });
const act = (id, parent, extra = {}) => ({ id, type: 'activity', branch: 'nvb1', parent, label: id, children: [], _ts: 1, ...extra });
const node = id => _state.get().nodes.find(n => n.id === id);
const record = () => JSON.stringify(_state.get().nodes);

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
  _state.reset();
  _state.setMapKind('week');
  _state.setCurrentView('mindmap');
  _state.setWindowInnerWidth(1280);
  _state.setWeekKey(WK);
  const week = { nodes: [vb('work')], tombstones: [], crdtVersion: 1 };
  await saveWeekIDB(WK, structuredClone(week));
  await saveValueIDB('vision', {
    nodes: [vb('nvb1', ['p']), act('p', 'nvb1', { children: ['k1', 'k2'] }), act('k1', 'p'), act('k2', 'p')],
    tombstones: [], crdtVersion: 1,
  });
  _state.set(structuredClone(week));
  await switchView('vision');
  _state.clearToast();
});

afterEach(() => _state.useRealIDB(false));

describe('inert week-only functions', () => {
  const inert = [
    ['setStatus done', () => setStatus('k1', 'done')],
    ['setStatus undone', () => setStatus('k1', 'undone')],
    ['setStatus unplanned', () => setStatus('k1', 'unplanned')],
    ['setStatus planned', () => setStatus('k1', 'planned')],
    ['toggleReusableNode', () => toggleReusableNode('k1')],
    ['setActivityDays', () => setActivityDays('k1', new Set([1]))],
    ['setTickDay', () => setTickDay('k1', 2)],
    ['sendNodeToDate', () => sendNodeToDate('k1', { date: '2026-12-24' })],
    ['moveNodeToWeek', () => moveNodeToWeek('k1')],
    ['transferUnfinished', () => transferUnfinished()],
    ['transferReusable', () => transferReusable()],
    ['clearWeek', () => clearWeek(false)],
    ['weekActionClearWeek', () => weekActionClearWeek()],
    ['openBaselinePanel', () => openBaselinePanel(0, 0)],
    ['applyDayReschedule', () => applyDayReschedule('k1', 'set', { currentDays: [], newDayIndex: 1 })],
    ['updateCounter', () => updateCounter('k1', 1)],
  ];
  for (const [name, call] of inert) {
    it(`${name} changes nothing, takes no snapshot and shows no toast`, async () => {
      const before = record();
      await call();
      expect(record()).toBe(before);
      expect(_state.getVisionUndoStack()).toHaveLength(0);
      expect(_state.getUndoStack()).toHaveLength(0);
      expect(_state.getToastText()).toBe('');
    });
  }
});

describe('label magic is off', () => {
  it('"Run 3x" stays a literal label with no tick leaves', () => {
    const n = createTask('nvb1', 'Pushups 10x');
    expect(n.label).toBe('Pushups 10x');
    expect(n.children).toEqual([]);
    expect(_state.get().nodes.some(x => x.tickChild)).toBe(false);
  });

  it('"(mo)" stays text, with no day leaf, and is displayed as written', () => {
    const n = createTask('nvb1', 'Run (mo)');
    expect(n.label).toBe('Run (mo)');
    expect(_state.get().nodes.some(x => x.dayChild)).toBe(false);
    expect(nodeDisplayLabel(n)).toBe('Run (mo)');
  });

  it('a rename is literal too, relative-day tokens included', () => {
    applyLabelEdit('k1', 'Visit tomorrow 3x');
    expect(node('k1').label).toBe('Visit tomorrow 3x');
    expect(node('k1').children).toEqual([]);
  });
});

describe('Let go and Take back', () => {
  it('Let go cascades to the subtree and says so', () => {
    setStatus('p', 'dropped');
    expect(node('p').dropped).toBe(true);
    expect(node('k1').dropped).toBe(true);
    expect(node('k2').dropped).toBe(true);
    expect(_state.getToastText()).toBe('Let go');
    expect(_state.getVisionUndoStack()).toHaveLength(1);
  });

  it('letting go of every child lets go of the parent', () => {
    setStatus('k1', 'dropped');
    setStatus('k2', 'dropped');
    expect(node('p').dropped).toBe(true);
    expect(node('p').done).toBeFalsy();
  });

  it('Take back reopens the subtree', () => {
    setStatus('p', 'dropped');
    setStatus('p', 'undropped');
    expect(node('p').dropped).toBeFalsy();
    expect(node('k1').dropped).toBeFalsy();
    expect(_state.getToastText()).toBe('Taken back');
  });

  it('U takes back a let-go node and does nothing on an open one', () => {
    const press = (key) => _state.triggerKeydown({
      key, preventDefault: () => {}, stopPropagation: () => {}, target: { tagName: 'DIV' },
      metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    });
    _state.setHoveredNode('k1');
    press('u');
    expect(node('k1').unplanned).toBeFalsy();
    expect(_state.getVisionUndoStack()).toHaveLength(0);
    press('x');
    expect(node('k1').dropped).toBe(true);
    press('u');
    expect(node('k1').dropped).toBeFalsy();
    press('d');
    expect(node('k1').done).toBeFalsy();
    _state.setHoveredNode(null);
  });
});

describe('horizon', () => {
  it('sets, changes and clears, one snapshot each, as content', () => {
    const ts = node('k1')._ts;
    expect(setHorizon('k1', 'someday')).toBe(true);
    expect(node('k1').horizon).toBe('someday');
    expect(node('k1')._ts).toBeGreaterThan(ts);
    expect(setHorizon('k1', 'year')).toBe(true);
    expect(setHorizon('k1', null)).toBe(true);
    expect(node('k1')).not.toHaveProperty('horizon');
    expect(_state.getVisionUndoStack()).toHaveLength(3);
  });

  it('setting the current value is a no-op', () => {
    setHorizon('k1', 'years');
    expect(setHorizon('k1', 'years')).toBe(false);
    expect(_state.getVisionUndoStack()).toHaveLength(1);
  });

  it('is independent of Let go and inherited by nothing', () => {
    setHorizon('p', 'years');
    setStatus('p', 'dropped');
    expect(node('p').horizon).toBe('years');
    expect(node('k1').horizon).toBeUndefined();
  });

  it('is refused on a week', async () => {
    await switchView('mindmap');
    expect(setHorizon('work', 'year')).toBe(false);
  });
});

describe('context menu on the Vision', () => {
  const shown = () => {
    const ids = ['ctx-done', 'ctx-undone', 'ctx-dropped', 'ctx-unplanned', 'ctx-reusable', 'ctx-reschedule',
      'ctx-reset', 'ctx-transfer-unfinished', 'ctx-transfer-reusable', 'ctx-clear-week', 'ctx-set-baseline',
      'ctx-clear-day-filter', 'ctx-prio-normal', 'ctx-prio-high', 'ctx-prio-critical',
      'ctx-horizon-year', 'ctx-horizon-years', 'ctx-horizon-someday', 'ctx-horizon-none',
      'ctx-rename', 'ctx-comment', 'ctx-add-child', 'ctx-change-color', 'ctx-delete'];
    return ids.filter(id => _state.getElement(id).style.display !== 'none');
  };

  it('an open intention offers Let go, priority, horizon and the edit items, no week item', () => {
    showContextMenu(10, 10, 'k1');
    const s = shown();
    expect(s).toEqual(expect.arrayContaining(['ctx-dropped', 'ctx-prio-high', 'ctx-prio-critical',
      'ctx-horizon-year', 'ctx-horizon-years', 'ctx-horizon-someday', 'ctx-rename', 'ctx-comment', 'ctx-delete']));
    for (const week of ['ctx-done', 'ctx-unplanned', 'ctx-reusable', 'ctx-reschedule', 'ctx-reset',
      'ctx-transfer-unfinished', 'ctx-clear-week', 'ctx-set-baseline', 'ctx-undone', 'ctx-prio-normal', 'ctx-horizon-none']) {
      expect(s).not.toContain(week);
    }
  });

  it('a let-go intention offers Take back instead, under the Vision words', () => {
    setStatus('k1', 'dropped');
    showContextMenu(10, 10, 'k1');
    expect(shown()).toContain('ctx-undone');
    expect(shown()).not.toContain('ctx-dropped');
  });

  it('a branch offers rename, add, colour and delete only', () => {
    showContextMenu(10, 10, 'nvb1');
    expect(shown().sort()).toEqual(['ctx-add-child', 'ctx-change-color', 'ctx-rename'].sort());
  });
});
