import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { _state, saveWeekIDB } from './setup.js';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');
const TABS = ['account', 'general', 'ai', 'data', 'dev'];

const el = (id) => _state.getElement(id);
const pane = (name) => el('settings-pane-' + name);
// The pane the user sees - the only one in layout.
const shownPanes = () => TABS.filter(name => !pane(name).hidden);

function key(k) {
  for (const fn of el('settings-tabs')._listeners.keydown || []) {
    fn({ key: k, preventDefault: () => {} });
  }
}

/** Markup of one pane, from its opening tag to the next pane (or the dialog end). */
function paneMarkup(name) {
  const start = SRC.indexOf(`id="settings-pane-${name}"`);
  const next = SRC.indexOf('class="settings-pane"', start + 1);
  return SRC.slice(start, next > 0 ? next : SRC.indexOf('<button type="button" id="perf-probe-arm"'));
}

describe('Settings dialog tabs', () => {
  beforeEach(() => {
    _state.setEditState(null);
    el('settings-tab-ai').hidden = true;
    el('settings-tab-dev').hidden = true;
    _state.setSyncStatus('disconnected');
    _state.selectSettingsTab('account');
    _state.closeSettings();
  });

  it('opens from the account button on Account with only its pane shown', () => {
    _state.openSettings();
    expect(_state.isSettingsOpen()).toBe(true);
    expect(el('account-btn').classList.contains('active')).toBe(true);
    expect(shownPanes()).toEqual(['account']);
    _state.closeSettings();
    expect(el('account-btn').classList.contains('active')).toBe(false);
  });

  it('opens on Account when sync is in error, whatever tab was last used', () => {
    _state.selectSettingsTab('data');
    _state.setSyncStatus('error');
    _state.openSettings();
    expect(_state.getSettingsTab()).toBe('account');
  });

  it('lays out only the open tab, so the window is as tall as its content', () => {
    _state.openSettings();
    expect(shownPanes()).toEqual(['account']);
    el('settings-tab-ai').hidden = false;
    _state.selectSettingsTab('ai');
    expect(shownPanes()).toEqual(['ai']);
    _state.selectSettingsTab('data');
    expect(shownPanes()).toEqual(['data']);
  });

  it('never selects a hidden tab', () => {
    _state.selectSettingsTab('ai');
    expect(_state.getSettingsTab()).toBe('account');
    _state.selectSettingsTab('dev');
    expect(shownPanes()).toEqual(['account']);
  });

  it('shows a revealed tab and remembers it across close and reopen', () => {
    el('settings-tab-ai').hidden = false;
    _state.selectSettingsTab('ai');
    expect(shownPanes()).toEqual(['ai']);
    expect(el('settings-tab-ai').tabIndex).toBe(0);
    expect(el('settings-tab-general').tabIndex).toBe(-1);
    _state.closeSettings();
    _state.openSettings();
    expect(shownPanes()).toEqual(['ai']);
  });

  it('arrow keys walk the shown tabs only, wrapping at both ends', () => {
    _state.openSettings();
    key('ArrowRight');
    expect(_state.getSettingsTab()).toBe('general');
    key('ArrowRight');
    expect(_state.getSettingsTab()).toBe('data');
    key('ArrowRight');
    expect(_state.getSettingsTab()).toBe('account');
    key('ArrowLeft');
    expect(_state.getSettingsTab()).toBe('data');
    el('settings-tab-dev').hidden = false;
    key('End');
    expect(_state.getSettingsTab()).toBe('dev');
    key('Home');
    expect(_state.getSettingsTab()).toBe('account');
    // Up and down walk the strip the same way as left and right.
    key('ArrowDown');
    expect(_state.getSettingsTab()).toBe('general');
    key('ArrowUp');
    expect(_state.getSettingsTab()).toBe('account');
  });

  it('owns the keyboard while open: a bare view hotkey does not switch view', () => {
    _state.setCurrentView('agenda');
    _state.openSettings();
    _state.triggerKeydown({
      key: 'm', preventDefault: () => {}, stopPropagation: () => {},
      target: { tagName: 'DIV' }, metaKey: false, ctrlKey: false, shiftKey: false,
    });
    expect(_state.getCurrentView()).toBe('agenda');
    expect(_state.isSettingsOpen()).toBe(true);
  });

  it('closes on its X and on the backdrop, not on a click inside the dialog', () => {
    _state.openSettings();
    for (const fn of el('settings-close')._listeners.click) fn({});
    expect(_state.isSettingsOpen()).toBe(false);

    _state.openSettings();
    const overlay = el('settings-overlay');
    for (const fn of overlay._listeners.click) fn({ target: el('settings-dialog') });
    expect(_state.isSettingsOpen()).toBe(true);
    for (const fn of overlay._listeners.click) fn({ target: overlay });
    expect(_state.isSettingsOpen()).toBe(false);
  });
});

