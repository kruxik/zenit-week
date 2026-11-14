// The relay half of zenit-week-mcp, free of third-party dependencies so the
// app's test suite can load it directly. It knows the wire protocol
// (docs/specs/agent-bridge.md section 9, handshake and pairing replaced by
// docs/specs/agent-bridge-setup.md section 4), the origin allowlist, the
// pairing store, tab routing and the rate budget. It never reads or merges week data:
// every call is forwarded to a page, which does the work.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every agent app starts its own server; each takes the first free port of
// this range and the page connects to all of them (agent-bridge-setup.md
// section 5). Keep in step with BRIDGE_PORT_MIN / MAX in zenit-week.html.
export const PORT_MIN = 47831;
export const PORT_MAX = 47838;
export const PORTS = Object.freeze(Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i));
export const HANDSHAKE_TIMEOUT_MS = 2000;
export const CALL_TIMEOUT_MS = 60000; // a write may wait 30 s for an editing user, plus the lock
export const OPEN_WAIT_MS = 15000;
// A server that just started is found by an open page within its longest
// rescan (30 s) or at once on focus, so its first calls wait that long for a tab.
export const STARTUP_GRACE_MS = 35000;
export const WRITE_BUDGET_PER_MIN = 200;

// Tools that only read. They do not count against the write budget.
export const READ_TOOLS = new Set(['read_weeks', 'read_week', 'read_schedule', 'read_agenda', 'read_vision', 'get_stats']);

// The page reports a vision save as a week-saved event under this key.
export const VISION_KEY = 'vision';

const ALLOWED_EXACT = new Set(['https://zenitweek.com', 'https://www.zenitweek.com']);
const ALLOWED_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

// The built-in sites, shown by `origins list` (setup spec section 6, row 1).
export const BUILT_IN_SITES = ['https://zenitweek.com', 'https://www.zenitweek.com', 'http://localhost:*', 'http://127.0.0.1:*'];

// `extra` holds the sites added with `origins add` (a dev tunnel such as
// ngrok). Only https origins are accepted there, compared exactly.
export function isAllowedOrigin(origin, extra = []) {
  if (typeof origin !== 'string') return false;
  return ALLOWED_EXACT.has(origin) || ALLOWED_DEV.test(origin) || extra.includes(origin);
}

// How an app is named to the agent: "Zenit Week" for production, the host
// name (with port) for any other site (setup spec section 6, row 6).
export const PRODUCTION_APP = 'Zenit Week';
export function appName(origin) {
  if (ALLOWED_EXACT.has(origin)) return PRODUCTION_APP;
  try { return new URL(origin).host; } catch (_) { return String(origin); }
}

// Whether the agent's `app` argument names this site: the app name, the
// origin or the host, case-insensitive.
export function appMatches(app, origin) {
  const a = String(app || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!a) return true;
  if (a === appName(origin).toLowerCase() || a === String(origin).toLowerCase()) return true;
  try { return new URL(origin).host.toLowerCase() === a || new URL(origin).hostname.toLowerCase() === a; } catch (_) { return false; }
}

// "Two apps are open (Zenit Week, abc.ngrok-free.app); this went to Zenit Week."
// Only when more than one site is connected and the agent named none.
export function routeWarning(apps, chosen) {
  if (apps.length < 2) return null;
  const n = apps.length === 2 ? 'Two' : String(apps.length);
  return `${n} apps are open (${apps.join(', ')}); this went to ${chosen}. Pass "app" to choose.`;
}

// Normalises an `origins add` value to a bare https origin, or null.
export function parseExtraOrigin(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null;
  } catch (_) {
    return null;
  }
}

// ── Pairing v2 (docs/specs/agent-bridge-setup.md section 4.4) ──
// The page and the server agree a key once, with ECDH P-256 and a commitment,
// and the user approves it by comparing a 6-digit code. Afterwards each
// connection is a mutual HMAC proof with that key; the key never crosses the
// socket.
export const PROTOCOL = 2;

