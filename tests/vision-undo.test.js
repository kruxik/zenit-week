import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _state, openDB, saveWeekIDB, loadWeekIDB, saveValueIDB, loadValueIDB,
  switchView, takeSnapshot, undo, redo, saveMapRecord, BRANCH_COLORS,
} from './setup.js';

// Two stack pairs: Ctrl+Z on the Vision undoes only Vision edits, and the
// week's history waits untouched while the Vision is open.

const WK = '2026-45';
const vb = (id, children = []) => ({ id, type: 'branch', branch: id, label: 'Area', children, side: 'left', _ts: 1 });
const act = (id, parent, extra = {}) => ({ id, type: 'activity', branch: parent, parent, label: id, children: [], _ts: 1, ...extra });
const labelOf = id => _state.get().nodes.find(n => n.id === id)?.label;

// An edit as the UI makes it: snapshot, change, save.
async function edit(id, label) {
  takeSnapshot();
  _state.get().nodes.find(n => n.id === id).label = label;
  await saveMapRecord();
}

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
  const week = { nodes: [vb('work', ['w1']), act('w1', 'work')], tombstones: [], crdtVersion: 1 };
  await saveWeekIDB(WK, structuredClone(week));
  await saveValueIDB('vision', { nodes: [vb('nvb1', ['v1']), act('v1', 'nvb1')], tombstones: [], crdtVersion: 1 });
  _state.set(structuredClone(week));
  BRANCH_COLORS.nvb1 = { main: '#123456', light: '#eee', text: '#111' };
});

afterEach(() => _state.useRealIDB(false));

describe('vision stack pair', () => {
  it('a vision edit goes on the vision stack, never on the week stack', async () => {
    await switchView('vision');
    await edit('v1', 'why');
    expect(_state.getVisionUndoStack()).toHaveLength(1);
    expect(_state.getUndoStack()).toHaveLength(0);
    expect(JSON.parse(_state.getVisionUndoStack()[0])).not.toHaveProperty('nextWeekRaw');
    expect(JSON.parse(_state.getVisionUndoStack()[0])).not.toHaveProperty('scheduleRaw');
  });

  it('undo and redo on the Vision restore the vision and never write a week', async () => {
    await switchView('vision');
    const weekBefore = JSON.stringify(await loadWeekIDB(WK));
    await edit('v1', 'why');
    await undo();
    expect(labelOf('v1')).toBe('v1');
    expect((await loadValueIDB('vision')).nodes.find(n => n.id === 'v1').label).toBe('v1');
    await redo();
    expect(labelOf('v1')).toBe('why');
    expect(JSON.stringify(await loadWeekIDB(WK))).toBe(weekBefore);
  });

  it('undo of an added intention buries it so a merge cannot bring it back', async () => {
    await switchView('vision');
    takeSnapshot();
    const v = _state.get();
    v.nodes.push(act('v2', 'nvb1'));
    v.nodes.find(n => n.id === 'nvb1').children.push('v2');
    await saveMapRecord();
    await undo();
    expect(_state.get().nodes.some(n => n.id === 'v2')).toBe(false);
    expect(_state.get().tombstones).toContain('v2');
  });
});

describe('the week pair survives the Vision', () => {
  it('week history is untouched by a round trip through the Vision', async () => {
    await edit('w1', 'week edit');
    expect(_state.getUndoStack()).toHaveLength(1);
    await switchView('vision');
    await edit('v1', 'vision edit');
    await undo();                       // undoes the vision edit only
    expect(_state.getUndoStack()).toHaveLength(1);
    await switchView('mindmap');
    expect(labelOf('w1')).toBe('week edit');
    await undo();                       // now the week edit
    expect(labelOf('w1')).toBe('w1');
  });

  it('the vision stacks wait while the week is in view', async () => {
    await switchView('vision');
    await edit('v1', 'vision edit');
    await switchView('mindmap');
    await undo();                       // nothing on the week stack
    await switchView('vision');
    expect(labelOf('v1')).toBe('vision edit');
    expect(_state.getVisionUndoStack()).toHaveLength(1);
  });

  it('a week undo never deletes a vision branch colour', async () => {
    delete BRANCH_COLORS.nvb1;
    await edit('w1', 'week edit');      // this snapshot knows no vision colour
    BRANCH_COLORS.nvb1 = { main: '#123456', light: '#eee', text: '#111' };  // seeded after it
    await undo();
    expect(BRANCH_COLORS.nvb1?.main).toBe('#123456');
  });
});
