import { describe, it, expect, afterEach } from 'vitest';
import {
  _state,
  firstNameFrom,
  centerDisplayName,
  formatWeekParts,
  formatWeekLabel,
  roundedRectPathD,
} from './setup.js';

// ISO week 2026-34 runs Mon 17 Aug – Sun 23 Aug; 2026-36 straddles Aug/Sep,
// which is the only case where the Czech wording repeats the month name.
const W34 = [2026, 34];
const W36 = [2026, 36];

describe('centerDisplayName', () => {
  afterEach(() => {
    _state.setGoogleUser('', '');
    _state.setLang('en');
  });

  describe('firstNameFrom', () => {
    it('takes the first token of a Google display name', () => {
      expect(firstNameFrom('Petr Burian', 'petr@example.com')).toBe('Petr');
    });

    it('collapses surrounding and inner whitespace', () => {
      expect(firstNameFrom('   Petr    Burian  ', '')).toBe('Petr');
    });

    it('falls back to the email local-part when there is no display name', () => {
      expect(firstNameFrom('', 'kruxik@gmail.com')).toBe('kruxik');
    });

    it('does not dress a handle up as a name', () => {
      // Deliberately not capitalized — see firstNameFrom's comment.
      expect(firstNameFrom('', 'petr.burian@example.com')).toBe('petr.burian');
    });

    it('returns empty when neither source has anything usable', () => {
      expect(firstNameFrom('', '')).toBe('');
      expect(firstNameFrom(null, undefined)).toBe('');
      expect(firstNameFrom('   ', '')).toBe('');
    });

    it('clamps a pathologically long name with an ellipsis', () => {
      const out = firstNameFrom('Averyveryverylongfirstname', '');
      expect(out).toBe('Averyveryverylo…');
      expect(out).toHaveLength(16);
    });

    it('leaves a name exactly at the limit alone', () => {
      const sixteen = 'Abcdefghijklmnop';
      expect(sixteen).toHaveLength(16);
      expect(firstNameFrom(sixteen, '')).toBe(sixteen);
    });
  });

  it('uses the signed-out wording in both languages', () => {
    _state.setGoogleUser('', '');
    _state.setLang('en');
    expect(centerDisplayName()).toBe('You');
    _state.setLang('cs');
    expect(centerDisplayName()).toBe('Ty');
  });

  it('uses the signed-in first name regardless of language', () => {
    _state.setGoogleUser('Petr Burian', 'kruxik@gmail.com');
    _state.setLang('en');
    expect(centerDisplayName()).toBe('Petr');
    _state.setLang('cs');
    expect(centerDisplayName()).toBe('Petr');
  });

  it('falls back to the local-part for an account with no display name', () => {
    _state.setGoogleUser('', 'kruxik@gmail.com');
    expect(centerDisplayName()).toBe('kruxik');
  });
});

describe('week label', () => {
  afterEach(() => { _state.setLang('en'); });

  it('splits the week name from its date range in English', () => {
    _state.setLang('en');
    expect(formatWeekParts(...W34)).toEqual({
      weekPart: 'Week 34',
      rangePart: 'Aug 17 - Aug 23',
    });
  });

  it('splits the week name from its date range in Czech', () => {
    _state.setLang('cs');
    expect(formatWeekParts(...W34)).toEqual({
      weekPart: 'Týden 34',
      rangePart: '17. - 23. srpen',
    });
  });

  it('names both months when a week straddles them', () => {
    _state.setLang('en');
    expect(formatWeekParts(...W36).rangePart).toBe('Aug 31 - Sep 6');
    _state.setLang('cs');
    expect(formatWeekParts(...W36).rangePart).toBe('31. srpen - 6. září');
  });

  it('joins the parts to a single line', () => {
    const label = formatWeekLabel(...W34);
    expect(label).toBe('Week 34 (Aug 17 - Aug 23)');
    expect(label).not.toContain('\n');
  });

  it('joins in Czech too', () => {
    _state.setLang('cs');
    expect(formatWeekLabel(...W34)).toBe('Týden 34 (17. - 23. srpen)');
  });
});

describe('roundedRectPathD', () => {
  const CENTER = [240, 80, 20];

  it('starts at top-center so a dasharray fills clockwise', () => {
    expect(roundedRectPathD(...CENTER).d.startsWith('M 0 -40')).toBe(true);
  });

  it('closes the outline', () => {
    expect(roundedRectPathD(...CENTER).d.endsWith('Z')).toBe(true);
  });

  it('reports the analytic perimeter of the center pill', () => {
    // Four straight runs + four quarter-circles = 400 + 80 + one r=20 circle.
    const expected = 2 * (240 - 40) + 2 * (80 - 40) + 2 * Math.PI * 20;
    expect(roundedRectPathD(...CENTER).perimeter).toBeCloseTo(expected, 6);
    expect(roundedRectPathD(...CENTER).perimeter).toBeCloseTo(605.6637, 3);
  });

  it('degenerates to a plain rectangle at rx 0', () => {
    expect(roundedRectPathD(240, 80, 0).perimeter).toBeCloseTo(640, 6);
  });

  it('clamps rx to half the shorter side, giving a circle', () => {
    const { perimeter } = roundedRectPathD(40, 40, 100);
    expect(perimeter).toBeCloseTo(2 * Math.PI * 20, 6);
  });

  it('never emits a negative radius', () => {
    expect(roundedRectPathD(240, 80, -10).perimeter).toBeCloseTo(640, 6);
  });
});
