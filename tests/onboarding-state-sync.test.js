// Onboarding state is a device fact — "this browser has seen the tour" — not
// user data. It lives in localStorage so a data wipe doesn't replay the first
// run, and it rides in the settings file so a second device stays quiet too.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _state, sanitizeColorsData, onboardingSettings, mergeRemoteOnboarding,
  writeBoolPref, readBoolPref, readTipsSeen,
} from './setup.js';

const remote = (over = {}) =>
  ({ onboarded: false, nudged: false, tipsEnabled: true, seen: {}, ...over });

describe('Onboarding state in the settings blob', () => {
  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
  });

  it('defaults to a first run: nothing seen, tips on', () => {
    expect(onboardingSettings()).toEqual({
      onboarded: false, nudged: false, tipsEnabled: true, seen: {},
    });
  });

  it('survives the settings sanitiser', () => {
    writeBoolPref('zenit-week-onboarded', true);
    const out = sanitizeColorsData({ savedAt: 1, onboarding: onboardingSettings() });
    expect(out.onboarding.onboarded).toBe(true);
  });

  it('drops junk and prototype keys out of a remote seen map', () => {
    const out = sanitizeColorsData({
      onboarding: { onboarded: 'yes', seen: { 'node-tip': true, '__proto__': true, 'bad id!': true } },
    });
    expect(out.onboarding.onboarded).toBe(true);       // coerced
    expect(Object.keys(out.onboarding.seen)).toEqual(['node-tip']);
  });

  it('is not treated as a branch colour', () => {
    const out = sanitizeColorsData({ work: { main: '#F24E1E' }, onboarding: { seen: {} } });
    expect(out.work).toEqual({ main: '#F24E1E' });
    expect(out.onboarding).toBeDefined();
  });

  it('unions seen tips from another device, whichever side is newer', () => {
    _state.setTipsSeen({ 'tip-a': true });
    mergeRemoteOnboarding(remote({ seen: { 'tip-b': true } }), false);
    expect(readTipsSeen()).toEqual({ 'tip-a': true, 'tip-b': true });
  });

  it('adopts onboarded and nudged from the remote — true always wins', () => {
    mergeRemoteOnboarding(remote({ onboarded: true, nudged: true }), false);
    expect(readBoolPref('zenit-week-onboarded', false)).toBe(true);
    expect(readBoolPref('zenit-week-playground-nudged', false)).toBe(true);
  });

  it('never un-sets a local flag the remote lacks', () => {
    writeBoolPref('zenit-week-onboarded', true);
    mergeRemoteOnboarding(remote(), true);
    expect(readBoolPref('zenit-week-onboarded', false)).toBe(true);
  });

  it('follows the newer side for the Show tips switch', () => {
    writeBoolPref('zenit-week-tips-enabled', true);
    mergeRemoteOnboarding(remote({ tipsEnabled: false }), true);
    expect(readBoolPref('zenit-week-tips-enabled', true)).toBe(false);
  });

  it('ignores an older side for the Show tips switch', () => {
    writeBoolPref('zenit-week-tips-enabled', true);
    mergeRemoteOnboarding(remote({ tipsEnabled: false }), false);
    expect(readBoolPref('zenit-week-tips-enabled', true)).toBe(true);
  });

  it('asks for a push only when this device knows more', () => {
    _state.setTipsSeen({ 'tip-a': true });
    expect(mergeRemoteOnboarding(remote({ seen: { 'tip-a': true } }), false)).toBe(false);
    expect(mergeRemoteOnboarding(remote({ seen: {} }), false)).toBe(true);
  });
});
