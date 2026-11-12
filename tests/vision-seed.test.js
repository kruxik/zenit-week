import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { _state, seedVisionFromWeek, loadVisionForView, BRANCH_COLORS } from './setup.js';

// The first open of the Vision seeds it with the areas of the week in view -
// and only when neither this device nor Drive holds a vision.

const branch = (id, label, side) => ({ id, type: 'branch', branch: id, label, side, children: [], _ts: 1 });
const week = () => ({
  nodes: [
    { ...branch('work', 'Work', 'left'), children: ['a1'] },
    branch('nhealth00001', 'Health', 'right'),
    { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Ship it', children: [], _ts: 1 },
  ],
  tombstones: [], crdtVersion: 1,
});

beforeEach(() => {
  _state.clearIDBStore();
  _state.resetSyncState();
  BRANCH_COLORS.work = { main: '#F24E1E', light: '#fde', text: '#300' };
  BRANCH_COLORS.nhealth00001 = { main: '#0ACF83', light: '#efe', text: '#030' };
});

describe('seedVisionFromWeek', () => {
  it('copies labels and sides under new ids, and no activity', () => {
    const { record, colorFrom } = seedVisionFromWeek(week());
    expect(record.nodes.map(n => n.label)).toEqual(['Work', 'Health']);
    expect(record.nodes.map(n => n.side)).toEqual(['left', 'right']);
    expect(record.nodes.every(n => n.type === 'branch' && n.children.length === 0)).toBe(true);
    for (const n of record.nodes) {
      expect(['work', 'nhealth00001']).not.toContain(n.id);
      expect(n.branch).toBe(n.id);
    }
    expect(Object.values(colorFrom).sort()).toEqual(['nhealth00001', 'work']);
  });
});

describe('loadVisionForView, signed out', () => {
  it('seeds on the first open and copies the palettes', async () => {
    const rec = await loadVisionForView(week());
    expect(rec.nodes).toHaveLength(2);
    const work = rec.nodes.find(n => n.label === 'Work');
    expect(BRANCH_COLORS[work.id].main).toBe('#F24E1E');
    // Saved, so the next open finds it and does not seed again.
    const stored = await _state.loadValueIDB('vision');
    expect(stored.nodes.map(n => n.id).sort()).toEqual(rec.nodes.map(n => n.id).sort());
    const again = await loadVisionForView(week());
    expect(again.nodes.map(n => n.id).sort()).toEqual(rec.nodes.map(n => n.id).sort());
  });

  it('does not seed when a local record exists, even an empty one', async () => {
    await _state.saveValueIDB('vision', { nodes: [], tombstones: [], crdtVersion: 3 });
    const rec = await loadVisionForView(week());
    expect(rec.nodes).toEqual([]);
  });
});

describe('loadVisionForView, signed in', () => {
  let remote = null;
  let status = 200;
  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files/:id', () => {
      if (status !== 200) return new HttpResponse(null, { status });
      return new HttpResponse(remote == null ? '' : JSON.stringify(remote));
    }),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());
  beforeEach(() => {
    remote = null;
    status = 200;
    _state.setAccessToken('token');
    _state.setDriveFileId('vision', 'file_vision');
  });
  afterEach(() => { _state.clearVisionSyncTimer(); _state.setAccessToken(null); });

  it('opens the vision Drive holds instead of seeding', async () => {
    remote = { nodes: [branch('nremote00001', 'Sea', 'left')], tombstones: [], crdtVersion: 2 };
    const rec = await loadVisionForView(week());
    expect(rec.nodes.map(n => n.label)).toEqual(['Sea']);
  });

  it('seeds when Drive answers that it holds none', async () => {
    const rec = await loadVisionForView(week());
    expect(rec.nodes.map(n => n.label)).toEqual(['Work', 'Health']);
  });

  it('never seeds when Drive could not be asked', async () => {
    status = 500;
    const rec = await loadVisionForView(week());
    expect(rec.nodes).toEqual([]);
    expect(await _state.loadValueIDB('vision')).toBeNull();
  });
});
