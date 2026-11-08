#!/usr/bin/env node
// zenit-week-mcp - lets an MCP client (Claude Code, Claude Desktop, ...) act on
// an open Zenit Week tab. MCP over stdio on one side, a loopback-only WebSocket
// on the other; the page does every read and write itself.
//
//   zenit-week-mcp            run the server (what the MCP client launches)
//   zenit-week-mcp pair       print the pairing code again and copy it
//   zenit-week-mcp rotate     make a new code; every paired tab must re-pair
//   options: --port <n>  --open (launch the app when no tab is connected)
//
// stdout belongs to the MCP protocol: everything human-readable goes to stderr.
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  DEFAULT_PORT, OPEN_WAIT_MS, Relay, RelayError, isAllowedOrigin, loadOrCreateToken,
  pairingCode, tokenPath, urisForWeekSaved,
} from './core.js';

const APP_URL = 'https://zenitweek.com/app';
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? parseInt(argv[portArg + 1], 10) : DEFAULT_PORT;
const OPEN = argv.includes('--open');
const err = (...a) => process.stderr.write(a.join(' ') + '\n');

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) { err('zenit-week-mcp: --port must be 1-65535'); process.exit(2); }

function copyToClipboard(text) {
  const tool = process.platform === 'darwin' ? ['pbcopy', []]
    : process.platform === 'win32' ? ['clip', []]
    : ['xclip', ['-selection', 'clipboard']];
  try {
    const p = spawn(tool[0], tool[1], { stdio: ['pipe', 'ignore', 'ignore'] });
    p.on('error', () => {});
    p.stdin.end(text);
    return true;
  } catch (_) { return false; }
}

function announceCode(token, out) {
  const code = pairingCode(PORT, token);
  copyToClipboard(code);
  out(`Zenit Week pairing code (copied to the clipboard):\n\n  ${code}\n`);
  out('Paste it in Zenit Week: Settings > Agent bridge. Your browser will ask to let');
  out('Zenit Week reach apps on this computer - choose Allow (Firefox: also tick "Remember").');
}

if (cmd === 'pair' || cmd === 'rotate') {
  const { token } = loadOrCreateToken(tokenPath(), { rotate: cmd === 'rotate' });
  if (cmd === 'rotate') console.log('New code made; every paired tab has to be paired again.\n');
  announceCode(token, s => console.log(s));
  process.exit(0);
}
if (cmd !== 'serve') { err(`zenit-week-mcp: unknown command "${cmd}"`); process.exit(2); }

const { token, created } = loadOrCreateToken(tokenPath());
if (created) announceCode(token, err);

// ── MCP side ──
const mcp = new McpServer(
  { name: 'zenit-week', version: '0.1.0' },
  {
    capabilities: { resources: { subscribe: true } },
    instructions: [
      'Zenit Week is a weekly planner shown as a mind map: branches (categories) hold tasks, tasks may hold sub-tasks.',
      'All writes act on the week open in the app, exactly as if the user clicked; each call is one undo step and shows the user a toast.',
      'Read zenit://week/current (or call get_stats) first to learn branch and task ids. Use open_week to switch weeks before writing to another week.',
      'Days are ISO weekdays: 1 = Monday ... 7 = Sunday. A label ending in "Nx" (e.g. "Pushups 10x") makes N ticks recorded with tick_task; days and Nx do not combine.',
      'Never put relative days (today, tomorrow) in labels: pass days instead.',
    ].join(' '),
  },
);

const subscriptions = new Set();
mcp.server.setRequestHandler(SubscribeRequestSchema, async req => { subscriptions.add(req.params.uri); return {}; });
mcp.server.setRequestHandler(UnsubscribeRequestSchema, async req => { subscriptions.delete(req.params.uri); return {}; });

const relay = new Relay({
  token,
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

async function forward(tool, args) {
  if (!relay.pickTab() && OPEN) {
    openApp();
    await relay.waitForTab(OPEN_WAIT_MS);
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
    try { return asText(await forward(name, args || {})); } catch (e) { return asError(e); }
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
const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  maxPayload: 4 * 1024 * 1024,
  verifyClient: ({ origin }) => isAllowedOrigin(origin),
});
wss.on('connection', ws => {
  const tab = relay.onOpen(ws);
  ws.on('message', data => relay.onMessage(tab, data.toString()));
  ws.on('close', () => relay.onClose(tab));
  ws.on('error', () => {});
});
wss.on('error', e => {
  err(`zenit-week-mcp: cannot listen on 127.0.0.1:${PORT} (${e.code || e.message}). Is another copy running?`);
  process.exit(1);
});

await mcp.connect(new StdioServerTransport());
err(`zenit-week-mcp: listening on ws://127.0.0.1:${PORT}`);