// ── Server version (docs/specs/mcp-updates.md section 5) ──
// The server names its version in `welcome`; the page names the latest
// released one in `ready` (BRIDGE_SERVER_LATEST), so both sides can say when
// this server is behind and what the user does about it.
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
export const isVersion = v => typeof v === 'string' && SEMVER.test(v);
// -1, 0 or 1; a missing or malformed version is older than any real one.
export function compareVersions(a, b) {
  const pa = isVersion(a) ? a.split('.').map(Number) : null;
  const pb = isVersion(b) ? b.split('.').map(Number) : null;
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
export const DESKTOP_EXTENSION_URL = 'https://github.com/kruxik/zenit-week/releases/latest/download/zenit-week.mcpb';
// What the user does to update, by install path, worded for the agent to pass on.
export const UPDATE_ACTIONS = Object.freeze({
  npx: 'restart your agent app; it fetches the new server on start',
  mcpb: `download the new Zenit Week extension for Claude Desktop (${DESKTOP_EXTENSION_URL}) and open it`,
  repo: 'pull the Zenit Week repository and restart your agent app',
});
// The one-time note for the first result of a session when this server is
// older than the latest release the page knows; null when it is not.
export function updateNote({ version, latest, install }) {
  if (!isVersion(latest) || compareVersions(version, latest) >= 0) return null;
  const action = UPDATE_ACTIONS[install] || UPDATE_ACTIONS.npx;
  return `This Zenit Week server is ${isVersion(version) ? version : 'an older version'}; ${latest} is out. `
    + `Tell the user, in your reply, to update it: ${action}. Everything keeps working meanwhile, but new features need the update.`;
}
export const PAIR_TIMEOUT_MS = 120000;     // from the moment the dialog is shown
export const PAIR_UNSHOWN_MAX_MS = 600000; // a dialog that waits behind the user's editing
const PAIR_INFO = 'zenit-week pairing v2';
const b64 = buf => Buffer.from(buf).toString('base64url');
const unb64 = s => Buffer.from(String(s || ''), 'base64url');

export function hmacB64(keyB64, message) {
  return crypto.createHmac('sha256', unb64(keyB64)).update(String(message)).digest('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const sha256 = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts.map(Buffer.from))).digest();

// Six digits from both public keys and both nonces, server's first. The page
// computes the same (pairCodeFor in zenit-week.html).
export function pairCodeFor(pubS, pubP, nonceS, nonceP) {
  const h = sha256(pubS, pubP, nonceS, nonceP);
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

export function pairKeyFor(shared, nonceS, nonceP) {
  return b64(crypto.hkdfSync('sha256', shared, Buffer.concat([nonceS, nonceP]), PAIR_INFO, 32));
}

// "482 913": how both sides show a code.
export const formatPairCode = code => `${code.slice(0, 3)} ${code.slice(3)}`;

// ~/.config/zenit-week-mcp/pairings.json, owner-only: one entry per site,
// shared by every server on the machine whatever installed it.
export function configDir(home = os.homedir()) {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'zenit-week-mcp');
}
export const pairingsPath = (home) => path.join(configDir(home), 'pairings.json');
export const configPath = (home) => path.join(configDir(home), 'config.json');

// ~/.config/zenit-week-mcp/config.json, owner-only: the added sites. Read on
// every new connection, so `origins add` needs no restart.
export function readOrigins(file = configPath()) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(raw?.origins) ? raw.origins : []).map(parseExtraOrigin).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function writeConfig(origins, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ origins }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

// Returns the normalised origin, or null when `value` is not an https URL.
export function addOrigin(value, file = configPath()) {
  const o = parseExtraOrigin(value);
  if (!o) return null;
  const list = readOrigins(file);
  if (!list.includes(o)) writeConfig([...list, o], file);
  return o;
}

// Returns whether a site was removed; matched like `unpair` (origin or host).
export function removeOrigin(value, file = configPath()) {
  const list = readOrigins(file);
  const kept = list.filter(o => !matchSite(value, o));
  if (kept.length !== list.length) writeConfig(kept, file);
  return kept.length !== list.length;
}

const PAIRING_ID = /^[A-Za-z0-9_-]{16,64}$/;
const PAIRING_KEY = /^[A-Za-z0-9_-]{43}$/;

export function readPairings(file = pairingsPath()) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw?.pairings) ? raw.pairings : [];
    return list.filter(e => e && typeof e.origin === 'string' && PAIRING_ID.test(e.pairingId) && PAIRING_KEY.test(e.key));
  } catch (_) {
    return [];
  }
}

export function writePairings(list, file = pairingsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, pairings: list }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

// The store the relay uses. Read on every handshake, so a pairing made through
// one agent app's server is seen by every other one at once.
export function filePairings(file = pairingsPath()) {
  return {
    get: origin => readPairings(file).find(e => e.origin === origin) || null,
    set: entry => writePairings([...readPairings(file).filter(e => e.origin !== entry.origin), entry], file),
    delete: origin => {
      const list = readPairings(file);
      const kept = list.filter(e => e.origin !== origin);
      if (kept.length !== list.length) writePairings(kept, file);
      return list.length - kept.length;
    },
    list: () => readPairings(file),
    // Last use per site, for `--open` (setup spec section 6, row 8).
    touch: (origin, at) => {
      const list = readPairings(file);
      const e = list.find(x => x.origin === origin);
      if (e) { e.lastUsedAt = at; writePairings(list, file); }
    },
  };
}

