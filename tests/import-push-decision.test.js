import { describe, it, expect } from 'vitest';
import { normalizeImportPending, importPushDecision } from './setup.js';

// An import is the one operation that may overwrite Drive instead of merging
// into it: it claims that what this device holds is the truth, including the
// absence of anything it does not hold, which per-node timestamps cannot
// express. That claim has to expire. It expires per week, against the age Drive
// states for that week, so a stale flag can no longer take the whole account
// back in time.
describe('import-pending flag', () => {
  it('carries the moment the import happened', () => {
    expect(normalizeImportPending({ v: 1, importedAt: 1700000000000 }))
      .toEqual({ importedAt: 1700000000000 });
  });

  it('reads a legacy "1" as age zero rather than as fresh', () => {
    // The old shape says an import is pending but not when — and a flag that
    // cannot state its age must never win, or the upgrade reintroduces the bug.
    expect(normalizeImportPending('1')).toEqual({ importedAt: 0 });
  });

  it('treats a malformed record the same way', () => {
    expect(normalizeImportPending({ v: 1 })).toEqual({ importedAt: 0 });
    expect(normalizeImportPending({ importedAt: 'yesterday' })).toEqual({ importedAt: 0 });
    expect(normalizeImportPending(true)).toEqual({ importedAt: 0 });
  });

  it('reports no pending import for an absent flag', () => {
    expect(normalizeImportPending(null)).toBe(null);
    expect(normalizeImportPending(undefined)).toBe(null);
    expect(normalizeImportPending('')).toBe(null);
  });
});

describe('import push decision', () => {
  const IMPORTED_AT = 2_000_000;

  it('pushes when the import is newer than the week on Drive', () => {
    expect(importPushDecision(IMPORTED_AT, { savedAt: 1_000_000 })).toBe('push');
  });

  it('pushes a week Drive does not hold', () => {
    expect(importPushDecision(IMPORTED_AT, undefined)).toBe('push');
    expect(importPushDecision(IMPORTED_AT, null)).toBe('push');
  });

  it('merges when the week on Drive is newer than the import', () => {
    // The reported incident: a flag left over from an older import met a week
    // another device had just written, and overwrote it.
    expect(importPushDecision(IMPORTED_AT, { savedAt: 3_000_000 })).toBe('merge');
  });

  it('pushes on a tie, so re-running an import is not a no-op', () => {
    expect(importPushDecision(IMPORTED_AT, { savedAt: IMPORTED_AT })).toBe('push');
  });

  it('merges when Drive cannot state the age of the week', () => {
    // A file written before appProperties carried savedAt. Unknown is not old.
    expect(importPushDecision(IMPORTED_AT, { savedAt: 0 })).toBe('merge');
    expect(importPushDecision(IMPORTED_AT, { savedAt: undefined })).toBe('merge');
    expect(importPushDecision(IMPORTED_AT, { savedAt: 'x' })).toBe('merge');
  });

  it('never overwrites an existing week on behalf of a legacy flag', () => {
    const legacy = normalizeImportPending('1');
    expect(importPushDecision(legacy.importedAt, { savedAt: 1 })).toBe('merge');
    // With nothing on Drive there is still no reason to hold the upload back.
    expect(importPushDecision(legacy.importedAt, null)).toBe('push');
  });

  it('decides per week, not once for the whole account', () => {
    const drive = new Map([
      ['2026-38', { savedAt: 1_000_000 }],  // older than the import
      ['2026-39', { savedAt: 3_000_000 }],  // newer — another device wrote it
      ['2026-40', undefined],               // not on Drive at all
    ]);
    const decisions = [...drive].map(([wk, entry]) => [wk, importPushDecision(IMPORTED_AT, entry)]);
    expect(decisions).toEqual([
      ['2026-38', 'push'],
      ['2026-39', 'merge'],
      ['2026-40', 'push'],
    ]);
  });
});
