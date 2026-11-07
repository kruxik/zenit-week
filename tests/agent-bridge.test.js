// Agent bridge, page side (docs/specs/agent-bridge.md): handshake, loopback
// only, queue order, every tool through the app's own functions, one undo
// entry per write, projection, week lock.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _state, genId, defaultWeekData, findNode, rebuildNodeMap, getTickInfo,
  bridgeRunTool, bridgeHandleCall, bridgeConnect, bridgeDisconnect, bridgeHmac,
  bridgeSocketUrl, parseBridgePairingCode, loadBridgeRecord, saveBridgeRecord,
  forgetBridge, projectWeek, commentHasUnsafeLink, bridgeNotifyWeekSaved,
  withWeekLock, undo, redo, setActivityDays, offsetWeek, BRANCH_COLORS,
} from './setup.js';

const sandbox = _state.sandbox;
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

// ── Fake socket ──
let sockets;
class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.closed = null; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; }
  open() { this.onopen && this.onopen(); }
  async receive(frame) { await this.onmessage({ data: JSON.stringify(frame) }); }
}

async function pairedSocket() {
  saveBridgeRecord({ enabled: true, port: 47831, token: TOKEN });
  bridgeConnect();
  const ws = sockets[sockets.length - 1];
  ws.open();
  const { nonce } = ws.sent[0];
  await ws.receive({ type: 'proof', hmac: await bridgeHmac(TOKEN, nonce), client: 'claude-code' });
  return ws;
}

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
  sandbox.WebSocket = FakeSocket;
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

describe('pairing record', () => {
  test('parses port.token and rejects anything else', () => {
    expect(parseBridgePairingCode(` 47831.${TOKEN} `)).toEqual({ port: 47831, token: TOKEN });
    expect(parseBridgePairingCode(`evil.com.${TOKEN}`)).toBeNull();
    expect(parseBridgePairingCode(`99999.${TOKEN}`)).toBeNull();
    expect(parseBridgePairingCode('47831.short')).toBeNull();
  });

  test('a tampered record falls back to safe values', () => {
    _state.setLocalStorage('zenit-week-bridge', { enabled: true, port: 'evil.com', token: TOKEN });
    expect(loadBridgeRecord()).toEqual({ enabled: true, port: 47831, token: TOKEN });
  });

  test('forget clears the record and closes the socket', async () => {
    const ws = await pairedSocket();
    forgetBridge();
    expect(_state.getLocalStorage('zenit-week-bridge')).toBeFalsy();
    expect(ws.closed).toBeTruthy();
    expect(_state.getBridgeStatus().state).toBe('off');
  });
});

describe('connection', () => {
  test('off is off: no socket without an enabled record', () => {
    bridgeConnect();
    expect(sockets).toHaveLength(0);
  });

  test('only ever targets loopback', async () => {
    await pairedSocket();
    expect(new URL(sockets[0].url).hostname).toBe('127.0.0.1');
    expect(new URL(bridgeSocketUrl(1234)).hostname).toBe('127.0.0.1');
  });

  test('hello carries the token only after the server proves it', async () => {
    const ws = await pairedSocket();
    expect(ws.sent.map(f => f.type)).toEqual(['challenge', 'hello']);
    expect(ws.sent[1].token).toBe(TOKEN);
    expect(_state.getBridgeStatus()).toEqual({ state: 'connected', client: 'claude-code' });
  });

  test('a wrong proof never sees the token and reads Refused', async () => {
    saveBridgeRecord({ enabled: true, port: 47831, token: TOKEN });
    bridgeConnect();
    const ws = sockets[0];
    ws.open();
    await ws.receive({ type: 'proof', hmac: 'nope' });
    expect(ws.sent.map(f => f.type)).toEqual(['challenge']);
    expect(ws.closed.reason).toBe('refused');
    expect(_state.getBridgeStatus().state).toBe('refused');
  });

  test('week-saved is sent once per distinct content', async () => {
    const ws = await pairedSocket();
    const a = { nodes: [{ id: 'x', type: 'activity', label: 'A' }] };
    const b = { nodes: [{ id: 'x', type: 'activity', label: 'B' }] };
    bridgeNotifyWeekSaved('2026-45', a);
    bridgeNotifyWeekSaved('2026-45', structuredClone(a));
    bridgeNotifyWeekSaved('2026-45', b);
    const sigs = ws.sent.filter(f => f.event === 'week-saved').map(f => f.sig);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).not.toBe(sigs[1]);
  });
});

describe('dispatch', () => {
  test('unknown tool and unknown argument are refused by the page', async () => {
    const ws = await pairedSocket();
    await bridgeHandleCall({ id: 1, tool: 'eval', args: {} });
    expect(ws.sent.at(-1)).toMatchObject({ id: 1, ok: false, error: { code: 'unknown_tool' } });
    expect(await codeOf(call('add_task', { branch: branchId(), label: 'x', js: 1 }))).toBe('bad_args');
  });

  test('calls arriving together run in order', async () => {
    const ws = await pairedSocket();
    const b = branchId();
    await Promise.all([
      bridgeHandleCall({ id: 1, tool: 'add_task', args: { branch: b, label: 'First' } }),
      bridgeHandleCall({ id: 2, tool: 'add_task', args: { branch: b, label: 'Second' } }),
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
    expect((await call('undo', {})).undone).toBe('Agent: added Read');
    expect((await call('redo', {})).redone).toBe('Agent: added Read');
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
