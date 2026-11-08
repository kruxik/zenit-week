// The relay half of zenit-week-mcp, free of third-party dependencies so the
// app's test suite can load it directly. It knows the wire protocol
// (docs/specs/agent-bridge.md, section 9), the origin allowlist, the pairing
// token, tab routing and the rate budget. It never reads or merges week data:
// every call is forwarded to a page, which does the work.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 47831;
export const HANDSHAKE_TIMEOUT_MS = 2000;
export const CALL_TIMEOUT_MS = 60000; // a write may wait 30 s for an editing user, plus the lock
export const OPEN_WAIT_MS = 15000;
export const WRITE_BUDGET_PER_MIN = 200;

// Tools that only read. They do not count against the write budget.
export const READ_TOOLS = new Set(['read_weeks', 'read_week', 'read_schedule', 'read_agenda', 'get_stats']);

const ALLOWED_EXACT = new Set(['https://zenitweek.com', 'https://www.zenitweek.com']);
const ALLOWED_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function isAllowedOrigin(origin) {
  if (typeof origin !== 'string') return false;
  return ALLOWED_EXACT.has(origin) || ALLOWED_DEV.test(origin);
}

// Same construction as the page: HMAC-SHA256 over the nonce, keyed with the
// UTF-8 bytes of the token string, base64url without padding.
export function proofFor(token, nonce) {
  return crypto.createHmac('sha256', token).update(String(nonce)).digest('base64url');
}

export function tokensEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function pairingCode(port, token) {
  return `${port}.${token}`;
}

// ~/.config/zenit-week-mcp/token, owner-only.
export function tokenPath(home = os.homedir()) {
  const base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'zenit-week-mcp', 'token');
}

export function loadOrCreateToken(file = tokenPath(), { rotate = false } = {}) {
  if (!rotate) {
    try {
      const t = fs.readFileSync(file, 'utf8').trim();
      if (/^[A-Za-z0-9_-]{16,128}$/.test(t)) return { token: t, created: false };
    } catch (_) { /* first start */ }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const token = newToken();
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { token, created: true };
}

class RelayError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
export { RelayError };

// One connected page. `ws` needs only send(string), close(code, reason) and the
// caller feeding frames into Relay.onMessage / onClose.
class Tab {
  constructor(ws) {
    this.ws = ws;
    this.ready = false;
    this.id = null;
    this.week = null;
    this.visible = false;
    this.lastFocus = 0;
    this.lastVisible = 0;
    this.timer = null;
  }
}

export class Relay {
  constructor({ token, clientName = () => null, onWeekSaved = () => {}, now = () => Date.now(), log = () => {} }) {
    this.token = token;
    this.clientName = clientName;
    this.onWeekSaved = onWeekSaved;
    this.now = now;
    this.log = log;
    this.tabs = new Set();
    this.pending = new Map();
    this.nextId = 1;
    this.writes = [];
    this.helloWaiters = new Set();
  }

  // A socket that already passed the origin check.
  onOpen(ws) {
    const tab = new Tab(ws);
    tab.timer = setTimeout(() => { if (!tab.ready) this._close(tab, 4002, 'handshake timeout'); }, HANDSHAKE_TIMEOUT_MS);
    this.tabs.add(tab);
    return tab;
  }

  onMessage(tab, text) {
    let f;
    try { f = JSON.parse(text); } catch (_) { return; }
    if (!f || typeof f !== 'object') return;
    if (!tab.ready) {
      if (f.type === 'challenge' && typeof f.nonce === 'string' && f.nonce.length >= 16 && f.nonce.length <= 256) {
        this._send(tab, { type: 'proof', hmac: proofFor(this.token, f.nonce), client: this.clientName() || null });
      } else if (f.type === 'hello') {
        if (!tokensEqual(f.token, this.token)) { this._close(tab, 4001, 'refused'); return; }
        clearTimeout(tab.timer);
        tab.ready = true;
        tab.id = String(f.tabId || '');
        tab.week = f.week || null;
        tab.visible = !!f.visible;
        if (tab.visible) tab.lastFocus = tab.lastVisible = this.now();
        this.log(`tab ${tab.id} connected (week ${tab.week})`);
        this.helloWaiters.forEach(fn => fn());
      }
      return;
    }
    if (f.type === 'result') {
      const p = this.pending.get(f.id);
      if (!p || p.tab !== tab) return;
      this.pending.delete(f.id);
      clearTimeout(p.timer);
      if (f.ok) p.resolve(f.data);
      else p.reject(new RelayError(f.error?.code || 'internal', f.error?.message));
    } else if (f.type === 'event') {
      const t = this.now();
      if (f.event === 'focus') { tab.visible = true; tab.lastFocus = t; tab.lastVisible = t; }
      else if (f.event === 'pause') { if (tab.visible) tab.lastVisible = t; tab.visible = false; }
      if (f.wk && (f.event === 'view' || f.event === 'focus' || f.event === 'pause')) tab.week = f.wk;
      if (f.event === 'week-saved' && typeof f.wk === 'string') this.onWeekSaved(f.wk, tab);
    }
  }

  onClose(tab) {
    clearTimeout(tab.timer);
    this.tabs.delete(tab);
    for (const [id, p] of this.pending) {
      if (p.tab !== tab) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new RelayError('no_app_tab', 'the app tab closed during the call'));
    }
  }

  // The tab that executes: the most recently focused visible one, else the
  // most recently visible one (a hidden tab still writes fine).
  pickTab() {
    const ready = [...this.tabs].filter(t => t.ready);
    if (!ready.length) return null;
    const visible = ready.filter(t => t.visible).sort((a, b) => b.lastFocus - a.lastFocus);
    if (visible.length) return visible[0];
    return ready.sort((a, b) => b.lastVisible - a.lastVisible)[0];
  }

  currentWeek() {
    return this.pickTab()?.week || null;
  }

  waitForTab(ms = OPEN_WAIT_MS) {
    if (this.pickTab()) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = ok => { clearTimeout(timer); this.helloWaiters.delete(fn); resolve(ok); };
      const fn = () => done(true);
      const timer = setTimeout(() => done(false), ms);
      this.helloWaiters.add(fn);
    });
  }

  _spendWrite() {
    const t = this.now();
    this.writes = this.writes.filter(w => t - w < 60000);
    if (this.writes.length >= WRITE_BUDGET_PER_MIN) return false;
    this.writes.push(t);
    return true;
  }

  call(tool, args = {}) {
    const tab = this.pickTab();
    if (!tab) return Promise.reject(new RelayError('no_app_tab', 'no Zenit Week tab is connected: open the app in Chrome or Firefox with the agent bridge on'));
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

// The resource URIs a week-saved event touches.
export function urisForWeekSaved(wk, currentWeek) {
  const uris = ['zenit://weeks', `zenit://week/${wk}`];
  if (wk === currentWeek) {
    uris.push('zenit://week/current');
    for (let d = 1; d <= 7; d++) uris.push(`zenit://agenda/${d}`);
  }
  return uris;
}
