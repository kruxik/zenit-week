import { describe, test, expect, beforeEach } from 'vitest';
import {
  applyTheme, currentThemePref, resolveTheme, migrateThemeToSystem,
  sanitizeColorsData, loadValueIDB, _state, sandboxGlobal,
} from './setup.js';

// The theme setting is a preference - System, Light or Dark. System follows
// the OS and is the default; data-theme always holds the resolved light/dark.

const DARK_QUERY = '(prefers-color-scheme: dark)';
const systemQuery = () => sandboxGlobal.window._mediaQueries[DARK_QUERY];
const setSystemDark = (dark) => {
  systemQuery().matches = dark;
  systemQuery().listeners.forEach(fn => fn({ matches: dark }));
};

describe('theme preference', () => {
  const doc = _state.getDocument();

  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    systemQuery().matches = false;
  });

  test('a missing or unknown stored value means System', () => {
    expect(currentThemePref()).toBe('system');
    applyTheme('sepia');
    expect(currentThemePref()).toBe('system');
  });

  test('System resolves from the OS; Light and Dark ignore it', () => {
    systemQuery().matches = true;
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    systemQuery().matches = false;
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  test('applyTheme stores the preference and paints the resolved theme', () => {
    systemQuery().matches = true;
    applyTheme('system');
    expect(_state.getLocalStorage('zenit-week-theme')).toBe('system');
    expect(doc.documentElement.dataset.theme).toBe('dark');
  });

  test('an OS flip repaints only while the preference is System', () => {
    applyTheme('system');
    setSystemDark(true);
    expect(doc.documentElement.dataset.theme).toBe('dark');
    setSystemDark(false);
    expect(doc.documentElement.dataset.theme).toBe('light');

    applyTheme('dark');
    setSystemDark(false);
    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(_state.getLocalStorage('zenit-week-theme')).toBe('dark');
  });

  test('the colors blob accepts system and rejects unknown values', () => {
    expect(sanitizeColorsData({ theme: 'system' }).theme).toBe('system');
    expect(sanitizeColorsData({ theme: 'auto' }).theme).toBeUndefined();
  });
});

describe('one-time move to System', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
  });

  test('a saved light/dark becomes System and is pushed in the colors blob', async () => {
    applyTheme('dark');
    await migrateThemeToSystem();
    expect(currentThemePref()).toBe('system');
    expect((await loadValueIDB('zenit-week-colors')).theme).toBe('system');
  });

  test('runs once - a later deliberate pin survives the next boot', async () => {
    await migrateThemeToSystem();
    applyTheme('light');
    await migrateThemeToSystem();
    expect(currentThemePref()).toBe('light');
  });

  test('a device with no saved theme writes nothing but the marker', async () => {
    await migrateThemeToSystem();
    expect(_state.getLocalStorage('zenit-week-theme')).toBeUndefined();
    expect(await loadValueIDB('zenit-week-colors')).toBeFalsy();
  });
});
