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
    async keys() { return [...store.keys()]; },
    async delete(key) { return store.delete(key); },
  };
}

// Minimal IndexedDB stand-in covering exactly what the worker's queue drain
// touches: one `misc` store, get and put, requests that settle asynchronously
// the way the real API does.
function makeIndexedDb(misc, { stores = ['weeks', 'misc'] } = {}) {
  const settle = req => { Promise.resolve().then(() => req.onsuccess && req.onsuccess({ target: req })); };
  const db = {
    closed: false,
    objectStoreNames: { contains: name => stores.includes(name) },
    close() { db.closed = true; },
    transaction(name) {
      return {
        objectStore() {
          return {
            get(key) { const req = { result: misc[key] }; settle(req); return req; },
            put(value, key) { misc[key] = value; const req = { result: key }; settle(req); return req; },
          };
        },
      };
    },
  };
  return {
    db,
    open() {
      const req = {};
      Promise.resolve().then(() => req.onsuccess && req.onsuccess({ target: { result: db } }));
      return req;
    },
  };
}

// Boots sw.js in an isolated context with the worker globals it expects, and
// hands back both the context and the recorded event listeners.
function loadWorker({ onLine, fetchImpl, clients = [], misc = null } = {}) {
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
      _names: ['zw-shell-v0', 'zw-shell-v1', 'zw-shell-v2'],
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
  const idb = makeIndexedDb(misc || {});
  ctx.indexedDB = idb;
  vm.createContext(ctx);
  vm.runInContext(swCode, ctx);
  return { ctx, listeners, cache, posted, fetches, idb };
}

function navEvent(url, preloadResponse) {
  const waits = [];
  const responses = [];
  const ev = {
    request: { url, method: 'GET', mode: 'navigate' },
    waitUntil: p => { waits.push(p); return p; },
    respondWith: p => { responses.push(p); return p; },
    waits,
    responses,
  };
  if (preloadResponse !== undefined) ev.preloadResponse = preloadResponse;
  return ev;
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

  it('registers every lifecycle listener it relies on', () => {
    expect(Object.keys(w.listeners).sort())
      .toEqual(['activate', 'fetch', 'install', 'message', 'periodicsync', 'sync']);
  });

  it('skips waiting on install so a new worker never waits for every tab to close', () => {
    w.listeners.install({ waitUntil: p => p });
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
    expect(w.ctx.caches._names).toEqual(['zw-shell-v2']);
  });
});

// ─── Offline upload queue ─────────────────────────────────────────────────────
//
// The hole this closes: a week edited offline was parked in an in-memory Set and
// drained only by the page's 'online' listener, so closing the tab before the
// link returned stranded that week on the device until its content happened to
// change again.

const QUEUE_KEY = 'zenit-week-offline-uploads';

function mkEntry(over = {}) {
  return {
    weekKey: '2026-30',
    fileId: 'file-1',
    json: '{"nodes":[]}',
    contentHash: '111',
    savedAt: '1700000000000',
    baseHashes: ['999'],
    ...over,
  };
}

// Routes the three hosts the drain talks to. `props` is the appProperties Drive
// reports for the file; `overrides` forces a status on a given leg.
function makeDriveFetch({ props = { contentHash: '999' }, token = 'tok', overrides = {} } = {}) {
  const calls = { token: 0, props: 0, upload: 0, uploadBodies: [] };
  const json = (status, body) => Promise.resolve({
    ok: status < 400, status, json: () => Promise.resolve(body),
  });
  const impl = (input, init) => {
    const url = String(input);
    if (url.includes('/api/token')) {
      calls.token++;
      if (overrides.token) return json(overrides.token, {});
      return json(200, { access_token: token });
    }
    if (url.includes('/upload/drive/v3/files/')) {
      calls.upload++;
      calls.uploadBodies.push(init && init.body);
      return json(overrides.upload || 200, {});
    }
    if (url.includes('/drive/v3/files/')) {
      calls.props++;
      if (overrides.props) return json(overrides.props, {});
      return json(200, props === null ? {} : { appProperties: props });
    }
    return json(200, {});
  };
  return { impl, calls };
}

