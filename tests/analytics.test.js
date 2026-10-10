// Umami product events. Each one is derived from a state change the app already
// makes - never from a marker of its own, because storing or reading anything
// on the device purely for analytics would need consent (ePrivacy). These tests
// pin the triggers: what fires, what must not, and that a missing or broken
// tracker can never surface as an error in the app.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import vm from 'node:vm';
import {
  _state,
  sandboxGlobal,
  commitEdit,
  findNode,
  openDB,
  saveWeekIDB,
  loadWeek,
  saveWeek,
  maybeSeedPlayground,
} from './setup.js';

const sb = sandboxGlobal;

function run(code) { return vm.runInContext(code, sb); }

function installTracker(impl) {
  const track = vi.fn(impl || (() => {}));
  sb.window.umami = { track };
  return track;
}

function removeTracker() { delete sb.window.umami; }

function clearQueue() { run('_analyticsQueue.length = 0'); }

function eventNames(track) { return track.mock.calls.map(c => c[0]); }

function mkBranch(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}

function mkActivity(id, parentId, extra = {}) {
  return { id, type: 'activity', branch: parentId, parent: parentId, label: id,
    done: false, unplanned: false, children: [], _ts: 0, ...extra };
}

// Mirrors startAddNode: an empty, editing node pushed under its parent, then
// committed with a label through the real commitEdit.
function addTask(parentId, label, id) {
  const parent = findNode(parentId);
  const node = { id, type: 'activity', branch: parent.branch || parent.id, parent: parentId,
    label: '', done: false, unplanned: false, children: [], _editing: true, _ts: Date.now() };
  const data = _state.get();
  data.nodes.push(node);
  parent.children.push(id);
  _state.set(data);
  _state.setEditState({ nodeId: id, isNew: true, originalLabel: '' }, label);
  commitEdit('none');
}

function seededWeek() {
  const nodes = _state.getPlaygroundSeed().week.nodes.map(n => ({
    ...n, children: [...(n.children || [])], _demo: true, _ts: 1,
  }));
  return { nodes };
}

describe('analytics - app_opened and the pre-load queue', () => {
  afterEach(() => { removeTracker(); clearQueue(); });

  it('holds events raised before the tracker loads and sends app_opened once per page', () => {
    removeTracker();
    clearQueue();
    expect(() => sb.trackEvent('returned_new_week')).not.toThrow();

    const track = installTracker();
    sb.onAnalyticsLoaded();
    sb.onAnalyticsLoaded();
    expect(eventNames(track)).toEqual(['app_opened', 'returned_new_week']);
  });

  it('sends only the UI language, never task content', () => {
    const track = installTracker();
    _state.setLang('cs');
    sb.trackEvent('first_node_created');
    expect(track).toHaveBeenCalledWith('first_node_created', { lang: 'cs' });
    _state.setLang('en');
  });

  it('caps the in-memory queue so an absent tracker cannot grow it', () => {
    removeTracker();
    clearQueue();
    for (let i = 0; i < 50; i++) sb.trackEvent('first_node_created');
    expect(run('_analyticsQueue.length')).toBe(10);
  });

  it('never throws when the tracker throws or rejects', () => {
    installTracker(() => { throw new Error('blocked'); });
    expect(() => sb.trackEvent('app_opened')).not.toThrow();
    installTracker(() => Promise.reject(new Error('offline')));
    expect(() => sb.trackEvent('app_opened')).not.toThrow();
  });

  it('writes nothing to localStorage', () => {
    _state.clearLocalStorage();
    installTracker();
    sb.trackEvent('app_opened');
    removeTracker();
    sb.trackEvent('app_opened');
    expect(Object.keys(sb._lsStore)).toEqual([]);
  });
});

