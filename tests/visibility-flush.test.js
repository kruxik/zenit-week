// I7 — hiding the page must leave nothing holding sync open.
//
// A gesture cannot survive the page being hidden, so anything still open at
// that moment is a leak, not an operation: an inline editor parks every remote
// merge, and an atomic op left above zero parks merges and uploads both. The
// device then sits on stale data and never says so.
//
// Teardown is the other half: syncWeekToDrive pulls, merges and pushes, and
// navigation kills the requests in flight. Pending weeks are handed to the
// service worker instead, exactly as the offline branch already does.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { _state, defaultWeekData } from './setup.js';

const QUEUE_KEY = 'zenit-week-offline-uploads';
const WK = '2026-38';

function reset() {
  _state.clearLocalStorage();
  _state.clearIDBStore();
  _state.reset();
  _state.resetSyncState();
  _state.clearPendingRemoteMerge();
  _state.clearOfflineUploadQueue();
  _state.setAtomicOpsDepth(0);
  _state.setEditState(null);
  _state.setWeekKey(WK);
  _state.set(defaultWeekData());
}

describe('visibilitychange → hidden releases every sync hold (I7)', () => {
  beforeEach(reset);
  afterEach(() => {
    _state.useRealAtomicOpGuard(false);
    _state.setAtomicOpsDepth(0);
  });

  test('a stuck atomic op, a parked merge and a parked upload key are all drained', async () => {
    _state.setAtomicOpsDepth(3);
    _state.setPendingRemoteMerge(WK, defaultWeekData());
    _state.addPendingUploadKey('2026-39');

    const uploaded = [];
    await _state.withStubbedUploads(uploaded, async () => {
      _state.fireVisibilityChange('hidden');
    });

    expect(_state.getAtomicOpsDepth()).toBe(0);
    expect(_state.getPendingRemoteMerge()).toBeNull();
    expect(_state.getPendingUploadKeys()).toEqual([]);
  });

  test('an open inline editor is committed before the flush', async () => {
    const data = defaultWeekData();
    const work = data.nodes.find(n => n.id === 'work');
    data.nodes.push({ id: 'e1', type: 'activity', branch: 'work', parent: 'work',
                      label: '', children: [], _editing: true });
    work.children.push('e1');
    _state.set(data);
    _state.setEditState({ nodeId: 'e1', isNew: false, originalLabel: '' }, 'Typed while leaving');

    await _state.withStubbedUploads([], async () => {
      _state.fireVisibilityChange('hidden');
    });

    const e1 = _state.get().nodes.find(n => n.id === 'e1');
    expect(e1.label).toBe('Typed while leaving');
    expect(e1._editing).toBeFalsy();
  });

  test('a drag still in flight is aborted, so its atomic op cannot survive', async () => {
    _state.useRealAtomicOpGuard(true);
    _state.setDragState({ activeNodeId: 'work', initialPositions: { work: { x: 0, y: 0 } } });
    _state.setAtomicOpsDepth(1);

    await _state.withStubbedUploads([], async () => {
      _state.fireVisibilityChange('hidden');
    });

    expect(_state.getDragState().activeNodeId).toBeNull();
    expect(_state.getAtomicOpsDepth()).toBe(0);
  });

  test('the hidden path still uploads directly — the page is alive there', async () => {
    const uploaded = [];
    await _state.withStubbedUploads(uploaded, async () => {
      _state.setSyncDebounceTimer('2026-39');
      _state.fireVisibilityChange('hidden');
    });
    expect(uploaded.sort()).toEqual(['2026-38', '2026-39']);
  });
});

describe('teardown parks instead of uploading', () => {
  beforeEach(async () => {
    reset();
    _state.setDriveFileId(WK, 'file_38');
    _state.setDriveFileId('2026-39', 'file_39');
    await _state.saveWeekIDB(WK, defaultWeekData());
    await _state.saveWeekIDB('2026-39', defaultWeekData());
  });

  test('makes no upload from the page', async () => {
    const uploaded = [];
    await _state.withStubbedUploads(uploaded, async () => {
      _state.setSyncDebounceTimer('2026-39');
      _state.flushOnTeardown();
    });
    expect(uploaded).toEqual([]);
  });

  test('hands the current week and every debounced week to the worker', async () => {
    await _state.withStubbedUploads([], async () => {
      _state.setSyncDebounceTimer('2026-39');
      _state.flushOnTeardown();
    });
    expect(_state.getOfflineUploadQueue().sort()).toEqual(['2026-38', '2026-39']);

    // Parking is async and serialised — let the queue writes settle.
    await _state.offlineQueueSettled();
    const stored = await _state.loadValueIDB(QUEUE_KEY);
    expect((stored || []).map(e => e.weekKey).sort()).toEqual(['2026-38', '2026-39']);
  });

  test('consumes the debounce timers it parked', async () => {
    await _state.withStubbedUploads([], async () => {
      _state.setSyncDebounceTimer('2026-39');
      _state.flushOnTeardown();
    });
    expect(_state.getSyncDebounceTimerKeys()).toEqual([]);
  });

  test('does nothing at all when signed out', async () => {
    _state.setAccessToken(null);
    _state.setSyncDebounceTimer('2026-39');
    _state.flushOnTeardown();
    expect(_state.getOfflineUploadQueue()).toEqual([]);
  });
});
