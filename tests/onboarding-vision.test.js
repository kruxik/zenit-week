import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state, seedVisionFromWeek, validateAndRepairVision, openVisionIntoView,
  relabelDemoNodes, clearExampleTasks, hasDemoActivityNodes, recordKey, t,
} from './setup.js';

// The Vision's share of onboarding: example intentions on a playground's first
// open, cleared and relabelled like the week's, and tips in its own words.

const branch = (id, label) => ({ id, type: 'branch', branch: id, label, side: 'left', children: [], _ts: 1 });
const playgroundWeek = () => ({
  nodes: [
    { ...branch('work', 'Work'), _demo: true, children: ['a1'] },
    { ...branch('family', 'Family'), _demo: true },
    { ...branch('me', 'Personal'), _demo: true },
    { ...branch('growth', 'Growth'), _demo: true },
    { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Q4 OKR draft', children: [], _ts: 1, _demo: true },
  ],
  tombstones: [], crdtVersion: 1,
});
const ownWeek = () => ({
  nodes: [
    { ...branch('work', 'Work'), children: ['a1'] },
    { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Ship it', children: [], _ts: 1 },
  ],
  tombstones: [], crdtVersion: 1,
});
const seedCount = () => _state.getPlaygroundSeed().vision.nodes.length;
const intentions = rec => rec.nodes.filter(n => n.type === 'activity');

beforeEach(() => { _state.setLang('en'); });

describe('seedVisionFromWeek with a playground week', () => {
  it('adds every seed intention under the copy of its week branch, flagged as an example', () => {
    const { record, colorFrom } = seedVisionFromWeek(playgroundWeek());
    const list = intentions(record);
    expect(list).toHaveLength(seedCount());
    expect(list.every(n => n._demo === true)).toBe(true);
    const half = list.find(n => n.label === 'Strong and healthy\nfor decades');
    expect(colorFrom[half.parent]).toBe('me');
    expect(half.horizon).toBe('years');
    expect(half.comments).toBeTruthy();
    const step = list.find(n => n.label === '50 pushups in a row');
    expect(step.parent).toBe(half.id);
    expect(half.children).toContain(step.id);
    // Branches are areas, never examples.
    expect(record.nodes.filter(n => n.type === 'branch').some(n => n._demo)).toBe(false);
  });

  it('shows every Vision feature: horizons, priority, a reason, a collapsed and a let-go intention', () => {
    const { record } = seedVisionFromWeek(playgroundWeek());
    const list = intentions(record);
    expect(new Set(list.map(n => n.horizon ?? 'none'))).toEqual(new Set(['year', 'years', 'someday', 'none']));
    expect(list.some(n => n.priority === 'critical')).toBe(true);
    // Priority passes down to the steps, as from the menu.
    const team = list.find(n => n.label === 'A team that runs without me');
    expect(team.priority).toBe('high');
    expect(team.children.map(id => list.find(n => n.id === id).priority)).toEqual(['high', 'high']);
    const folded = list.find(n => n.collapsed);
    expect(folded.children.length).toBeGreaterThan(0);
    const letGo = list.find(n => n.dropped);
    expect(letGo.droppedAt).toBeTruthy();
    expect(letGo.comments).toBeTruthy();
    // All of it survives the repair a save runs.
    const out = validateAndRepairVision(record);
    expect(intentions(out).find(n => n.id === folded.id).collapsed).toBe(true);
    expect(intentions(out).find(n => n.id === letGo.id).dropped).toBe(true);
  });

  it('writes the examples in the current language', () => {
    _state.setLang('cs');
    const { record } = seedVisionFromWeek(playgroundWeek());
    expect(intentions(record).map(n => n.label)).toContain('Silné a zdravé tělo\nna desítky let');
  });

  it('adds nothing once the week has no untouched examples', () => {
    expect(intentions(seedVisionFromWeek(ownWeek()).record)).toEqual([]);
  });

  it('keeps the example flag through repair, on intentions only', () => {
    const { record } = seedVisionFromWeek(playgroundWeek());
    record.nodes.find(n => n.type === 'branch')._demo = true;
    const out = validateAndRepairVision(record);
    expect(intentions(out).every(n => n._demo === true)).toBe(true);
    expect(out.nodes.filter(n => n.type === 'branch').some(n => n._demo)).toBe(false);
  });
});

describe('Vision examples in view', () => {
  beforeEach(() => { openVisionIntoView(seedVisionFromWeek(playgroundWeek()).record); });

  it('relabels untouched examples on a language switch', () => {
    _state.setLang('cs');
    expect(relabelDemoNodes()).toBe(seedCount());
    expect(intentions(_state.get()).map(n => n.label)).toContain('Učit druhé, co se naučím');
  });

  it('Clear example intentions removes them and keeps a touched one', () => {
    const kept = intentions(_state.get()).find(n => n.label === 'Teach what I learn');
    delete kept._demo;
    expect(hasDemoActivityNodes()).toBe(true);
    clearExampleTasks();
    expect(intentions(_state.get()).map(n => n.id)).toEqual([kept.id]);
    expect(hasDemoActivityNodes()).toBe(false);
  });

  it('reads the Vision wording of a string where it has one', () => {
    expect(recordKey('tips.root')).toBe('tips.rootVision');
    expect(recordKey('tips.done')).toBe('tips.done');
    expect(t(recordKey('quick_add.placeholder'))).toBe('Add an intention…');
  });
});

describe('Vision tips', () => {
  it('registers the first-open and horizon-filter tips, anchored to controls', () => {
    const HINTS = _state.getHints();
    expect(HINTS.vision.textKey).toBe('tips.vision');
    expect(HINTS.horizonfilter.keys.map(k => k.k)).toEqual(['1', '2', '3', '4']);
    expect(HINTS.vision.matches).toBeUndefined();
    expect(HINTS.horizonfilter.matches).toBeUndefined();
  });

  it('every Vision twin of a string exists in both languages', () => {
    for (const lang of ['en', 'cs']) {
      _state.setLang(lang);
      for (const key of ['tips.rootVision', 'tips.hoverIntroVision', 'tips.hoverTouchVision',
        'tips.priorityIntroVision', 'quick_add.placeholderVision', 'onboarding.clearExampleVision']) {
        expect(t(key)).not.toBe(key);
      }
    }
  });
});
