// Agent bridge, page side (docs/specs/agent-bridge.md): handshake, loopback
// only, queue order, every tool through the app's own functions, one undo
// entry per write, projection, week lock.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _state, genId, defaultWeekData, findNode, rebuildNodeMap, getTickInfo,
  bridgeRunTool, bridgeConnect, bridgeDisconnect, bridgeUnpair, bridgeUpdateHintKey,
  bridgeSocketUrl, bridgeAddCmd, loadBridgeRecord, saveBridgeRecord, projectWeek, commentHasUnsafeLink, bridgeNotifyWeekSaved,
  withWeekLock, undo, redo, setActivityDays, offsetWeek, BRANCH_COLORS,
  mergeWeekData, applyRemoteMerge, weekContentHash, reloadAppFresh,
} from './setup.js';
import nodeCrypto from 'node:crypto';
import { Relay, memoryPairings } from '../mcp/core.js';

const sandbox = _state.sandbox;

// ── Wire: page sockets to real relays (mcp/core.js) ──
// A FakeSocket to a port with a relay behind it talks to that relay in
// process, so the page's WebCrypto and the server's node:crypto meet for real.
// A port without one never opens, like nothing listening.
const ORIGIN = 'http://localhost:5000';
let sockets;
let servers; // port -> { relay, tab, ws }
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = null;
    sockets.push(this);
    const srv = servers.get(this.port);
    if (srv) queueMicrotask(() => this._attach(srv));
  }
  get port() { return Number(new URL(this.url).port); }
  _attach(srv) {
    const page = this;
    srv.ws = {
      send: s => { const f = JSON.parse(s); queueMicrotask(() => page.receive(f)); },
      // Frames sent before the close still arrive, as on a real socket.
      close: (code, reason) => queueMicrotask(() => { page.closed = { code, reason }; page.drop(reason, code); }),
    };
    srv.tab = srv.relay.onOpen(srv.ws, srv.origin || ORIGIN);
    this.srv = srv;
    this.onopen && this.onopen();
  }
  send(s) { const f = JSON.parse(s); this.sent.push(f); if (this.srv && !this.closed) this.srv.relay.onMessage(this.srv.tab, s); }
  close(code, reason) {
    if (this.closed) return;
    this.closed = { code, reason };
    if (this.srv) this.srv.relay.onClose(this.srv.tab);
    queueMicrotask(() => this.drop(reason, code));
  }
  async receive(frame) { if (!this.closed || frame.type === 'call') await this.onmessage({ data: JSON.stringify(frame) }); }
  async drop(reason = '', code = 1006) { if (this._dropped) return; this._dropped = true; await this.onclose({ reason, code }); }
}

const settle = () => new Promise(r => setTimeout(r, 15));
async function until(cond, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timed out waiting'); await settle(); }
}

function serve(port, { client = 'claude-code', pairings = memoryPairings() } = {}) {
  const srv = { relay: new Relay({ pairings, clientName: () => client }), tab: null, ws: null };
  servers.set(port, srv);
  return srv;
}
const socketOn = port => sockets.filter(s => s.port === port).at(-1);

// The confirm dialog, stubbed: the last one shown, and whether it is open.
let dialog;
function stubDialog() {
  dialog = null;
  sandbox.showAppConfirm = opts => { dialog = { ...opts, open: true }; };
  sandbox.window.isAppConfirmOpen = id => !!dialog?.open && (!id || id === dialog.id);
  sandbox.window.closeAppConfirm = () => { if (dialog?.open) { dialog.open = false; dialog.onCancel?.(); } };
}
const allow = () => { dialog.open = false; return dialog.onConfirm(); };
const deny = () => sandbox.window.closeAppConfirm();

function turnOn() {
  saveBridgeRecord({ ...loadBridgeRecord(), enabled: true, explained: true });
  bridgeConnect();
}

// Pairs through the server on `port` and returns the page's socket to it.
async function pairVia(port) {
  const srv = servers.get(port);
  await until(() => srv.tab && srv.relay.hasAnyTab());
  const req = await srv.relay.requestPairing();
  expect(req.kind).toBe('pairing');
  await until(() => dialog?.open);
  await allow();
  await until(() => srv.relay.pickTab());
  return { ws: socketOn(port), req, srv };
}

async function pairedSocket() {
  serve(47831);
  turnOn();
  return (await pairVia(47831)).ws;
}
// A call as the server sends it; resolves when the page has answered.
const serverCall = (ws, frame) => ws.receive({ type: 'call', ...frame });

// ── Week fixture ──
const branchId = () => _state.get().nodes.find(n => n.type === 'branch').id;
function addActivity(label, props = {}, parentId = branchId()) {
  const id = genId();
  const parent = findNode(parentId);
  _state.get().nodes.push({
    id, type: 'activity', branch: parent.branch || parent.id, label, parent: parentId,
    children: [], done: false, unplanned: false, priority: null, reusable: false, _ts: 1, ...props,
  });
  parent.children.push(id);
  rebuildNodeMap();
  return id;
}
// validateAndRepair, run on every snapshot, writes the missing `_posTs: 0`
// default; it is no change of content, so the comparison leaves it out.
const weekJson = () => JSON.stringify(_state.get().nodes.map(({ _posTs, ...n }) => (_posTs ? { ...n, _posTs } : n)));
const undoDepth = () => _state.getUndoStack().length;
const call = (tool, args) => bridgeRunTool(tool, args);
const codeOf = p => p.then(() => 'ok', e => e.code);

beforeEach(() => {
  sockets = [];
  servers = new Map();
  sandbox.WebSocket = FakeSocket;
  sandbox.document.visibilityState = 'visible';
  sandbox.location.host = 'localhost:5000';
  stubDialog();
  _state.reset();
  _state.clearLocalStorage();
  _state.set(defaultWeekData());
  _state.setWeekKey('2026-45');
  _state.setActiveDayFilter(null);
  _state.setEditState(null);
  _state.setSchedule({ entries: [], tombstones: [], crdtVersion: 0 });
});