export function memoryPairings(initial = []) {
  let list = [...initial];
  return {
    get: origin => list.find(e => e.origin === origin) || null,
    set: entry => { list = [...list.filter(e => e.origin !== entry.origin), entry]; },
    delete: origin => { const n = list.length; list = list.filter(e => e.origin !== origin); return n - list.length; },
    list: () => [...list],
    touch: (origin, at) => { const e = list.find(x => x.origin === origin); if (e) e.lastUsedAt = at; },
  };
}

// The site `--open` launches: the pairing used last, else production.
export function lastUsedSite(list) {
  const used = list.filter(e => typeof e.lastUsedAt === 'string').sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  return used.length ? used[0].origin : 'https://zenitweek.com';
}

// `unpair <site>`: an origin, or a bare host name, matched against stored sites.
export function matchSite(arg, origin) {
  const a = String(arg || '').trim().replace(/\/+$/, '');
  if (!a) return false;
  if (a === origin) return true;
  try { return new URL(origin).host === a || new URL(a).origin === origin; } catch (_) { return false; }
}

// Binds the first free port of `ports`. `tryListen(port)` resolves to the
// listening server, or to null when the port is taken; any other failure
// rejects. Resolves to { port, server }, or null when every port is taken.
export async function listenOnFirstFreePort(tryListen, ports = PORTS) {
  for (const port of ports) {
    const server = await tryListen(port);
    if (server) return { port, server };
  }
  return null;
}

class RelayError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
export { RelayError };

const NONCE = /^[A-Za-z0-9_-]{43}$/;      // 32 bytes, base64url
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/; // 65-byte uncompressed P-256 point

// One connected page. `ws` needs only send(string), close(code, reason) and the
// caller feeding frames into Relay.onMessage / onClose.
//   new   - socket open, no `open` frame yet (2 s to send one)
//   open  - protocol checked; not paired, or not proven yet. Knows only
//           whether the tab is visible and focused: no week, no tab id.
//   ready - both sides proved the pairing key; calls may run
class Tab {
  constructor(ws, origin) {
    this.ws = ws;
    this.origin = origin;
    this.state = 'new';
    this.id = null;
    this.week = null;
    this.visible = false;
    this.lastFocus = 0;
    this.lastVisible = 0;
    this.timer = null;
    this.nonce = null;      // the server's nonce of this connection
    this.pairingId = null;  // the pairing this tab proved
    this.serverLatest = null; // the latest server version the page knows
    this.manifest = null;     // the page's tools (mcp-updates.md section 3), validated
  }
  get ready() { return this.state === 'ready'; }
}

export class Relay {
  constructor({
    pairings = memoryPairings(), clientName = () => null, install = 'npx', version = null,
    onWeekSaved = () => {}, onManifest = () => {}, now = () => Date.now(), log = () => {},
  } = {}) {
    this.onManifest = onManifest;
    this.pairings = pairings;
    this.clientName = clientName;
    this.install = install;
    this.onWeekSaved = onWeekSaved;
    this.now = now;
    this.log = log;
    this.tabs = new Set();
    this.pending = new Map();
    this.nextId = 1;
    this.writes = [];
    this.tabWaiters = new Set();
    this.pairing = null; // the one open pairing of this server
    this.version = isVersion(version) ? version : null;
  }

  // A socket that already passed the origin check.
  onOpen(ws, origin) {
    const tab = new Tab(ws, origin);
    tab.timer = setTimeout(() => { if (tab.state === 'new') this._close(tab, 4002, 'handshake timeout'); }, HANDSHAKE_TIMEOUT_MS);
    this.tabs.add(tab);
    return tab;
  }

  onMessage(tab, text) {
    let f;
    try { f = JSON.parse(text); } catch (_) { return; }
    if (!f || typeof f !== 'object') return;
    if (tab.state === 'new') return this._onFirstFrame(tab, f);
    if (tab.state === 'open') return this._onUnpairedFrame(tab, f);
    return this._onReadyFrame(tab, f);
  }

  _onFirstFrame(tab, f) {
    // A v1 page opens with `challenge`. On any mismatch the server names its
    // protocol and install path first, so a newer page can say which side to
    // update and how (setup spec 4.5), then closes.
    if (f.type === 'challenge' || (f.type === 'open' && f.protocol !== PROTOCOL)) {
      this._send(tab, { type: 'mismatch', protocol: PROTOCOL, install: this.install });
      this._close(tab, 4003, 'protocol');
      return;
    }
    if (f.type !== 'open') return;
    clearTimeout(tab.timer);
    tab.state = 'open';
    tab.nonce = b64(crypto.randomBytes(32));
    this._seen(tab, !!f.visible, !!f.focused);
    const welcome = { type: 'welcome', protocol: PROTOCOL, install: this.install, version: this.version, client: this.clientName() || null, nonce: tab.nonce, paired: false };
    const entry = typeof f.pairingId === 'string' ? this.pairings.get(tab.origin) : null;
    if (entry && entry.pairingId === f.pairingId && typeof f.nonce === 'string' && NONCE.test(f.nonce)) {
      welcome.paired = true;
      welcome.proof = hmacB64(entry.key, `server|${f.nonce}`);
    } else if (typeof f.pairingId === 'string') {
      welcome.unknown = true; // the page keeps its key (setup spec 4.7, row 2)
    }
    this._send(tab, welcome);
    this._wakeTabWaiters();
  }

