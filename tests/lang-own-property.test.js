// A language code from a synced colors file must be an own key of TRANSLATIONS;
// `in` would also accept inherited names such as 'constructor' or 'toString'.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sanitizeColorsData, isKnownLang } from './setup.js';

describe('language code validation', () => {
  it('accepts the shipped languages only', () => {
    expect(isKnownLang('en')).toBe(true);
    expect(isKnownLang('cs')).toBe(true);
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'de', '', null, 5]) {
      expect(isKnownLang(bad)).toBe(false);
    }
  });

  it('drops an inherited name from a remote colors file', () => {
    expect(sanitizeColorsData({ lang: 'constructor' }).lang).toBeUndefined();
    expect(sanitizeColorsData({ lang: 'cs' }).lang).toBe('cs');
  });

  it('no code path tests TRANSLATIONS membership with the in operator', () => {
    const html = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/\bin TRANSLATIONS\b/);
  });
});