describe('sw.js — offline upload queue: the safety rule', () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  it('pushes when Drive still holds a revision this device reconciled', () => {
    expect(w.ctx.canPushEntry(mkEntry({ baseHashes: ['999'] }), { contentHash: '999' })).toBe(true);
  });

  it('accepts any known revision, not just the most recent one', () => {
    // lastSyncedHash and lastSeenRemoteHash can legitimately differ; either
    // proves we have already merged whatever Drive holds.
    expect(w.ctx.canPushEntry(mkEntry({ baseHashes: ['999', '888'] }), { contentHash: '888' })).toBe(true);
  });

  it('refuses when another device wrote while we were offline', () => {
    expect(w.ctx.canPushEntry(mkEntry({ baseHashes: ['999'] }), { contentHash: 'other' })).toBe(false);
  });

  it('refuses a week whose file has gone', () => {
    expect(w.ctx.canPushEntry(mkEntry(), null)).toBe(false);
  });

  it('refuses when Drive holds content we have never seen a hash for', () => {
    expect(w.ctx.canPushEntry(mkEntry({ baseHashes: [] }), { contentHash: 'other' })).toBe(false);
  });

  it('allows the first push to a file that carries no hash yet', () => {
    expect(w.ctx.canPushEntry(mkEntry({ baseHashes: [] }), {})).toBe(true);
  });

  it('compares by value, so a numeric hash still matches its stored string', () => {
    expect(w.ctx.canPushEntry(mkEntry({ baseHashes: [999] }), { contentHash: 999 })).toBe(true);
  });
});

describe('sw.js — offline upload queue: draining', () => {
  it('pushes a parked week and clears it from the queue', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const drive = makeDriveFetch();
    const w = loadWorker({ misc, fetchImpl: drive.impl, clients: [`${ORIGIN}/app`] });
    await w.ctx.drainUploadQueue();
    expect(drive.calls.upload).toBe(1);
    expect(misc[QUEUE_KEY]).toEqual([]);
  });

  it('sends the payload the page serialized, not one it rebuilt', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry({ json: '{"nodes":[{"id":"a"}]}' })] };
    const drive = makeDriveFetch();
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await w.ctx.drainUploadQueue();
    expect(drive.calls.uploadBodies[0]).toContain('{"nodes":[{"id":"a"}]}');
    expect(drive.calls.uploadBodies[0]).toContain('"contentHash":"111"');
  });

  it('tells an open tab what it pushed so the badge and hash agree', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const drive = makeDriveFetch();
    const w = loadWorker({ misc, fetchImpl: drive.impl, clients: [`${ORIGIN}/app`] });
    await w.ctx.drainUploadQueue();
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].msg).toEqual({
      type: 'zw-drive-uploaded', weekKey: '2026-30', contentHash: '111',
    });
  });

  it('drops a conflicted week instead of retrying it forever', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const drive = makeDriveFetch({ props: { contentHash: 'someone-else' } });
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await expect(w.ctx.drainUploadQueue()).resolves.toBeUndefined();
    expect(drive.calls.upload).toBe(0);
    expect(misc[QUEUE_KEY]).toEqual([]);
  });

  it('drops a week whose Drive file no longer exists', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const drive = makeDriveFetch({ overrides: { props: 404 } });
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await w.ctx.drainUploadQueue();
    expect(drive.calls.upload).toBe(0);
    expect(misc[QUEUE_KEY]).toEqual([]);
  });

  it('drops the whole queue when the session is gone rather than retrying', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry(), mkEntry({ weekKey: '2026-31' })] };
    const drive = makeDriveFetch({ overrides: { token: 400 } });
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await expect(w.ctx.drainUploadQueue()).resolves.toBeUndefined();
    expect(drive.calls.props).toBe(0);
    expect(misc[QUEUE_KEY]).toEqual([]);
  });

  it('keeps a week and throws when the upload fails transiently', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const drive = makeDriveFetch({ overrides: { upload: 503 } });
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await expect(w.ctx.drainUploadQueue()).rejects.toThrow();
    expect(misc[QUEUE_KEY]).toHaveLength(1);
  });

  it('does not lose a healthy week because another one failed', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry({ weekKey: '2026-30', fileId: 'good' }),
                                 mkEntry({ weekKey: '2026-31', fileId: 'bad' })] };
    const drive = makeDriveFetch();
    const w = loadWorker({
      misc,
      fetchImpl: (input, init) => (String(input).includes('bad')
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : drive.impl(input, init)),
    });
    await expect(w.ctx.drainUploadQueue()).rejects.toThrow();
    expect(drive.calls.upload).toBe(1);
    expect(misc[QUEUE_KEY].map(e => e.weekKey)).toEqual(['2026-31']);
  });

  it('does nothing at all when nothing is parked', async () => {
    const w = loadWorker({ misc: {}, fetchImpl: makeDriveFetch().impl });
    await w.ctx.drainUploadQueue();
    expect(w.fetches).toHaveLength(0);
  });

  it('refuses to start while the browser reports no link', async () => {
    const w = loadWorker({ misc: { [QUEUE_KEY]: [mkEntry()] }, onLine: false });
    await expect(w.ctx.drainUploadQueue()).rejects.toThrow('offline');
  });

  it('only answers its own sync tag', () => {
    const w = loadWorker();
    const waits = [];
    w.listeners.sync({ tag: 'something-else', waitUntil: p => waits.push(p) });
    expect(waits).toHaveLength(0);
  });

  it('ignores queue rows too damaged to push', async () => {
    const misc = { [QUEUE_KEY]: [{ weekKey: '2026-30' }, null, mkEntry()] };
    const drive = makeDriveFetch();
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await w.ctx.drainUploadQueue();
    expect(drive.calls.upload).toBe(1);
  });
});