  _onUnpairedFrame(tab, f) {
    if (f.type === 'event') { this._event(tab, f); return; }
    if (f.type === 'ready') { this._onReady(tab, f); return; }
    const p = this.pairing;
    if (!p || p.tab !== tab) return;
    if (f.type === 'pair-key') this._onPairKey(p, f);
    else if (f.type === 'pair-shown') this._armPairTimer(p, PAIR_TIMEOUT_MS);
    else if (f.type === 'pair-ok') this._onPairOk(p, f);
    else if (f.type === 'pair-deny') this._settlePairing(p, f.reason === 'busy' ? 'busy' : 'denied');
  }

  // The page proves the pairing key; only then does it name its tab and week.
  _onReady(tab, f) {
    const entry = this.pairings.get(tab.origin);
    if (!entry || typeof f.proof !== 'string' || !safeEqual(f.proof, hmacB64(entry.key, `page|${tab.nonce}`))) {
      this._close(tab, 4001, 'refused');
      return;
    }
    tab.state = 'ready';
    tab.pairingId = entry.pairingId;
    this.pairings.touch?.(tab.origin, new Date(this.now()).toISOString());
    tab.id = String(f.tabId || '');
    tab.week = f.week || null;
    // The latest server release the page knows (mcp-updates.md 5.1); an older
    // page sends none.
    tab.serverLatest = isVersion(f.serverLatest) ? f.serverLatest : null;
    this._seen(tab, !!f.visible, !!f.visible);
    this.log(`tab ${tab.id} connected (week ${tab.week})`);
    this._wakeTabWaiters();
  }

  _onReadyFrame(tab, f) {
    if (f.type === 'result') {
      const p = this.pending.get(f.id);
      if (!p || p.tab !== tab) return;
      this.pending.delete(f.id);
      clearTimeout(p.timer);
      if (f.ok) p.resolve(f.data);
      else p.reject(new RelayError(f.error?.code || 'internal', f.error?.message));
    } else if (f.type === 'event') {
      this._event(tab, f);
      if (f.event === 'week-saved' && typeof f.wk === 'string') this.onWeekSaved(f.wk, tab);
    } else if (f.type === 'manifest') {
      // The page's tool list (mcp-updates.md section 3). A bad one is ignored
      // and the tools registered so far stay.
      const m = validateManifest(f.manifest);
      if (!m) { this.log(`tab ${tab.id} sent a manifest that fails the check; ignored`); return; }
      tab.manifest = m;
      // The server's handling never takes the process down with it.
      try { this.onManifest(tab, m); } catch (e) { this.log(`manifest of tab ${tab.id} not applied: ${e.message}`); }
    } else if (f.type === 'unpair') {
      // Settings "Unpair": this site's pairing goes for every server, since
      // they share the file; every tab of the site here is shut out with it.
      const entry = this.pairings.get(tab.origin);
      if (entry && entry.pairingId === tab.pairingId) this.pairings.delete(tab.origin);
      for (const t of [...this.tabs]) if (t.origin === tab.origin && t.ready) this._close(t, 4004, 'unpaired');
      this.log(`site ${tab.origin} unpaired from the app`);
    }
  }

  _event(tab, f) {
    const t = this.now();
    if (f.event === 'focus') this._seen(tab, true, true);
    else if (f.event === 'pause') { if (tab.visible) tab.lastVisible = t; tab.visible = false; }
    if (tab.ready && f.wk && (f.event === 'view' || f.event === 'focus' || f.event === 'pause')) tab.week = f.wk;
  }

  _seen(tab, visible, focused) {
    const t = this.now();
    tab.visible = visible;
    if (visible) tab.lastVisible = t;
    if (focused) tab.lastFocus = t;
  }

