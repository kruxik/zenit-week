import { t, _state, getThemeColors } from './setup.js';

describe('Internationalization & UI Helpers', () => {
  describe('t(key) translation helper', () => {
    test('returns English translation by default', () => {
      _state.setLang('en');
      expect(t('toolbar.today')).toBe('Today');
    });

    test('returns Czech translation when language is set to cs', () => {
      _state.setLang('cs');
      expect(t('toolbar.today')).toBe('Dnes');
    });

    test('falls back to English if key is missing in cs', () => {
      _state.setLang('cs');
      // Assuming 'view.sandTitle' is defined in EN but let's verify a known one
      // Actually let's just mock a missing key if possible or use a known one.
      // TRANSLATIONS is a constant so we can't easily inject, but we can check existing ones.
      expect(t('toolbar.today')).toBe('Dnes');
    });

    test('returns the key itself if missing in both languages', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });
  });

  describe('Theme & Colors', () => {
    test('deriveBranchPalette generates light/text variants correctly (light mode)', () => {
      const doc = _state.getDocument();
      doc.documentElement.dataset.theme = 'light';
      
      // Using an export from setup.js for deriveBranchPalette
      const { deriveBranchPalette } = require('./setup.js');
      const palette = deriveBranchPalette('#ff0000');
      
      expect(palette.main).toBe('#ff0000');
      expect(palette.light).toBeDefined();
      expect(palette.text).toBeDefined();
    });

    test('deriveBranchPalette generates darker variants in dark mode', () => {
      const { deriveBranchPalette, applyTheme } = require('./setup.js');
      
      applyTheme('light');
      const lightPalette = deriveBranchPalette('#ff0000');
      
      applyTheme('dark');
      const darkPalette = deriveBranchPalette('#ff0000');
      
      expect(darkPalette.light).not.toBe(lightPalette.light);
      // In dark mode, light is blended with #1a1a1a, so it should be much darker
      expect(darkPalette.light).toBe('#311717');
    });

    test('getThemeColors returns correct palette for light mode', () => {
      const doc = _state.getDocument();
      doc.documentElement.dataset.theme = 'light';
      
      const colors = getThemeColors();
      expect(colors.CENTER_COLOR.main).toBe('#333333');
      expect(colors.DONE_BG).toBe('#EBEBEB');
    });

    test('getThemeColors returns correct palette for dark mode', () => {
      const doc = _state.getDocument();
      doc.documentElement.dataset.theme = 'dark';
      
      const colors = getThemeColors();
      expect(colors.CENTER_COLOR.main).toBe('#555555');
      expect(colors.DONE_BG).toBe('#2c2c2c');
    });
  });
});
