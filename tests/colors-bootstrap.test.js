// A custom branch color used to survive exactly one refresh. Init called the
// async loadBranchColors() without awaiting it, then the theme/lang bootstrap —
// which looked for the colors blob in localStorage, where the IndexedDB
// migration had deleted it, so it always missed — re-saved BRANCH_COLORS while
// those were still the hardcoded defaults. The stored palette was overwritten,
// the in-memory one finished loading and looked right for that session, and the
// next refresh showed the default color.
import { describe, test, expect, beforeEach } from 'vitest';
import {
  _state, loadBranchColors, saveBranchColors, bootstrapColorsSettings,
  saveValueIDB, loadValueIDB, BRANCH_COLORS,
} from './setup.js';

const KEY = 'zenit-week-colors';
const DEFAULT_WORK = BRANCH_COLORS.work.main;

describe('colors settings bootstrap', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.clearIDBStore();
    BRANCH_COLORS.work = { main: DEFAULT_WORK };
  });

  test('a legacy blob gains theme/lang without losing the stored color', async () => {
    await saveValueIDB(KEY, { savedAt: 100, work: { main: '#FFCD29' } });
    await loadBranchColors();
    await bootstrapColorsSettings();
    const stored = await loadValueIDB(KEY);
    expect(stored.work.main).toBe('#FFCD29');
    expect(stored.theme).toBeTruthy();
    expect(stored.lang).toBeTruthy();
  });

  test('a complete blob is left untouched', async () => {
    const blob = { savedAt: 100, theme: 'dark', lang: 'cs', work: { main: '#FFCD29' } };
    await saveValueIDB(KEY, blob);
    await loadBranchColors();
    await bootstrapColorsSettings();
    expect(await loadValueIDB(KEY)).toEqual(blob);
  });

  test('a first run with no stored blob writes one', async () => {
    await loadBranchColors();
    await bootstrapColorsSettings();
    const stored = await loadValueIDB(KEY);
    expect(stored.work.main).toBe(DEFAULT_WORK);
    expect(stored.theme).toBeTruthy();
  });

  test('a color set in one session is still there in the next two', async () => {
    // Session 1 — user picks yellow.
    BRANCH_COLORS.work = { main: '#FFCD29' };
    await saveBranchColors();

    // Two subsequent startups. The load is deliberately not awaited here: that is
    // the init order that lost the color, and the bootstrap must be safe under it.
    for (let i = 0; i < 2; i++) {
      BRANCH_COLORS.work = { main: DEFAULT_WORK }; // fresh page load starts at defaults
      const loading = loadBranchColors();
      await bootstrapColorsSettings();
      await loading;
      expect(BRANCH_COLORS.work.main).toBe('#FFCD29');
      expect((await loadValueIDB(KEY)).work.main).toBe('#FFCD29');
    }
  });

  test('a legacy blob survives the same un-awaited load', async () => {
    await saveValueIDB(KEY, { savedAt: 100, work: { main: '#FFCD29' } });
    const loading = loadBranchColors();
    await bootstrapColorsSettings();
    await loading;
    expect((await loadValueIDB(KEY)).work.main).toBe('#FFCD29');
  });
});