  onClose(tab) {
    clearTimeout(tab.timer);
    this.tabs.delete(tab);
    if (this.pairing && this.pairing.tab === tab) this._settlePairing(this.pairing, 'closed');
    for (const [id, p] of this.pending) {
      if (p.tab !== tab) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new RelayError('no_app_tab', 'the app tab closed during the call'));
    }
  }

  // The tab that executes: the most recently focused visible one, else the
  // most recently visible one (a hidden tab still writes fine). Paired only.
  // With `app`, only tabs of that site count.
  pickTab(app = null) {
    return this._pick([...this.tabs].filter(t => t.ready && appMatches(app, t.origin)));
  }

  // The sites with a tab here, paired or not, by name, in a stable order.
  openApps() {
    return [...new Set([...this.tabs].filter(t => t.state !== 'new').map(t => appName(t.origin)))].sort();
  }

  // Paired tabs with a manifest, the one a call goes to by default last.
  manifestTabs() {
    const chosen = this.pickTab();
    const tabs = [...this.tabs].filter(t => t.ready && t.manifest && t !== chosen);
    return chosen && chosen.manifest ? [...tabs, chosen] : tabs;
  }

  // zenit://apps: every connected app tab of this server.
  listApps() {
    const chosen = this.pickTab();
    return [...this.tabs].filter(t => t.state !== 'new').map(t => ({
      app: appName(t.origin),
      paired: t.ready,
      week: t.ready ? t.week : null,
      visible: t.visible,
      focused: t === chosen,
    }));
  }

  _pick(tabs) {
    if (!tabs.length) return null;
    const visible = tabs.filter(t => t.visible).sort((a, b) => b.lastFocus - a.lastFocus);
    if (visible.length) return visible[0];
    return tabs.sort((a, b) => b.lastVisible - a.lastVisible)[0];
  }

  hasAnyTab() {
    return [...this.tabs].some(t => t.state !== 'new');
  }

  currentWeek() {
    return this.pickTab()?.week || null;
  }

  // Resolves true once a tab is open (paired or not), false after `ms`.
  waitForTab(ms = OPEN_WAIT_MS, { paired = false } = {}) {
    const have = () => (paired ? !!this.pickTab() : this.hasAnyTab());
    if (have()) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); this.tabWaiters.delete(fn); resolve(ok); };
      const fn = () => { if (have()) done(true); };
      const timer = setTimeout(() => done(false), ms);
      this.tabWaiters.add(fn);
    });
  }

  _wakeTabWaiters() { [...this.tabWaiters].forEach(fn => fn()); }

  // ── Pairing ──
  // Called when the agent asks for something and no tab is paired. Resolves to
  //   { kind: 'no_tab' }   nothing connected at all
  //   { kind: 'hidden' }   only hidden tabs: no dialog (setup spec 4.3, row 2)
  //   { kind: 'pairing', code, settled }  the dialog is (or will be) up; `code`
  //       is the 6 digits, `settled` resolves to 'paired' | 'denied' | 'timeout'
  //       | 'busy' | 'closed' | 'failed'. Repeated requests get the same pairing.
  //   { kind: 'busy' }     the tab is showing another server's request
  //   { kind: 'failed' }   the key exchange broke off
  // A promise either way; with no tab it resolves at once.
  requestPairing(app = null) {
    if (this.pairing) return appMatches(app, this.pairing.tab.origin) ? this.pairing.view : Promise.resolve({ kind: 'busy' });
    const open = [...this.tabs].filter(t => t.state === 'open' && appMatches(app, t.origin));
    if (!open.length) return Promise.resolve({ kind: 'no_tab' });
    const visible = open.filter(t => t.visible).sort((a, b) => b.lastFocus - a.lastFocus);
    if (!visible.length) return Promise.resolve({ kind: 'hidden' });
    const tab = visible[0];
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const p = {
      tab, ecdh, pub: ecdh.getPublicKey(), nonce: crypto.randomBytes(32), key: null, timer: null,
      settled: null, settle: null, codeReady: null, codeResolve: null, view: null, outcome: null,
    };
    p.settled = new Promise(r => { p.settle = r; });
    p.codeReady = new Promise(r => { p.codeResolve = r; });
    this.pairing = p;
    this._armPairTimer(p, PAIR_UNSHOWN_MAX_MS);
    // Every request during this pairing gets this same promise, so the same code.
    p.view = Promise.race([p.codeReady, p.settled.then(() => null)])
      .then(code => (code ? { kind: 'pairing', code, settled: p.settled, app: appName(tab.origin) } : { kind: p.outcome === 'busy' ? 'busy' : 'failed' }));
    this._send(tab, { type: 'pair-start', commit: b64(sha256(p.pub, p.nonce)), client: this.clientName() || null });
    return p.view;
  }

  _onPairKey(p, f) {
    if (p.key || !PUBLIC_KEY.test(f.pub || '') || !NONCE.test(f.nonce || '')) { this._settlePairing(p, 'failed'); return; }
    const pubP = unb64(f.pub);
    const nonceP = unb64(f.nonce);
    let shared;
    try { shared = p.ecdh.computeSecret(pubP); } catch (_) { this._settlePairing(p, 'failed'); return; }
    p.key = pairKeyFor(shared, p.nonce, nonceP);
    this._send(p.tab, { type: 'pair-reveal', pub: b64(p.pub), nonce: b64(p.nonce) });
    p.codeResolve(pairCodeFor(p.pub, pubP, p.nonce, nonceP));
  }

  _onPairOk(p, f) {
    if (!p.key || typeof f.pairingId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(f.pairingId)
      || typeof f.proof !== 'string' || !safeEqual(f.proof, hmacB64(p.key, `ok|${f.pairingId}`))) {
      this._settlePairing(p, 'failed');
      return;
    }
    this.pairings.set({ pairingId: f.pairingId, origin: p.tab.origin, key: p.key, pairedAt: new Date(this.now()).toISOString() });
    this.log(`site ${p.tab.origin} paired`);
    this._settlePairing(p, 'paired');
  }

  _armPairTimer(p, ms) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      this._send(p.tab, { type: 'pair-cancel' });
      this._settlePairing(p, 'timeout');
    }, ms);
  }

  _settlePairing(p, outcome) {
    if (this.pairing !== p) return;
    clearTimeout(p.timer);
    this.pairing = null;
    p.outcome = outcome;
    p.settle(outcome);
  }

  _spendWrite() {
    const t = this.now();
    this.writes = this.writes.filter(w => t - w < 60000);
    if (this.writes.length >= WRITE_BUDGET_PER_MIN) return false;
    this.writes.push(t);
    return true;
  }

  call(tool, args = {}, { app = null } = {}) {
    const tab = this.pickTab(app);
    if (!tab) {
      const open = this.openApps();
      return Promise.reject(new RelayError('no_app_tab', app
        ? `no paired tab of "${app}" is connected${open.length ? `; open apps: ${open.join(', ')}` : ''}`
        : 'no Zenit Week tab is connected: open the app in Chrome or Firefox with AI agents on'));
    }
    if (!READ_TOOLS.has(tool) && !this._spendWrite()) {
      return Promise.reject(new RelayError('rate_limited', `more than ${WRITE_BUDGET_PER_MIN} writes in a minute`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RelayError('timeout', `${tool} did not answer in ${CALL_TIMEOUT_MS / 1000} s`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { tab, resolve, reject, timer });
      this._send(tab, { type: 'call', id, tool, args });
    });
  }

  _send(tab, frame) {
    try { tab.ws.send(JSON.stringify(frame)); } catch (_) { /* socket gone; onClose follows */ }
  }

  _close(tab, code, reason) {
    try { tab.ws.close(code, reason); } catch (_) { /* already closed */ }
    this.onClose(tab);
  }
}

