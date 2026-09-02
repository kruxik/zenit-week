import { describe, it, expect, beforeEach } from 'vitest';
import { _state, relabelDemoNodes } from './setup.js';

// Builds a week shaped like a freshly seeded playground in the given language.
function seedWeek(lang) {
  const nodes = _state.getPlaygroundSeed().week.nodes.map(n => {
    const { labelCs, ...rest } = n;
    return { ...rest, label: (lang === 'cs' && labelCs) || n.label, _demo: true, _ts: 1 };
  });
  return { nodes, tombstones: [], crdtVersion: 0 };
}

describe('Playground relabel on language switch', () => {
  beforeEach(() => {
    _state.setWeekKey('2026-20');
    _state.setLang('en');
    _state.set(seedWeek('en'));
  });

  it('re-labels untouched demo nodes into the new language', () => {
    _state.setLang('cs');
    const changed = relabelDemoNodes();
    expect(changed).toBeGreaterThan(0);

    const byId = new Map(_state.get().nodes.map(n => [n.id, n]));
    expect(byId.get('family').label).toBe('Rodina');       // branch
    expect(byId.get('nc615d740acdd').label).toBe('Návrh OKR na Q1');
  });

  it('keeps seed labels that read the same in both languages', () => {
    _state.setLang('cs');
    relabelDemoNodes();
    const byId = new Map(_state.get().nodes.map(n => [n.id, n]));
    expect(byId.get('n399c0070935b').label).toBe('Code review');
  });

  it('never rewrites a node the user has claimed', () => {
    const week = _state.get();
    const claimed = week.nodes.find(n => n.id === 'nc615d740acdd');
    delete claimed._demo;
    claimed.label = 'My own plan';
    _state.set(week);

    _state.setLang('cs');
    relabelDemoNodes();
    expect(_state.get().nodes.find(n => n.id === 'nc615d740acdd').label).toBe('My own plan');
  });

  it('switches back to English and reports nothing to do when already current', () => {
    _state.setLang('cs');
    relabelDemoNodes();
    _state.setLang('en');
    expect(relabelDemoNodes()).toBeGreaterThan(0);
    expect(_state.get().nodes.find(n => n.id === 'family').label).toBe('Family');
    expect(relabelDemoNodes()).toBe(0);
  });
});
