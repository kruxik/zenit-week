import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const swCode = readFileSync(resolve(__dirname, '../sw.js'), 'utf8');

const ORIGIN = 'https://zenitweek.com';

function makeResponse({ ok = true, status = 200, etag = null, lastModified = null, tag = 'body' } = {}) {
  const headers = {
    get(name) {
      const lc = name.toLowerCase();
      if (lc === 'etag') return etag;
      if (lc === 'last-modified') return lastModified;
      return null;
    },
  };
  const resp = { ok, status, headers, tag };
  resp.clone = () => ({ ...resp, clone: resp.clone });
  return resp;
}

function makeCache() {
  const store = new Map();
  return {
    store,
    async match(key) { return store.get(key); },
    async put(key, value) { store.set(key, value); },
  };
}

// Boots sw.js in an isolated context with the worker globals it expects, and
// hands back both the context and the recorded event listeners.
function loadWorker({ onLine, fetchImpl, clients = [] } = {}) {
  const listeners = {};
  const cache = makeCache();
  const posted = [];
  const fetches = [];

  const clientStubs = clients.map(url => ({
    url,
    postMessage: msg => posted.push({ url, msg }),
  }));

  const ctx = {
    console: { debug() {}, warn() {}, error() {} },
    URL,
    AbortSignal,
    Response: class {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status ?? 200;
        this.ok = this.status < 400;
        this.headers = init.headers || {};
      }
    },
    caches: {
      _names: ['zw-shell-v0', 'zw-shell-v1'],
      async open() { return cache; },
      async keys() { return this._names; },
      async delete(name) { this._names = this._names.filter(n => n !== name); return true; },
    },
    fetch: (input, init) => {
      fetches.push({ input, init });
      if (fetchImpl) return fetchImpl(input, init);
      return Promise.resolve(makeResponse({ etag: '"fresh"' }));
    },
  };
  ctx.self = {
    location: new URL('/sw.js', ORIGIN),
    navigator: onLine === undefined ? {} : { onLine },
    skipWaiting: () => { ctx.self._skipWaitingCalls = (ctx.self._skipWaitingCalls || 0) + 1; },
    clients: {
      claim: async () => {},
      matchAll: async () => clientStubs,
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  vm.createContext(ctx);
  vm.runInContext(swCode, ctx);
  return { ctx, listeners, cache, posted, fetches };
}

function navEvent(url) {
  const waits = [];
  const responses = [];
  return {
    request: { url, method: 'GET', mode: 'navigate' },
    waitUntil: p => { waits.push(p); return p; },
    respondWith: p => { responses.push(p); return p; },
    waits,
    responses,
  };
}

describe('sw.js — request routing', () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  it('claims the app document on every URL it is served from', () => {
    for (const path of ['/app', '/app/', '/app/anything', '/zenit-week.html']) {
      expect(w.ctx.isAppDocument(new URL(path, ORIGIN))).toBe(true);
    }
  });

  it('does not mistake the marketing pages, the API or itself for the app', () => {
    for (const path of ['/', '/index.html', '/cs/', '/privacy', '/terms', '/api/token', '/sw.js']) {
      expect(w.ctx.isAppDocument(new URL(path, ORIGIN))).toBe(false);
    }
  });

  it('normalises each marketing page onto a single cache key', () => {
    const pairs = [
      ['/', '/'], ['/index.html', '/'],
      ['/cs', '/cs/'], ['/cs/', '/cs/'], ['/cs/index.html', '/cs/'],
      ['/privacy', '/privacy'], ['/privacy.html', '/privacy'],
      ['/terms', '/terms'], ['/terms.html', '/terms'],
    ];
    for (const [path, key] of pairs) {
      expect(w.ctx.marketingKey(new URL(path, ORIGIN))).toBe(key);
    }
  });

  it('ignores a query string when keying a marketing page', () => {
    expect(w.ctx.marketingKey(new URL('/?utm_source=x', ORIGIN))).toBe('/');
  });

  it('claims no other path, and no other origin', () => {
    for (const path of ['/api/token', '/sw.js', '/assets/hero.svg', '/robots.txt', '/nope']) {
      expect(w.ctx.marketingKey(new URL(path, ORIGIN))).toBeNull();
    }
    expect(w.ctx.marketingKey(new URL('https://evil.example/'))).toBeNull();
  });

  it('takes over a navigation to a marketing page', () => {
    const ev = navEvent(`${ORIGIN}/privacy`);
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(1);
  });

  it('leaves non-document requests to the marketing pages alone', () => {
    const ev = navEvent(`${ORIGIN}/assets/hero.svg`);
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(0);
  });

  it('never claims another origin — Drive traffic must pass straight through', () => {
    expect(w.ctx.isAppDocument(new URL('https://www.googleapis.com/drive/v3/files'))).toBe(false);
    expect(w.ctx.isAppDocument(new URL('https://evil.example/app'))).toBe(false);
  });

  it('handles only navigations, not sub-resource GETs', () => {
    const ev = navEvent(`${ORIGIN}/app`);
    ev.request.mode = 'cors';
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(0);
  });

  it('handles only GET', () => {
    const ev = navEvent(`${ORIGIN}/app`);
    ev.request.method = 'POST';
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(0);
  });

  it('takes over a navigation to the app document', () => {
    const ev = navEvent(`${ORIGIN}/app`);
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(1);
  });

  it('registers install, activate and fetch', () => {
    expect(Object.keys(w.listeners).sort()).toEqual(['activate', 'fetch', 'install']);
  });

  it('skips waiting on install so a new worker never waits for every tab to close', () => {
    w.listeners.install();
    expect(w.ctx.self._skipWaitingCalls).toBe(1);
  });
});