// The resource URIs a vision save touches.
// show_task brings the browser to the front (macOS). The page's socket is the
// way to the browser: lsof names the process at the other end of it, and the
// outermost .app around that process's executable is the browser to activate.
// `lsof -F pn` output -> the first pid other than ours.
export function peerPidFromLsof(out, ownPid) {
  for (const line of String(out).split('\n')) {
    if (!line.startsWith('p')) continue;
    const pid = Number(line.slice(1));
    if (Number.isInteger(pid) && pid > 0 && pid !== ownPid) return pid;
  }
  return null;
}

// "/Applications/Google Chrome.app/Contents/Frameworks/.../Helper" ->
// "/Applications/Google Chrome.app"; null outside an application bundle.
export function appBundleOf(execPath) {
  const m = /^(\/.*?\.app)(?:\/|$)/.exec(String(execPath || '').trim());
  return m ? m[1] : null;
}

// The page's browser hint is untrusted: only these names reach `open -a`.
export const BROWSER_HINTS = Object.freeze(['Google Chrome', 'Microsoft Edge', 'Opera', 'Firefox', 'Safari']);
export const browserHint = hint => (BROWSER_HINTS.includes(hint) ? hint : null);

export function urisForVisionSaved() {
  return ['zenit://vision'];
}

// The resource URIs a week-saved event touches. The vision rides the same
// event under VISION_KEY and touches only its own resource.
export function urisForWeekSaved(wk, currentWeek) {
  if (wk === VISION_KEY) return urisForVisionSaved();
  const uris = ['zenit://weeks', `zenit://week/${wk}`];
  if (wk === currentWeek) {
    uris.push('zenit://week/current');
    for (let d = 1; d <= 7; d++) uris.push(`zenit://agenda/${d}`);
  }
  return uris;
}

// ── Manifest: the page defines the tools (docs/specs/mcp-updates.md section 3) ──
// The page sends its tools, resources and agent instructions after `ready`;
// the server registers whatever it says. The only work left in the server is
// its hooks: what a page cannot do.
export const KNOWN_HOOKS = Object.freeze(['raise-browser', 'apps']);
export const MANIFEST_LIMITS = Object.freeze({
  tools: 64, resources: 32, description: 2000, instructions: 8000, schemaDepth: 6, schemaKeys: 64,
});
const TOOL_NAME = /^[a-z_]{1,64}$/;
const RESOURCE_NAME = /^[a-z-]{1,64}$/;
const HOOK_NAME = /^[a-z-]{1,32}$/;
const RESOURCE_URI = /^zenit:\/\/[a-z0-9/_-]{1,120}$/;
const RESOURCE_TEMPLATE = /^zenit:\/\/[a-z0-9/_-]{0,100}\{[a-z]{1,16}\}$/;
// Template variables map to a fixed vocabulary: `day` an integer, `week` a
// week key where `current` means none.
export const RESOURCE_ARG_KINDS = Object.freeze(['day', 'week']);
// Plain JSON Schema only: nothing that points outside the schema.
const SCHEMA_TYPES = new Set(['object', 'string', 'integer', 'number', 'boolean', 'array', 'null']);
const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

