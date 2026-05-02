import { describe, it, expect, beforeEach } from 'vitest';
import { _state, t, applyTranslations } from './setup.js';

describe('Internationalization', () => {
  it('translates keys correctly', () => {
    _state.setLang('en');
    expect(t('todo.done')).toBe('Done');
    
    _state.setLang('cs');
    expect(t('todo.done')).toBe('Hotovo');
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
