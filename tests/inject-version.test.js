import { describe, it, expect } from 'vitest';
import {
  resolveVersion,
  validateResolvedVersion,
  substitutePlaceholder,
} from '../scripts/inject-version.js';

// Default mocks — tests opt in to the real network path explicitly.
const NO_FETCH = async () => null;

describe('resolveVersion', () => {
  it('accepts a valid CalVer tag', async () => {
    const v = await resolveVersion({ runGit: () => 'v2026.05.10', env: {}, fetchTags: NO_FETCH });
    expect(v).toBe('v2026.05.10');
  });

  it('prefers VERCEL_GIT_COMMIT_REF when it matches CalVer (tag-push deploy)', async () => {
    const v = await resolveVersion({
      runGit:    () => { throw new Error('should not be called'); },
      fetchTags: NO_FETCH,
      env:       { VERCEL_GIT_COMMIT_REF: 'v2026.05.11' },
    });
    expect(v).toBe('v2026.05.11');
  });

  it('ignores VERCEL_GIT_COMMIT_REF when it is a branch name and falls back to git describe', async () => {
    const v = await resolveVersion({
      runGit:    () => 'v2026.05.10',
      fetchTags: NO_FETCH,
      env:       { VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'deadbee1234' },
    });
    expect(v).toBe('v2026.05.10');
  });

  it('accepts a CalVer tag with same-day build suffix', async () => {
    const v = await resolveVersion({ runGit: () => 'v2026.05.10.1', env: {}, fetchTags: NO_FETCH });
    expect(v).toBe('v2026.05.10.1');
  });

  it('falls back to GitHub API when git CLI fails (Vercel no-git env)', async () => {
    const v = await resolveVersion({
      runGit:    () => { throw new Error('not a git repository'); },
      fetchTags: async (slug) => {
        expect(slug).toBe('kruxik/zenit-week');
        return 'v2026.05.12';
      },
      env: { VERCEL_GIT_REPO_SLUG: 'kruxik/zenit-week', VERCEL_GIT_COMMIT_SHA: 'abc1234' },
    });
    expect(v).toBe('v2026.05.12');
  });

  it('builds slug from VERCEL_GIT_REPO_OWNER + _NAME when SLUG is unset', async () => {
    let seenSlug = null;
    await resolveVersion({
      runGit:    () => { throw new Error('no git'); },
      fetchTags: async (slug) => { seenSlug = slug; return 'v2026.05.13'; },
      env: { VERCEL_GIT_REPO_OWNER: 'foo', VERCEL_GIT_REPO_NAME: 'bar', VERCEL_GIT_COMMIT_SHA: 'abc1234' },
    });
    expect(seenSlug).toBe('foo/bar');
  });

  it('hardcodes slug on Vercel when neither slug env var is set', async () => {
    let seenSlug = null;
    await resolveVersion({
      runGit:    () => { throw new Error('no git'); },
      fetchTags: async (slug) => { seenSlug = slug; return 'v2026.05.14'; },
      env: { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: 'abc1234' },
    });
    expect(seenSlug).toBe('kruxik/zenit-week');
  });

  it('skips GitHub API when no slug resolvable (tests / local non-Vercel)', async () => {
    let calls = 0;
    const v = await resolveVersion({
      runGit:    () => { throw new Error('no git'); },
      fetchTags: async () => { calls++; return 'v2026.05.99'; },
      env: { VERCEL_GIT_COMMIT_SHA: 'abc1234567' },
    });
    expect(calls).toBe(0);
    expect(v).toBe('dev-abc1234');
  });

  it('rejects malformed tag (single-digit month) and falls back to SHA', async () => {
    const v = await resolveVersion({
      runGit:    () => 'v2026.5.10',
      fetchTags: NO_FETCH,
      env:       { VERCEL_GIT_COMMIT_SHA: 'abc1234def56789' },
    });
    expect(v).toBe('dev-abc1234');
  });

  it('rejects unprefixed tag and falls back to SHA', async () => {
    const v = await resolveVersion({
      runGit:    () => '2026.05.10',
      fetchTags: NO_FETCH,
      env:       { VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' },
    });
    expect(v).toBe('dev-0123456');
  });

  it('falls back to "dev" when nothing resolves', async () => {
    const v = await resolveVersion({
      runGit:    () => { throw new Error('no tags'); },
      fetchTags: NO_FETCH,
      env:       {},
    });
    expect(v).toBe('dev');
  });

  it('falls back to SHA when git throws but VERCEL_GIT_COMMIT_SHA is present', async () => {
    const v = await resolveVersion({
      runGit:    () => { throw new Error('shallow clone'); },
      fetchTags: NO_FETCH,
      env:       { VERCEL_GIT_COMMIT_SHA: 'deadbeefcafe1234' },
    });
    expect(v).toBe('dev-deadbee');
  });

  it('lowercases SHA fallback', async () => {
    const v = await resolveVersion({
      runGit:    () => '',
      fetchTags: NO_FETCH,
      env:       { VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890' },
    });
    expect(v).toBe('dev-abcdef1');
  });

  it('falls back to SHA when GitHub API itself fails', async () => {
    const v = await resolveVersion({
      runGit:    () => { throw new Error('no git'); },
      fetchTags: async () => { throw new Error('GitHub 500'); },
      env:       { VERCEL_GIT_REPO_SLUG: 'kruxik/zenit-week', VERCEL_GIT_COMMIT_SHA: '0123456789' },
    });
    expect(v).toBe('dev-0123456');
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