afterEach(() => {
  bridgeDisconnect();
  vi.useRealTimers();
});

describe('record', () => {
  test('a v1 record keeps its switch and drops port and token', () => {
    _state.setLocalStorage('zenit-week-bridge', { enabled: true, port: 47831, token: 'abcdefghijklmnopqrstuvwxyz012345' });
    expect(loadBridgeRecord()).toEqual({ enabled: true, explained: true, pairingId: '', key: '', pairedAt: '' });
  });

  test('a tampered record falls back to safe values', () => {
    _state.setLocalStorage('zenit-week-bridge', { enabled: true, pairingId: '<script>', key: 'x' });
    expect(loadBridgeRecord()).toMatchObject({ enabled: true, pairingId: '', key: '' });
  });

  test('sign-out and reset (reloadAppFresh) clear the record', () => {
    saveBridgeRecord({ enabled: true, explained: true });
    const realReload = sandbox.location.reload;
    sandbox.location.reload = () => {};
    try { reloadAppFresh(); } finally { sandbox.location.reload = realReload; }
    expect(_state.getLocalStorage('zenit-week-bridge')).toBeFalsy();
  });
});

describe('connection', () => {
  test('off is off: no socket without an enabled record', () => {
    bridgeConnect();
    expect(sockets).toHaveLength(0);
  });

  test('one scan opens a socket to every port of the range, loopback only', () => {
    turnOn();
    expect(sockets.map(s => s.port)).toEqual([47831, 47832, 47833, 47834, 47835, 47836, 47837, 47838]);
    expect(sockets.every(s => new URL(s.url).hostname === '127.0.0.1')).toBe(true);
    expect(new URL(bridgeSocketUrl(47838)).hostname).toBe('127.0.0.1');
    expect(() => bridgeSocketUrl(1234)).toThrow();
    expect(() => bridgeSocketUrl(47839)).toThrow();
  });

  test('before pairing the page sends only its protocol and visibility', async () => {
    const srv = serve(47831);
    turnOn();
    await until(() => _state.getBridgeStatus().state === 'waiting-agent');
    const sent = socketOn(47831).sent;
    expect(sent).toEqual([{ type: 'open', protocol: 2, visible: true, focused: true }]);
    expect(srv.relay.pickTab()).toBeNull();
  });

  test('presence events reach an unpaired server without the week', async () => {
    serve(47831);
    turnOn();
    await until(() => _state.getBridgeStatus().state === 'waiting-agent');
    _state.fireVisibilityChange('hidden');
    const ws = socketOn(47831);
    expect(JSON.stringify(ws.sent)).not.toContain('2026-45');
  });

  test('a v1 server reads as Update your server; a newer one as Reload', async () => {
    servers.set(47831, { relay: { onOpen: () => ({}), onMessage: () => {}, onClose: () => {} }, tab: null });
    turnOn();
    const ws = await (async () => { await until(() => socketOn(47831).srv); return socketOn(47831); })();
    await ws.drop('handshake timeout', 4002);
    expect(_state.getBridgeStatus().state).toBe('update-server');
    expect(_state.getBridgeStatus().agents).toEqual([{ port: 47831, client: '', state: 'old', install: null }]);
    expect(bridgeUpdateHintKey(_state.getBridgeStatus().agents)).toBe('bridge.state.update-server');
    bridgeDisconnect();
    sockets = [];
    servers = new Map();
    servers.set(47832, { relay: { onOpen: () => ({}), onMessage: () => {}, onClose: () => {} }, tab: null });
    turnOn();
    await until(() => socketOn(47832).srv);
    await socketOn(47832).drop('protocol', 4003);
    expect(_state.getBridgeStatus().state).toBe('reload-app');
  });
});

describe('protocol mismatch names the side to update (setup spec 4.5)', () => {
  test('an older server says how it was installed; the hint follows it', async () => {
    const relay = new Relay({ pairings: memoryPairings(), install: 'mcpb' });
    relay.onMessage = (tab, text) => {
      // A server one protocol behind: what core.js sends on a mismatch.
      if (JSON.parse(text).type === 'open') { tab.ws.send(JSON.stringify({ type: 'mismatch', protocol: 1, install: 'mcpb' })); tab.ws.close(4003, 'protocol'); }
    };
    relay.onOpen = ws => ({ ws });
    servers.set(47831, { relay, tab: null });
    turnOn();
    await until(() => _state.getBridgeStatus().state === 'update-server');
    expect(_state.getBridgeStatus().agents).toEqual([{ port: 47831, client: '', state: 'old', install: 'mcpb' }]);
    expect(bridgeUpdateHintKey(_state.getBridgeStatus().agents)).toBe('bridge.state.update-server-mcpb');
  });

  test('a newer server reads as Reload Zenit Week', async () => {
    const relay = { onOpen: ws => ({ ws }), onClose: () => {}, onMessage: (tab, text) => {
      if (JSON.parse(text).type === 'open') { tab.ws.send(JSON.stringify({ type: 'mismatch', protocol: 3, install: 'npx' })); tab.ws.close(4003, 'protocol'); }
    } };
    servers.set(47831, { relay, tab: null });
    turnOn();
    await until(() => _state.getBridgeStatus().state === 'reload-app');
  });

  test('hints: one per shared install path, both when any cannot say', () => {
    const old = install => ({ port: 1, client: '', state: 'old', install });
    expect(bridgeUpdateHintKey([old('npx'), old('npx')])).toBe('bridge.state.update-server-npx');
    expect(bridgeUpdateHintKey([old('repo')])).toBe('bridge.state.update-server-repo');
    expect(bridgeUpdateHintKey([old('npx'), old('mcpb')])).toBe('bridge.state.update-server');
    expect(bridgeUpdateHintKey([old(null)])).toBe('bridge.state.update-server');
  });
});

