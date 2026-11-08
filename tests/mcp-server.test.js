// zenit-week-mcp, relay side (mcp/core.js): origin allowlist, the v2
// handshake (setup spec 4.4), pairing, tab routing, rate budget, no_app_tab,
// resource updates, the shared pairings file and the port range.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Relay, isAllowedOrigin, parseExtraOrigin, urisForWeekSaved, hmacB64, memoryPairings, filePairings,
  matchSite, listenOnFirstFreePort, formatPairCode, PORTS, PORT_MIN, PORT_MAX, PROTOCOL,
  appName, appMatches, routeWarning, readOrigins, addOrigin, removeOrigin, lastUsedSite,
  HANDSHAKE_TIMEOUT_MS, WRITE_BUDGET_PER_MIN, PAIR_TIMEOUT_MS,
} from '../mcp/core.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGIN = 'https://zenitweek.com';
const KEY = 'k'.repeat(43);
const PAIRING_ID = 'p'.repeat(22);

class Sock {
  constructor() { this.sent = []; this.closed = null; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; }
}

let relay, saved, pairings;
const open = (tab, extra = {}) => relay.onMessage(tab, JSON.stringify({ type: 'open', protocol: PROTOCOL, visible: true, focused: true, ...extra }));
// A paired page: open with its pairing, then prove the key.
function connect({ tabId = 't1', visible = true, week = '2026-45', key = KEY, origin = ORIGIN } = {}) {
  const ws = new Sock();
  const tab = relay.onOpen(ws, origin);
  open(tab, { visible, focused: visible, pairingId: PAIRING_ID, nonce: 'n'.repeat(43) });
  const { nonce } = ws.sent[0];
  relay.onMessage(tab, JSON.stringify({ type: 'ready', proof: hmacB64(key, `page|${nonce}`), tabId, week, visible }));
  return { ws, tab };
}
// The page's side of a call: answer the last call frame.
function answer({ ws, tab }, data = { ok: 1 }) {
  const call = ws.sent.filter(f => f.type === 'call').at(-1);
  relay.onMessage(tab, JSON.stringify({ type: 'result', id: call.id, ok: true, data }));
  return call;
}

beforeEach(() => {
  saved = [];
  pairings = memoryPairings([{ pairingId: PAIRING_ID, origin: ORIGIN, key: KEY, pairedAt: '2026-11-08T00:00:00.000Z' }]);
  relay = new Relay({ pairings, clientName: () => 'claude-code', onWeekSaved: (wk, tab) => saved.push([wk, tab.id]) });
});
afterEach(() => vi.useRealTimers());

describe('origin allowlist', () => {
  test('production and loopback dev origins only', () => {
    for (const o of ['https://zenitweek.com', 'https://www.zenitweek.com', 'http://localhost:3000', 'http://127.0.0.1:8765', 'http://localhost']) {
      expect(isAllowedOrigin(o)).toBe(true);
    }
    for (const o of [undefined, 'null', 'https://evil.com', 'http://zenitweek.com', 'https://zenitweek.com.evil.com',
      'http://localhost.evil.com', 'http://127.0.0.1.nip.io', 'https://localhost:3000', 'chrome-extension://abc']) {
      expect(isAllowedOrigin(o)).toBe(false);
    }
  });
});

describe('added sites (origins add)', () => {
  test('accepts exactly the https origin it names', () => {
    const extra = [parseExtraOrigin('https://dev-x.ngrok.app/app')];
    expect(extra).toEqual(['https://dev-x.ngrok.app']);
    expect(isAllowedOrigin('https://dev-x.ngrok.app', extra)).toBe(true);
    expect(isAllowedOrigin('https://dev-y.ngrok.app', extra)).toBe(false);
    expect(isAllowedOrigin('https://dev-x.ngrok.app', [])).toBe(false);
    expect(parseExtraOrigin('http://dev-x.ngrok.app')).toBeNull();
    expect(parseExtraOrigin('https://u:p@dev-x.ngrok.app')).toBeNull();
    expect(parseExtraOrigin('nope')).toBeNull();
  });
});

