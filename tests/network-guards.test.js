import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  netFetch,
  isDefinitelyOffline,
  requestAssetUpdateCheck,
  checkForAssetUpdate,
  requestPersistentStorage,
  _state,
} from './setup.js';

const sandbox = _state.sandbox;

// The app calls the bare global `fetch`, which resolves through the VM's global
// object — swapping it out captures every request the code under test makes.
let realFetch;
let calls;

function stubFetch(impl) {
  sandbox.fetch = (input, init) => {
    calls.push({ input, init });
    return impl ? impl(input, init) : Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
    });
  };
}

beforeEach(() => {
  realFetch = sandbox.fetch;
  calls = [];
  delete sandbox.navigator.onLine;
});

afterEach(() => {
  sandbox.fetch = realFetch;
  delete sandbox.navigator.onLine;
});

describe('isDefinitelyOffline', () => {
  it('is true only when the browser positively reports no link', () => {
    sandbox.navigator.onLine = false;
    expect(isDefinitelyOffline()).toBe(true);
  });

  it('is false when a link is reported — true proves nothing, so it must not gate', () => {
    sandbox.navigator.onLine = true;
    expect(isDefinitelyOffline()).toBe(false);
  });

  it('is false when the browser says nothing at all', () => {
    expect(isDefinitelyOffline()).toBe(false);
  });
});

describe('netFetch', () => {
  it('attaches an abort signal to every request', async () => {
    stubFetch();
    await netFetch('/api/token', { method: 'POST' });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal).toBeInstanceOf(sandbox.AbortSignal);
  });

  it('passes the caller options through untouched', async () => {
    stubFetch();
    await netFetch('/api/token', { method: 'POST', body: '{}', timeoutMs: 50 });
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{}');
    // timeoutMs is consumed by netFetch, not forwarded to fetch().
    expect(calls[0].init.timeoutMs).toBeUndefined();
  });

  it('aborts the signal once the deadline passes', async () => {
    stubFetch();
    await netFetch('/slow', { timeoutMs: 10 });
    const { signal } = calls[0].init;
    expect(signal.aborted).toBe(false);
    await new Promise(r => setTimeout(r, 40));
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
  });

  it('rejects a request that never answers, rather than hanging forever', async () => {
    // A server that accepts the connection and says nothing — the exact failure
    // that used to leave the sync badge spinning for the rest of the session.
    stubFetch((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));
    await expect(netFetch('/hang', { timeoutMs: 10 })).rejects.toThrow(/aborted|timed out/i);
  });

  it('defaults to the shared timeout when none is given', async () => {
    const { NET_TIMEOUT_MS } = _state.getNetTimeouts();
    expect(NET_TIMEOUT_MS).toBeGreaterThan(0);
    stubFetch();
    await netFetch('/api/token');
    expect(calls[0].init.signal.aborted).toBe(false);
  });
});

describe('checkForAssetUpdate', () => {
  it('makes no request while the device has no link', async () => {
    sandbox.navigator.onLine = false;
    stubFetch();
    await checkForAssetUpdate();
    expect(calls).toHaveLength(0);
  });

  it('probes with HEAD, and with the shorter probe deadline', async () => {
    const { NET_PROBE_TIMEOUT_MS, NET_TIMEOUT_MS } = _state.getNetTimeouts();
    expect(NET_PROBE_TIMEOUT_MS).toBeLessThan(NET_TIMEOUT_MS);
    stubFetch();
    await checkForAssetUpdate();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('HEAD');
  });

  it('survives a probe that rejects', async () => {
    stubFetch(() => Promise.reject(new Error('network down')));
    await expect(checkForAssetUpdate()).resolves.toBeUndefined();
  });
});

describe('requestAssetUpdateCheck throttle', () => {
  let probes;
  let realCheck;

  beforeEach(() => {
    probes = 0;
    realCheck = sandbox.checkForAssetUpdate;
    sandbox.checkForAssetUpdate = () => { probes++; };
    _state.setLastProbeAt(0);
  });

  afterEach(() => {
    sandbox.checkForAssetUpdate = realCheck;
    _state.setLastProbeAt(0);
  });

  it('collapses the visibilitychange + focus pair into a single probe', () => {
    // Both events fire on one desktop tab switch; three returns to the tab used
    // to cost six probes.
    for (let i = 0; i < 3; i++) {
      requestAssetUpdateCheck();  // visibilitychange
      requestAssetUpdateCheck();  // focus
    }
    expect(probes).toBe(1);
  });

  it('probes again once the throttle window has elapsed', () => {
    const { PROBE_MIN_INTERVAL_MS } = _state.getNetTimeouts();
    requestAssetUpdateCheck();
    expect(probes).toBe(1);
    _state.setLastProbeAt(Date.now() - PROBE_MIN_INTERVAL_MS - 1);
    requestAssetUpdateCheck();
    expect(probes).toBe(2);
  });

  it('records when it last probed, so the window is real', () => {
    _state.setLastProbeAt(0);
    requestAssetUpdateCheck();
    expect(_state.getLastProbeAt()).toBeGreaterThan(0);
  });
});

describe('requestPersistentStorage', () => {
  afterEach(() => { delete sandbox.navigator.storage; });

  it('does nothing where the API is absent', async () => {
    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });

  it('asks for persistence when it has not been granted yet', async () => {
    let asked = 0;
    sandbox.navigator.storage = {
      persisted: async () => false,
      persist: async () => { asked++; return true; },
    };
    await requestPersistentStorage();
    expect(asked).toBe(1);
  });

  it('never re-asks once granted — that would be a second permission prompt', async () => {
    let asked = 0;
    sandbox.navigator.storage = {
      persisted: async () => true,
      persist: async () => { asked++; return true; },
    };
    await requestPersistentStorage();
    expect(asked).toBe(0);
  });

  it('swallows a rejection from the storage manager', async () => {
    sandbox.navigator.storage = {
      persisted: async () => { throw new Error('not allowed'); },
      persist: async () => true,
    };
    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });
});
