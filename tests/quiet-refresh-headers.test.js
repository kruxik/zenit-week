import { describe, it, expect } from 'vitest';
import { parseAssetVersionHeaders } from './setup.js';

// Mimic the case-insensitive Headers.get() contract used in real Fetch.
function makeHeaders(map) {
  return {
    get(name) {
      const lc = name.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lc) return v;
      }
      return null;
    }
  };
}

describe('parseAssetVersionHeaders', () => {
  it('prefers ETag over Last-Modified', () => {
    const h = makeHeaders({ etag: '"abc123"', 'last-modified': 'Mon, 11 May 2026 09:00:00 GMT' });
    expect(parseAssetVersionHeaders(h)).toEqual({
      etag: '"abc123"',
      lastModified: 'Mon, 11 May 2026 09:00:00 GMT',
      token: '"abc123"',
    });
  });

  it('falls back to Last-Modified when ETag is absent', () => {
    const h = makeHeaders({ 'last-modified': 'Mon, 11 May 2026 09:00:00 GMT' });
    const r = parseAssetVersionHeaders(h);
    expect(r.etag).toBeNull();
    expect(r.token).toBe('Mon, 11 May 2026 09:00:00 GMT');
  });

  it('returns null token when both headers absent', () => {
    const h = makeHeaders({});
    expect(parseAssetVersionHeaders(h)).toEqual({
      etag: null,
      lastModified: null,
      token: null,
    });
  });

  it('preserves weak ETag prefix as-is', () => {
    const h = makeHeaders({ etag: 'W/"deadbeef"' });
    expect(parseAssetVersionHeaders(h).token).toBe('W/"deadbeef"');
  });

  it('reads case-insensitively (uppercase ETag header)', () => {
    const h = makeHeaders({ ETag: '"X"' });
    expect(parseAssetVersionHeaders(h).token).toBe('"X"');
  });

  it('reads case-insensitively (mixed-case Last-Modified)', () => {
    const h = makeHeaders({ 'Last-Modified': 'Tue, 12 May 2026 10:00:00 GMT' });
    expect(parseAssetVersionHeaders(h).token).toBe('Tue, 12 May 2026 10:00:00 GMT');
  });

  it('returns null token when ETag is empty string', () => {
    const h = makeHeaders({ etag: '', 'last-modified': '' });
    expect(parseAssetVersionHeaders(h).token).toBeNull();
  });
});