describe('handshake', () => {
  test('a known pairing: the server proves the key first, then the page', () => {
    const ws = new Sock();
    const tab = relay.onOpen(ws, ORIGIN);
    open(tab, { pairingId: PAIRING_ID, nonce: 'a'.repeat(43) });
    expect(ws.sent[0]).toMatchObject({ type: 'welcome', protocol: 2, paired: true, client: 'claude-code', proof: hmacB64(KEY, `server|${'a'.repeat(43)}`) });
    expect(relay.pickTab()).toBeNull();
    relay.onMessage(tab, JSON.stringify({ type: 'ready', proof: hmacB64(KEY, `page|${ws.sent[0].nonce}`), tabId: 't', week: '2026-45' }));
    expect(relay.pickTab()?.week).toBe('2026-45');
  });

  test('a wrong page proof is closed with refused', () => {
    const { ws } = connect({ key: 'w'.repeat(43) });
    expect(ws.closed).toEqual({ code: 4001, reason: 'refused' });
    expect(relay.pickTab()).toBeNull();
  });

  test('an unknown pairing is said so, and the page is left open to pair again', () => {
    const ws = new Sock();
    const tab = relay.onOpen(ws, ORIGIN);
    open(tab, { pairingId: 'q'.repeat(22), nonce: 'a'.repeat(43) });
    expect(ws.sent[0]).toMatchObject({ type: 'welcome', paired: false, unknown: true });
    expect(ws.sent[0].proof).toBeUndefined();
    expect(ws.closed).toBeNull();
  });

  test('a pairing of another site does not count for this one', () => {
    const ws = new Sock();
    const tab = relay.onOpen(ws, 'https://dev-x.ngrok.app');
    open(tab, { pairingId: PAIRING_ID, nonce: 'a'.repeat(43) });
    expect(ws.sent[0]).toMatchObject({ paired: false, unknown: true });
  });

  test('a v1 page, or another protocol, is closed with protocol', () => {
    for (const frame of [{ type: 'challenge', nonce: 'x'.repeat(32) }, { type: 'open', protocol: 3 }]) {
      const ws = new Sock();
      relay.onMessage(relay.onOpen(ws, ORIGIN), JSON.stringify(frame));
      expect(ws.closed).toEqual({ code: 4003, reason: 'protocol' });
    }
  });

  test('a socket without open is closed after the handshake timeout', () => {
    vi.useFakeTimers();
    const ws = new Sock();
    relay.onOpen(ws, ORIGIN);
    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS + 1);
    expect(ws.closed.code).toBe(4002);
    expect(relay.tabs.size).toBe(0);
  });

  test('calls are not sent before the page proved the key', async () => {
    const ws = new Sock();
    open(relay.onOpen(ws, ORIGIN));
    await expect(relay.call('read_week')).rejects.toMatchObject({ code: 'no_app_tab' });
    expect(ws.sent.map(f => f.type)).toEqual(['welcome']);
  });
});

describe('pairing', () => {
  const unpaired = (visible = true) => {
    const ws = new Sock();
    const tab = relay.onOpen(ws, ORIGIN);
    open(tab, { visible, focused: visible });
    return { ws, tab };
  };

  test('nothing connected, or only hidden tabs: no pairing starts', async () => {
    expect((await relay.requestPairing()).kind).toBe('no_tab');
    const { ws } = unpaired(false);
    expect((await relay.requestPairing()).kind).toBe('hidden');
    expect(ws.sent.map(f => f.type)).toEqual(['welcome']);
  });

  test('a bad pair-key breaks the pairing off', async () => {
    const t = unpaired();
    const p = relay.requestPairing();
    relay.onMessage(t.tab, JSON.stringify({ type: 'pair-key', pub: 'x', nonce: 'y' }));
    expect((await p).kind).toBe('failed');
  });

  test('the 120 s start when the dialog is shown', async () => {
    vi.useFakeTimers();
    const t = unpaired();
    const page = (await import('node:crypto')).createECDH('prime256v1');
    page.generateKeys();
    const req = relay.requestPairing();
    relay.onMessage(t.tab, JSON.stringify({ type: 'pair-key', pub: page.getPublicKey().toString('base64url'), nonce: Buffer.alloc(32, 1).toString('base64url') }));
    const p = await req;
    expect(p.code).toMatch(/^\d{6}$/);
    expect(formatPairCode('482913')).toBe('482 913');
    vi.advanceTimersByTime(PAIR_TIMEOUT_MS * 2); // not shown yet: still waiting
    relay.onMessage(t.tab, JSON.stringify({ type: 'pair-shown' }));
    vi.advanceTimersByTime(PAIR_TIMEOUT_MS + 1);
    expect(await p.settled).toBe('timeout');
    expect(t.ws.sent.at(-1)).toEqual({ type: 'pair-cancel' });
  });

  test('pair-ok without a proof of the new key is refused', async () => {
    const t = unpaired();
    const page = (await import('node:crypto')).createECDH('prime256v1');
    page.generateKeys();
    const req = relay.requestPairing();
    relay.onMessage(t.tab, JSON.stringify({ type: 'pair-key', pub: page.getPublicKey().toString('base64url'), nonce: Buffer.alloc(32, 2).toString('base64url') }));
    const p = await req;
    relay.onMessage(t.tab, JSON.stringify({ type: 'pair-ok', pairingId: 'z'.repeat(22), proof: 'nope' }));
    expect(await p.settled).toBe('failed');
    expect(pairings.get(ORIGIN).pairingId).toBe(PAIRING_ID);
  });

  test('another server\'s request on screen answers busy', async () => {
    const t = unpaired();
    const req = relay.requestPairing();
    relay.onMessage(t.tab, JSON.stringify({ type: 'pair-deny', reason: 'busy' }));
    expect((await req).kind).toBe('busy');
  });
});