describe('analytics - first_node_created', () => {
  let track;
  beforeEach(() => {
    clearQueue();
    track = installTracker();
    _state.setWeekKey('2026-20');
    _state.reset();
    _state.setLang('en');
  });
  afterEach(() => { removeTracker(); clearQueue(); });

  it('fires when the first task is added to an empty week', () => {
    _state.set({ nodes: [mkBranch('work')] });
    addTask('work', 'Write report', 'u1');
    expect(eventNames(track)).toEqual(['first_node_created']);
  });

  it('does not fire again for the second task', () => {
    _state.set({ nodes: [mkBranch('work')] });
    addTask('work', 'Write report', 'u1');
    addTask('work', 'Call Anna', 'u2');
    addTask('u1', 'Outline', 'u3');
    expect(eventNames(track)).toEqual(['first_node_created']);
  });

  it('does not fire in a week that already holds a task', () => {
    _state.set({ nodes: [mkBranch('work', ['a1']), mkActivity('a1', 'work')] });
    addTask('work', 'Write report', 'u1');
    expect(track).not.toHaveBeenCalled();
  });

  it('ignores the playground seed, untouched or claimed', () => {
    const week = seededWeek();
    // A seed node the user edited loses _demo but is still scaffolding.
    const claimed = week.nodes.find(n => n.type === 'activity');
    delete claimed._demo;
    _state.set(week);
    addTask('work', 'My own task', 'u1');
    expect(eventNames(track)).toEqual(['first_node_created']);
  });

  it('does not count a seed node as the first task', () => {
    _state.set(seededWeek());
    expect(() => sb.noteTaskCreated('nc615d740acdd')).not.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  it('does not fire for a new branch', () => {
    _state.set({ nodes: [mkBranch('work', ['b2']), { ...mkBranch('b2'), parent: 'center', _editing: true, label: '' }] });
    _state.setEditState({ nodeId: 'b2', isNew: true, originalLabel: '' }, 'Health');
    commitEdit('none');
    expect(track).not.toHaveBeenCalled();
  });

  it('does not fire for a rename', () => {
    _state.set({ nodes: [mkBranch('work', ['a1']), mkActivity('a1', 'work')] });
    _state.setEditState({ nodeId: 'a1', isNew: false, originalLabel: 'a1' }, 'Renamed');
    commitEdit('none');
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps the commit working when the tracker is missing or broken', () => {
    removeTracker();
    _state.set({ nodes: [mkBranch('work')] });
    expect(() => addTask('work', 'Write report', 'u1')).not.toThrow();
    expect(findNode('u1').label).toBe('Write report');

    installTracker(() => { throw new Error('blocked'); });
    _state.set({ nodes: [mkBranch('work')] });
    expect(() => addTask('work', 'Another', 'u2')).not.toThrow();
    expect(findNode('u2').label).toBe('Another');
  });
});

describe('analytics - returned_new_week', () => {
  const TODAY = '2026-20';
  let track;

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

  const settle = () => new Promise(r => setTimeout(r, 30));

  async function openAndSave(wk) {
    const data = await loadWeek(wk);
    await saveWeek(wk, data);
    await settle();
    return data;
  }

  beforeEach(async () => {
    _state.useRealIDB(true);
    await clearDb();
    _state.clearLocalStorage();
    _state.setTodayWeekKey(TODAY);
    _state.setWeekKey(TODAY);
    sb.location.hash = '';
    clearQueue();
    track = installTracker();
  });

  afterEach(() => {
    removeTracker();
    clearQueue();
    sb.location.hash = '';
    _state.clearTodayWeekKeyOverride();
    _state.useRealIDB(false);
  });

  it('fires on the first save of this week when an earlier week exists', async () => {
    await saveWeekIDB('2026-18', { nodes: [mkBranch('work', ['a1']), mkActivity('a1', 'work')] });
    await openAndSave(TODAY);
    expect(eventNames(track)).toEqual(['returned_new_week']);
  });

  it('does not fire on later saves or on reopening the week', async () => {
    await saveWeekIDB('2026-19', { nodes: [mkBranch('work')] });
    const data = await openAndSave(TODAY);
    await saveWeek(TODAY, data);
    await openAndSave(TODAY); // a reload: the record is on disk now
    await settle();
    expect(eventNames(track)).toEqual(['returned_new_week']);
  });

  it('does not fire for a first-ever week', async () => {
    await openAndSave(TODAY);
    expect(track).not.toHaveBeenCalled();
  });

  it('does not fire when only a later week exists', async () => {
    await saveWeekIDB('2026-22', { nodes: [mkBranch('work')] });
    await openAndSave(TODAY);
    expect(track).not.toHaveBeenCalled();
  });

  it('does not fire when browsing to a week other than today', async () => {
    await saveWeekIDB('2026-19', { nodes: [mkBranch('work')] });
    await openAndSave('2026-21');
    expect(track).not.toHaveBeenCalled();
  });

  it('does not fire for the playground seed', async () => {
    sb.location.hash = '#playground';
    await maybeSeedPlayground();
    await settle();
    expect(track).not.toHaveBeenCalled();
  });

  it('saves the week even when the tracker is missing', async () => {
    removeTracker();
    await saveWeekIDB('2026-19', { nodes: [mkBranch('work')] });
    await expect(openAndSave(TODAY)).resolves.toBeTruthy();
    expect(run('_analyticsQueue.slice()')).toEqual(['returned_new_week']);
  });
});
