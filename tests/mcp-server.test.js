// zenit-week-mcp, relay side (mcp/core.js): origin allowlist, the v2
// handshake (setup spec 4.4), pairing, tab routing, rate budget, no_app_tab,
// resource updates, the shared pairings file and the port range.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Relay, isAllowedOrigin, parseExtraOrigin, urisForWeekSaved, urisForVisionSaved, READ_TOOLS, hmacB64, memoryPairings, filePairings,
  matchSite, listenOnFirstFreePort, formatPairCode, PORTS, PORT_MIN, PORT_MAX, PROTOCOL,
  appName, appMatches, routeWarning, readOrigins, addOrigin, removeOrigin, lastUsedSite,
  HANDSHAKE_TIMEOUT_MS, WRITE_BUDGET_PER_MIN, PAIR_TIMEOUT_MS, appBundleOf, peerPidFromLsof, browserHint,
  compareVersions, updateNote, UPDATE_ACTIONS,
  validateManifest, cleanSchema, mergeManifests, matchResource, manifestNeeds, manifestHash, listedTool,
  readManifestCache, writeManifestCache, manifestPath, MANIFEST_LIMITS,
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

  test('a v1 page, or another protocol, hears the server\'s protocol and install, then is closed', () => {
    relay.install = 'mcpb';
    for (const frame of [{ type: 'challenge', nonce: 'x'.repeat(32) }, { type: 'open', protocol: 3 }]) {
      const ws = new Sock();
      relay.onMessage(relay.onOpen(ws, ORIGIN), JSON.stringify(frame));
      expect(ws.sent).toEqual([{ type: 'mismatch', protocol: PROTOCOL, install: 'mcpb' }]);
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

  test('a vision save touches zenit://vision and nothing else', () => {
    const t = connect();
    relay.onMessage(t.tab, JSON.stringify({ type: 'event', event: 'week-saved', wk: 'vision', sig: 'y' }));
    expect(saved).toEqual([['vision', 't1']]);
    expect(urisForWeekSaved('vision', '2026-45')).toEqual(['zenit://vision']);
    expect(urisForVisionSaved()).toEqual(['zenit://vision']);
  });

  test('read_vision is a read: it never spends the write budget', () => {
    expect(READ_TOOLS.has('read_vision')).toBe(true);
    expect(READ_TOOLS.has('open_vision')).toBe(false);
    expect(READ_TOOLS.has('set_horizon')).toBe(false);
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
    relay.onMessage(devTab, JSON.stringify({ type: 'pair-deny' }));
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

describe('Claude Desktop extension (setup spec section 3.2)', () => {
  const root = new URL('..', import.meta.url);
  const read = p => fs.readFileSync(new URL(p, root), 'utf8');
  const manifest = JSON.parse(read('mcp/manifest.json'));

  test('manifest 0.3 with the required fields, a node server and the mcpb install marker', () => {
    expect(manifest.manifest_version).toBe('0.3');
    for (const k of ['name', 'version', 'description', 'author', 'server']) expect(manifest[k]).toBeTruthy();
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.server).toEqual({
      type: 'node', entry_point: 'server.js',
      mcp_config: { command: 'node', args: ['${__dirname}/server.js'], env: { ZENIT_WEEK_MCP_INSTALL: 'mcpb' } },
    });
    expect(manifest.compatibility.runtimes.node).toBe('>=20.0.0');
    expect(manifest.user_config).toBeUndefined(); // dev sites go through `origins add`, one way for every install
  });

  test('directory-ready: tools come from the app, a privacy policy and a support link (mcp-updates.md section 4)', () => {
    expect(manifest.tools_generated).toBe(true);
    expect(manifest.privacy_policies).toEqual(['https://zenitweek.com/privacy']);
    expect(read('privacy.html')).toContain('AI agents (only if you turn them on)');
    expect(manifest.support).toMatch(/^https:\/\//);
    const baseline = JSON.parse(read('mcp/baseline-manifest.json'));
    for (const t of baseline.tools) expect(typeof t.annotations.readOnlyHint, t.name).toBe('boolean');
    for (const name of ['delete_task', 'delete_branch']) expect(baseline.tools.find(t => t.name === name).annotations.destructiveHint, name).toBe(true);
  });

  test('same version as the npm package', () => {
    expect(manifest.version).toBe(JSON.parse(read('mcp/package.json')).version);
  });

  test('declares exactly the tools of the baseline the server starts with', () => {
    const registered = JSON.parse(read('mcp/baseline-manifest.json')).tools.map(t => t.name);
    expect(manifest.tools.map(t => t.name)).toEqual(registered);
    expect(manifest.tools.every(t => t.description)).toBe(true);
  });

  test('each tool description is a whole sentence (no escape left over, no cut at an apostrophe)', () => {
    for (const t of manifest.tools) {
      expect(t.description, t.name).not.toMatch(/\\/);
      expect(t.description, t.name).toMatch(/\w.*\.$/);
    }
  });

  test('every bundled file exists, the icon and the baseline tools among them', async () => {
    const { BUNDLE_FILES } = await import('../scripts/mcp-bundle.mjs');
    for (const f of BUNDLE_FILES) expect(fs.existsSync(new URL(f.from, root)), f.from).toBe(true);
    expect(BUNDLE_FILES.map(f => f.to)).toEqual(expect.arrayContaining(['manifest.json', manifest.server.entry_point, 'core.js', 'baseline-manifest.json', manifest.icon]));
    expect(JSON.parse(read('mcp/package.json')).files).toContain('baseline-manifest.json');
  });
});

// show_task brings the browser forward: the process at the other end of the
// tab's socket, and the application bundle around it.
describe('show_task: which browser to raise', () => {
  test('the peer pid is the first one that is not ours', () => {
    expect(peerPidFromLsof('p500\nf12\np812\nf40\n', 500)).toBe(812);
    expect(peerPidFromLsof('p500\n', 500)).toBeNull();
    expect(peerPidFromLsof('', 1)).toBeNull();
  });
  test('the outermost .app around the executable', () => {
    expect(appBundleOf('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper\n'))
      .toBe('/Applications/Google Chrome.app');
    expect(appBundleOf('/Applications/Firefox.app/Contents/MacOS/firefox')).toBe('/Applications/Firefox.app');
    expect(appBundleOf('/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking')).toBeNull();
    expect(appBundleOf(null)).toBeNull();
  });
  test('the page hint reaches open -a only when it is a known browser', () => {
    expect(browserHint('Safari')).toBe('Safari');
    for (const bad of ['-n', '/Applications/Terminal.app', 'Terminal', '', null, 42]) expect(browserHint(bad)).toBeNull();
  });
});

describe('server version (mcp-updates.md section 5)', () => {
  test('welcome names the server version; ready stores the latest the page knows', () => {
    relay = new Relay({ pairings, version: '1.2.0', install: 'mcpb' });
    const ws = new Sock();
    const tab = relay.onOpen(ws, ORIGIN);
    open(tab, { pairingId: PAIRING_ID, nonce: 'n'.repeat(43) });
    expect(ws.sent[0]).toMatchObject({ type: 'welcome', version: '1.2.0', install: 'mcpb' });
    relay.onMessage(tab, JSON.stringify({ type: 'ready', proof: hmacB64(KEY, `page|${ws.sent[0].nonce}`), tabId: 't', serverLatest: '1.3.0' }));
    expect(tab.serverLatest).toBe('1.3.0');
  });

  test('an older page sends no latest; junk is ignored', () => {
    const { tab } = connect();
    expect(tab.serverLatest).toBeNull();
    const ws = new Sock();
    const t2 = relay.onOpen(ws, ORIGIN);
    open(t2, { pairingId: PAIRING_ID, nonce: 'n'.repeat(43) });
    relay.onMessage(t2, JSON.stringify({ type: 'ready', proof: hmacB64(KEY, `page|${ws.sent[0].nonce}`), tabId: 't', serverLatest: '<b>9</b>' }));
    expect(t2.serverLatest).toBeNull();
  });

  test('versions compare by number', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions(null, '1.0.0')).toBe(-1);
  });

  test('the note: only when older, with the action for the install', () => {
    expect(updateNote({ version: '1.2.0', latest: '1.2.0', install: 'npx' })).toBeNull();
    expect(updateNote({ version: '1.3.0', latest: '1.2.0', install: 'npx' })).toBeNull();
    expect(updateNote({ version: '1.1.0', latest: null, install: 'npx' })).toBeNull();
    for (const install of ['npx', 'mcpb', 'repo']) {
      const note = updateNote({ version: '1.1.0', latest: '1.2.0', install });
      expect(note).toContain('This Zenit Week server is 1.1.0; 1.2.0 is out.');
      expect(note).toContain(UPDATE_ACTIONS[install]);
    }
  });

  test('server.js adds the note once per session, on the first labelled result', () => {
    const src = fs.readFileSync(new URL('../mcp/server.js', import.meta.url), 'utf8');
    expect(src).toMatch(/version: VERSION,/);
    expect(src).toMatch(/let updateNoted = false;/);
    expect(src).toMatch(/if \(note\) updateNoted = true;/);
  });

  test('the page and the server word the update actions alike', () => {
    const html = fs.readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');
    for (const [install, action] of Object.entries(UPDATE_ACTIONS)) {
      if (install === 'mcpb') expect(html).toContain('download the new Zenit Week extension for Claude Desktop (${BRIDGE_DESKTOP_EXTENSION_URL}) and open it');
      else expect(html).toContain(`${install}: '${action}'`);
    }
  });
});

describe('manifest: the page defines the tools (mcp-updates.md section 3)', () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('../mcp/baseline-manifest.json', import.meta.url), 'utf8'));
  const tool = (name, extra = {}) => ({ name, description: `${name} does it.`, inputSchema: { type: 'object', properties: {} }, ...extra });
  const mk = (extra = {}) => ({ instructions: 'Use it.', tools: [tool('a_tool')], resources: [], ...extra });

  test('the baseline passes its own check and keeps its version', () => {
    const m = validateManifest(baseline);
    expect(m).toEqual(baseline);
    expect(m.manifestVersion).toBe(manifestHash(m));
  });

  test('the version is the server\'s own hash, never the sender\'s', () => {
    const m = validateManifest({ ...mk(), manifestVersion: 'forged' });
    expect(m.manifestVersion).not.toBe('forged');
    expect(validateManifest(mk()).manifestVersion).toBe(m.manifestVersion);
    expect(validateManifest(mk({ instructions: 'Other.' })).manifestVersion).not.toBe(m.manifestVersion);
  });

  test('bounds: names, counts, lengths, duplicates', () => {
    expect(validateManifest(mk({ tools: [tool('Bad-Name')] }))).toBeNull();
    expect(validateManifest(mk({ tools: [] }))).toBeNull();
    expect(validateManifest(mk({ tools: Array.from({ length: MANIFEST_LIMITS.tools + 1 }, (_, i) => tool(`t_${'x'.repeat(i % 20)}${String.fromCharCode(97 + (i % 26))}`)) }))).toBeNull();
    expect(validateManifest(mk({ tools: [tool('a'), tool('a')] }))).toBeNull();
    expect(validateManifest(mk({ instructions: 'x'.repeat(MANIFEST_LIMITS.instructions + 1) }))).toBeNull();
    expect(validateManifest(mk({ tools: [tool('a', { description: 'x'.repeat(MANIFEST_LIMITS.description + 1) })] }))).toBeNull();
    expect(validateManifest(mk({ minServer: 'soon' }))).toBeNull();
    expect(validateManifest(null)).toBeNull();
  });

  test('schemas: plain JSON Schema only, nothing pointing outside, no app of their own', () => {
    expect(cleanSchema({ type: 'object', properties: { d: { type: 'array', items: { type: 'integer', minimum: 1 } } }, required: ['d'] })).toBeTruthy();
    expect(cleanSchema({ $ref: 'https://evil.example/schema' })).toBeNull();
    expect(cleanSchema({ type: 'object', properties: { x: { anyOf: [] } } })).toBeNull();
    expect(cleanSchema({ type: 'string', pattern: '(' })).toBeNull();
    expect(cleanSchema({ type: 'object', additionalProperties: { type: 'string' } })).toBeNull();
    let deep = { type: 'string' };
    for (let i = 0; i < 10; i++) deep = { type: 'array', items: deep };
    expect(cleanSchema(deep)).toBeNull();
    expect(validateManifest(mk({ tools: [tool('a', { inputSchema: { type: 'string' } })] }))).toBeNull();
    expect(validateManifest(mk({ tools: [tool('a', { inputSchema: { type: 'object', properties: { app: { type: 'string' } } } })] }))).toBeNull();
  });

  test('resources: a fixed argument vocabulary, the template variable mapped', () => {
    const r = (extra) => mk({ resources: [{ name: 'res', description: 'A resource.', tool: 'read_x', ...extra }] });
    expect(validateManifest(r({ uri: 'zenit://x' }))).toBeTruthy();
    expect(validateManifest(r({ uriTemplate: 'zenit://x/{day}', args: { day: 'day' } }))).toBeTruthy();
    expect(validateManifest(r({ uriTemplate: 'zenit://x/{day}' }))).toBeNull();
    expect(validateManifest(r({ uriTemplate: 'zenit://x/{day}', args: { day: 'eval' } }))).toBeNull();
    expect(validateManifest(r({ uri: 'https://example.com' }))).toBeNull();
    expect(validateManifest(r({ uri: 'zenit://x?y=1' }))).toBeNull();
  });

  test('a listed tool gets app added to its schema', () => {
    const t = listedTool(validateManifest(baseline).tools.find(x => x.name === 'open_week'));
    expect(Object.keys(t.inputSchema.properties)).toEqual(['week', 'app']);
    expect(t.inputSchema.required).toEqual(['week']);
  });

  test('resource URIs: exact, templates, ?app, week current means none', () => {
    const { resources } = validateManifest(baseline);
    expect(matchResource(resources, 'zenit://week/current')).toMatchObject({ resource: { name: 'week-current' }, args: {}, app: null });
    expect(matchResource(resources, 'zenit://week/current?app=abc.ngrok-free.app')).toMatchObject({ resource: { name: 'week-current' }, app: 'abc.ngrok-free.app' });
    expect(matchResource(resources, 'zenit://week/2026-45')).toMatchObject({ resource: { name: 'week' }, args: { week: '2026-45' } });
    expect(matchResource(resources, 'zenit://agenda/3?app=Zenit%20Week')).toMatchObject({ resource: { name: 'agenda' }, args: { day: 3 }, app: 'Zenit Week' });
    expect(matchResource(resources, 'zenit://agenda/x')).toBeNull();
    expect(matchResource(resources, 'zenit://apps')).toMatchObject({ resource: { hook: 'apps' } });
    expect(matchResource(resources, 'zenit://nope')).toBeNull();
  });

  test('merge: the base, then each app, the default app last; instructions stay the base\'s', () => {
    const base = validateManifest(mk({ tools: [tool('a', { description: 'Old a.' }), tool('b')] }));
    const dev = validateManifest({ instructions: 'Dev.', tools: [tool('a', { description: 'Dev a.' }), tool('dev_only')], resources: [] });
    const prod = validateManifest({ instructions: 'Prod.', tools: [tool('a', { description: 'Prod a.' })], resources: [] });
    const m = mergeManifests(base, [dev, prod]);
    expect(m.instructions).toBe('Use it.');
    expect(m.tools.map(t => t.name)).toEqual(['a', 'b', 'dev_only']);
    expect(m.tools[0].description).toBe('Prod a.');
  });

  test('an unknown hook or a higher minServer: tools kept, the server says it is behind', () => {
    const m = validateManifest(mk({ minServer: '9.0.0', tools: [tool('a', { hook: 'teleport' }), tool('b', { hook: 'raise-browser' })] }));
    expect(m.tools.map(t => t.name)).toEqual(['a', 'b']);
    expect(manifestNeeds(m, '1.2.0')).toEqual({ unknownHooks: ['teleport'], newerServer: true });
    expect(manifestNeeds(validateManifest(baseline), '1.2.0')).toEqual({ unknownHooks: [], newerServer: false });
  });

  test('the relay takes a valid manifest from a paired tab; a bad one is ignored and the last kept', () => {
    const got = [];
    relay = new Relay({ pairings, onManifest: (tab, m) => got.push([tab.id, m.tools.length]) });
    const c = connect({ tabId: 'p1' });
    relay.onMessage(c.tab, JSON.stringify({ type: 'manifest', manifest: mk() }));
    expect(got).toEqual([['p1', 1]]);
    relay.onMessage(c.tab, JSON.stringify({ type: 'manifest', manifest: { ...mk(), tools: [{ name: '$ref' }] } }));
    expect(got).toHaveLength(1);
    expect(c.tab.manifest.tools[0].name).toBe('a_tool');
    expect(relay.manifestTabs()).toEqual([c.tab]);
  });

  test('an unpaired tab cannot send one', () => {
    const got = [];
    relay = new Relay({ pairings: memoryPairings(), onManifest: () => got.push(1) });
    const ws = new Sock();
    const tab = relay.onOpen(ws, ORIGIN);
    open(tab);
    relay.onMessage(tab, JSON.stringify({ type: 'manifest', manifest: mk() }));
    expect(got).toEqual([]);
  });

  test('cache per site, owner-only, beside pairings.json; a tampered file reads as none', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zw-manifest-'));
    const prev = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      const m = validateManifest(mk());
      expect(readManifestCache(ORIGIN, home)).toBeNull();
      writeManifestCache(ORIGIN, m, home);
      expect(readManifestCache(ORIGIN, home)).toEqual(m);
      expect(readManifestCache('https://abc.ngrok-free.app', home)).toBeNull();
      const file = manifestPath(ORIGIN, home);
      expect(path.basename(file)).toBe('manifest-zenitweek.com.json');
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      fs.writeFileSync(file, JSON.stringify({ ...m, tools: [{ name: 'x', inputSchema: { $ref: '#' } }] }));
      expect(readManifestCache(ORIGIN, home)).toBeNull();
    } finally {
      if (prev !== undefined) process.env.XDG_CONFIG_HOME = prev;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('server.js registers the manifest, starts from the cache or the baseline, and says when tools changed', () => {
    const src = fs.readFileSync(new URL('../mcp/server.js', import.meta.url), 'utf8');
    expect(src).toContain('readManifestCache(lastUsedSite(pairings.list())) || BASELINE');
    expect(src).toContain('mcp.sendToolListChanged()');
    expect(src).toContain('mcp.sendResourceListChanged()');
    expect(src).toMatch(/head\.notice = LIST_CHANGED_NOTE/);
    expect(src).not.toMatch(/registerTool|from 'zod'/);
  });
});