describe('Settings dialog height', () => {
  // The window follows its content's height, eased from the height it had.
  it('eases from the settled height to the new one, then lets go', async () => {
    const dialog = el('settings-dialog');
    dialog.getBoundingClientRect = () => ({ height: 300 });
    _state.openSettings();
    dialog.getBoundingClientRect = () => ({ height: 420 });
    _state.animateSettingsHeight();
    expect(dialog.style.height).toBe('420px');
    expect(dialog.style.transition).toContain('height');
    // No scrollbar while it is merely catching up with its content.
    expect(dialog.classList.contains('settings-height-moving')).toBe(true);
    await new Promise(r => setTimeout(r, 260));
    expect(dialog.classList.contains('settings-height-moving')).toBe(false);
    expect(dialog.style.height).toBe('');
    expect(dialog.style.transition).toBe('');
    _state.closeSettings();
  });

  it('does nothing while closed, and clears on close', () => {
    const dialog = el('settings-dialog');
    _state.closeSettings();
    dialog.getBoundingClientRect = () => ({ height: 500 });
    _state.animateSettingsHeight();
    expect(dialog.style.height).toBe('');
  });
});

describe('Settings Data summary', () => {
  it('counts the stored weeks and names the first one, in calendar order', async () => {
    _state.clearIDBStore();
    await saveWeekIDB('2026-14', { nodes: [] });
    await saveWeekIDB('2025-52', { nodes: [] });
    await saveWeekIDB('2026-3', { nodes: [] });
    await _state.refreshDataSummary();
    expect(el('data-weeks-count').textContent).toBe('3');
    expect(el('data-first-week').textContent).toBe('52 / 2025');
  });

  it('marks the data as local when no Drive account is signed in', async () => {
    _state.clearIDBStore();
    await _state.refreshDataSummary();
    expect(el('data-section').dataset.state).toBe('local');
    expect(el('data-weeks-count').textContent).toBe('0');
    expect(el('data-first-week').textContent).toBe('-');
  });
});

describe('Settings dialog markup', () => {
  const CONTROLS = {
    general: ['zoom-track', 'lang-select', 'theme-select', 'autolayout-toggle', 'tips-toggle', 'tips-replay-btn', 'settings-help-btn'],
    ai: ['bridge-toggle', 'bridge-status', 'bridge-agents', 'bridge-guide', 'bridge-unpair-btn'],
    data: ['import-data-btn', 'export-data-btn', 'import-file-input', 'import-error'],
    dev: ['dev-probe-btn', 'dev-reset-btn'],
  };

  for (const [name, ids] of Object.entries(CONTROLS)) {
    it(`puts every ${name} control in the ${name} pane`, () => {
      const markup = paneMarkup(name);
      for (const id of ids) expect(markup, id).toContain(`id="${id}"`);
    });
  }

  it('ships the AI and Development tabs hidden and every pane but General hidden', () => {
    expect(SRC).toMatch(/id="settings-tab-ai"[^>]* hidden>/);
    expect(SRC).toMatch(/id="settings-tab-dev"[^>]* hidden>/);
    for (const name of ['ai', 'data', 'dev']) {
      expect(SRC).toMatch(new RegExp(`id="settings-pane-${name}"[^>]* hidden>`));
    }
    expect(SRC).not.toMatch(/id="settings-pane-general"[^>]* hidden>/);
  });

  it('reveals the AI tab only from initBridgeSettings', () => {
    const at = SRC.indexOf('function initBridgeSettings()');
    const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
    expect(body).toContain("getElementById('settings-tab-ai')");
    expect(body).toMatch(/matchMedia\('\(pointer: fine\)'\)/);
  });
});
