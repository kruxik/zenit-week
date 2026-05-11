import { describe, it, expect } from 'vitest';
import {
  resolveVersion,
  validateResolvedVersion,
  substitutePlaceholder,
} from '../scripts/inject-version.js';

describe('resolveVersion', () => {
  it('accepts a valid CalVer tag', () => {
    const v = resolveVersion({ runGit: () => 'v2026.05.10', env: {} });
    expect(v).toBe('v2026.05.10');
  });

  it('accepts a CalVer tag with same-day build suffix', () => {
    const v = resolveVersion({ runGit: () => 'v2026.05.10.1', env: {} });
    expect(v).toBe('v2026.05.10.1');
  });

  it('rejects malformed tag (single-digit month) and falls back to SHA', () => {
    const v = resolveVersion({
      runGit: () => 'v2026.5.10',
      env: { VERCEL_GIT_COMMIT_SHA: 'abc1234def56789' },
    });
    expect(v).toBe('dev-abc1234');
  });

  it('rejects unprefixed tag and falls back to SHA', () => {
    const v = resolveVersion({
      runGit: () => '2026.05.10',
      env: { VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' },
    });
    expect(v).toBe('dev-0123456');
  });

  it('falls back to "dev" when both git and SHA are missing', () => {
    const v = resolveVersion({
      runGit: () => { throw new Error('no tags'); },
      env: {},
    });
    expect(v).toBe('dev');
  });

  it('falls back to SHA when git throws but VERCEL_GIT_COMMIT_SHA is present', () => {
    const v = resolveVersion({
      runGit: () => { throw new Error('shallow clone'); },
      env: { VERCEL_GIT_COMMIT_SHA: 'deadbeefcafe1234' },
    });
    expect(v).toBe('dev-deadbee');
  });

  it('lowercases SHA fallback', () => {
    const v = resolveVersion({
      runGit: () => '',
      env: { VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890' },
    });
    expect(v).toBe('dev-abcdef1');
  });
});

describe('validateResolvedVersion', () => {
  it('accepts CalVer without suffix', () => {
    expect(validateResolvedVersion('v2026.05.10')).toBe(true);
  });

  it('accepts CalVer with same-day suffix', () => {
    expect(validateResolvedVersion('v2026.05.10.1')).toBe(true);
    expect(validateResolvedVersion('v2026.05.10.42')).toBe(true);
  });

  it('accepts "dev"', () => {
    expect(validateResolvedVersion('dev')).toBe(true);
  });

  it('accepts "dev-<sha7>"', () => {
    expect(validateResolvedVersion('dev-abc1234')).toBe(true);
  });

  it('rejects bare year', () => {
    expect(validateResolvedVersion('2026')).toBe(false);
  });

  it('rejects single-digit month', () => {
    expect(validateResolvedVersion('v2026.5.10')).toBe(false);
  });

  it('rejects missing "v" prefix', () => {
    expect(validateResolvedVersion('2026.05.10')).toBe(false);
  });

  it('rejects pre-release suffix', () => {
    expect(validateResolvedVersion('v2026.05.10-rc1')).toBe(false);
  });

  it('rejects SHA fallback with wrong length', () => {
    expect(validateResolvedVersion('dev-abc')).toBe(false);
    expect(validateResolvedVersion('dev-abc12345')).toBe(false);
  });
});

describe('substitutePlaceholder', () => {
  it('replaces exactly one placeholder', () => {
    const out = substitutePlaceholder(
      `<span id="app-version">__APP_VERSION__</span>`,
      'v2026.05.10'
    );
    expect(out).toBe('<span id="app-version">v2026.05.10</span>');
  });

  it('throws when placeholder is absent', () => {
    expect(() => substitutePlaceholder('<span>no placeholder</span>', 'v2026.05.10'))
      .toThrow(/not found/);
  });

  it('throws when placeholder appears more than once', () => {
    expect(() => substitutePlaceholder('__APP_VERSION__ x __APP_VERSION__', 'v2026.05.10'))
      .toThrow(/found 2 times/);
  });

  it('replaces the placeholder regardless of surrounding markup', () => {
    const html = `const X = '__APP_VERSION__';`;
    const out = substitutePlaceholder(html, 'v2026.05.10.1');
    expect(out).toBe(`const X = 'v2026.05.10.1';`);
  });
});