// A copy of `schema` holding only the allowed keywords, or null.
export function cleanSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > MANIFEST_LIMITS.schemaDepth) return null;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    switch (k) {
      case 'type':
        if (!SCHEMA_TYPES.has(v)) return null;
        out.type = v; break;
      case 'description':
        if (!isText(v, MANIFEST_LIMITS.description)) return null;
        out.description = v; break;
      case 'pattern':
        if (!isText(v, 200)) return null;
        try { new RegExp(v); } catch (_) { return null; }
        out.pattern = v; break;
      case 'minimum': case 'maximum': case 'minLength': case 'maxLength': case 'minItems': case 'maxItems':
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        out[k] = v; break;
      case 'enum':
        if (!Array.isArray(v) || !v.length || v.length > 32 || !v.every(x => typeof x === 'string' || typeof x === 'number')) return null;
        out.enum = [...v]; break;
      case 'required':
        if (!Array.isArray(v) || !v.every(x => typeof x === 'string' && TOOL_NAME.test(x))) return null;
        out.required = [...v]; break;
      case 'additionalProperties':
        if (typeof v !== 'boolean') return null;
        out.additionalProperties = v; break;
      case 'items': {
        const c = cleanSchema(v, depth + 1);
        if (!c) return null;
        out.items = c; break;
      }
      case 'properties': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
        const entries = Object.entries(v);
        if (entries.length > MANIFEST_LIMITS.schemaKeys) return null;
        out.properties = {};
        for (const [name, sub] of entries) {
          const c = TOOL_NAME.test(name) ? cleanSchema(sub, depth + 1) : null;
          if (!c) return null;
          out.properties[name] = c;
        }
        break;
      }
      default: return null; // $ref, $defs, anyOf ... : refused, not dropped
    }
  }
  return out;
}

function cleanTool(t) {
  if (!t || typeof t !== 'object' || !TOOL_NAME.test(t.name) || !isText(t.description, MANIFEST_LIMITS.description)) return null;
  const inputSchema = cleanSchema(t.inputSchema);
  if (!inputSchema || inputSchema.type !== 'object' || (inputSchema.properties && 'app' in inputSchema.properties)) return null;
  const annotations = {};
  for (const k of ANNOTATION_KEYS) if (typeof t.annotations?.[k] === 'boolean') annotations[k] = t.annotations[k];
  if (t.hook !== undefined && !(typeof t.hook === 'string' && HOOK_NAME.test(t.hook))) return null;
  return { name: t.name, description: t.description, inputSchema, annotations, ...(t.hook ? { hook: t.hook } : {}) };
}

function cleanResource(r) {
  if (!r || typeof r !== 'object' || !RESOURCE_NAME.test(r.name) || !isText(r.description, MANIFEST_LIMITS.description)) return null;
  const isTemplate = r.uriTemplate !== undefined;
  if (isTemplate ? !RESOURCE_TEMPLATE.test(r.uriTemplate) : !RESOURCE_URI.test(r.uri)) return null;
  if (r.hook !== undefined && !(typeof r.hook === 'string' && HOOK_NAME.test(r.hook))) return null;
  if (!r.hook && !TOOL_NAME.test(r.tool)) return null;
  const args = {};
  if (r.args !== undefined) {
    if (!r.args || typeof r.args !== 'object' || Array.isArray(r.args)) return null;
    for (const [k, kind] of Object.entries(r.args)) {
      if (!/^[a-z]{1,16}$/.test(k) || !RESOURCE_ARG_KINDS.includes(kind)) return null;
      args[k] = kind;
    }
  }
  if (isTemplate) {
    const v = /\{([a-z]+)\}$/.exec(r.uriTemplate)[1];
    if (!args[v]) return null; // the template's one variable must be mapped
  }
  return {
    name: r.name, description: r.description,
    ...(isTemplate ? { uriTemplate: r.uriTemplate } : { uri: r.uri }),
    ...(r.tool ? { tool: r.tool } : {}), ...(Object.keys(args).length ? { args } : {}), ...(r.hook ? { hook: r.hook } : {}),
  };
}

