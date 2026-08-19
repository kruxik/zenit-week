import { describe, it, expect, beforeEach } from 'vitest';
import { _state, t, applyTranslations } from './setup.js';

describe('Internationalization', () => {
  it('translates keys correctly', () => {
    _state.setLang('en');
    expect(t('todo.done')).toBe('Done');
    
    _state.setLang('cs');
    expect(t('todo.done')).toBe('Hotovo');
  });

  it('has every Stats panel key in both languages', () => {
    const statsKeys = [
      'stats.title', 'stats.planVsReality',
      'stats.planCompletion', 'stats.unplannedLoad', 'stats.unplannedCompletion',
      'stats.legCatPlanned', 'stats.legCatUnplanned',
      'stats.legDone', 'stats.legOpen', 'stats.weekPrefix',
      'stats.followThrough', 'stats.effortBalance', 'stats.baseline',
      'stats.unplannedShort', 'stats.legendDone', 'stats.legendOpen', 'stats.legendUnplanned',
      'stats.emptyWeek', 'stats.emptyWeekHint', 'stats.noUnplanned',
      'stats.theWeek', 'stats.tlDone', 'stats.tlUnpl',
    ];
    for (const lang of ['en', 'cs']) {
      _state.setLang(lang);
      for (const k of statsKeys) {
        const v = t(k);
        expect(v, `${k} missing/blank in ${lang}`).toBeTruthy();
        expect(v, `${k} not translated in ${lang}`).not.toBe(k);
      }
    }
  });

  it('has the node-comment menu label in both languages', () => {
    _state.setLang('en');
    expect(t('menu.comment')).toBe('Comment');

    _state.setLang('cs');
    expect(t('menu.comment')).toBe('Komentář');
  });

  it('updates DOM elements on language change', () => {
    _state.setLang('en');
    // Mock some elements that applyTranslations updates
    const helpBtn = _state.getElement('help-fab');
    helpBtn.dataset.i18nTitle = 'help.fab';
    const settingsBtn = _state.getElement('settings-btn');
    
    applyTranslations();
    
    // In zenit-week.html, applyTranslations sets title/aria-label/textContent
    // Let's check help-fab's title
    expect(helpBtn.title).toBe('Help & Hotkeys');
    
    _state.setLang('cs');
    applyTranslations();
    expect(helpBtn.title).toBe('Nápověda & klávesové zkratky');
  });
});