describe('pairing (setup spec section 4)', () => {
  test('Allow: both sides show one code, store the key, and the tab becomes ready', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings });
    turnOn();
    const { req, srv } = await pairVia(47831);
    expect(dialog.highlight).toBe(`${req.code.slice(0, 3)} ${req.code.slice(3)}`);
    expect(dialog.body).toContain('claude-code');
    expect(await req.settled).toBe('paired');
    const rec = loadBridgeRecord();
    expect(rec.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pairings.get(ORIGIN)).toMatchObject({ pairingId: rec.pairingId, key: rec.key, origin: ORIGIN });
    expect(srv.relay.pickTab().week).toBe('2026-45');
    expect(_state.getBridgeStatus()).toMatchObject({ state: 'connected', clients: ['claude-code'] });
    // The key never crosses the socket.
    expect(JSON.stringify(socketOn(47831).sent)).not.toContain(rec.key);
  });

  test('repeated requests during one pairing get the same code and one dialog', async () => {
    const srv = serve(47831);
    turnOn();
    await until(() => srv.relay.hasAnyTab());
    let shown = 0;
    const real = sandbox.showAppConfirm;
    sandbox.showAppConfirm = o => { shown++; real(o); };
    const a = await srv.relay.requestPairing();
    const b = await srv.relay.requestPairing();
    expect(b.code).toBe(a.code);
    await until(() => dialog?.open);
    expect(shown).toBe(1);
  });

  test('Deny: no key on either side, and the next request has a new pairing', async () => {
    const pairings = memoryPairings();
    const srv = serve(47831, { pairings });
    turnOn();
    await until(() => srv.relay.hasAnyTab());
    const a = await srv.relay.requestPairing();
    await until(() => dialog?.open);
    deny();
    expect(await a.settled).toBe('denied');
    expect(loadBridgeRecord().key).toBe('');
    expect(pairings.list()).toEqual([]);
    const b = await srv.relay.requestPairing();
    expect(b.kind).toBe('pairing');
    expect(b.settled).not.toBe(a.settled);
  });

  test('a hidden tab gets no dialog', async () => {
    const srv = serve(47831);
    sandbox.document.visibilityState = 'hidden';
    turnOn();
    await until(() => srv.relay.hasAnyTab());
    expect((await srv.relay.requestPairing()).kind).toBe('hidden');
    expect(dialog).toBeNull();
  });

  test('the dialog waits while the user edits', async () => {
    const srv = serve(47831);
    turnOn();
    await until(() => srv.relay.hasAnyTab());
    _state.setEditState({ nodeId: 'x' });
    await srv.relay.requestPairing();
    await new Promise(r => setTimeout(r, 400));
    expect(dialog).toBeNull();
    _state.setEditState(null);
    await until(() => dialog?.open);
  });

  test('later sessions connect silently with the stored key', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings });
    turnOn();
    await pairVia(47831);
    bridgeDisconnect();
    dialog = null;
    const srv = serve(47831, { pairings });
    turnOn();
    await until(() => srv.relay.pickTab());
    expect(dialog).toBeNull();
    expect(_state.getBridgeStatus().state).toBe('connected');
  });

  test('a site paired through one agent app is paired for the other', async () => {
    const pairings = memoryPairings(); // the shared pairings.json
    serve(47831, { pairings, client: 'claude-ai' });
    const other = serve(47832, { pairings, client: 'claude-code' });
    turnOn();
    await until(() => other.relay.hasAnyTab());
    await pairVia(47831);
    await until(() => other.relay.pickTab(), 5000);
    expect(_state.getBridgeStatus().clients).toEqual(['claude-ai', 'claude-code']);
  });

  test('unpaired on the agent side: the page shows it and keeps its key', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings });
    turnOn();
    await pairVia(47831);
    const key = loadBridgeRecord().key;
    bridgeDisconnect();
    pairings.delete(ORIGIN); // zenit-week-mcp unpair
    serve(47831, { pairings });
    turnOn();
    await until(() => _state.getBridgeStatus().state === 'unpaired-remote');
    expect(loadBridgeRecord().key).toBe(key);
  });

  test('Settings Unpair removes the pairing on the server and the key in the page', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings });
    turnOn();
    await pairVia(47831);
    bridgeUnpair();
    expect(pairings.list()).toEqual([]);
    expect(loadBridgeRecord()).toMatchObject({ enabled: true, key: '', pairingId: '' });
  });

  test('a relay in the middle with its own keys: the two codes differ', async () => {
    // The attacker plays page to the real server and server to the page.
    const real = new Relay({ pairings: memoryPairings(), clientName: () => 'claude-code' });
    const attacker = { ws: null, tab: null };
    const toPage = [];
    const realTab = real.onOpen({ send: s => toPage.push(JSON.parse(s)), close: () => {} }, ORIGIN);
    real.onMessage(realTab, JSON.stringify({ type: 'open', protocol: 2, visible: true, focused: true }));
    // The page side: an ordinary server on 47831 the attacker controls.
    const ecdh = nodeCrypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const attNonce = nodeCrypto.randomBytes(32);
    const commit = nodeCrypto.createHash('sha256').update(Buffer.concat([ecdh.getPublicKey(), attNonce])).digest('base64url');
    const fake = {
      relay: {
        onOpen: () => ({}),
        onClose: () => {},
        onMessage: (_t, s) => {
          const f = JSON.parse(s);
          if (f.type === 'open') fake.ws.send(JSON.stringify({ type: 'welcome', protocol: 2, install: 'npx', client: 'claude-code', nonce: 'n'.repeat(43), paired: false }));
          if (f.type === 'pair-key') {
            attacker.pagePub = Buffer.from(f.pub, 'base64url');
            attacker.pageNonce = Buffer.from(f.nonce, 'base64url');
            fake.ws.send(JSON.stringify({ type: 'pair-reveal', pub: ecdh.getPublicKey().toString('base64url'), nonce: attNonce.toString('base64url') }));
          }
        },
      },
    };
    servers.set(47831, fake);
    turnOn();
    await until(() => fake.ws);
    await until(() => _state.getBridgeStatus().state === 'waiting-agent');
    const realReq = real.requestPairing();
    // The attacker answers the real server with a key of its own.
    const ecdh2 = nodeCrypto.createECDH('prime256v1');
    ecdh2.generateKeys();
    real.onMessage(realTab, JSON.stringify({ type: 'pair-key', pub: ecdh2.getPublicKey().toString('base64url'), nonce: nodeCrypto.randomBytes(32).toString('base64url') }));
    fake.ws.send(JSON.stringify({ type: 'pair-start', commit, client: 'claude-code' }));
    await until(() => dialog?.open);
    const serverCode = (await realReq).code;
    expect(dialog.highlight.replace(' ', '')).not.toBe(serverCode);
  });
});

