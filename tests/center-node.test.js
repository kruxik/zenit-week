import { describe, it, expect, afterEach } from 'vitest';
import {
  _state,
  firstNameFrom,
  centerDisplayName,
  centerNodeText,
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
    expect(centerDisplayName()).toBe('Me');
    _state.setLang('cs');
    expect(centerDisplayName()).toBe('Já');
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

// What the root circle paints. The photo is not a tier here — it is layered over
// the initials in the DOM, so a failed or skipped image reveals them.
describe('centerNodeText', () => {
  afterEach(() => {
    _state.setGoogleUser('', '');
    _state.setLang('en');
  });

  it('shows the signed-out wording when there is no account', () => {
    _state.setGoogleUser('', '');
    expect(centerNodeText()).toBe('Me');
    _state.setLang('cs');
    expect(centerNodeText()).toBe('Já');
  });

  it('shows initials for a signed-in account', () => {
    _state.setGoogleUser('Petr Burian', 'kruxik@gmail.com');
    expect(centerNodeText()).toBe('PB');
  });

  it('derives initials from the email when there is no display name', () => {
    _state.setGoogleUser('', 'kruxik@gmail.com');
    expect(centerNodeText()).toBe('KR');
  });

  it('stays initials in Czech — a name is not translated', () => {
    _state.setGoogleUser('Petr Burian', 'kruxik@gmail.com');
    _state.setLang('cs');
    expect(centerNodeText()).toBe('PB');
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

// The root's completion ring: a circle of r=110.5 inset inside the 250px node.
describe('root completion ring', () => {
  const RING_R = 110.5;
  const ring = () => roundedRectPathD(RING_R * 2, RING_R * 2, RING_R);

  it('is a true circle, not a racetrack', () => {
    expect(ring().perimeter).toBeCloseTo(2 * Math.PI * RING_R, 6);
    expect(ring().perimeter).toBeCloseTo(694.2920, 3);
  });

  it('starts at the top of the circle so the arc fills clockwise', () => {
    expect(ring().d.startsWith(`M 0 ${-RING_R}`)).toBe(true);
  });

  it('maps a percentage onto a dasharray that never exceeds the circle', () => {
    const { perimeter } = ring();
    const dash = (pct) => (pct / 100) * perimeter;
    expect(dash(0)).toBe(0);                              // empty week — bare track
    expect(dash(100)).toBeCloseTo(perimeter, 6);           // finished — closed ring
    expect(dash(50)).toBeCloseTo(perimeter / 2, 6);
    expect(dash(37)).toBeLessThan(perimeter);
  });
});
