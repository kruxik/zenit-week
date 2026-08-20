// A device with an empty database seeds the playground before the user can sign
// in. When Drive then returns a week that already has real tasks, the account is
// an existing one on a new device — the example tasks must not merge into it,
// and must never upload back out to the user's other devices.
import { describe, it, expect } from 'vitest';
import { mergeWeekData } from './setup.js';

const branch = (id, children) =>
  ({ id, type: 'branch', branch: id, label: id, side: 'left', children, _ts: 10 });

// The locally seeded playground: one untouched example task, one the user
// marked done while exploring (touchNode cleared its _demo), and a demo parent
// whose child they touched.
const seeded = () => ({
  nodes: [
    branch('work', ['demo1', 'touched', 'parent']),
    { id: 'demo1', type: 'activity', parent: 'work', label: 'Example', _demo: true, children: [], _ts: 10 },
    { id: 'touched', type: 'activity', parent: 'work', label: 'Mine now', children: [], _ts: 20 },
    { id: 'parent', type: 'activity', parent: 'work', label: 'Example parent', _demo: true, children: ['kid'], _ts: 10 },
    { id: 'kid', type: 'activity', parent: 'parent', label: 'Ticked', children: [], _ts: 20 },
  ],
  tombstones: [],
  savedAt: 1000,
  crdtVersion: 1,
});

const remoteWeek = () => ({
  nodes: [
    branch('work', ['real']),
    { id: 'real', type: 'activity', parent: 'work', label: 'Real task', children: [], _ts: 500 },
  ],
  tombstones: [],
  savedAt: 2000,
  crdtVersion: 4,
});

describe('Playground never merges into an existing Drive account', () => {
  it('drops untouched example tasks when the remote week has real content', () => {
    const merged = mergeWeekData(seeded(), remoteWeek());
    const ids = merged.nodes.map(n => n.id);
    expect(ids).toContain('real');
    expect(ids).not.toContain('demo1');
  });

  it('keeps what the user touched while exploring', () => {
    const ids = mergeWeekData(seeded(), remoteWeek()).nodes.map(n => n.id);
    expect(ids).toContain('touched');
    // The parent is still flagged demo, but its child was touched — the subtree
    // is no longer all example, so it stays whole (same rule as the cleanup).
    expect(ids).toContain('parent');
    expect(ids).toContain('kid');
  });

  it('detaches a dropped node from its branch', () => {
    const merged = mergeWeekData(seeded(), remoteWeek());
    const work = merged.nodes.find(n => n.id === 'work');
    expect(work.children).not.toContain('demo1');
    expect(work.children).toContain('parent');   // kept: a touched child lives under it
  });

  it('keeps branches even when every child was an example task', () => {
    const local = {
      nodes: [
        branch('work', ['demo1']),
        { id: 'demo1', type: 'activity', parent: 'work', label: 'Example', _demo: true, children: [], _ts: 10 },
      ],
      tombstones: [], savedAt: 1000, crdtVersion: 1,
    };
    const merged = mergeWeekData(local, remoteWeek());
    expect(merged.nodes.find(n => n.id === 'work')).toBeDefined();
  });

  it('leaves a genuine first run alone — an empty remote week keeps the playground', () => {
    const remote = { nodes: [branch('work', [])], tombstones: [], savedAt: 500, crdtVersion: 1 };
    const merged = mergeWeekData(seeded(), remote);
    expect(merged.nodes.map(n => n.id)).toContain('demo1');
  });

  it('does not tombstone the dropped nodes — they were never the user\'s data', () => {
    const merged = mergeWeekData(seeded(), remoteWeek());
    expect(merged.tombstones).toEqual([]);
  });

  // The reported bug: a device pushed its playground to Drive, so the seeded
  // branch lives on the remote side. Importing real data locally and syncing
  // brought the empty branch straight back.
  it('drops a seeded branch that arrives from the remote side', () => {
    const remote = {
      nodes: [
        { ...branch('growth', ['demoA']), _demo: true },
        { id: 'demoA', type: 'activity', parent: 'growth', label: 'Example', _demo: true, children: [], _ts: 10 },
      ],
      tombstones: [], savedAt: 900, crdtVersion: 2,
    };
    const local = {
      nodes: [
        branch('work', ['real']),
        { id: 'real', type: 'activity', parent: 'work', label: 'Real task', children: [], _ts: 500 },
      ],
      tombstones: [], savedAt: 2000, crdtVersion: 4,
    };
    const ids = mergeWeekData(local, remote).nodes.map(n => n.id);
    expect(ids).toEqual(['work', 'real']);
  });

  it('keeps a seeded branch the user put their own task under', () => {
    const remote = {
      nodes: [
        { ...branch('growth', ['mine']), _demo: true },
        { id: 'mine', type: 'activity', parent: 'growth', label: 'My task', children: [], _ts: 900 },
      ],
      tombstones: [], savedAt: 900, crdtVersion: 2,
    };
    const local = {
      nodes: [
        branch('work', ['real']),
        { id: 'real', type: 'activity', parent: 'work', label: 'Real task', children: [], _ts: 500 },
      ],
      tombstones: [], savedAt: 2000, crdtVersion: 4,
    };
    const ids = mergeWeekData(local, remote).nodes.map(n => n.id);
    expect(ids).toContain('growth');
    expect(ids).toContain('mine');
  });

  it('leaves the playground alone when both sides are the same seed', () => {
    // First run, two devices: the user has added one real task. The seed nodes
    // exist on both sides, so LWW owns them — nothing is scaffolding to strip.
    const withReal = () => {
      const w = seeded();
      w.nodes.push({ id: 'real', type: 'activity', parent: 'work', label: 'Real task', children: [], _ts: 900 });
      w.nodes.find(n => n.id === 'work').children.push('real');
      return w;
    };
    const ids = mergeWeekData(withReal(), withReal()).nodes.map(n => n.id);
    expect(ids).toContain('demo1');
    expect(ids).toContain('real');
  });
});
