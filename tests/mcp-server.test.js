// zenit-week-mcp, relay side (mcp/core.js): origin allowlist, handshake,
// handshake timeout, rate budget, tab routing, no_app_tab, resource updates.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Relay, isAllowedOrigin, parseExtraOrigin, proofFor, urisForWeekSaved, loadOrCreateToken,
  listenOnFirstFreePort, pairingCode, PORTS, PORT_MIN, PORT_MAX,
  HANDSHAKE_TIMEOUT_MS, WRITE_BUDGET_PER_MIN,
} from '../mcp/core.js';
import { bridgeHmac } from './setup.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

class Sock {
  constructor() { this.sent = []; this.closed = null; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; }
}

let relay, saved;
function connect({ tabId = 't1', visible = true, week = '2026-45', token = TOKEN } = {}) {
  const ws = new Sock();
  const tab = relay.onOpen(ws);
  relay.onMessage(tab, JSON.stringify({ type: 'challenge', nonce: 'n'.repeat(32) }));
  relay.onMessage(tab, JSON.stringify({ type: 'hello', token, tabId, week, visible }));
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
  relay = new Relay({ token: TOKEN, clientName: () => 'claude-code', onWeekSaved: (wk, tab) => saved.push([wk, tab.id]) });
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

describe('--allow-origin', () => {
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
  test('the proof matches what the page computes', async () => {
    const ws = new Sock();
    const tab = relay.onOpen(ws);
    relay.onMessage(tab, JSON.stringify({ type: 'challenge', nonce: 'abc'.repeat(8) }));
    expect(ws.sent[0]).toEqual({ type: 'proof', hmac: await bridgeHmac(TOKEN, 'abc'.repeat(8)), client: 'claude-code' });
    expect(proofFor(TOKEN, 'x')).not.toBe(proofFor('other-token-value-here', 'x'));
  });

  test('a wrong token is closed with refused', () => {
    const { ws } = connect({ token: 'wrong-token-wrong-token-wrong' });
    expect(ws.closed).toEqual({ code: 4001, reason: 'refused' });
    expect(relay.pickTab()).toBeNull();
  });

  test('a socket without hello is closed after the handshake timeout', () => {
    vi.useFakeTimers();
    const ws = new Sock();
    relay.onOpen(ws);
    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS + 1);
    expect(ws.closed.code).toBe(4002);
    expect(relay.tabs.size).toBe(0);
  });

  test('calls are not sent before hello', async () => {
    const ws = new Sock();
    relay.onOpen(ws);
    await expect(relay.call('read_week')).rejects.toMatchObject({ code: 'no_app_tab' });
    expect(ws.sent).toEqual([]);
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

  test('the pairing code keeps its port.token shape', () => {
    expect(pairingCode(TOKEN)).toBe(`47831.${TOKEN}`);
  });
});

describe('token file', () => {
  test('created owner-only, reused, rotated', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwmcp-'));
    const file = path.join(dir, 'sub', 'token');
    const a = loadOrCreateToken(file);
    expect(a.created).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadOrCreateToken(file)).toEqual({ token: a.token, created: false });
    expect(loadOrCreateToken(file, { rotate: true }).token).not.toBe(a.token);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
