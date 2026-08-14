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
 *
 * It also drains the offline upload queue on a Background Sync event, which is
 * the only way a week edited offline can reach Drive after the tab is closed.
 * That path deliberately holds no application logic: the page serializes both
 * the payload and its content hash, and this worker pushes a week only when
 * Drive still holds a revision the page has already reconciled. Every real
 * conflict is dropped for the page's CRDT merge to settle on next open.
 */
'use strict';

const CACHE_NAME = 'zw-shell-v2';

// The four icons the web app manifest points at. Every other asset the app
// needs is inline in the document — favicons are canvas-rendered data: URLs and
// the UI icons are an inline SVG sprite — so these are the only static files
// that have to survive going offline. They are also the only ones `vercel.json`
// sets no Cache-Control for, which left them revalidating on the install path.
// The 512 maskable variant is on disk but deliberately absent from the manifest
// (see the note beside the icon list in zenit-week.html), so it is not cached.
const ICON_PATHS = [
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-1024.png',
  '/assets/icon-1024-maskable.png',
];

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

function isManifestIcon(url) {
  return url.origin === self.location.origin && ICON_PATHS.includes(url.pathname);
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

// ─── Offline upload queue ─────────────────────────────────────────────────────

const DB_NAME = 'zenit-week-db';
const DB_VERSION = 1;
const UPLOAD_QUEUE_KEY = 'zenit-week-offline-uploads';
const UPLOAD_SYNC_TAG = 'zw-drive-upload';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

// Open without ever triggering an upgrade. The page owns the schema; a worker
// that created the stores itself would race the page's own open and could hand
// back a database the page then has to upgrade underneath us.
function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { try { request.transaction.abort(); } catch (_) {} };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
    request.onblocked = () => reject(new Error('idb-blocked'));
  });
}

function idbRequest(db, storeName, mode, run) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) { resolve(undefined); return; }
    let req;
    try {
      req = run(db.transaction(storeName, mode).objectStore(storeName));
    } catch (err) { reject(err); return; }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readUploadQueue(db) {
  const stored = await idbRequest(db, 'misc', 'readonly', store => store.get(UPLOAD_QUEUE_KEY));
  return Array.isArray(stored) ? stored.filter(e => e && e.weekKey && e.fileId && e.json) : [];
}

function writeUploadQueue(db, entries) {
  return idbRequest(db, 'misc', 'readwrite', store => store.put(entries, UPLOAD_QUEUE_KEY));
}

// The safety rule, in one place. `props` is the file's Drive appProperties, or
// null when the file is gone. A push is safe only when Drive still holds a
// revision this device has already reconciled — anything else means another
// device wrote while we were offline, and blindly pushing would lose their work.
function canPushEntry(entry, props) {
  if (!props) return false;
  const remote = props.contentHash === undefined || props.contentHash === null
    ? null : String(props.contentHash);
  const bases = Array.isArray(entry.baseHashes) ? entry.baseHashes.map(String) : [];
  if (remote === null) return bases.length === 0;
  return bases.includes(remote);
}

// The refresh token is an HttpOnly cookie, so the worker can mint an access
// token without the page ever having run. Returns null when the session is gone
// (signed out, cookie expired) — that is a reason to drop the queue, not retry.
async function mintAccessToken() {
  const resp = await fetch('/api/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token' }),
    signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS),
  });
  if (resp.status === 400 || resp.status === 401) return null;
  if (!resp.ok) throw new Error(`token HTTP ${resp.status}`);
  const data = await resp.json().catch(() => ({}));
  return data.access_token || null;
}

async function fetchDriveProps(entry, token) {
  const resp = await fetch(`${DRIVE_FILES_URL}/${entry.fileId}?fields=appProperties`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS),
  });
  if (resp.status === 404) return { gone: true, props: null };
  if (!resp.ok) throw new Error(`props HTTP ${resp.status}`);
  const data = await resp.json().catch(() => ({}));
  return { gone: false, props: data.appProperties || {} };
}