describe('several agent apps (setup spec section 5)', () => {
  test('events reach every server; a result goes only to the server that called', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings, client: 'claude-code' });
    const b = serve(47832, { pairings, client: 'claude-ai' });
    turnOn();
    const { ws: a } = await pairVia(47831);
    await until(() => b.relay.pickTab(), 5000);
    const bws = socketOn(47832);
    bridgeNotifyWeekSaved('2026-45', { nodes: [{ id: 'x', type: 'activity', label: 'A' }] });
    expect(a.sent.filter(f => f.event === 'week-saved')).toHaveLength(1);
    expect(bws.sent.filter(f => f.event === 'week-saved')).toHaveLength(1);
    await serverCall(bws, { id: 7, tool: 'get_stats', args: {} });
    expect(bws.sent.filter(f => f.type === 'result').map(f => f.id)).toEqual([7]);
    expect(a.sent.some(f => f.type === 'result')).toBe(false);
  });

  test('writes from two servers queue: one at a time, in arrival order', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings });
    const b = serve(47832, { pairings, client: 'claude-ai' });
    turnOn();
    const { ws: a } = await pairVia(47831);
    await until(() => b.relay.pickTab(), 5000);
    const bws = socketOn(47832);
    const br = branchId();
    await Promise.all([
      serverCall(a, { id: 1, tool: 'add_task', args: { branch: br, label: 'From A' } }),
      serverCall(bws, { id: 1, tool: 'add_task', args: { branch: br, label: 'From B' } }),
    ]);
    const labels = findNode(br).children.map(id => findNode(id).label);
    expect(labels.indexOf('From A')).toBeLessThan(labels.indexOf('From B'));
  });

  test('a call through the real relay comes back to its agent', async () => {
    const srv = serve(47831);
    turnOn();
    await pairVia(47831);
    const stats = await srv.relay.call('get_stats', {});
    expect(stats.week).toBe('2026-45');
  });

  test('one server quitting leaves the other connected', async () => {
    const pairings = memoryPairings();
    serve(47831, { pairings, client: 'claude-code' });
    const b = serve(47832, { pairings, client: 'claude-ai' });
    turnOn();
    const { ws: a } = await pairVia(47831);
    await until(() => b.relay.pickTab(), 5000);
    a.close(1001, 'gone');
    await until(() => _state.getBridgeStatus().clients.length === 1);
    expect(_state.getBridgeStatus().clients).toEqual(['claude-ai']);
  });

  test('disconnect closes every socket', async () => {
    const ws = await pairedSocket();
    bridgeDisconnect();
    expect(ws.closed).toBeTruthy();
    expect(_state.getBridgeStatus().state).toBe('off');
  });
});

describe('dispatch', () => {
  test('unknown tool and unknown argument are refused by the page', async () => {
    const ws = await pairedSocket();
    await serverCall(ws, { id: 1, tool: 'eval', args: {} });
    expect(ws.sent.at(-1)).toMatchObject({ id: 1, ok: false, error: { code: 'unknown_tool' } });
    expect(await codeOf(call('add_task', { branch: branchId(), label: 'x', js: 1 }))).toBe('bad_args');
  });

  test('calls arriving together run in order', async () => {
    const ws = await pairedSocket();
    const b = branchId();
    await Promise.all([
      serverCall(ws, { id: 1, tool: 'add_task', args: { branch: b, label: 'First' } }),
      serverCall(ws, { id: 2, tool: 'add_task', args: { branch: b, label: 'Second' } }),
    ]);
    const results = ws.sent.filter(f => f.type === 'result');
    expect(results.map(r => r.id)).toEqual([1, 2]);
    const labels = findNode(b).children.map(id => findNode(id).label);
    expect(labels.indexOf('First')).toBeLessThan(labels.indexOf('Second'));
  });

  test('a write waits for the week lock held by a merge', async () => {
    const id = addActivity('Gym');
    let release;
    const held = withWeekLock('2026-45', () => new Promise(r => { release = r; }));
    const p = call('set_status', { id, status: 'done' });
    await new Promise(r => setTimeout(r, 20));
    expect(findNode(id).done).toBe(false);
    release();
    await held;
    await p;
    expect(findNode(id).done).toBe(true);
  });

  test('a write waits while the user edits, and fails with user_busy after 30 s', async () => {
    vi.useFakeTimers();
    const id = addActivity('Gym');
    findNode(id)._editing = true;
    const p = codeOf(call('set_status', { id, status: 'done' }));
    await vi.advanceTimersByTimeAsync(31000);
    expect(await p).toBe('user_busy');
    delete findNode(id)._editing;
  });

  test('reads are not held back by an editing user', async () => {
    const id = addActivity('Gym');
    findNode(id)._editing = true;
    const week = await call('read_week', {});
    expect(week.week).toBe('2026-45');
    delete findNode(id)._editing;
  });
});

