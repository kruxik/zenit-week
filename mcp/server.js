#!/usr/bin/env node
// zenit-week-mcp - lets an MCP client (Claude Code, Claude Desktop, ...) act on
// an open Zenit Week tab. MCP over stdio on one side, a loopback-only WebSocket
// on the other; the page does every read and write itself.
//
//   zenit-week-mcp                  run the server (what the MCP client launches)
//   zenit-week-mcp unpair <site>    forget a site's pairing (an origin or a host name)
//   zenit-week-mcp unpair --all     forget every pairing
//   options: --open (launch the app when no tab is connected)
//            --allow-origin <https-url> (also accept that page origin, e.g. an ngrok dev tunnel)
//
// Each copy listens on the first free port of 47831-47838, so every agent app
// can run its own; the page connects to all of them.
//
// stdout belongs to the MCP protocol: everything human-readable goes to stderr.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  OPEN_WAIT_MS, PAIR_TIMEOUT_MS, PORT_MIN, PORT_MAX, STARTUP_GRACE_MS, Relay, RelayError, filePairings,
  formatPairCode, isAllowedOrigin, listenOnFirstFreePort, matchSite, pairingsPath, parseExtraOrigin,
  urisForWeekSaved,
} from './core.js';

const APP_URL = 'https://zenitweek.com/app';
const { version: VERSION } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';
const OPEN = argv.includes('--open');
const err = (...a) => process.stderr.write(a.join(' ') + '\n');
// --allow-origin https://<host> (repeatable): an extra page origin, for a dev tunnel.
const EXTRA_ORIGINS = [];
argv.forEach((a, i) => {
  if (a !== '--allow-origin') return;
  const o = parseExtraOrigin(argv[i + 1]);
  if (!o) { err('zenit-week-mcp: --allow-origin needs an https URL'); process.exit(2); }
  EXTRA_ORIGINS.push(o);
});

const pairings = filePairings(pairingsPath());

if (cmd === 'unpair') {
  const site = argv[1];
  if (!site) { err('zenit-week-mcp: unpair needs a site (https://zenitweek.com or a host name) or --all'); process.exit(2); }
  const all = pairings.list();
  const gone = site === '--all' ? all : all.filter(e => matchSite(site, e.origin));
  gone.forEach(e => pairings.delete(e.origin));
  console.log(gone.length ? `Unpaired: ${gone.map(e => e.origin).join(', ')}` : `No pairing for ${site}.`);
  process.exit(0);
}
if (cmd !== 'serve') { err(`zenit-week-mcp: unknown command "${cmd}"`); process.exit(2); }

// Which update hint the page shows on a protocol mismatch (setup spec 4.5, row 4).
const INSTALL = /[\\/]_npx[\\/]/.test(fileURLToPath(import.meta.url)) ? 'npx' : 'repo';

// ── MCP side ──
const mcp = new McpServer(
  { name: 'zenit-week', version: VERSION },
  {
    capabilities: { resources: { subscribe: true } },
    instructions: [
      'Zenit Week is a weekly planner shown as a mind map: branches (categories) hold tasks, tasks may hold sub-tasks.',
      'All writes act on the week open in the app, exactly as if the user clicked; each call is one undo step and shows the user a toast.',
      'Read zenit://week/current (or call get_stats) first to learn branch and task ids. Use open_week to switch weeks before writing to another week.',
      'Days are ISO weekdays: 1 = Monday ... 7 = Sunday. A label ending in "Nx" (e.g. "Pushups 10x") makes N ticks recorded with tick_task; days and Nx do not combine.',
      'Never put relative days (today, tomorrow) in labels: pass days instead.',
      'The first request may answer that Zenit Week is not connected yet and give a code: tell the user that code, ask them to check it matches the one shown in Zenit Week and click Allow there, and call again only after they confirm.',
    ].join(' '),
  },
);

const subscriptions = new Set();
mcp.server.setRequestHandler(SubscribeRequestSchema, async req => { subscriptions.add(req.params.uri); return {}; });
mcp.server.setRequestHandler(UnsubscribeRequestSchema, async req => { subscriptions.delete(req.params.uri); return {}; });

const relay = new Relay({
  pairings,
  install: INSTALL,
  clientName: () => mcp.server.getClientVersion()?.name || null,
  log: s => err(`zenit-week-mcp: ${s}`),
  onWeekSaved: (wk, tab) => {
    for (const uri of urisForWeekSaved(wk, tab.week)) {
      if (subscriptions.has(uri)) mcp.server.sendResourceUpdated({ uri }).catch(() => {});
    }
  },
});