async function pushEntry(entry, token) {
  const boundary = `ZenitWeekSW_${entry.weekKey}_${entry.contentHash}`;
  const meta = JSON.stringify({
    appProperties: { savedAt: String(entry.savedAt), contentHash: String(entry.contentHash) },
  });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${entry.json}\r\n--${boundary}--`;
  const resp = await fetch(`${DRIVE_UPLOAD_URL}/${entry.fileId}?uploadType=multipart`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
    signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`upload HTTP ${resp.status}`);
}

async function notifyUploaded(entry) {
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const client of windows) {
    client.postMessage({
      type: 'zw-drive-uploaded',
      weekKey: entry.weekKey,
      contentHash: String(entry.contentHash),
    });
  }
}

// Throws when anything is worth retrying, so the browser re-fires the sync
// event on its own backoff. Entries are only kept for a retry when the failure
// was transient — a conflict or a missing file is resolved by the page instead,
// and staying in the queue would mean retrying forever.
async function drainUploadQueue() {
  if (self.navigator && self.navigator.onLine === false) throw new Error('offline');
  const db = await openQueueDb();
  try {
    const entries = await readUploadQueue(db);
    if (!entries.length) return;

    const token = await mintAccessToken();
    if (!token) {
      console.debug('[sw] upload-queue: no session, dropping', entries.length);
      await writeUploadQueue(db, []);
      return;
    }

    const keep = [];
    let retry = false;
    for (const entry of entries) {
      try {
        const { gone, props } = await fetchDriveProps(entry, token);
        if (gone) { console.debug('[sw] upload-queue: file gone', entry.weekKey); continue; }
        if (!canPushEntry(entry, props)) {
          console.debug('[sw] upload-queue: conflict, leaving to the page', entry.weekKey);
          continue;
        }
        await pushEntry(entry, token);
        await notifyUploaded(entry);
        console.debug('[sw] upload-queue: pushed', entry.weekKey);
      } catch (err) {
        console.debug('[sw] upload-queue: retry', entry.weekKey, err && err.message);
        keep.push(entry);
        retry = true;
      }
    }
    await writeUploadQueue(db, keep);
    if (retry) throw new Error('upload-queue incomplete');
  } finally {
    try { db.close(); } catch (_) {}
  }
}

self.addEventListener('sync', event => {
  if (event.tag !== UPLOAD_SYNC_TAG) return;
  event.waitUntil(drainUploadQueue());
});

self.addEventListener('install', event => {
  // The shell itself is not precached — the first navigation populates it. The
  // icons are, because nothing in the page ever requests them: the browser
  // fetches them when the user installs the app, which is exactly the moment
  // they may be offline. One failure must not fail the install, so each is
  // allowed to settle on its own.
  event.waitUntil(precacheIcons());
  // Activate straight away so a new worker never waits for every tab to close.
  self.skipWaiting();
});

async function precacheIcons() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(ICON_PATHS.map(async path => {
    try {
      if (await cache.match(path)) return;
      const resp = await fetch(path, { cache: 'no-cache', signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS) });
      if (resp && resp.ok) await cache.put(path, resp);
    } catch (err) {
      console.debug('[sw] icon-precache-failed', path, err && err.message);
    }
  }));
}

// Lets the browser start the navigation request in parallel with booting this
// worker, instead of the worker booting first and only then reaching for the
// network. It costs no extra traffic: a cache hit already spends one request on
// revalidation, and that is the request the preload becomes — see
// revalidateDocument, which consumes it rather than issuing its own.
async function enableNavigationPreload() {
  if (!self.registration || !self.registration.navigationPreload) return;
  try {
    await self.registration.navigationPreload.enable();
  } catch (err) {
    console.debug('[sw] navigation-preload-failed', err && err.message);
  }
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await enableNavigationPreload();
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
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // Icons are not navigations, so this branch sits above the navigate check.
  if (isManifestIcon(url)) {
    event.respondWith(cachedIcon(event, url.pathname));
    return;
  }
  if (req.mode !== 'navigate') return;
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

// Cache-first with no revalidation, unlike the documents. An icon is content-
// stable for the life of a build, and a build that changes one ships a new
// CACHE_NAME — so a background check would only ever confirm what we hold.
async function cachedIcon(event, path) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(path);
  if (cached) return cached;
  try {
    const fresh = await fetch(event.request);
    if (fresh && fresh.ok) await cache.put(path, fresh.clone());
    return fresh;
  } catch (err) {
    // No cached copy and no link: let the browser render its own broken-image
    // state rather than a 200 with nothing in it.
    return new Response('', { status: 504, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ─── Offline fallback ─────────────────────────────────────────────────────────
//
// Only ever reached by someone whose very first visit is offline: any later
// visit is answered from the cache. It used to be one English sentence of
// text/plain, which reads as a broken server rather than as "you are offline".
//
// The app ships English and Czech but the worker cannot read the stored
// language — localStorage is unavailable here, and the choice is stored in a
// document that by definition has never loaded on this device. Accept-Language
// is all there is, and it is the same signal the browser itself would use.
const OFFLINE_COPY = {
  en: {
    lang:  'en',
    title: 'Zenit Week — offline',
    head:  'You are offline',
    body:  'This device has not installed Zenit Week yet. Connect once and it will keep working offline from then on.',
    retry: 'Try again',
  },
  cs: {
    lang:  'cs',
    title: 'Zenit Week — offline',
    head:  'Jsi offline',
    body:  'Na tomto zařízení ještě není Zenit Week nainstalovaný. Připoj se jednou a od té chvíle bude fungovat i offline.',
    retry: 'Zkusit znovu',
  },
};

function offlineCopy(request) {
  let header = '';
  try { header = (request && request.headers && request.headers.get('accept-language')) || ''; } catch (_) {}
  return /(^|,)\s*cs\b/i.test(header) ? OFFLINE_COPY.cs : OFFLINE_COPY.en;
}

// The retry target is the cache key, never the request URL: `/app/…` accepts
// arbitrary trailing segments and interpolating one into markup would be an
// injection. Every cache key is a constant defined in this file.
function offlineRetryHref(cacheKey) {
  return cacheKey === SHELL_KEY ? '/app' : cacheKey;
}

function offlineResponse(request, cacheKey) {
  const c = offlineCopy(request);
  const href = offlineRetryHref(cacheKey);
  const html = `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${c.title}</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7fb; --fg: #1a1a24; --muted: #5a5a70; --line: #dededf; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #181825; --fg: #f2f2f7; --muted: #a0a0b8; --line: #33334a; }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: var(--bg); color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.55; text-align: center;
}
main { max-width: 26rem; }
h1 { margin: 0 0 12px; font-size: 1.5rem; font-weight: 600; }
p { margin: 0 0 24px; color: var(--muted); }
a {
  display: inline-block; padding: 10px 20px; border: 1px solid var(--line); border-radius: 10px;
  color: inherit; text-decoration: none; font-weight: 500;
}
a:hover { border-color: currentColor; }
</style>
</head>
<body>
<main>
<h1>${c.head}</h1>
<p>${c.body}</p>
<a href="${href}">${c.retry}</a>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Cache-first with background revalidation. `notify` is for the app shell only:
// the marketing pages have no quiet-refresh machinery to tell about a new build.
async function cachedDocument(event, cacheKey, notify) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);
  const path = new URL(event.request.url).pathname;
  // The browser fires this the moment the navigation starts, whether or not we
  // end up using it, so both branches below hand it on rather than starting a
  // second request. A rejection is just "no preload" — never a failed response.
  const preload = preloadResponse(event);
  if (cached) {
    // Stale-while-revalidate: paint from cache, check for a new deploy after.
    event.waitUntil(revalidateDocument(cache, cacheKey, cached, path, notify, preload));
    return cached;
  }
  try {
    const fresh = (preload && await preload) || await fetch(event.request);
    if (fresh && fresh.ok) await cache.put(cacheKey, fresh.clone());
    return fresh;
  } catch (err) {
    return offlineResponse(event.request, cacheKey);
  }
}

// Null when the browser has no navigation preload, or the feature is off.
function preloadResponse(event) {
  if (!event.preloadResponse || typeof event.preloadResponse.then !== 'function') return null;
  return event.preloadResponse.catch(() => null);
}

function revalidateShell(cache, cached, path) {
  return revalidateDocument(cache, SHELL_KEY, cached, path, true);
}

async function revalidateDocument(cache, cacheKey, cached, path, notify, preload = null) {
  // Only trusted in the negative — see isDefinitelyOffline() in the app.
  if (self.navigator && self.navigator.onLine === false) return;
  let fresh = preload ? await preload : null;
  if (!fresh) {
    try {
      // `no-cache` sends a conditional request, so an unchanged document costs a
      // 304 and not another full download. The preload above is the browser's own
      // navigation request, which the app document's must-revalidate makes
      // conditional too — so either route costs the same on an unchanged deploy.
      fresh = await fetch(path, { cache: 'no-cache', signal: timeoutSignal(SHELL_FETCH_TIMEOUT_MS) });
    } catch (err) {
      return; // Offline or the link died — the cached copy stays authoritative.
    }
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