describe('one call, one undo entry', () => {
  test('add_task Pushups 10x: ten ticks, one entry, undo restores, redo reapplies', async () => {
    const before = weekJson();
    const task = await call('add_task', { branch: branchId(), label: 'Pushups 10x' });
    expect(task.ticks).toEqual({ done: 0, total: 10 });
    expect(task.label).toBe('Pushups');
    expect(undoDepth()).toBe(1);
    const after = weekJson();
    await undo();
    expect(weekJson()).toBe(before);
    await redo();
    expect(findNode(task.id)).toBeTruthy();
    expect(getTickInfo(findNode(task.id)).total).toBe(10);
    expect(weekJson().length).toBeGreaterThan(before.length);
    expect(after).toBeTruthy();
  });

  test('add_task with days, priority and a comment is one entry', async () => {
    const before = weekJson();
    const task = await call('add_task', { branch: branchId(), label: 'Run', days: [1, 3, 5], priority: 'high', comment: '- [ ] 5 km' });
    expect(task.days).toEqual([1, 3, 5]);
    expect(task.priority).toBe('high');
    expect(task.comments).toBe('- [ ] 5 km');
    expect(undoDepth()).toBe(1);
    await undo();
    expect(weekJson()).toBe(before);
  });

  test('tick_task n=3 is one entry; too many is refused whole', async () => {
    const task = await call('add_task', { branch: branchId(), label: 'Squats 4x' });
    const depth = undoDepth();
    const r = await call('tick_task', { id: task.id, n: 3 });
    expect(r.ticks).toEqual({ done: 3, total: 4 });
    expect(undoDepth()).toBe(depth + 1);
    expect(await codeOf(call('tick_task', { id: task.id, n: 2 }))).toBe('bad_args');
    expect(findNode(task.id).children.map(findNode).filter(c => c.done)).toHaveLength(3);
    await call('tick_task', { id: task.id, n: -1 });
    expect(getTickInfo(findNode(task.id)).done).toBe(2);
    await undo(); await undo();
    expect(getTickInfo(findNode(task.id)).done).toBe(0);
  });

  test('add_branch with label and colour is one entry without an editing flag', async () => {
    const r = await call('add_branch', { label: 'Health', color: '#00aa55' });
    expect(undoDepth()).toBe(1);
    expect(findNode(r.id)._editing).toBeUndefined();
    expect(BRANCH_COLORS[r.id].main.toLowerCase()).toBe('#00aa55');
    await undo();
    expect(findNode(r.id)).toBeFalsy();
  });

  test('transfer_unfinished is one entry', async () => {
    _state.setLocalStorage('zenit-week-' + offsetWeek('2026-45', -1), {
      nodes: [
        { id: 'center', type: 'center' },
        { id: 'b1', type: 'branch', parent: 'center', label: 'Work', children: ['a2'] },
        { id: 'a2', type: 'activity', parent: 'b1', branch: 'b1', label: 'Carry me', done: false, children: [] },
      ],
    });
    _state.set({ nodes: [{ id: 'center', type: 'center' }, { id: 'b1', type: 'branch', parent: 'center', label: 'Work', children: [] }] });
    const before = weekJson();
    await call('transfer_unfinished', {});
    expect(_state.get().nodes.some(n => n.label === 'Carry me')).toBe(true);
    expect(undoDepth()).toBe(1);
    await undo();
    expect(JSON.parse(weekJson()).map(n => n.id)).toEqual(JSON.parse(before).map(n => n.id));
  });

  test('a failure after the snapshot rolls back without touching redo', async () => {
    const id = addActivity('Gym');
    await call('set_status', { id, status: 'done' });
    await undo();
    expect(_state.getRedoStack()).toHaveLength(1);
    const before = weekJson();
    const real = sandbox.writeComment;
    sandbox.writeComment = () => { throw new Error('boom'); };
    try {
      await expect(call('add_task', { branch: branchId(), label: 'X', comment: 'c' })).rejects.toThrow('boom');
    } finally {
      sandbox.writeComment = real;
    }
    expect(weekJson()).toBe(before);
    expect(undoDepth()).toBe(0);
    expect(_state.getRedoStack()).toHaveLength(1);
  });

  test('undo reports which action it reversed', async () => {
    await call('add_task', { branch: branchId(), label: 'Read' });
    expect((await call('undo', {})).undone).toBe('Added Read');
    expect((await call('redo', {})).redone).toBe('Added Read');
  });
});

