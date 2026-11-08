import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state,
  mergeWeekData,
  emptyVision,
  stripVisionNode,
  validateAndRepairVision,
  loadVision,
  saveVision,
} from './setup.js';

// The vision record: a second map record shaped like a week, holding
// intentions. These tests pin the validator (week machinery stripped, never
// refused) and the merge it shares with weeks.

const branch = (id, extra = {}) => ({
  id, type: 'branch', branch: id, label: 'Area ' + id, children: [], side: 'right', _ts: 1, ...extra,
});
const intention = (id, parent, br, extra = {}) => ({
  id, type: 'activity', branch: br, parent, label: 'Intention ' + id, children: [], _ts: 1, ...extra,
});
const record = (nodes, extra = {}) => ({ nodes, tombstones: [], crdtVersion: 1, savedAt: 1000, ...extra });
const link = (nodes) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) if (n.parent && byId.has(n.parent)) byId.get(n.parent).children.push(n.id);
  return nodes;
};
const ids = (rec) => rec.nodes.map(n => n.id).sort();

describe('validateAndRepairVision', () => {
  it('returns an empty vision for missing or malformed input', () => {
    expect(validateAndRepairVision(null)).toEqual(emptyVision());
    expect(validateAndRepairVision({})).toEqual(emptyVision());
    expect(validateAndRepairVision({ nodes: 'x' })).toEqual(emptyVision());
  });

  it('never injects the week default branches into a vision without branches', () => {
    const out = validateAndRepairVision(record([], { tombstones: ['ndead'] }));
    expect(out.nodes).toEqual([]);
    expect(out.tombstones).toEqual(['ndead']);
  });

  it('never resurrects a default branch for a node that names one as parent', () => {
    const nodes = link([branch('vb1'), intention('i1', 'vb1', 'vb1'), intention('orphan', 'work', 'work')]);
    const out = validateAndRepairVision(record(nodes));
    expect(ids(out)).toEqual(['i1', 'vb1']);
    expect(out.nodes.some(n => n.id === 'work')).toBe(false);
  });

  it('strips every week-only field', () => {
    const nodes = link([branch('vb1', { _demo: true }), intention('i1', 'vb1', 'vb1', {
      done: true, doneAt: 'x', unplanned: true, unplannedAt: 'x', reusable: true,
      dayIndex: 2, val: 1, max: 3, ticks: [], schedId: 's', schedDate: 'd', inbox: true,
      labelCs: 'cz', priority: 'high', comments: 'why', horizon: 'someday',
    })]);
    const out = validateAndRepairVision(record(nodes));
    const n = out.nodes.find(x => x.id === 'i1');
    for (const k of ['done', 'doneAt', 'unplanned', 'unplannedAt', 'reusable', 'dayIndex',
      'val', 'max', 'ticks', 'schedId', 'schedDate', 'inbox', 'labelCs']) {
      expect(n).not.toHaveProperty(k);
    }
    expect(out.nodes.find(x => x.id === 'vb1')).not.toHaveProperty('_demo');
    expect(n.priority).toBe('high');
    expect(n.comments).toBe('why');
    expect(n.horizon).toBe('someday');
  });

  it('deletes day leaves, tick leaves and counters, with anything under them', () => {
    const nodes = link([
      branch('vb1'),
      intention('i1', 'vb1', 'vb1'),
      intention('d1', 'i1', 'vb1', { dayChild: true, dayIndex: 1, label: 'Mo' }),
      intention('t1', 'i1', 'vb1', { tickChild: true, tickIndex: 1, label: '1' }),
      { id: 'c1', type: 'counter', branch: 'vb1', parent: 'i1', children: [], val: 0, max: 3, _ts: 1 },
      intention('under', 'd1', 'vb1'),
    ]);
    const out = validateAndRepairVision(record(nodes));
    expect(ids(out)).toEqual(['i1', 'vb1']);
    expect(out.nodes.find(n => n.id === 'i1').children).toEqual([]);
  });

  it('normalises horizon to the three values or absent', () => {
    const nodes = link([branch('vb1'),
      intention('a', 'vb1', 'vb1', { horizon: 'year' }),
      intention('b', 'vb1', 'vb1', { horizon: 'decade' }),
      intention('c', 'vb1', 'vb1', { horizon: 7 })]);
    const out = validateAndRepairVision(record(nodes));
    const h = id => out.nodes.find(n => n.id === id).horizon;
    expect(h('a')).toBe('year');
    expect(h('b')).toBeUndefined();
    expect(h('c')).toBeUndefined();
  });

  it('keeps collapsed only on a node with children, and never invents it', () => {
    const nodes = link([branch('vb1', { collapsed: true }),
      intention('p', 'vb1', 'vb1', { collapsed: true }),
      intention('kid', 'p', 'vb1'),
      intention('leaf', 'vb1', 'vb1', { collapsed: true }),
      intention('odd', 'vb1', 'vb1', { collapsed: 'yes' })]);
    const out = validateAndRepairVision(record(nodes));
    const c = id => out.nodes.find(n => n.id === id).collapsed;
    expect(c('vb1')).toBe(true);
    expect(c('p')).toBe(true);
    expect(c('leaf')).toBeUndefined();
    expect(c('odd')).toBeUndefined();
    expect(c('kid')).toBeUndefined();
  });

  it('keeps dropped and horizon independent, and droppedAt only with dropped', () => {
    const nodes = link([branch('vb1'),
      intention('a', 'vb1', 'vb1', { dropped: true, droppedAt: 't', horizon: 'years' }),
      intention('b', 'vb1', 'vb1', { droppedAt: 't' })]);
    const out = validateAndRepairVision(record(nodes));
    const a = out.nodes.find(n => n.id === 'a');
    expect(a.dropped).toBe(true);
    expect(a.droppedAt).toBe('t');
    expect(a.horizon).toBe('years');
    expect(out.nodes.find(n => n.id === 'b')).not.toHaveProperty('droppedAt');
  });

  it('does not mutate its input', () => {
    const raw = record(link([branch('vb1'), intention('i1', 'vb1', 'vb1', { done: true })]));
    const before = JSON.stringify(raw);
    validateAndRepairVision(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('stripVisionNode keeps the editing flag in memory', () => {
    const n = stripVisionNode(intention('i1', 'vb1', 'vb1', { _editing: true, done: false }));
    expect(n._editing).toBe(true);
    expect(n).not.toHaveProperty('done');
  });
});

describe('mergeWeekData on two vision records', () => {
  it('takes content from the higher _ts', () => {
    const local = record(link([branch('vb1'), intention('i1', 'vb1', 'vb1', { label: 'old', _ts: 5 })]));
    const remote = record(link([branch('vb1'), intention('i1', 'vb1', 'vb1', { label: 'new', _ts: 9 })]));
    const out = validateAndRepairVision(mergeWeekData(local, remote, 'vision'));
    expect(out.nodes.find(n => n.id === 'i1').label).toBe('new');
  });

  it('takes collapsed from the higher _posTs, independent of content', () => {
    const local = record(link([branch('vb1'),
      intention('p', 'vb1', 'vb1', { label: 'edited', _ts: 9, _posTs: 1 }), intention('k', 'p', 'vb1')]));
    const remote = record(link([branch('vb1'),
      intention('p', 'vb1', 'vb1', { label: 'stale', _ts: 2, _posTs: 7, collapsed: true }), intention('k', 'p', 'vb1')]));
    const out = validateAndRepairVision(mergeWeekData(local, remote, 'vision'));
    const p = out.nodes.find(n => n.id === 'p');
    expect(p.label).toBe('edited');
    expect(p.collapsed).toBe(true);
  });

  it('a newer expand on the other device wins over an older collapse', () => {
    const local = record(link([branch('vb1'),
      intention('p', 'vb1', 'vb1', { _posTs: 3, collapsed: true }), intention('k', 'p', 'vb1')]));
    const remote = record(link([branch('vb1'),
      intention('p', 'vb1', 'vb1', { _posTs: 8 }), intention('k', 'p', 'vb1')]));
    const out = validateAndRepairVision(mergeWeekData(local, remote, 'vision'));
    expect(out.nodes.find(n => n.id === 'p').collapsed).toBeUndefined();
  });

  it('tombstones win over a newer edit', () => {
    const local = record(link([branch('vb1')]), { tombstones: ['i1'] });
    const remote = record(link([branch('vb1'), intention('i1', 'vb1', 'vb1', { _ts: 99 })]));
    const out = validateAndRepairVision(mergeWeekData(local, remote, 'vision'));
    expect(ids(out)).toEqual(['vb1']);
    expect(out.tombstones).toContain('i1');
  });
});

describe('loadVision / saveVision', () => {
  beforeEach(() => {
    _state.clearIDB?.();
    _state.sandbox._tabPosts = [];
  });

  it('a missing record loads as an empty vision', async () => {
    await _state.saveValueIDB('vision', null);
    expect(await loadVision()).toEqual(emptyVision());
  });

  it('saves a stripped, stamped record, minus editing placeholders', async () => {
    const data = record(link([branch('vb1'),
      intention('i1', 'vb1', 'vb1', { done: false, unplanned: false }),
      intention('tmp', 'vb1', 'vb1', { _editing: true })]), { crdtVersion: 4, savedAt: 0 });
    const ok = await saveVision(data);
    expect(ok).toBe(true);
    const stored = await _state.loadValueIDB('vision');
    expect(stored.nodes.map(n => n.id).sort()).toEqual(['i1', 'vb1']);
    expect(stored.nodes.find(n => n.id === 'i1')).not.toHaveProperty('done');
    expect(stored.crdtVersion).toBe(5);
    expect(stored.savedAt).toBeGreaterThan(0);
    // In memory too: the record in view is stripped as it is saved.
    expect(data.nodes.find(n => n.id === 'i1')).not.toHaveProperty('unplanned');
  });

  it('tells peer tabs with wk "vision", never a week key', async () => {
    await saveVision(record(link([branch('vb1')])));
    const posts = _state.sandbox._tabPosts.filter(m => m.type === 'week-saved');
    expect(posts).toHaveLength(1);
    expect(posts[0].wk).toBe('vision');
    expect(typeof posts[0].sig).toBe('string');
  });

  it('never writes a week', async () => {
    const before = await _state.loadWeekIDB(_state.getWeekKey?.() ?? '2026-01');
    await saveVision(record(link([branch('vb1'), intention('i1', 'vb1', 'vb1')])));
    const after = await _state.loadWeekIDB(_state.getWeekKey?.() ?? '2026-01');
    expect(after).toEqual(before);
  });
});
