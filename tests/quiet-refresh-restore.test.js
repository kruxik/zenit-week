import { describe, it, expect } from 'vitest';
import { buildRestorePayload, validateRestorePayload } from './setup.js';

const NOW = 1_715_000_000_000; // arbitrary fixed epoch ms for deterministic tests

function validState(overrides = {}) {
  return {
    now:            NOW,
    panX:           123.456,
    panY:           -78.9,
    zoom:           1.42,
    currentView:    'mindmap',
    currentWeekKey: '2026-19',
    hoveredNodeId:  'node-abc',
    ...overrides,
  };
}

function validCtx(overrides = {}) {
  return {
    now:            NOW,
    currentWeekKey: '2026-19',
    ...overrides,
  };
}

describe('buildRestorePayload', () => {
  it('captures all state fields plus v + ts', () => {
    const p = buildRestorePayload(validState());
    expect(p).toEqual({
      v:              1,
      ts:             NOW,
      panX:           123.456,
      panY:           -78.9,
      zoom:           1.42,
      currentView:    'mindmap',
      currentWeekKey: '2026-19',
      hoveredNodeId:  'node-abc',
    });
  });

  it('normalizes undefined hoveredNodeId to null', () => {
    const p = buildRestorePayload(validState({ hoveredNodeId: undefined }));
    expect(p.hoveredNodeId).toBeNull();
  });
});

describe('validateRestorePayload', () => {
  it('round-trips a valid payload through JSON', () => {
    const built  = buildRestorePayload(validState());
    const parsed = JSON.parse(JSON.stringify(built));
    const out    = validateRestorePayload(parsed, validCtx());
    expect(out).toEqual(built);
  });

  it('rejects schema version mismatch', () => {
    const p = { ...buildRestorePayload(validState()), v: 2 };
    expect(validateRestorePayload(p, validCtx())).toBeNull();
  });

  it('rejects staleness (>5min old)', () => {
    const p = buildRestorePayload(validState());
    const ctx = validCtx({ now: NOW + 5 * 60 * 1000 + 1 });
    expect(validateRestorePayload(p, ctx)).toBeNull();
  });

  it('accepts payload right at 5min boundary', () => {
    const p   = buildRestorePayload(validState());
    const ctx = validCtx({ now: NOW + 5 * 60 * 1000 });
    expect(validateRestorePayload(p, ctx)).not.toBeNull();
  });

  it('rejects currentWeekKey mismatch (user changed week before reload)', () => {
    const p = buildRestorePayload(validState({ currentWeekKey: '2026-19' }));
    const ctx = validCtx({ currentWeekKey: '2026-20' });
    expect(validateRestorePayload(p, ctx)).toBeNull();
  });

  it('rejects non-finite panX', () => {
    const p = { ...buildRestorePayload(validState()), panX: NaN };
    expect(validateRestorePayload(p, validCtx())).toBeNull();
    const p2 = { ...buildRestorePayload(validState()), panX: Infinity };
    expect(validateRestorePayload(p2, validCtx())).toBeNull();
  });

  it('rejects zero or negative zoom', () => {
    const p1 = { ...buildRestorePayload(validState()), zoom: 0 };
    expect(validateRestorePayload(p1, validCtx())).toBeNull();
    const p2 = { ...buildRestorePayload(validState()), zoom: -1 };
    expect(validateRestorePayload(p2, validCtx())).toBeNull();
  });

  it('rejects missing fields', () => {
    const p = buildRestorePayload(validState());
    delete p.currentView;
    expect(validateRestorePayload(p, validCtx())).toBeNull();
  });

  it('rejects non-string hoveredNodeId', () => {
    const p = { ...buildRestorePayload(validState()), hoveredNodeId: 42 };
    expect(validateRestorePayload(p, validCtx())).toBeNull();
  });

  it('accepts null hoveredNodeId', () => {
    const p = buildRestorePayload(validState({ hoveredNodeId: null }));
    expect(validateRestorePayload(p, validCtx())).not.toBeNull();
  });

  it('rejects null payload', () => {
    expect(validateRestorePayload(null, validCtx())).toBeNull();
  });

  it('rejects array payload', () => {
    expect(validateRestorePayload([], validCtx())).toBeNull();
  });

  it('returns a clean object (does not mutate or pass through extra keys)', () => {
    const dirty = { ...buildRestorePayload(validState()), extraField: 'attacker-controlled' };
    const out   = validateRestorePayload(dirty, validCtx());
    expect(out).not.toHaveProperty('extraField');
  });
});