describe('tool rules', () => {
  test('days with an Nx label and relative days are refused, leaving nothing', async () => {
    const b = branchId();
    expect(await codeOf(call('add_task', { branch: b, label: 'Pushups 10x', days: [1] }))).toBe('bad_args');
    expect(await codeOf(call('add_task', { branch: b, label: 'Call (tomorrow)' }))).toBe('bad_args');
    expect(await codeOf(call('rename_task', { id: addActivity('A'), label: 'A (today)' }))).toBe('bad_args');
    expect(undoDepth()).toBe(0);
  });

  test("the user's day filter does not stamp an agent task", async () => {
    _state.setActiveDayFilter(2);
    const t1 = await call('add_task', { branch: branchId(), label: 'Plain' });
    expect(t1.days).toEqual([]);
    const t2 = await call('add_task', { branch: branchId(), label: 'Run', days: [1, 3, 5] });
    expect(t2.days).toEqual([1, 3, 5]);
  });

  test('set_priority is absolute; the same value is a no-op', async () => {
    const id = addActivity('Report', { priority: 'high' });
    const r = await call('set_priority', { id, priority: 'high' });
    expect(r.priority).toBe('high');
    expect(undoDepth()).toBe(0);
  });

  test('set_status undone reopens a done and a dropped task', async () => {
    const a = addActivity('A');
    const b = addActivity('B');
    await call('set_status', { id: a, status: 'done' });
    await call('set_status', { id: b, status: 'dropped' });
    expect((await call('set_status', { id: a, status: 'undone' })).done).toBe(false);
    expect((await call('set_status', { id: b, status: 'undone' })).dropped).toBe(false);
  });

  test('set_comment refuses an unsafe link and stores anything else byte for byte', async () => {
    const id = addActivity('Read', { comments: 'old' });
    expect(await codeOf(call('set_comment', { id, markdown: '[x](javascript:alert(1))' }))).toBe('bad_args');
    expect(findNode(id).comments).toBe('old');
    const text = '# H\n*  odd** [ok](https://example.com)  \n\tliteral';
    await call('set_comment', { id, markdown: text });
    expect(findNode(id).comments).toBe(text);
    expect(commentHasUnsafeLink('[a](mailto:x@y.z)')).toBe(false);
  });

  test('set_days replaces the days and says when ticks went', async () => {
    const task = await call('add_task', { branch: branchId(), label: 'Plank 3x' });
    const r = await call('set_days', { id: task.id, days: [2, 4] });
    expect(r.days).toEqual([2, 4]);
    expect(r.ticks).toBeNull();
    expect(r.ticksRemoved).toBe(true);
  });

  test('set_reusable is idempotent', async () => {
    const id = addActivity('Laundry');
    await call('set_reusable', { id, on: true });
    await call('set_reusable', { id, on: true });
    expect(undoDepth()).toBe(1);
  });

  test('tick_task on a task without ticks is wrong_type; unknown id is not_found', async () => {
    expect(await codeOf(call('tick_task', { id: addActivity('Plain') }))).toBe('wrong_type');
    expect(await codeOf(call('set_status', { id: 'nope', status: 'done' }))).toBe('not_found');
  });

  test('delete_task on a repeating occurrence without scope asks for one', async () => {
    _state.setSchedule({
      entries: [{ id: 's1', label: 'Gym', branch: branchId(), anchor: '2026-11-02',
        repeat: { every: 1, unit: 'week' }, end: { type: 'never' }, plantedThrough: '2026-11-08', planted: [], _ts: 1 }],
      tombstones: [], crdtVersion: 0,
    });
    const id = addActivity('Gym (mo)', { schedId: 's1', schedDate: '2026-11-02' });
    expect(await codeOf(call('delete_task', { id }))).toBe('needs_choice');
    expect(findNode(id)).toBeTruthy();
  });

  test('delete_task on a plain task deletes at once, one entry', async () => {
    const id = addActivity('Old');
    await call('delete_task', { id });
    expect(findNode(id)).toBeFalsy();
    expect(undoDepth()).toBe(1);
  });
});

describe('get_stats', () => {
  test('counts only: no raw leaves, no internal stamps', async () => {
    addActivity('Gym', { done: true, doneAt: '2026-11-03T08:00:00.000Z' });
    addActivity('Read');
    const stats = await call('get_stats', {});
    expect(Object.keys(stats).sort()).toEqual(['global', 'perBranch', 'week']);
    expect(stats.global).toMatchObject({ total: 2, done: 1 });
    expect(JSON.stringify(stats)).not.toMatch(/_ts|_posTs|leaves/);
  });
});

describe('projection', () => {
  test('omits internal stamps and folds day and tick leaves', () => {
    const run = addActivity('Run', { offX: 5, _posTs: 9 });
    setActivityDays(run, new Set([1, 0]));
    const p = projectWeek(_state.get(), '2026-45');
    const json = JSON.stringify(p);
    for (const k of ['_ts', '_posTs', 'offX', 'offY', '_demo', '_editing', 'dayChild', 'tickChild']) expect(json).not.toContain(`"${k}"`);
    const task = p.branches.flatMap(b => b.tasks).find(t => t.id === run);
    expect(task.days).toEqual([1, 7]);
    expect(task.children).toEqual([]);
    expect(p.range).toBe('2026-11-02/2026-11-08');
  });

  test('the week in view is read from memory', async () => {
    const id = addActivity('Unsaved');
    const week = await call('read_week', { week: '2026-45' });
    expect(week.branches.flatMap(b => b.tasks).some(t => t.id === id)).toBe(true);
  });

  test('read_agenda returns the day in render order', async () => {
    const gym = addActivity('Gym');
    setActivityDays(gym, new Set([3]));
    const ag = await call('read_agenda', { day: 3 });
    expect(ag.groups.map(g => g.group)).toEqual(['pending', 'done', 'anyday', 'dropped']);
    expect(ag.groups[0].rows[0].task.label).toBe('Gym');
  });
});

describe('week lock', () => {
  test('no wrapped write body re-enters the lock it runs under', async () => {
    const real = sandbox.withWeekLock;
    const held = new Set();
    const reentries = [];
    sandbox.withWeekLock = (wk, fn) => {
      if (held.has(wk)) reentries.push(wk);
      held.add(wk);
      return real(wk, async () => { try { return await fn(); } finally { held.delete(wk); } });
    };
    try {
      const b = branchId();
      const task = await call('add_task', { branch: b, label: 'Squats 3x' });
      const plain = await call('add_task', { branch: b, label: 'Plain' });
      await call('rename_task', { id: plain.id, label: 'Plain two' });
      await call('set_status', { id: plain.id, status: 'done' });
      await call('set_priority', { id: plain.id, priority: 'critical' });
      await call('set_days', { id: plain.id, days: [1] });
      await call('tick_task', { id: task.id, n: 2 });
      await call('set_comment', { id: plain.id, markdown: 'hi' });
      await call('set_reusable', { id: plain.id, on: true });
      await call('add_branch', { label: 'Side' });
      await call('delete_task', { id: plain.id });
    } finally {
      sandbox.withWeekLock = real;
    }
    expect(reentries).toEqual([]);
  });
});