// The manifest as the server keeps it, or null when it fails the check.
// `manifestVersion` is recomputed here, never taken from the sender.
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (!isText(m.instructions, MANIFEST_LIMITS.instructions)) return null;
  if (m.minServer !== undefined && m.minServer !== null && !isVersion(m.minServer)) return null;
  if (!Array.isArray(m.tools) || !m.tools.length || m.tools.length > MANIFEST_LIMITS.tools) return null;
  if (!Array.isArray(m.resources) || m.resources.length > MANIFEST_LIMITS.resources) return null;
  const tools = m.tools.map(cleanTool);
  const resources = m.resources.map(cleanResource);
  if (tools.includes(null) || resources.includes(null)) return null;
  if (new Set(tools.map(t => t.name)).size !== tools.length) return null;
  if (new Set(resources.map(r => r.name)).size !== resources.length) return null;
  const out = { minServer: m.minServer || null, instructions: m.instructions, tools, resources };
  return { manifestVersion: manifestHash(out), ...out };
}

// Content hash of a manifest without its version; the page computes the same.
export function manifestHash(m) {
  const { manifestVersion, ...rest } = m;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('base64url').slice(0, 22);
}

// Hooks this server does not have, and whether the manifest needs a newer
// server: either way the user is told to update (section 3.3); the tools
// still work, without the extra.
export function manifestNeeds(m, version) {
  const hooks = [...m.tools, ...m.resources].map(x => x.hook).filter(Boolean);
  return {
    unknownHooks: [...new Set(hooks.filter(h => !KNOWN_HOOKS.includes(h)))],
    newerServer: !!m.minServer && compareVersions(version, m.minServer) < 0,
  };
}

// What the server registers: the base manifest (cache or baseline), then each
// connected app's on top, the default app's last (section 3.5). Instructions
// stay the base's: MCP fixes them at session start.
export function mergeManifests(base, overlays = []) {
  const tools = new Map(base.tools.map(t => [t.name, t]));
  const resources = new Map(base.resources.map(r => [r.name, r]));
  for (const m of overlays) {
    m.tools.forEach(t => tools.set(t.name, t));
    m.resources.forEach(r => resources.set(r.name, r));
  }
  return { instructions: base.instructions, tools: [...tools.values()], resources: [...resources.values()] };
}

// A resource URI -> { resource, args, app }, or null. Every resource takes
// `?app=<name>` (setup spec section 6, row 5).
export function matchResource(resources, uri) {
  const s = String(uri);
  const q = s.indexOf('?');
  const base = q < 0 ? s : s.slice(0, q);
  const app = q < 0 ? null : new URLSearchParams(s.slice(q + 1)).get('app');
  const exact = resources.find(r => r.uri === base);
  if (exact) return { resource: exact, args: {}, app };
  for (const r of resources) {
    if (!r.uriTemplate) continue;
    const prefix = r.uriTemplate.slice(0, r.uriTemplate.indexOf('{'));
    const name = /\{([a-z]+)\}$/.exec(r.uriTemplate)[1];
    if (!base.startsWith(prefix)) continue;
    const raw = decodeURIComponent(base.slice(prefix.length));
    if (!raw || raw.includes('/')) continue;
    const kind = r.args[name];
    if (kind === 'day') {
      if (!/^\d{1,2}$/.test(raw)) continue;
      return { resource: r, args: { [name]: parseInt(raw, 10) }, app };
    }
    if (kind === 'week') return { resource: r, args: raw === 'current' ? {} : { [name]: raw }, app };
  }
  return null;
}

// ~/.config/zenit-week-mcp/manifest-<site>.json, owner-only, beside pairings.json.
export function manifestPath(origin, home) {
  let host;
  try { host = new URL(origin).host; } catch (_) { host = String(origin); }
  return path.join(configDir(home), `manifest-${host.replace(/[^a-z0-9.-]/gi, '_')}.json`);
}

export function readManifestCache(origin, home) {
  try { return validateManifest(JSON.parse(fs.readFileSync(manifestPath(origin, home), 'utf8'))); } catch (_) { return null; }
}

export function writeManifestCache(origin, m, home) {
  const file = manifestPath(origin, home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

// The tools of an MCP listing: the manifest's schema plus `app`.
export const APP_ARG = Object.freeze({
  type: 'string',
  description: 'Which app: "Zenit Week" or a host name such as abc.ngrok-free.app (see zenit://apps). Default: the focused tab.',
});
export function listedTool(t) {
  return {
    name: t.name, description: t.description,
    inputSchema: { ...t.inputSchema, type: 'object', properties: { ...(t.inputSchema.properties || {}), app: APP_ARG } },
    ...(Object.keys(t.annotations || {}).length ? { annotations: t.annotations } : {}),
  };
}

export const LIST_CHANGED_NOTE = 'Zenit Week has new tools for this session. If one is missing, ask the user to restart the agent app.';