describe('sw.js — version token', () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  it('prefers the ETag', () => {
    const r = makeResponse({ etag: '"abc"', lastModified: 'Mon, 11 May 2026 09:00:00 GMT' });
    expect(w.ctx.versionToken(r)).toBe('"abc"');
  });

  it('falls back to Last-Modified', () => {
    expect(w.ctx.versionToken(makeResponse({ lastModified: 'Mon, 11 May 2026 09:00:00 GMT' })))
      .toBe('Mon, 11 May 2026 09:00:00 GMT');
  });

  it('is null when the host sends neither', () => {
    expect(w.ctx.versionToken(makeResponse())).toBeNull();
  });
});

describe('sw.js — serving the shell', () => {
  it('answers from cache without ever waiting on the network', async () => {
    // The network here never answers. If the shell response were on the
    // critical path at all, this test would hang instead of asserting — which
    // is precisely the launch failure the worker exists to prevent.
    let release;
    const w = loadWorker({ fetchImpl: () => new Promise(r => { release = r; }) });
    const cached = makeResponse({ etag: '"v1"', tag: 'cached' });
    await w.cache.put('/__zw-shell__', cached);

    const ev = navEvent(`${ORIGIN}/app`);
    const resp = await w.ctx.shellResponse(ev);

    expect(resp.tag).toBe('cached');
    expect(ev.waits).toHaveLength(1);  // revalidation handed off to waitUntil
    release(makeResponse({ etag: '"v1"' }));
    await ev.waits[0];
  });

  it('stores the shell under one synthetic key, not per request URL', async () => {
    const w = loadWorker();
    await w.ctx.shellResponse(navEvent(`${ORIGIN}/app?code=oauth-secret`));
    const keys = [...w.cache.store.keys()];
    expect(keys).toHaveLength(1);
    // An OAuth callback must never become a cache key.
    expect(keys[0]).not.toContain('oauth-secret');
    expect(keys[0]).not.toContain('/app');
  });

  it('falls back to the network on a cold cache and stores the result', async () => {
    const w = loadWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(resp.ok).toBe(true);
    expect(w.fetches).toHaveLength(1);
    expect(w.cache.store.size).toBe(1);
  });

  it('explains itself when the cache is cold and the network is gone', async () => {
    const w = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) });
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(resp.status).toBe(503);
    expect(String(resp.body)).toMatch(/offline/i);
  });

  it('serves the cached shell even with no network at all', async () => {
    const w = loadWorker({
      onLine: false,
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"', tag: 'cached' }));
    const ev = navEvent(`${ORIGIN}/app`);
    const resp = await w.ctx.shellResponse(ev);
    expect(resp.tag).toBe('cached');
    await Promise.all(ev.waits);
    expect(w.fetches).toHaveLength(0);
  });
});