// Spec 7.2 and 9, against real IndexedDB so the merge has a genuine await gap
// between reading the week and assigning weekData.
describe('merge window and week-saved events (real IDB)', () => {
  const WK = '2026-45';
  let realSaveWeek;
  beforeEach(() => {
    _state.useRealIDB(true);
    realSaveWeek = sandbox.saveWeek;
  });
  afterEach(() => {
    sandbox.saveWeek = realSaveWeek;
    _state.useRealIDB(false);
  });

  function twoTasks() {
    const a = addActivity('Local A', { _ts: 1 });
    const b = addActivity('Shared B', { _ts: 1 });
    return { a, b };
  }
  function remoteWith(id, patch) {
    const remote = JSON.parse(JSON.stringify(_state.get()));
    Object.assign(remote.nodes.find(n => n.id === id), patch, { _ts: Date.now() + 60000 });
    return remote;
  }

  test('a write issued inside a merge waits for it, and both changes survive', async () => {
    const { a, b } = twoTasks();
    _state.setPendingRemoteMerge(WK, remoteWith(b, { label: 'Remote B' }));
    const merge = _state.flushPendingMerge();          // takes the lock now, commits after its IDB write
    const write = call('set_status', { id: a, status: 'done' }); // issued inside that window
    await Promise.all([merge, write]);
    expect(findNode(a).done).toBe(true);                // the agent's write was not overwritten
    expect(findNode(b).label).toBe('Remote B');         // nor was the remote change
  });

  test('user, agent, second tab and Drive each produce one week-saved event; a no-op merge none', async () => {
    const ws = await pairedSocket();
    const events = () => ws.sent.filter(f => f.event === 'week-saved').length;
    const settle = () => new Promise(r => setTimeout(r, 30));
    const { b } = twoTasks();

    await sandbox.saveWeek(WK, _state.get());           // the user's own save
    expect(events()).toBe(1);

    await call('add_task', { branch: branchId(), label: 'From agent' });
    await settle();
    expect(events()).toBe(2);

    _state.setPendingRemoteMerge(WK, remoteWith(b, { label: 'From tab' }));
    await _state.flushPendingMerge();                   // a peer tab's save, merged here
    expect(events()).toBe(3);

    const remote = remoteWith(b, { label: 'From Drive' });
    const merged = mergeWeekData(JSON.parse(JSON.stringify(_state.get())), remote, WK);
    await applyRemoteMerge(WK, merged, JSON.stringify(merged), weekContentHash(merged), false, remote);
    expect(events()).toBe(4);

    const same = JSON.parse(JSON.stringify(_state.get()));
    await applyRemoteMerge(WK, same, JSON.stringify(same), weekContentHash(same), false, same);
    expect(events()).toBe(4);
  });
});