function openApp() {
  const [c, a] = process.platform === 'darwin' ? ['open', [APP_URL]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', APP_URL]]
    : ['xdg-open', [APP_URL]];
  try { spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch (_) { /* no opener */ }
}

const STARTED_AT = Date.now();

// A result the agent should read out rather than treat as a failure: the
// pairing code, or what the user has to do first (setup spec 4.2, row 2).
class Notice { constructor(text) { this.text = text; } }

const NOT_PAIRED = code => `Not connected yet. Zenit Week shows a request with the code ${formatPairCode(code)}. `
  + 'Ask the user to check that the code matches and click Allow there, then call again. Do not retry before the user confirms.';
const PAIR_NOTICES = {
  hidden: 'Zenit Week is open but not in front. Ask the user to bring the Zenit Week tab to the front, then ask again.',
  busy: 'Zenit Week is showing another approval request. Ask the user to answer it, then ask again.',
  failed: 'Pairing with Zenit Week broke off. Ask again to start a new request.',
  denied: 'The user did not allow this agent in Zenit Week. Ask again only if the user wants to connect.',
  timeout: 'Nobody answered the request in Zenit Week. Ask again to show a new code.',
  closed: 'The Zenit Week tab closed during pairing. Ask again once it is open.',
};

const canElicit = () => !!mcp.server.getClientCapabilities()?.elicitation;

// Pairing on the agent's first request (setup spec 4.1, step 3). Where the agent
// app can show a message during the wait, the request is held and runs once
// the user clicks Allow; otherwise the code comes back as a normal result.
async function pairFirst() {
  const p = await relay.requestPairing();
  if (p.kind === 'no_tab') return null;
  if (p.kind !== 'pairing') return new Notice(PAIR_NOTICES[p.kind] || PAIR_NOTICES.failed);
  if (!canElicit()) return new Notice(NOT_PAIRED(p.code));
  const abort = new AbortController();
  mcp.server.elicitInput({
    message: `Zenit Week is asking you to approve this agent. The code there should be ${formatPairCode(p.code)}. Click Allow in Zenit Week.`,
    requestedSchema: { type: 'object', properties: {} },
  }, { signal: abort.signal, timeout: PAIR_TIMEOUT_MS * 5 }).then(r => {
    if (r?.action === 'decline') relay.cancelPairing();
  }).catch(() => { /* aborted after Allow, or the app has no prompt after all */ });
  const outcome = await p.settled;
  abort.abort();
  if (outcome !== 'paired') return new Notice(PAIR_NOTICES[outcome] || PAIR_NOTICES.failed);
  await relay.waitForTab(5000, { paired: true });
  return null;
}

async function forward(tool, args) {
  if (!relay.pickTab()) {
    if (!relay.hasAnyTab()) {
      if (OPEN) openApp();
      const grace = STARTUP_GRACE_MS - (Date.now() - STARTED_AT);
      const wait = Math.max(OPEN ? OPEN_WAIT_MS : 0, grace);
      if (wait > 0) await relay.waitForTab(wait);
    }
    if (!relay.pickTab()) {
      const notice = await pairFirst();
      if (notice) return notice;
    }
  }
  return relay.call(tool, args);
}

const asText = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const asError = e => ({
  isError: true,
  content: [{ type: 'text', text: `${e instanceof RelayError ? e.code : 'internal'}: ${e.message}` }],
});

function tool(name, description, shape, annotations = {}) {
  mcp.registerTool(name, { description, inputSchema: shape, annotations }, async args => {
    try {
      const out = await forward(name, args || {});
      return out instanceof Notice ? { content: [{ type: 'text', text: out.text }] } : asText(out);
    } catch (e) { return asError(e); }
  });
}

const id = z.string().describe('Node id from a week read');
const isoDays = z.array(z.number().int().min(1).max(7)).describe('ISO weekdays, 1 = Monday ... 7 = Sunday');
const readOnly = { readOnlyHint: true };

tool('open_week', 'Show a week in the app (navigation, not an undo step). Required before writing to a week other than the one in view. Creates the week if absent. Returns the week.',
  { week: z.string().regex(/^\d{4}-\d{2}$/).describe('ISO week key YYYY-WW') });
tool('add_task', 'Add a task to the week in view. A label like "Pushups 10x" makes 10 ticks. Pass days for weekdays; never "today"/"tomorrow" in the label. Returns the new task.',
  {
    branch: z.string().describe('Branch id or its exact name'),
    label: z.string(),
    parent: id.optional().describe('Task id to add a sub-task under'),
    days: isoDays.optional(),
    priority: z.enum(['normal', 'high', 'critical']).optional(),
    comment: z.string().optional().describe('Markdown: # heading, - bullet, 1. item, - [ ] checkbox, **bold**, *italic*, [text](https://...)'),
  });
tool('rename_task', 'Rename a task. Day tokens in the label, e.g. "Run (mo, we)", replace its days; "Nx" sets ticks.', { id, label: z.string() });
tool('set_status', 'Mark a task done, undone (reopens done or dropped), dropped (will not happen), unplanned or planned. Cascades to sub-tasks.',
  { id, status: z.enum(['done', 'undone', 'dropped', 'unplanned', 'planned']) });
tool('set_priority', 'Set a task priority (cascades to sub-tasks). Same value is a no-op.', { id, priority: z.enum(['normal', 'high', 'critical']) });
tool('set_days', 'Replace the weekdays of a task. Empty array removes all days. Days remove Nx ticks.', { id, days: isoDays });
tool('tick_task', 'Record n repetitions of an Nx task (negative n reopens the last ones).', { id, n: z.number().int().optional().describe('Default 1') });
tool('set_comment', 'Replace the comment of a task with Markdown (max 20000 chars; links http, https or mailto only).', { id, markdown: z.string() });
tool('set_reusable', 'Mark a task reusable (copied by transfer_reusable to the next week) or not.', { id, on: z.boolean() });
tool('delete_task', 'Delete a task at once. A date of a repeating schedule entry needs scope "occurrence" or "series".',
  { id, scope: z.enum(['occurrence', 'series']).optional() });
tool('send_to_date', 'Move a task out of this week to a date (YYYY-MM-DD), optionally repeating. A one-off date inside the same week just sets its weekday.',
  {
    id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    repeat: z.object({
      every: z.number().int().min(1).optional(),
      unit: z.enum(['day', 'week', 'month', 'year']),
      end: z.object({ type: z.enum(['never', 'count', 'until']), n: z.number().int().min(1).optional(), date: z.string().optional() }).optional(),
    }).optional(),
  });
tool('transfer_unfinished', 'Copy the previous week\'s unfinished tasks into the week in view, as the context menu does.', {});
tool('transfer_reusable', 'Copy the previous week\'s reusable tasks into the week in view.', {});
tool('add_branch', 'Add a branch (category) to the week in view.',
  { label: z.string(), side: z.enum(['left', 'right']).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
tool('undo', 'Undo the last action in the app, whoever made it. Says which action it undid.', {});
tool('redo', 'Redo the last undone action.', {});
tool('get_stats', 'Completion statistics of the week in view.', {}, readOnly);

function resource(name, uri, description, args) {
  mcp.registerResource(name, uri, { description, mimeType: 'application/json' }, async (u, vars) => {
    const data = await forward(args.tool, args.map ? args.map(vars) : {});
    if (data instanceof Notice) return { contents: [{ uri: u.href, mimeType: 'text/plain', text: data.text }] };
    return { contents: [{ uri: u.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  });
}
resource('weeks', 'zenit://weeks', 'Weeks stored on this device with task counts.', { tool: 'read_weeks' });
resource('week-current', 'zenit://week/current', 'The week in view: branches, tasks, days, ticks, status, ids.', { tool: 'read_week' });
resource('week', new ResourceTemplate('zenit://week/{week}', { list: undefined }), 'Any stored week (YYYY-WW).',
  { tool: 'read_week', map: v => ({ week: String(v.week) }) });
resource('schedule', 'zenit://schedule', 'Dated and repeating entries (the Later tab).', { tool: 'read_schedule' });
resource('agenda', new ResourceTemplate('zenit://agenda/{day}', { list: undefined }), 'Agenda of the week in view for ISO day 1-7.',
  { tool: 'read_agenda', map: v => ({ day: parseInt(v.day, 10) }) });

// ── Page side: loopback only ──
// Resolves to the listening server, or null when the port is taken.
function tryListen(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port,
      maxPayload: 4 * 1024 * 1024,
      verifyClient: ({ origin }) => isAllowedOrigin(origin, EXTRA_ORIGINS),
    });
    const failed = e => { wss.close(); if (e.code === 'EADDRINUSE') resolve(null); else reject(e); };
    wss.once('error', failed);
    wss.once('listening', () => { wss.off('error', failed); resolve(wss); });
  });
}

let bound;
try {
  bound = await listenOnFirstFreePort(tryListen);
} catch (e) {
  err(`zenit-week-mcp: cannot listen on 127.0.0.1 (${e.code || e.message})`);
  process.exit(1);
}
if (!bound) {
  err(`zenit-week-mcp: Too many Zenit Week servers running (ports ${PORT_MIN}-${PORT_MAX} are all taken). Quit an agent app you no longer use.`);
  process.exit(1);
}
const { port: PORT, server: wss } = bound;
wss.on('connection', (ws, req) => {
  const tab = relay.onOpen(ws, req.headers.origin);
  ws.on('message', data => relay.onMessage(tab, data.toString()));
  ws.on('close', () => relay.onClose(tab));
  ws.on('error', () => {});
});
wss.on('error', e => err(`zenit-week-mcp: socket server error on 127.0.0.1:${PORT} (${e.code || e.message})`));

await mcp.connect(new StdioServerTransport());
// The agent app is gone when stdin ends. Exit then, or the orphaned copy would
// keep its port of the range for good.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
err(`zenit-week-mcp: listening on ws://127.0.0.1:${PORT}`);