describe('sw.js — revalidation', () => {
  it('tells every open tab when the deployed version changed', async () => {
    const w = loadWorker({
      clients: [`${ORIGIN}/app`, `${ORIGIN}/app`],
      fetchImpl: () => Promise.resolve(makeResponse({ etag: '"v2"' })),
    });
    const cached = makeResponse({ etag: '"v1"' });
    await w.cache.put('/__zw-shell__', cached);

    await w.ctx.revalidateShell(w.cache, cached, '/app');

    expect(w.posted).toHaveLength(2);
    expect(w.posted[0].msg).toEqual({ type: 'zw-shell-updated', token: '"v2"' });
  });

  it('stays quiet when the version is unchanged', async () => {
    const w = loadWorker({
      clients: [`${ORIGIN}/app`],
      fetchImpl: () => Promise.resolve(makeResponse({ etag: '"v1"' })),
    });
    const cached = makeResponse({ etag: '"v1"' });
    await w.cache.put('/__zw-shell__', cached);
    await w.ctx.revalidateShell(w.cache, cached, '/app');
    expect(w.posted).toHaveLength(0);
  });

  it('refreshes the cached copy so the next reload gets the new build offline', async () => {
    const w = loadWorker({ fetchImpl: () => Promise.resolve(makeResponse({ etag: '"v2"', tag: 'fresh' })) });
    const cached = makeResponse({ etag: '"v1"', tag: 'stale' });
    await w.cache.put('/__zw-shell__', cached);
    await w.ctx.revalidateShell(w.cache, cached, '/app');
    expect((await w.cache.match('/__zw-shell__')).tag).toBe('fresh');
  });

  it('makes a conditional request with a deadline, so an unchanged shell costs a 304', async () => {
    const w = loadWorker();
    await w.ctx.revalidateShell(w.cache, makeResponse({ etag: '"v1"' }), '/app');
    expect(w.fetches[0].init.cache).toBe('no-cache');
    expect(w.fetches[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('makes no request at all when the device has no link', async () => {
    const w = loadWorker({ onLine: false });
    await w.ctx.revalidateShell(w.cache, makeResponse({ etag: '"v1"' }), '/app');
    expect(w.fetches).toHaveLength(0);
  });

  it('keeps the cached shell when revalidation fails', async () => {
    const w = loadWorker({ fetchImpl: () => Promise.reject(new Error('timeout')) });
    const cached = makeResponse({ etag: '"v1"', tag: 'cached' });
    await w.cache.put('/__zw-shell__', cached);
    await expect(w.ctx.revalidateShell(w.cache, cached, '/app')).resolves.toBeUndefined();
    expect((await w.cache.match('/__zw-shell__')).tag).toBe('cached');
  });

  it('ignores a non-ok response rather than caching an error page', async () => {
    const w = loadWorker({
      clients: [`${ORIGIN}/app`],
      fetchImpl: () => Promise.resolve(makeResponse({ ok: false, status: 502, etag: '"err"', tag: 'error-page' })),
    });
    const cached = makeResponse({ etag: '"v1"', tag: 'cached' });
    await w.cache.put('/__zw-shell__', cached);
    await w.ctx.revalidateShell(w.cache, cached, '/app');
    expect((await w.cache.match('/__zw-shell__')).tag).toBe('cached');
    expect(w.posted).toHaveLength(0);
  });
});

describe('sw.js — marketing pages', () => {
  it('serves a cached landing page so an offline reader still reaches the app link', async () => {
    const w = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) });
    await w.cache.put('/', makeResponse({ etag: '"landing"', tag: 'landing' }));
    const ev = navEvent(`${ORIGIN}/index.html`);  // same document, other URL
    w.listeners.fetch(ev);
    const resp = await ev.responses[0];
    expect(resp.tag).toBe('landing');
  });

  it('keeps each marketing page in its own cache entry', async () => {
    const w = loadWorker();
    await w.ctx.cachedDocument(navEvent(`${ORIGIN}/`), '/', false);
    await w.ctx.cachedDocument(navEvent(`${ORIGIN}/privacy`), '/privacy', false);
    expect([...w.cache.store.keys()].sort()).toEqual(['/', '/privacy']);
  });

  it('never announces a marketing update to the app — there is nothing to reload', async () => {
    const w = loadWorker({
      clients: [`${ORIGIN}/app`],
      fetchImpl: () => Promise.resolve(makeResponse({ etag: '"v2"' })),
    });
    const cached = makeResponse({ etag: '"v1"' });
    await w.cache.put('/', cached);
    await w.ctx.revalidateDocument(w.cache, '/', cached, '/', false);
    expect(w.posted).toHaveLength(0);
    // ...but the newer copy is still cached for next time.
    expect(w.ctx.versionToken(await w.cache.match('/'))).toBe('"v2"');
  });

  it('does not evict the app shell when a marketing page is cached', async () => {
    const w = loadWorker();
    await w.cache.put('/__zw-shell__', makeResponse({ tag: 'shell' }));
    await w.ctx.cachedDocument(navEvent(`${ORIGIN}/`), '/', false);
    expect((await w.cache.match('/__zw-shell__')).tag).toBe('shell');
  });
});

describe('sw.js — activation', () => {
  it('warms the shell from an open tab so the very first visit survives going offline', async () => {
    const w = loadWorker({ clients: [`${ORIGIN}/app?code=oauth-secret`] });
    await w.ctx.warmShell();
    expect(w.cache.store.size).toBe(1);
    // Warming must strip the query: an OAuth code has no business being fetched again.
    expect(w.fetches[0].input).toBe('/app');
  });

  it('does not refetch a shell it already has', async () => {
    const w = loadWorker({ clients: [`${ORIGIN}/app`] });
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"' }));
    await w.ctx.warmShell();
    expect(w.fetches).toHaveLength(0);
  });

  it('does nothing when no app tab is open to learn the URL from', async () => {
    const w = loadWorker({ clients: [`${ORIGIN}/privacy`] });
    await w.ctx.warmShell();
    expect(w.fetches).toHaveLength(0);
  });

  it('drops caches from older worker versions', async () => {
    const w = loadWorker({ clients: [] });
    let work;
    w.listeners.activate({ waitUntil: p => { work = p; } });
    await work;
    expect(w.ctx.caches._names).toEqual(['zw-shell-v1']);
  });
});