// ── Vision Canvas (docs/specs/vision-canvas.md, section 6) ──
describe('vision', () => {
  const WK = '2026-45';
  const vb = (id, children = []) => ({ id, type: 'branch', branch: id, label: 'Sea', children, side: 'left', _ts: 1 });
  const intent = (id, parent, extra = {}) => ({ id, type: 'activity', branch: 'nvb1', parent, label: 'Live by the sea', children: [], _ts: 1, ...extra });
  const visionUndo = () => _state.getVisionUndoStack().length;
  const node = id => _state.get().nodes.find(n => n.id === id);

  beforeEach(async () => {
    _state.useRealIDB(true);
    const db = await sandbox.openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['weeks', 'misc'], 'readwrite');
      tx.objectStore('weeks').clear();
      tx.objectStore('misc').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    _state.setMapKind('week');
    _state.setCurrentView('mindmap');
    _state.setWindowInnerWidth(1280);
    const week = defaultWeekData();
    await sandbox.saveWeekIDB(WK, structuredClone(week));
    await sandbox.saveValueIDB('vision', { nodes: [vb('nvb1', ['nv1']), intent('nv1', 'nvb1')], tombstones: [], crdtVersion: 1 });
    _state.set(week);
  });
  afterEach(async () => {
    if (_state.getMapKind() === 'vision') await sandbox.switchView('mindmap');
    _state.useRealIDB(false);
  });

  test('read_vision projects the stored vision without opening it', async () => {
    const v = await call('read_vision', {});
    expect(_state.getMapKind()).toBe('week');
    expect(v.branches[0].intentions[0]).toEqual({
      id: 'nv1', label: 'Live by the sea', priority: 'normal', horizon: null,
      letGo: false, letGoAt: null, comments: '', children: [],
    });
  });

  test('open_vision navigates with no undo entry; open_week comes back', async () => {
    const v = await call('open_vision', {});
    expect(_state.getMapKind()).toBe('vision');
    expect(v.branches.map(b => b.id)).toEqual(['nvb1']);
    expect(visionUndo()).toBe(0);
    await call('open_week', { week: WK });
    expect(_state.getMapKind()).toBe('week');
    expect(_state.getCurrentView()).toBe('mindmap');
  });

  test('a vision id while a week is in view answers not_in_view, and vice versa', async () => {
    await expect(codeOf(call('rename_task', { id: 'nv1', label: 'x' }))).resolves.toBe('not_in_view');
    const weekBranch = branchId();
    await call('open_vision', {});
    await expect(codeOf(call('add_task', { branch: weekBranch, label: 'x' }))).resolves.toBe('not_in_view');
  });

  test('add_task with a comment, then set_horizon: one undo entry each, on the vision stack', async () => {
    await call('open_vision', {});
    const added = await call('add_task', { branch: 'nvb1', label: 'Sail across', comment: '# Why\nFreedom.' });
    expect(added).toMatchObject({ label: 'Sail across', comments: '# Why\nFreedom.', horizon: null });
    const h = await call('set_horizon', { id: added.id, horizon: 'someday' });
    expect(h.horizon).toBe('someday');
    expect(visionUndo()).toBe(2);
    expect(_state.getUndoStack()).toHaveLength(0);
    // Same value: no-op, no snapshot.
    await call('set_horizon', { id: added.id, horizon: 'someday' });
    expect(visionUndo()).toBe(2);
  });

  test('add_task refuses days and Nx on the Vision; a relative word is just text', async () => {
    await call('open_vision', {});
    await expect(codeOf(call('add_task', { branch: 'nvb1', label: 'Run', days: [1] }))).resolves.toBe('bad_args');
    await expect(codeOf(call('add_task', { branch: 'nvb1', label: 'Pushups 10x' }))).resolves.toBe('bad_args');
    const t = await call('add_task', { branch: 'nvb1', label: 'Call home tomorrow' });
    expect(t.label).toBe('Call home tomorrow');
  });

  test('rename is literal', async () => {
    await call('open_vision', {});
    await call('rename_task', { id: 'nv1', label: 'Run (mo) 3x' });
    expect(node('nv1').label).toBe('Run (mo) 3x');
    expect(node('nv1').children).toEqual([]);
  });

  test('rename_branch is literal, one vision undo entry; the same label is a no-op', async () => {
    await expect(codeOf(call('rename_branch', { branch: 'nvb1', label: 'x' }))).resolves.toBe('not_in_view');
    await call('open_vision', {});
    expect(await call('rename_branch', { branch: 'nvb1', label: 'Sea 3x (mo)' })).toEqual({ id: 'nvb1', label: 'Sea 3x (mo)' });
    expect(node('nvb1').label).toBe('Sea 3x (mo)');
    expect(visionUndo()).toBe(1);
    await call('rename_branch', { branch: 'nvb1', label: 'Sea 3x (mo)' });
    expect(visionUndo()).toBe(1);
  });

  test('delete_branch takes the subtree, refuses the last branch, and one undo restores it', async () => {
    await call('open_vision', {});
    await expect(codeOf(call('delete_branch', { branch: 'nvb1' }))).resolves.toBe('wrong_type');
    expect(visionUndo()).toBe(0);
    const other = await call('add_branch', { label: 'Health' });
    expect(await call('delete_branch', { branch: 'nvb1' })).toEqual({ deleted: 'nvb1' });
    expect(node('nvb1')).toBeFalsy();
    expect(node('nv1')).toBeFalsy();
    expect(visionUndo()).toBe(2);
    await call('undo', {});
    expect(node('nvb1')).toBeTruthy();
    expect(node('nv1')).toBeTruthy();
    expect(node(other.id)).toBeTruthy();
  });

  test('set_status: dropped lets go, undone takes back, done is wrong_type', async () => {
    await call('open_vision', {});
    expect((await call('set_status', { id: 'nv1', status: 'dropped' })).letGo).toBe(true);
    expect((await call('set_status', { id: 'nv1', status: 'undone' })).letGo).toBe(false);
    for (const s of ['done', 'unplanned', 'planned']) {
      await expect(codeOf(call('set_status', { id: 'nv1', status: s }))).resolves.toBe('wrong_type');
    }
    expect(node('nv1').done).toBeFalsy();
  });

  test('week-only tools are wrong_type while the Vision is in view', async () => {
    await call('open_vision', {});
    for (const [tool, args] of [
      ['set_days', { id: 'nv1', days: [1] }],
      ['tick_task', { id: 'nv1' }],
      ['set_reusable', { id: 'nv1', on: true }],
      ['send_to_date', { id: 'nv1', date: '2030-01-01' }],
      ['transfer_unfinished', {}],
      ['transfer_reusable', {}],
    ]) {
      await expect(codeOf(call(tool, args))).resolves.toBe('wrong_type');
    }
    expect(visionUndo()).toBe(0);
  });

  test('set_horizon on a week node is wrong_type', async () => {
    const id = addActivity('Gym');
    await expect(codeOf(call('set_horizon', { id, horizon: 'year' }))).resolves.toBe('wrong_type');
  });

  test('week reads of the week in view say not_in_view on the Vision', async () => {
    await call('open_vision', {});
    await expect(codeOf(call('get_stats', {}))).resolves.toBe('not_in_view');
    await expect(codeOf(call('read_agenda', { day: 1 }))).resolves.toBe('not_in_view');
    // A stored week is still readable.
    expect((await call('read_week', { week: WK })).week).toBe(WK);
  });

  test('undo acts on the record in view and names it', async () => {
    await call('open_vision', {});
    await call('set_priority', { id: 'nv1', priority: 'high' });
    const u = await call('undo', {});
    expect(u.record).toBe('vision');
    expect(node('nv1').priority).toBeFalsy();
  });

  test('a vision save tells the agent once, under the key vision', async () => {
    const ws = await pairedSocket();
    await call('open_vision', {});
    ws.sent.length = 0;
    await call('set_priority', { id: 'nv1', priority: 'critical' });
    await new Promise(r => setTimeout(r, 30));
    const ev = ws.sent.filter(f => f.type === 'event' && f.event === 'week-saved');
    expect(ev.map(f => f.wk)).toEqual(['vision']);
  });
});

describe('agent add commands follow the site', () => {
  const base = 'claude mcp add --scope user zenit-week -- npx -y zenit-week-mcp@1';
  test.each(['https://zenitweek.com', 'https://www.zenitweek.com', 'http://localhost:8080', 'http://127.0.0.1:5000'])(
    'built-in site %s copies the plain command', o => expect(bridgeAddCmd('claude-code', o)).toBe(base));
  test('a tunnel adds its own site first', () => {
    expect(bridgeAddCmd('claude-code', 'https://abc.ngrok-free.dev'))
      .toBe(`npx -y zenit-week-mcp@1 origins add https://abc.ngrok-free.dev && ${base}`);
  });
  test('a site the server cannot add (not https) copies the plain command', () => {
    expect(bridgeAddCmd('claude-code', 'http://192.168.1.5:8080')).toBe(base);
  });
  test('Grok Build gets its own command', () => {
    expect(bridgeAddCmd('grok', 'https://zenitweek.com')).toBe('grok mcp add zenit-week -- npx -y zenit-week-mcp@1');
  });
  test('Codex and Gemini CLI get their own commands', () => {
    expect(bridgeAddCmd('codex', 'https://zenitweek.com')).toBe('codex mcp add zenit-week -- npx -y zenit-week-mcp@1');
    expect(bridgeAddCmd('gemini', 'https://abc.ngrok-free.dev'))
      .toBe('npx -y zenit-week-mcp@1 origins add https://abc.ngrok-free.dev && gemini mcp add --scope user zenit-week npx zenit-week-mcp@1');
  });
});