// ─── Manifest icons ───────────────────────────────────────────────────────────
//
// Nothing in the page ever requests these: the browser fetches them when the
// user installs the app, which is exactly when they may be offline. They are
// also the only static files vercel.json sets no Cache-Control for.

// Mirrors ICON_PATHS in sw.js — a top-level const lives in the script's lexical
// scope, not on the context object, so it cannot be read back out of the worker.
const ICON_PATHS = [
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-1024.png',
  '/assets/icon-1024-maskable.png',
];

function iconEvent(url, mode = 'no-cors') {
  const responses = [];
  return {
    request: { url, method: 'GET', mode },
    waitUntil: p => p,
    respondWith: p => { responses.push(p); return p; },
    responses,
  };
}

describe('sw.js — manifest icons', () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  it('claims exactly the icons the manifest declares', () => {
    for (const path of ICON_PATHS) {
      expect(w.ctx.isManifestIcon(new URL(path, ORIGIN))).toBe(true);
    }
  });

  it('leaves alone the maskable size the manifest deliberately omits', () => {
    expect(w.ctx.isManifestIcon(new URL('/assets/icon-512-maskable.png', ORIGIN))).toBe(false);
  });

  it('leaves the rest of /assets alone — hero.svg is 632 KB of marketing', () => {
    for (const path of ['/assets/hero.svg', '/og-image.png', '/assets/playground-seed.json']) {
      expect(w.ctx.isManifestIcon(new URL(path, ORIGIN))).toBe(false);
    }
  });

  it('never claims another origin', () => {
    expect(w.ctx.isManifestIcon(new URL('https://evil.example/assets/icon-192.png'))).toBe(false);
  });

  it('precaches every icon on install', async () => {
    await w.ctx.precacheIcons();
    expect(w.cache.store.size).toBe(ICON_PATHS.length);
    expect(w.fetches.map(f => f.input).sort()).toEqual([...ICON_PATHS].sort());
  });

  it('does not refetch icons it already holds', async () => {
    await w.ctx.precacheIcons();
    const before = w.fetches.length;
    await w.ctx.precacheIcons();
    expect(w.fetches).toHaveLength(before);
  });

  it('survives an install with no link — one bad icon must not fail the install', async () => {
    const bad = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) });
    await expect(bad.ctx.precacheIcons()).resolves.toBeUndefined();
    expect(bad.cache.store.size).toBe(0);
  });

  it('does not cache a failed response', async () => {
    const bad = loadWorker({ fetchImpl: () => Promise.resolve(makeResponse({ ok: false, status: 500 })) });
    await bad.ctx.precacheIcons();
    expect(bad.cache.store.size).toBe(0);
  });

  it('serves an icon request even though it is not a navigation', () => {
    const ev = iconEvent(`${ORIGIN}/assets/icon-192.png`);
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(1);
  });

  it('answers from cache without touching the network', async () => {
    await w.cache.put('/assets/icon-192.png', makeResponse({ tag: 'cached-icon' }));
    const got = await w.ctx.cachedIcon(iconEvent(`${ORIGIN}/assets/icon-192.png`), '/assets/icon-192.png');
    expect(got.tag).toBe('cached-icon');
    expect(w.fetches).toHaveLength(0);
  });

  it('fetches and stores an icon it does not hold yet', async () => {
    const ev = iconEvent(`${ORIGIN}/assets/icon-512.png`);
    await w.ctx.cachedIcon(ev, '/assets/icon-512.png');
    expect(w.cache.store.has('/assets/icon-512.png')).toBe(true);
  });

  it('fails the request rather than caching a broken icon when offline', async () => {
    const bad = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) });
    const got = await bad.ctx.cachedIcon(iconEvent(`${ORIGIN}/assets/icon-192.png`), '/assets/icon-192.png');
    expect(got.status).toBe(504);
    expect(bad.cache.store.size).toBe(0);
  });

  it('still ignores non-GET traffic to an icon path', () => {
    const ev = iconEvent(`${ORIGIN}/assets/icon-192.png`);
    ev.request.method = 'POST';
    w.listeners.fetch(ev);
    expect(ev.responses).toHaveLength(0);
  });

  it('drops the previous shell cache so stale icons cannot linger', async () => {
    const stale = loadWorker({ clients: [] });
    stale.ctx.caches._names = ['zw-shell-v1', 'zw-shell-v2'];
    let work;
    stale.listeners.activate({ waitUntil: p => { work = p; } });
    await work;
    expect(stale.ctx.caches._names).toEqual(['zw-shell-v2']);
  });
});

