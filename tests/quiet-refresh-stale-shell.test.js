import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _state, _noteStaleShell, _noteProbedVersion } from './setup.js';

const sandbox = _state.sandbox;

// The saved token is the last deployed version this device has seen, not the
// one the page runs. A phone once sat a build behind because the worker's
// "shell updated" report matched that saved token and was dropped.
describe('quiet refresh — a stale shell is never ignored', () => {
  let reloadTries;
  let realTry;

  beforeEach(() => {
    reloadTries = 0;
    realTry = sandbox.tryQuietReload;
    sandbox.tryQuietReload = () => { reloadTries++; };
    sandbox.localStorage.removeItem('zenit-week-asset-etag');
    _state.resetPendingReload();
  });

  afterEach(() => {
    sandbox.tryQuietReload = realTry;
    _state.resetPendingReload();
  });

  it('arms the reload on the worker report even when the token was already seen', () => {
    sandbox.localStorage.setItem('zenit-week-asset-etag', '"v2"');
    _noteStaleShell('"v2"');
    expect(_state.getPendingReload()).toBe(true);
    expect(reloadTries).toBe(1);
  });

  it('arms the reload on the very first worker report, with no baseline yet', () => {
    _noteStaleShell('"v2"');
    expect(_state.getPendingReload()).toBe(true);
    expect(sandbox.localStorage.getItem('zenit-week-asset-etag')).toBe('"v2"');
  });

  it('only seeds a baseline from the first probe — a page fresh off the network is current', async () => {
    await _noteProbedVersion('"v1"');
    expect(_state.getPendingReload()).toBe(false);
    expect(sandbox.localStorage.getItem('zenit-week-asset-etag')).toBe('"v1"');
  });

  it('arms the reload when a probe sees a new token', async () => {
    sandbox.localStorage.setItem('zenit-week-asset-etag', '"v1"');
    await _noteProbedVersion('"v2"');
    expect(_state.getPendingReload()).toBe(true);
  });

  it('stays quiet when a probe sees the same token', async () => {
    sandbox.localStorage.setItem('zenit-week-asset-etag', '"v1"');
    await _noteProbedVersion('"v1"');
    expect(_state.getPendingReload()).toBe(false);
  });
});