describe('unpair', () => {
  test('from the app: the site\'s pairing goes and its tabs are shut out', () => {
    const a = connect({ tabId: 'a' });
    const b = connect({ tabId: 'b' });
    relay.onMessage(a.tab, JSON.stringify({ type: 'unpair' }));
    expect(pairings.get(ORIGIN)).toBeNull();
    expect(a.ws.closed).toEqual({ code: 4004, reason: 'unpaired' });
    expect(b.ws.closed).toEqual({ code: 4004, reason: 'unpaired' });
  });

  test('the command matches an origin or a host name', () => {
    expect(matchSite('https://zenitweek.com', ORIGIN)).toBe(true);
    expect(matchSite('zenitweek.com', ORIGIN)).toBe(true);
    expect(matchSite('https://zenitweek.com/', ORIGIN)).toBe(true);
    expect(matchSite('abc.ngrok-free.app', ORIGIN)).toBe(false);
    expect(matchSite('', ORIGIN)).toBe(false);
  });
});

describe('pairings file', () => {
  test('owner-only, one entry per site, shared by every reader', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwmcp-'));
    const file = path.join(dir, 'sub', 'pairings.json');
    const a = filePairings(file);
    const b = filePairings(file); // a second server on the machine
    a.set({ pairingId: PAIRING_ID, origin: ORIGIN, key: KEY, pairedAt: 'x' });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(b.get(ORIGIN)).toMatchObject({ pairingId: PAIRING_ID, key: KEY });
    a.set({ pairingId: 'r'.repeat(22), origin: ORIGIN, key: KEY, pairedAt: 'y' });
    expect(b.list()).toHaveLength(1);
    expect(b.delete(ORIGIN)).toBe(1);
    expect(a.get(ORIGIN)).toBeNull();
    fs.writeFileSync(file, '{ not json');
    expect(a.list()).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('calls', () => {
  test('forwards and resolves by id', async () => {
    const t = connect();
    const p = relay.call('add_task', { label: 'x' });
    const frame = answer(t, { id: 'n1' });
    expect(frame).toMatchObject({ type: 'call', tool: 'add_task', args: { label: 'x' } });
    expect(await p).toEqual({ id: 'n1' });
  });

  test('page errors keep their code', async () => {
    const t = connect();
    const p = relay.call('delete_task', { id: 'x' });
    const call = t.ws.sent.at(-1);
    relay.onMessage(t.tab, JSON.stringify({ type: 'result', id: call.id, ok: false, error: { code: 'needs_choice', message: 'pick' } }));
    await expect(p).rejects.toMatchObject({ code: 'needs_choice' });
  });

  test('no tab answers no_app_tab; a closing tab fails its pending call', async () => {
    await expect(relay.call('read_week')).rejects.toMatchObject({ code: 'no_app_tab' });
    const t = connect();
    const p = relay.call('read_week');
    relay.onClose(t.tab);
    await expect(p).rejects.toMatchObject({ code: 'no_app_tab' });
  });

  test('more than the write budget in a minute is rate_limited; reads are free', async () => {
    connect();
    for (let i = 0; i < WRITE_BUDGET_PER_MIN; i++) relay.call('set_status', {}).catch(() => {});
    await expect(relay.call('set_status', {})).rejects.toMatchObject({ code: 'rate_limited' });
    const read = relay.call('read_week');
    expect(read).toBeInstanceOf(Promise);
    read.catch(() => {});
    for (const p of relay.pending.values()) clearTimeout(p.timer);
  });
});

describe('tab routing', () => {
  test('the most recently focused visible tab executes', () => {
    let now = 1000;
    relay.now = () => now;
    const a = connect({ tabId: 'a' });
    now = 2000;
    const b = connect({ tabId: 'b' });
    expect(relay.pickTab().id).toBe('b');
    now = 3000;
    relay.onMessage(a.tab, JSON.stringify({ type: 'event', event: 'focus', wk: '2026-46' }));
    expect(relay.pickTab().id).toBe('a');
    expect(relay.currentWeek()).toBe('2026-46');
    expect(b).toBeTruthy();
  });

  test('with every tab hidden, the most recently visible one executes', () => {
    let now = 1000;
    relay.now = () => now;
    const a = connect({ tabId: 'a' });
    now = 2000;
    const b = connect({ tabId: 'b' });
    now = 3000;
    relay.onMessage(b.tab, JSON.stringify({ type: 'event', event: 'pause' }));
    now = 4000;
    relay.onMessage(a.tab, JSON.stringify({ type: 'event', event: 'pause' }));
    expect(relay.pickTab().id).toBe('a');
  });
});

describe('resource updates', () => {
  test('week-saved reaches the server once per event, with the right URIs', () => {
    const t = connect();
    relay.onMessage(t.tab, JSON.stringify({ type: 'event', event: 'week-saved', wk: '2026-45', sig: 'x' }));
    expect(saved).toEqual([['2026-45', 't1']]);
    expect(urisForWeekSaved('2026-45', '2026-45')).toEqual(expect.arrayContaining(['zenit://week/current', 'zenit://week/2026-45', 'zenit://agenda/3', 'zenit://weeks']));
    expect(urisForWeekSaved('2026-44', '2026-45')).not.toContain('zenit://week/current');
  });
});

describe('port range (setup spec section 5)', () => {
  test('eight ports from 47831, the same range the page scans', () => {
    expect([PORT_MIN, PORT_MAX]).toEqual([47831, 47838]);
    expect(PORTS).toHaveLength(8);
    const html = fs.readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');
    expect(html).toContain(`const BRIDGE_PORT_MIN = ${PORT_MIN};`);
    expect(html).toContain(`const BRIDGE_PORT_MAX = ${PORT_MAX};`);
  });

  test('takes the first free port', async () => {
    const taken = new Set([47831, 47832]);
    const tried = [];
    const r = await listenOnFirstFreePort(async p => { tried.push(p); return taken.has(p) ? null : { p }; });
    expect(r).toEqual({ port: 47833, server: { p: 47833 } });
    expect(tried).toEqual([47831, 47832, 47833]);
  });

  test('null when every port is taken', async () => {
    expect(await listenOnFirstFreePort(async () => null)).toBeNull();
  });

  test('another bind failure is not mistaken for a taken port', async () => {
    const e = Object.assign(new Error('denied'), { code: 'EACCES' });
    await expect(listenOnFirstFreePort(async () => { throw e; })).rejects.toBe(e);
  });
});

describe('production and dev side by side (setup spec section 6)', () => {
  const DEV = 'https://abc.ngrok-free.app';
  beforeEach(() => { pairings.set({ pairingId: 'd'.repeat(22), origin: DEV, key: KEY, pairedAt: 'x' }); });
  const devConnect = opts => {
    const ws = new Sock();
    const tab = relay.onOpen(ws, DEV);
    open(tab, { pairingId: 'd'.repeat(22), nonce: 'n'.repeat(43) });
    relay.onMessage(tab, JSON.stringify({ type: 'ready', proof: hmacB64(KEY, `page|${ws.sent[0].nonce}`), tabId: 'dev', week: '2026-46', visible: true, ...opts }));
    return { ws, tab };
  };

  test('apps are named "Zenit Week" or by host', () => {
    expect(appName('https://zenitweek.com')).toBe('Zenit Week');
    expect(appName('https://www.zenitweek.com')).toBe('Zenit Week');
    expect(appName(DEV)).toBe('abc.ngrok-free.app');
    expect(appName('http://localhost:3000')).toBe('localhost:3000');
    expect(appMatches('zenit week', ORIGIN)).toBe(true);
    expect(appMatches('abc.ngrok-free.app', DEV)).toBe(true);
    expect(appMatches(DEV, DEV)).toBe(true);
    expect(appMatches('Zenit Week', DEV)).toBe(false);
    expect(appMatches(null, DEV)).toBe(true);
  });

  test('app picks the site; without it the focused tab runs, with a warning', async () => {
    let now = 1000;
    relay.now = () => now;
    const prod = connect({ tabId: 'prod' });
    now = 2000;
    const dev = devConnect();
    expect(relay.pickTab().id).toBe('dev');
    expect(relay.pickTab('Zenit Week').id).toBe('prod');
    expect(relay.openApps()).toEqual(['Zenit Week', 'abc.ngrok-free.app']);
    expect(routeWarning(relay.openApps(), 'abc.ngrok-free.app'))
      .toBe('Two apps are open (Zenit Week, abc.ngrok-free.app); this went to abc.ngrok-free.app. Pass "app" to choose.');
    expect(routeWarning(['Zenit Week'], 'Zenit Week')).toBeNull();
    const p = relay.call('get_stats', {}, { app: 'Zenit Week' });
    expect(prod.ws.sent.at(-1)).toMatchObject({ type: 'call', tool: 'get_stats' });
    expect(dev.ws.sent.some(f => f.type === 'call')).toBe(false);
    answer(prod);
    await p;
    await expect(relay.call('get_stats', {}, { app: 'other.dev' })).rejects.toMatchObject({ code: 'no_app_tab', message: expect.stringContaining('open apps: Zenit Week, abc.ngrok-free.app') });
  });

  test('zenit://apps lists every app tab of this server', () => {
    let now = 1000;
    relay.now = () => now;
    connect({ tabId: 'prod' });
    now = 2000;
    devConnect();
    const unpaired = relay.onOpen(new Sock(), 'http://localhost:3000');
    open(unpaired, { visible: false, focused: false });
    expect(relay.listApps()).toEqual([
      { app: 'Zenit Week', paired: true, week: '2026-45', visible: true, focused: false },
      { app: 'abc.ngrok-free.app', paired: true, week: '2026-46', visible: true, focused: true },
      { app: 'localhost:3000', paired: false, week: null, visible: false, focused: false },
    ]);
  });

  test('a pairing request can be aimed at one app', async () => {
    const devTab = relay.onOpen(new Sock(), DEV);
    open(devTab);
    const prodTab = relay.onOpen(new Sock(), ORIGIN);
    open(prodTab);
    pairings.delete(DEV);
    const p = relay.requestPairing('abc.ngrok-free.app');
    expect(devTab.ws.sent.at(-1).type).toBe('pair-start');
    expect(prodTab.ws.sent.at(-1).type).toBe('welcome');
    expect((await relay.requestPairing('Zenit Week')).kind).toBe('busy');
    relay.cancelPairing();
    await p;
  });

  test('--open goes to the pairing used last', () => {
    expect(lastUsedSite([])).toBe('https://zenitweek.com');
    connect();
    devConnect();
    expect(pairings.get(DEV).lastUsedAt).toBeTruthy();
    expect(lastUsedSite([{ origin: ORIGIN, lastUsedAt: '2026-11-08T10:00:00Z' }, { origin: DEV, lastUsedAt: '2026-11-08T11:00:00Z' }])).toBe(DEV);
  });

  test('origins add, list and remove: https only, exact, owner-only file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwmcp-'));
    const file = path.join(dir, 'config.json');
    expect(addOrigin('http://abc.ngrok-free.app', file)).toBeNull();
    expect(addOrigin('https://abc.ngrok-free.app/app', file)).toBe(DEV);
    expect(addOrigin(DEV, file)).toBe(DEV);
    expect(readOrigins(file)).toEqual([DEV]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(isAllowedOrigin(DEV, readOrigins(file))).toBe(true);
    expect(isAllowedOrigin('https://abd.ngrok-free.app', readOrigins(file))).toBe(false);
    expect(removeOrigin('abc.ngrok-free.app', file)).toBe(true);
    expect(readOrigins(file)).toEqual([]);
    expect(removeOrigin('abc.ngrok-free.app', file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
