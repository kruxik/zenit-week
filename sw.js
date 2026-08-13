/* Zenit Week — offline-first app shell.
 *
 * The whole application is one ~640 KB HTML document served with
 * `Cache-Control: max-age=0, must-revalidate`, which means every launch used to
 * block on a live network round-trip. This worker keeps a copy of that document
 * in the Cache Storage API and serves it immediately, revalidating in the
 * background. Startup therefore works offline and stays instant on a slow link.
 *
 * Scope is the whole origin (the file sits at the root), but only navigations to
 * the app document are intercepted. The marketing pages, `/api/*` and every
 * cross-origin request (Google Drive) fall straight through to the network.
 *
 * This is the one piece of the app that cannot live in zenit-week.html: browsers
 * only accept a service worker from a same-origin script URL.
 */
'use strict';

const CACHE_NAME = 'zw-shell-v1';

// Synthetic cache key. The app answers on several URLs (`/app`, `/app/…`,
// `/zenit-week.html`) that all resolve to the same document via Vercel
// rewrites, and OAuth returns to `/app?code=…`. Storing one entry under a key
// that is never fetched keeps those variants from multiplying in the cache.
const SHELL_KEY = '/__zw-shell__';

const APP_PATH = /^\/(?:app(?:\/.*)?|zenit-week\.html)$/;

// Background shell fetches get a deadline so a dead link cannot pin the worker
// open waiting on a response that never comes. The cache-miss path in
// shellResponse() deliberately has none: there it is the only route to a
// working app, and a slow answer still beats no answer.
const SHELL_FETCH_TIMEOUT_MS = 20000;

function timeoutSignal(ms) {
  return (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
    ? AbortSignal.timeout(ms)
    : undefined;
}

function isAppDocument(url) {
  return url.origin === self.location.origin && APP_PATH.test(url.pathname);
}

// The marketing pages are ordinary, distinct documents, so unlike the shell they
// are cached under their own keys — normalised, because each answers on both a
// bare and an .html path and a query string never changes what is served.
// Returns the cache key, or null for anything not a marketing document.
const MARKETING_KEYS = {
  '/': '/', '/index.html': '/',
  '/cs': '/cs/', '/cs/': '/cs/', '/cs/index.html': '/cs/',
  '/privacy': '/privacy', '/privacy.html': '/privacy',
  '/terms': '/terms', '/terms.html': '/terms',
};

function marketingKey(url) {
  if (url.origin !== self.location.origin) return null;
  return MARKETING_KEYS[url.pathname] || null;
}

// Version identity of a shell response, matching the page-side probe: an ETag
// when the host sends one, Last-Modified otherwise.
function versionToken(response) {
  return response.headers.get('etag') || response.headers.get('last-modified') || null;
}

self.addEventListener('install', () => {
  // Nothing to precache — the first navigation populates the shell. Activate
  // straight away so a new worker never waits for every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
    await warmShell();
  })());
});

// The navigation that installs the worker is not itself intercepted, so without
// this the very first visit would leave the cache empty — install the app, go
// offline, and it would be dead. Fetch the shell once on activation instead.
async function warmShell() {
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(SHELL_KEY)) return;
  const windows = await self.clients.matchAll({ type: 'window' });
  const client = windows.find(c => {
    try { return isAppDocument(new URL(c.url)); } catch (_) { return false; }
  });
  if (!client) return;
  // Path only: never store a response keyed to an OAuth `?code=` callback.
  const path = new URL(client.url).pathname;
  try {
    const resp = await fetch(path, { cache: 'no-cache', signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS) });
    if (resp && resp.ok) await cache.put(SHELL_KEY, resp);
  } catch (err) {
    console.debug('[sw] warm-failed', err && err.message);
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (isAppDocument(url)) {
    event.respondWith(shellResponse(event));
    return;
  }
  // The landing and legal pages are what people bookmark and share, so a reader
  // who has the app cached but hits `/` first should not meet a browser error
  // page. Only the documents are cached — assets/hero.svg alone is 632 KB and
  // loads lazily, so it is left to fail into its alt text.
  const key = marketingKey(url);
  if (key) event.respondWith(cachedDocument(event, key, false));
});

function shellResponse(event) {
  return cachedDocument(event, SHELL_KEY, true);
}

// Cache-first with background revalidation. `notify` is for the app shell only:
// the marketing pages have no quiet-refresh machinery to tell about a new build.
async function cachedDocument(event, cacheKey, notify) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);
  const path = new URL(event.request.url).pathname;
  if (cached) {
    // Stale-while-revalidate: paint from cache, check for a new deploy after.
    event.waitUntil(revalidateDocument(cache, cacheKey, cached, path, notify));
    return cached;
  }
  try {
    const fresh = await fetch(event.request);
    if (fresh && fresh.ok) await cache.put(cacheKey, fresh.clone());
    return fresh;
  } catch (err) {
    return new Response(
      'Zenit Week is offline and has no cached copy yet. Reconnect once to install it.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
}

function revalidateShell(cache, cached, path) {
  return revalidateDocument(cache, SHELL_KEY, cached, path, true);
}

async function revalidateDocument(cache, cacheKey, cached, path, notify) {
  // Only trusted in the negative — see isDefinitelyOffline() in the app.
  if (self.navigator && self.navigator.onLine === false) return;
  let fresh;
  try {
    // `no-cache` sends a conditional request, so an unchanged document costs a
    // 304 and not another full download.
    fresh = await fetch(path, { cache: 'no-cache', signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS) });
  } catch (err) {
    return; // Offline or the link died — the cached copy stays authoritative.
  }
  if (!fresh || !fresh.ok) return;
  const newToken = versionToken(fresh);
  const oldToken = versionToken(cached);
  await cache.put(cacheKey, fresh.clone());
  if (!notify) return;
  if (!newToken || !oldToken || newToken === oldToken) return;
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const client of windows) {
    client.postMessage({ type: 'zw-shell-updated', token: newToken });
  }
}
