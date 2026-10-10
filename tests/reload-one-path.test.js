import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  _state, sandboxGlobal, buildRestorePayload,
  isReloadNavigation, readReloadRestore, saveViewStateOnLeave, reloadApp, reloadAppFresh,
} from './setup.js';

// Every reload - browser F5 / Cmd+R / its button, the pull-down
// gesture, the quiet update reload - goes one way: saved on `pagehide`,
// restored at boot only when the browser reports a reload. These tests pin
// both halves, and the source guards below keep a second path from creeping
// back in.

const perf = (type) => ({ getEntriesByType: () => (type ? [{ type }] : []) });
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), has: k => m.has(k) };
};

describe('isReloadNavigation', () => {
  it('true only for a reload', () => {
    expect(isReloadNavigation(perf('reload'))).toBe(true);
    expect(isReloadNavigation(perf('navigate'))).toBe(false);
    expect(isReloadNavigation(perf('back_forward'))).toBe(false);
  });

  it('falls back to the legacy navigation type', () => {
    expect(isReloadNavigation({ getEntriesByType: () => [], navigation: { type: 1 } })).toBe(true);
    expect(isReloadNavigation({ getEntriesByType: () => [], navigation: { type: 0 } })).toBe(false);
    expect(isReloadNavigation(null)).toBe(false);
  });
});

describe('readReloadRestore - the way in', () => {
  const KEY = _state.getRestoreKey();
  const saved = (over = {}) => JSON.stringify(buildRestorePayload({
    panX: 1, panY: 2, zoom: 1, currentView: 'agenda', currentWeekKey: '2026-40',
    hoveredNodeId: null, commentNodeId: 'n1', helpOpen: false, now: 1000, ...over,
  }));

  it('restores view, week and open comment after a reload', () => {
    const storage = memStorage({ [KEY]: saved() });
    const r = readReloadRestore({ storage, perf: perf('reload'), currentWeekKey: '2026-40', now: 2000 });
    expect(r).toMatchObject({ currentView: 'agenda', currentWeekKey: '2026-40', commentNodeId: 'n1', helpOpen: false });
    expect(storage.has(KEY)).toBe(false); // consumed
  });

  it('restores an open Help panel', () => {
    const storage = memStorage({ [KEY]: saved({ commentNodeId: null, helpOpen: true }) });
    expect(readReloadRestore({ storage, perf: perf('reload'), currentWeekKey: '2026-40', now: 2000 }).helpOpen).toBe(true);
  });

  it('a fresh open never restores - and still consumes what the last tab left', () => {
    const storage = memStorage({ [KEY]: saved() });
    expect(readReloadRestore({ storage, perf: perf('navigate'), currentWeekKey: '2026-40', now: 2000 })).toBe(null);
    expect(storage.has(KEY)).toBe(false);
  });

  it('refuses a payload for another week, a stale one, or garbage', () => {
    const at = (raw, wk = '2026-40', now = 2000) =>
      readReloadRestore({ storage: memStorage({ [KEY]: raw }), perf: perf('reload'), currentWeekKey: wk, now });
    expect(at(saved(), '2026-41')).toBe(null);
    expect(at(saved(), '2026-40', 1000 + 6 * 60 * 1000)).toBe(null);
    expect(at('{nope')).toBe(null);
  });
});

