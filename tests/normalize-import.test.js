import { normalizeImportKey } from './setup.js';

describe('normalizeImportKey', () => {
  test('passes through zenit-week- prefixed keys unchanged', () => {
    expect(normalizeImportKey('zenit-week-2026-14')).toBe('zenit-week-2026-14');
  });

  test('converts week-planner- prefix to zenit-week-', () => {
    expect(normalizeImportKey('week-planner-2025-01')).toBe('zenit-week-2025-01');
  });

  test('returns null for unrecognized prefix', () => {
    expect(normalizeImportKey('other-app-2026-14')).toBe(null);
  });

  test('returns null for empty string', () => {
    expect(normalizeImportKey('')).toBe(null);
  });

  test('preserves non-week suffixes after prefix', () => {
    expect(normalizeImportKey('zenit-week-colors')).toBe('zenit-week-colors');
    expect(normalizeImportKey('week-planner-colors')).toBe('zenit-week-colors');
  });

  test('handles zenit-week- prefix with no suffix', () => {
    expect(normalizeImportKey('zenit-week-')).toBe('zenit-week-');
  });

  test('does not double-convert zenit-week- keys', () => {
    const key = 'zenit-week-2026-22';
    expect(normalizeImportKey(normalizeImportKey(key))).toBe(key);
  });
});