// ─── Offline fallback ─────────────────────────────────────────────────────────
//
// Only reachable when the very first visit to a document is offline. It used to
// be one English sentence of text/plain, which reads as a broken server rather
// than as "you are offline".

function langEvent(url, acceptLanguage) {
  const ev = navEvent(url);
  ev.request.headers = { get: name => (name.toLowerCase() === 'accept-language' ? acceptLanguage : null) };
  return ev;
}

const offlineWorker = () => loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) });

describe('sw.js — offline fallback', () => {
  it('answers 503 as a document, not as plain text', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(resp.status).toBe(503);
    expect(resp.headers['Content-Type']).toMatch(/text\/html/);
  });

  it('is never stored — a cached "you are offline" would outlive being offline', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(resp.headers['Cache-Control']).toBe('no-store');
    expect(w.cache.store.size).toBe(0);
  });

  it('speaks Czech to a Czech browser', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(langEvent(`${ORIGIN}/app`, 'cs-CZ,cs;q=0.9,en;q=0.8'));
    expect(String(resp.body)).toContain('Jsi offline');
    expect(String(resp.body)).toContain('lang="cs"');
  });

  it('finds Czech behind another preferred language', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(langEvent(`${ORIGIN}/app`, 'sk-SK,sk;q=0.9,cs;q=0.8'));
    expect(String(resp.body)).toContain('Jsi offline');
  });

  it('falls back to English for anything else', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(langEvent(`${ORIGIN}/app`, 'de-DE,de;q=0.9'));
    expect(String(resp.body)).toContain('You are offline');
    expect(String(resp.body)).toContain('lang="en"');
  });

  it('does not mistake a language that merely starts with cs', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(langEvent(`${ORIGIN}/app`, 'csb-PL,csb;q=0.9'));
    expect(String(resp.body)).toContain('You are offline');
  });

  it('falls back to English when the header is missing entirely', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(String(resp.body)).toContain('You are offline');
  });

  it('offers a retry that lands back on the app', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(String(resp.body)).toContain('href="/app"');
  });

  it('offers a retry that lands back on the page the reader asked for', async () => {
    const w = offlineWorker();
    const resp = await w.ctx.cachedDocument(navEvent(`${ORIGIN}/privacy.html`), '/privacy', false);
    expect(String(resp.body)).toContain('href="/privacy"');
  });

  it('never puts the request path in the markup — /app/… takes any trailing segment', async () => {
    const w = offlineWorker();
    const hostile = `${ORIGIN}/app/"><script>alert(1)</script>`;
    const resp = await w.ctx.shellResponse(navEvent(hostile));
    expect(String(resp.body)).toContain('href="/app"');
    expect(String(resp.body)).not.toContain('alert(1)');
  });

  it('keeps the cached copy authoritative — the fallback is a last resort', async () => {
    const w = offlineWorker();
    await w.cache.put('/__zw-shell__', makeResponse({ tag: 'cached-shell' }));
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`));
    expect(resp.tag).toBe('cached-shell');
  });
});

// ─── Navigation preload ───────────────────────────────────────────────────────
//
// The browser starts the navigation request in parallel with booting the
// worker. It costs no extra traffic here: a cache hit already spends one
// request on revalidation, and that is the request the preload becomes.

describe('sw.js — navigation preload', () => {
  it('turns it on during activation', async () => {
    const w = loadWorker();
    const calls = [];
    w.ctx.self.registration = { navigationPreload: { enable: async () => calls.push('enabled') } };
    await w.ctx.enableNavigationPreload();
    expect(calls).toEqual(['enabled']);
  });

  it('activates cleanly on a browser that has no preload at all', async () => {
    const w = loadWorker({ clients: [] });
    let work;
    w.listeners.activate({ waitUntil: p => { work = p; } });
    await expect(work).resolves.toBeUndefined();
  });

  it('survives a browser that refuses to enable it', async () => {
    const w = loadWorker();
    w.ctx.self.registration = { navigationPreload: { enable: async () => { throw new Error('nope'); } } };
    await expect(w.ctx.enableNavigationPreload()).resolves.toBeUndefined();
  });

  it('serves a cold cache from the preload instead of fetching again', async () => {
    const preloaded = makeResponse({ etag: '"preloaded"', tag: 'preloaded' });
    const w = loadWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`, Promise.resolve(preloaded)));
    expect(resp.tag).toBe('preloaded');
    expect(w.fetches).toHaveLength(0);
    expect(w.cache.store.size).toBe(1);
  });

  it('falls back to its own fetch when the preload yields nothing', async () => {
    const w = loadWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`, Promise.resolve(null)));
    expect(resp.ok).toBe(true);
    expect(w.fetches).toHaveLength(1);
  });

  it('treats a rejected preload as no preload, not as a failure', async () => {
    const w = loadWorker();
    const resp = await w.ctx.shellResponse(navEvent(`${ORIGIN}/app`, Promise.reject(new Error('preload died'))));
    expect(resp.ok).toBe(true);
    expect(w.fetches).toHaveLength(1);
  });

  it('revalidates a cache hit from the preload rather than a second request', async () => {
    const w = loadWorker();
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"', tag: 'cached' }));
    const ev = navEvent(`${ORIGIN}/app`, Promise.resolve(makeResponse({ etag: '"v2"', tag: 'preloaded' })));
    const resp = await w.ctx.shellResponse(ev);
    await Promise.all(ev.waits);
    expect(resp.tag).toBe('cached');            // still painted from cache
    expect(w.fetches).toHaveLength(0);          // and no request of our own
    expect(w.cache.store.get('/__zw-shell__').tag).toBe('preloaded');
  });

  it('still tells the page about a new deploy it learned from the preload', async () => {
    const w = loadWorker({ clients: [`${ORIGIN}/app`] });
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"' }));
    const ev = navEvent(`${ORIGIN}/app`, Promise.resolve(makeResponse({ etag: '"v2"' })));
    await w.ctx.shellResponse(ev);
    await Promise.all(ev.waits);
    expect(w.posted[0].msg).toEqual({ type: 'zw-shell-updated', token: '"v2"' });
  });

  it('ignores a preload that came back broken', async () => {
    const w = loadWorker();
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"', tag: 'cached' }));
    const ev = navEvent(`${ORIGIN}/app`, Promise.resolve(makeResponse({ ok: false, status: 500 })));
    await w.ctx.shellResponse(ev);
    await Promise.all(ev.waits);
    expect(w.cache.store.get('/__zw-shell__').tag).toBe('cached');
  });

  it('does not reach for the network at all when the browser says it is offline', async () => {
    const w = loadWorker({ onLine: false });
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"' }));
    const ev = navEvent(`${ORIGIN}/app`, Promise.resolve(makeResponse({ etag: '"v2"' })));
    await w.ctx.shellResponse(ev);
    await Promise.all(ev.waits);
    expect(w.cache.store.get('/__zw-shell__').headers.get('etag')).toBe('"v1"');
  });
});

// ─── Periodic refresh ─────────────────────────────────────────────────────────
//
// Keeps the cached shell current between visits so opening the app lands on the
// build it should be on. An enhancement only: Chromium-only, gated on an
// installed PWA and site engagement, with the browser setting the real cadence.

describe('sw.js — periodic refresh', () => {
  it('only answers its own tag', () => {
    const w = loadWorker();
    const waits = [];
    w.listeners.periodicsync({ tag: 'zw-drive-upload', waitUntil: p => waits.push(p) });
    expect(waits).toHaveLength(0);
  });

  it('revalidates the cached shell', async () => {
    const w = loadWorker();
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"', tag: 'stale' }));
    await w.ctx.periodicRefresh();
    expect(w.cache.store.get('/__zw-shell__').headers.get('etag')).toBe('"fresh"');
  });

  it('tells any open tab about a build it found', async () => {
    const w = loadWorker({ clients: [`${ORIGIN}/app`] });
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"' }));
    await w.ctx.periodicRefresh();
    expect(w.posted[0].msg).toEqual({ type: 'zw-shell-updated', token: '"fresh"' });
  });

  it('waits for a real visit when nothing is cached yet', async () => {
    // No client is open during a periodic sync, so there is nothing to learn the
    // shell URL from — refreshing a shell we never had is not this event's job.
    const w = loadWorker();
    await w.ctx.periodicRefresh();
    expect(w.cache.store.has('/__zw-shell__')).toBe(false);
  });

  it('tops up any icon it is missing', async () => {
    const w = loadWorker();
    await w.ctx.periodicRefresh();
    expect(w.cache.store.size).toBe(ICON_PATHS.length);
  });

  it('pushes anything still parked from being offline', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const drive = makeDriveFetch();
    const w = loadWorker({ misc, fetchImpl: drive.impl });
    await w.ctx.periodicRefresh();
    expect(drive.calls.upload).toBe(1);
    expect(misc[QUEUE_KEY]).toEqual([]);
  });

  it('does not escalate an upload failure — the sync event owns retrying', async () => {
    const misc = { [QUEUE_KEY]: [mkEntry()] };
    const w = loadWorker({
      misc,
      fetchImpl: (input) => (String(input).includes('googleapis') || String(input).includes('/api/token')
        ? Promise.reject(new Error('drive down'))
        : Promise.resolve(makeResponse({ etag: '"fresh"' }))),
    });
    await expect(w.ctx.periodicRefresh()).resolves.toBeUndefined();
    expect(misc[QUEUE_KEY]).toHaveLength(1);
  });

  it('stays off the network entirely when the browser says it is offline', async () => {
    const w = loadWorker({ onLine: false, misc: { [QUEUE_KEY]: [mkEntry()] },
                           fetchImpl: () => Promise.reject(new Error('offline')) });
    await w.cache.put('/__zw-shell__', makeResponse({ etag: '"v1"', tag: 'cached' }));
    await expect(w.ctx.periodicRefresh()).resolves.toBeUndefined();
    expect(w.cache.store.get('/__zw-shell__').tag).toBe('cached');
  });
});

// ─── Avatar photo ─────────────────────────────────────────────────────────────
//
// The only cross-origin subresource the app loads. The page cannot cache it
// itself: reading the bytes would need fetch() and therefore
// googleusercontent.com in connect-src, which costs more than the photo is worth.

const PHOTO = 'https://lh3.googleusercontent.com/a/abc123=s96-c';

function imgEvent(url) {
  const waits = [];
  return {
    request: { url, method: 'GET', mode: 'no-cors' },
    waitUntil: p => { waits.push(p); return p; },
    respondWith: p => p,
    waits,
  };
}

describe('sw.js — avatar photo', () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  it('claims the Google photo hosts', () => {
    for (const href of ['https://lh3.googleusercontent.com/a/x', 'https://googleusercontent.com/a/x']) {
      expect(w.ctx.isAvatarPhoto(new URL(href))).toBe(true);
    }
  });

  it('matches the host suffix, not a substring an attacker can choose', () => {
    for (const href of ['https://googleusercontent.com.evil.example/a/x',
                        'https://evil-googleusercontent.com/a/x',
                        'http://lh3.googleusercontent.com/a/x']) {
      expect(w.ctx.isAvatarPhoto(new URL(href))).toBe(false);
    }
  });

  it('leaves the Drive API alone — sync traffic must never be cached', () => {
    expect(w.ctx.isAvatarPhoto(new URL('https://www.googleapis.com/drive/v3/files'))).toBe(false);
  });

  it('takes over the image request', () => {
    const ev = imgEvent(PHOTO);
    let responded = false;
    ev.respondWith = () => { responded = true; };
    w.listeners.fetch(ev);
    expect(responded).toBe(true);
  });

  it('stores the photo on first sight', async () => {
    const ev = imgEvent(PHOTO);
    await w.ctx.cachedAvatar(ev, PHOTO);
    await Promise.all(ev.waits);
    expect(w.cache.store.has(PHOTO)).toBe(true);
  });

  it('serves it back with no network on the next load', async () => {
    await w.cache.put(PHOTO, makeResponse({ tag: 'cached-photo' }));
    const got = await w.ctx.cachedAvatar(imgEvent(PHOTO), PHOTO);
    expect(got.tag).toBe('cached-photo');
    expect(w.fetches).toHaveLength(0);
  });

  it('keeps exactly one — an opaque entry costs far more quota than its bytes', async () => {
    const older = 'https://lh3.googleusercontent.com/a/older=s96-c';
    await w.cache.put(older, makeResponse({ tag: 'old-photo' }));
    const ev = imgEvent(PHOTO);
    await w.ctx.cachedAvatar(ev, PHOTO);
    await Promise.all(ev.waits);
    expect(w.cache.store.has(older)).toBe(false);
    expect(w.cache.store.has(PHOTO)).toBe(true);
  });

  it('never evicts the shell or the icons while pruning photos', async () => {
    await w.cache.put('/__zw-shell__', makeResponse({ tag: 'shell' }));
    await w.cache.put('/assets/icon-192.png', makeResponse({ tag: 'icon' }));
    const ev = imgEvent(PHOTO);
    await w.ctx.cachedAvatar(ev, PHOTO);
    await Promise.all(ev.waits);
    expect(w.cache.store.has('/__zw-shell__')).toBe(true);
    expect(w.cache.store.has('/assets/icon-192.png')).toBe(true);
  });

  it('drops the photo on sign-out — it identifies who was signed in', async () => {
    await w.cache.put(PHOTO, makeResponse({ tag: 'photo' }));
    await w.cache.put('/__zw-shell__', makeResponse({ tag: 'shell' }));
    await w.ctx.clearAvatars();
    expect(w.cache.store.has(PHOTO)).toBe(false);
    expect(w.cache.store.has('/__zw-shell__')).toBe(true);
  });

  it('clears on the signal from the page and ignores anything else', async () => {
    await w.cache.put(PHOTO, makeResponse({ tag: 'photo' }));
    const waits = [];
    w.listeners.message({ data: { type: 'zw-something-else' }, waitUntil: p => waits.push(p) });
    expect(waits).toHaveLength(0);
    w.listeners.message({ data: { type: 'zw-clear-avatar' }, waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    expect(w.cache.store.has(PHOTO)).toBe(false);
  });
});
