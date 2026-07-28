// The colors/settings blob is the second synced file, and unlike week data it
// had no equivalent of validateAndRepair. It arrives from Drive or a JSON
// import, its keys become DOM selectors and its values feed the palette math,
// so both are whitelisted on ingest.
import { describe, test, expect, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  _state, sanitizeColorsData, loadBranchColors, syncColorsFromDrive,
  saveValueIDB, loadValueIDB, BRANCH_COLORS,
} from './setup.js';

describe('sanitizeColorsData', () => {
  test('keeps well-formed branch colors and settings', () => {
    const uuid = '3f6b1c2e-0a4d-4f8b-9c11-2d7e5a8b0c3f';
    const out = sanitizeColorsData({
      savedAt: 1700,
      theme: 'dark',
      lang: 'cs',
      work: { main: '#F24E1E' },
      [uuid]: { main: '#0acf83' },
    });
    expect(out).toEqual({
      savedAt: 1700,
      theme: 'dark',
      lang: 'cs',
      work: { main: '#F24E1E' },
      [uuid]: { main: '#0acf83' },
    });
  });

  test('drops branch ids that would break a DOM selector', () => {
    const out = sanitizeColorsData({
      'work"],[data-branch-dot="me': { main: '#ff0000' },
      'a b': { main: '#ff0000' },
      '': { main: '#ff0000' },
      ['x'.repeat(65)]: { main: '#ff0000' },
      work: { main: '#ff0000' },
    });
    expect(Object.keys(out)).toEqual(['work']);
  });

  test('drops non-hex color values', () => {
    const out = sanitizeColorsData({
      a: { main: 'red' },
      b: { main: '#fff' },
      c: { main: '#12345g' },
      d: { main: 'url(javascript:alert(1))' },
      e: { main: 42 },
      f: { main: null },
      g: {},
      h: 'not-an-object',
      i: { main: '#abcdef' },
    });
    expect(out).toEqual({ i: { main: '#abcdef' } });
  });

  test('drops prototype-pollution keys and unknown settings', () => {
    const out = sanitizeColorsData(JSON.parse(
      '{"__proto__":{"main":"#ff0000"},"constructor":{"main":"#ff0000"},"polluted":true,"savedAt":"soon","theme":"neon","lang":"toString"}'
    ));
    expect(out).toEqual({});
    expect({}.main).toBeUndefined();
  });

  test('tolerates a non-object file', () => {
    expect(sanitizeColorsData(null)).toEqual({});
    expect(sanitizeColorsData('nope')).toEqual({});
    expect(sanitizeColorsData(7)).toEqual({});
  });
});

describe('colors ingest paths', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
  });

  test('loadBranchColors ignores a tampered stored file', async () => {
    const before = BRANCH_COLORS.work.main;
    await saveValueIDB('zenit-week-colors', {
      work: { main: 'javascript:alert(1)' },
      'me"]{x': { main: '#000000' },
    });
    await loadBranchColors();
    expect(BRANCH_COLORS.work.main).toBe(before);
    expect(BRANCH_COLORS['me"]{x']).toBeUndefined();
  });

  test('loadBranchColors still applies a valid stored color', async () => {
    await saveValueIDB('zenit-week-colors', { work: { main: '#0ACF83' } });
    await loadBranchColors();
    expect(BRANCH_COLORS.work.main).toBe('#0ACF83');
  });
});

describe('colors download from Drive', () => {
  const server = setupServer(
    http.get('https://www.googleapis.com/drive/v3/files', () => HttpResponse.json({
      files: [{ id: 'file_id_colors', name: 'zenit-week-colors.json' }],
    })),
    http.get('https://www.googleapis.com/drive/v3/files/file_id_colors', ({ request }) => {
      if (new URL(request.url).searchParams.get('alt') !== 'media') {
        return HttpResponse.json({ id: 'file_id_colors', appProperties: {} });
      }
      return HttpResponse.json({
        savedAt: 9_000_000,
        theme: 'sepia',
        lang: 'constructor',
        work: { main: '#0ACF83' },
        'evil"],[data-branch-dot="me': { main: '#000000' },
        rogue: { main: 'not-a-color' },
      });
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => { server.resetHandlers(); _state.resetSyncState(); });
  afterAll(() => server.close());

  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    _state.setAccessToken('test_token');
    _state.setDriveFileId('colors', 'file_id_colors');
  });

  test('stores only the whitelisted subset', async () => {
    await syncColorsFromDrive();
    const stored = await loadValueIDB('zenit-week-colors');
    expect(stored).toEqual({ savedAt: 9_000_000, work: { main: '#0ACF83' } });
    expect(BRANCH_COLORS.work.main).toBe('#0ACF83');
    expect(BRANCH_COLORS['evil"],[data-branch-dot="me']).toBeUndefined();
    expect(BRANCH_COLORS.rogue).toBeUndefined();
    // Bogus theme/lang never reach the app.
    expect(_state.getLocalStorage('zenit-week-theme')).toBeUndefined();
    expect(_state.getLocalStorage('zenit-week-lang')).toBeUndefined();
  });
});