describe('the way out, and the two ways to reload', () => {
  const KEY = _state.getRestoreKey();
  let reloads;
  let origReload;
  let origNavigator;

  beforeEach(() => {
    reloads = 0;
    origReload = sandboxGlobal.location.reload;
    origNavigator = sandboxGlobal.navigator;
    sandboxGlobal.location.reload = () => { reloads++; };
    _state.setReloadFresh(false);
    sandboxGlobal.localStorage.removeItem(KEY);
  });

  afterEach(() => {
    sandboxGlobal.location.reload = origReload;
    sandboxGlobal.navigator = origNavigator;
    _state.setReloadFresh(false);
    sandboxGlobal.localStorage.removeItem(KEY);
  });

  it('leaving the page saves the view', () => {
    saveViewStateOnLeave();
    const saved = JSON.parse(sandboxGlobal.localStorage.getItem(KEY));
    expect(saved).toMatchObject({ currentWeekKey: expect.any(String), commentNodeId: null, helpOpen: false });
  });

  it('reloadApp reloads the document when there is one to come back to', async () => {
    expect(await reloadApp()).toBe('reloading');
    expect(reloads).toBe(1);
  });

  it('offline with no service worker, reloadApp re-opens the week in place instead', async () => {
    sandboxGlobal.navigator = { ...origNavigator, onLine: false };
    expect(await reloadApp()).toBe('reopened');
    expect(reloads).toBe(0);
  });

  it('sign-out and reset reload fresh: nothing saved on the way out', () => {
    sandboxGlobal.localStorage.setItem(KEY, '{"left":"over"}');
    reloadAppFresh();
    expect(reloads).toBe(1);
    expect(sandboxGlobal.localStorage.getItem(KEY)).toBe(null);
    saveViewStateOnLeave(); // the pagehide that follows
    expect(sandboxGlobal.localStorage.getItem(KEY)).toBe(null);
  });
});

describe('one path - source guards', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'zenit-week.html'), 'utf8');
  const script = html.match(/<script\s+id="app-script">([\s\S]*?)<\/script>/)[1];
  const code = script.replace(/^\s*\/\/.*$/gm, ''); // line comments only
  const body = (name) => {
    const start = code.search(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
    expect(start, `${name} exists`).toBeGreaterThan(-1);
    // The body's brace follows the parameter list - which may itself hold a
    // destructuring `{ … }`, so look for `) {`, not the first brace.
    let depth = 0, i = code.indexOf(') {', start) + 2;
    const from = i;
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) break;
    }
    return code.slice(from, i + 1);
  };

  it('location.reload() is called in exactly two places: reloadApp and reloadAppFresh', () => {
    expect(code.match(/location\.reload\(\)/g)).toHaveLength(2);
    expect(body('reloadApp')).toContain('location.reload()');
    expect(body('reloadAppFresh')).toContain('location.reload()');
  });

  it('the view is saved in one place: the pagehide handler', () => {
    expect(code.match(/stashViewStateForReload\(/g)).toHaveLength(2); // definition + saveViewStateOnLeave
    expect(body('saveViewStateOnLeave')).toContain('stashViewStateForReload()');
    expect(code).toMatch(/addEventListener\('pagehide', saveViewStateOnLeave\)/);
  });

  it('boot restores only through readReloadRestore', () => {
    expect(code.match(/readReloadRestore\(/g)).toHaveLength(2); // definition + boot
    expect(code.match(/getItem\(RESTORE_KEY\)/g)).toHaveLength(1);
    expect(body('readReloadRestore')).toContain('getItem(RESTORE_KEY)');
  });

  it('boot reopens the comment and Help only after the saved view is applied', () => {
    // switchView closes Help, so a reopen above it would be undone at once.
    const applyView = code.indexOf('switchView(currentView);');
    expect(applyView).toBeGreaterThan(-1);
    expect(code.indexOf('openCommentDialog(_quietRestore.commentNodeId)')).toBeGreaterThan(applyView);
    expect(code.indexOf('if (_quietRestore && _quietRestore.helpOpen) openHelp()')).toBeGreaterThan(applyView);
  });

  it('the pull-down gesture and the quiet update reload use reloadApp', () => {
    expect(body('performPullRefresh')).toContain('reloadApp()');
    expect(body('_fireQuietReload')).toContain('reloadApp()');
    for (const name of ['performPullRefresh', '_fireQuietReload']) {
      expect(body(name)).not.toMatch(/location\.reload|stashViewStateForReload/);
    }
  });

  it('sign-out and reset use reloadAppFresh', () => {
    expect(body('signOutAndClear')).toContain('reloadAppFresh()');
    expect(body('devResetApp')).toContain('reloadAppFresh()');
  });
});
