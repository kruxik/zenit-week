#!/usr/bin/env node
// zenit-week-mcp - lets an MCP client (Claude Code, Claude Desktop, ...) act on
// an open Zenit Week tab. MCP over stdio on one side, a loopback-only WebSocket
// on the other; the page does every read and write itself.
//
//   zenit-week-mcp                  run the server (what the MCP client launches)
//   zenit-week-mcp unpair <site>    forget a site's pairing (an origin or a host name)
//   zenit-week-mcp unpair --all     forget every pairing
//   zenit-week-mcp origins list | add <https-url> | remove <site>
//                                   the sites besides the built-in ones, e.g. an ngrok dev tunnel
//   options: --open (launch the last used site when no tab is connected)
//
// Each copy listens on the first free port of 47831-47838, so every agent app
// can run its own; the page connects to all of them.
//
// stdout belongs to the MCP protocol: everything human-readable goes to stderr.
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ErrorCode, ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema,
  McpError, ReadResourceRequestSchema, SubscribeRequestSchema, UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  BUILT_IN_SITES, OPEN_WAIT_MS, PORT_MIN, PORT_MAX, STARTUP_GRACE_MS, Relay, RelayError,
  addOrigin, appBundleOf, appMatches, browserHint, appName, filePairings, formatPairCode, isAllowedOrigin, lastUsedSite,
  listenOnFirstFreePort, matchSite, updateNote, pairingsPath, peerPidFromLsof, readOrigins, removeOrigin, routeWarning, urisForWeekSaved,
  LIST_CHANGED_NOTE, listedTool, manifestNeeds, matchResource, mergeManifests, readManifestCache, validateManifest, writeManifestCache,
} from './core.js';

const { version: VERSION } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';
const OPEN = argv.includes('--open');
const err = (...a) => process.stderr.write(a.join(' ') + '\n');
if (argv.includes('--allow-origin')) {
  err('zenit-week-mcp: --allow-origin is gone. Add the site once with: zenit-week-mcp origins add <https-url>');
  process.exit(2);
}

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
if (cmd === 'origins') {
  const [sub, value] = argv.slice(1);
  if (sub === 'list' || !sub) {
    console.log('Built in:');
    BUILT_IN_SITES.forEach(o => console.log(`  ${o}`));
    const added = readOrigins();
    console.log(added.length ? 'Added:' : 'Added: none');
    added.forEach(o => console.log(`  ${o}`));
  } else if (sub === 'add') {
    const o = addOrigin(value);
    if (!o) { err('zenit-week-mcp: origins add needs an https URL, for example https://abc.ngrok-free.app'); process.exit(2); }
    console.log(`Added ${o}. Every Zenit Week server on this computer accepts it now. Open it, turn on AI agents and approve your agent once.`);
  } else if (sub === 'remove') {
    if (!value) { err('zenit-week-mcp: origins remove needs a site'); process.exit(2); }
    console.log(removeOrigin(value) ? `Removed ${value}.` : `${value} was not added.`);
  } else {
    err(`zenit-week-mcp: unknown origins command "${sub}" (list, add, remove)`);
    process.exit(2);
  }
  process.exit(0);
}
if (cmd !== 'serve') { err(`zenit-week-mcp: unknown command "${cmd}"`); process.exit(2); }

// Which update hint the page shows on a protocol mismatch (setup spec 4.5,
// row 4). The Claude Desktop extension says so in its manifest's env.
const INSTALL = process.env.ZENIT_WEEK_MCP_INSTALL === 'mcpb' ? 'mcpb'
  : /[\\/]_npx[\\/]/.test(fileURLToPath(import.meta.url)) ? 'npx' : 'repo';

// ── Tools: defined by the page (docs/specs/mcp-updates.md section 3) ──
// At start: the cached manifest of the site used last, else the baseline
// bundled with the package. A connected tab's manifest replaces it, and the
// client hears tools/list_changed. Instructions are fixed for the session.
const BASELINE = validateManifest(JSON.parse(readFileSync(new URL('./baseline-manifest.json', import.meta.url), 'utf8')));
if (!BASELINE) { err('zenit-week-mcp: the bundled baseline-manifest.json fails its own check'); process.exit(1); }
const START = readManifestCache(lastUsedSite(pairings.list())) || BASELINE;
let registry = mergeManifests(START);
let listChangedNote = false;

const mcp = new Server(
  { name: 'zenit-week', version: VERSION },
  {
    capabilities: { tools: { listChanged: true }, resources: { subscribe: true, listChanged: true } },
    instructions: START.instructions,
  },
);

const subscriptions = new Set();
mcp.setRequestHandler(SubscribeRequestSchema, async req => { subscriptions.add(req.params.uri); return {}; });
mcp.setRequestHandler(UnsubscribeRequestSchema, async req => { subscriptions.delete(req.params.uri); return {}; });

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A tab sent its tools: cache them for its site, re-register, tell the client.
function onManifest(tab, m) {
  if (readManifestCache(tab.origin)?.manifestVersion !== m.manifestVersion) {
    try { writeManifestCache(tab.origin, m); } catch (e) { err(`zenit-week-mcp: cannot cache the manifest (${e.code || e.message})`); }
  }
  const { unknownHooks, newerServer } = manifestNeeds(m, VERSION);
  if (unknownHooks.length || newerServer) {
    err(`zenit-week-mcp: ${appName(tab.origin)} wants a newer server (${[newerServer && `needs ${m.minServer}`, ...unknownHooks].filter(Boolean).join(', ')}); its tools run without that`);
  }
  const next = mergeManifests(START, relay.manifestTabs().map(t => t.manifest));
  const toolsChanged = !sameJson(next.tools, registry.tools);
  const resourcesChanged = !sameJson(next.resources, registry.resources);
  registry = next;
  if (toolsChanged) { listChangedNote = true; mcp.sendToolListChanged().catch(() => {}); }
  if (resourcesChanged) mcp.sendResourceListChanged().catch(() => {});
}

const relay = new Relay({
  pairings,
  install: INSTALL,
  version: VERSION,
  clientName: () => mcp.getClientVersion()?.name || null,
  log: s => err(`zenit-week-mcp: ${s}`),
  onManifest,
  // A subscription may name its app (`?app=`); it hears only that app's saves.
  onWeekSaved: (wk, tab) => {
    const touched = new Set(urisForWeekSaved(wk, tab.week));
    for (const uri of subscriptions) {
      const { base, app } = splitAppQuery(uri);
      if (touched.has(base) && appMatches(app, tab.origin)) mcp.sendResourceUpdated({ uri }).catch(() => {});
    }
  },
});

// `zenit://week/current?app=x` -> base URI and app name.
function splitAppQuery(uri) {
  const i = String(uri).indexOf('?');
  if (i < 0) return { base: String(uri), app: null };
  return { base: uri.slice(0, i), app: new URLSearchParams(uri.slice(i + 1)).get('app') };
}

// --open launches the site of the pairing used last, else production.
function openApp() {
  const url = `${lastUsedSite(pairings.list())}/app`;
  const [c, a] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try { spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch (_) { /* no opener */ }
}

const STARTED_AT = Date.now();

// A result the agent should read out rather than treat as a failure: the
// pairing code, or what the user has to do first (setup spec 4.2, row 2).
class Notice { constructor(text) { this.text = text; } }

const NOT_PAIRED = (code, app) => `Not connected yet. ${app} shows a request with the code ${formatPairCode(code)}. `
  + 'Ask the user to check that the code matches and click Allow there, then call again. Do not retry before the user confirms.';
const PAIR_NOTICES = {
  hidden: 'Zenit Week is open but not in front. Ask the user to bring the Zenit Week tab to the front, then ask again.',
  busy: 'Zenit Week is showing another approval request. Ask the user to answer it, then ask again.',
  failed: 'Pairing with Zenit Week broke off. Ask again to start a new request.',
  denied: 'The user did not allow this agent in Zenit Week. Ask again only if the user wants to connect.',
  timeout: 'Nobody answered the request in Zenit Week. Ask again to show a new code.',
  closed: 'The Zenit Week tab closed during pairing. Ask again once it is open.',
};

// Pairing on the agent's first request (setup spec 4.1, step 3). The code comes
// back as a normal result at once, so the agent says it in its own reply and the
// user can compare it with the one in Zenit Week; the pairing itself completes
// in the app, and the agent calls again once the user confirms.
async function pairFirst(app) {
  const p = await relay.requestPairing(app);
  if (p.kind === 'no_tab') return null;
  if (p.kind !== 'pairing') return new Notice(PAIR_NOTICES[p.kind] || PAIR_NOTICES.failed);
  return new Notice(NOT_PAIRED(p.code, p.app));
}

// Runs a call on the app the agent named, or the focused tab, and says which
// app that was: `{ app, warning, data }`, or a Notice.
async function forward(tool, args, app = null) {
  if (!relay.pickTab(app)) {
    if (!relay.hasAnyTab()) {
      if (OPEN) openApp();
      const grace = STARTUP_GRACE_MS - (Date.now() - STARTED_AT);
      const wait = Math.max(OPEN ? OPEN_WAIT_MS : 0, grace);
      if (wait > 0) await relay.waitForTab(wait);
    }
    if (!relay.pickTab(app)) {
      const notice = await pairFirst(app);
      if (notice) return notice;
    }
  }
  const tab = relay.pickTab(app);
  const data = await relay.call(tool, args, { app });
  const name = tab ? appName(tab.origin) : null;
  return { app: name, warning: app ? null : routeWarning(relay.openApps(), name), data, tab };
}

const run = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, { timeout: 3000 }, (e, stdout) => resolve(e ? null : String(stdout)));
});

// Hook `raise-browser` (show_task): the browser holding the tab comes to the
// front. macOS only: the application that owns the tab's socket, else the
// page's hint by name (Safari runs its sockets outside Safari.app). Says
// whether it could.
async function raiseBrowser(tab, hint) {
  if (process.platform !== 'darwin') return false;
  let bundle = null;
  if (tab && tab.peerPort) {
    const lsof = await run('lsof', ['-nP', `-iTCP:${tab.peerPort}`, '-sTCP:ESTABLISHED', '-Fp']);
    const pid = lsof && peerPidFromLsof(lsof, process.pid);
    if (pid) bundle = appBundleOf(await run('ps', ['-o', 'comm=', '-p', String(pid)]));
  }
  const target = bundle || browserHint(hint);
  if (!target) return false;
  return (await run('open', ['-a', target])) !== null;
}

// The server's work after a tool, by the hook its manifest entry names. An
// unknown hook is skipped: the user loses the extra, never the tool.
const TOOL_HOOKS = {
  'raise-browser': async out => {
    const { browser, ...data } = out.data || {};
    return { ...out, data: { ...data, raised: await raiseBrowser(out.tab, browser) } };
  },
};

// The first result of a session whose server is behind the latest release
// carries `update`, once (mcp-updates.md 5.2, row 3): the agent passes it on.
let updateNoted = false;
function takeUpdateNote(tab) {
  if (updateNoted || !tab) return null;
  const note = updateNote({ version: VERSION, latest: tab.serverLatest, install: INSTALL });
  if (note) updateNoted = true;
  return note;
}

// Every result carries `app` (setup spec section 6, row 6), plus the warning
// when the agent named no app and several are open, and the one-time notes.
function labelled({ app, warning, data, tab }, { tool = false } = {}) {
  const head = warning ? { app, warning } : { app };
  const update = takeUpdateNote(tab);
  if (update) head.update = update;
  // New tools mid-session: some clients ignore list_changed (section 3.4, row 4).
  if (tool && listChangedNote) { head.notice = LIST_CHANGED_NOTE; listChangedNote = false; }
  return data && typeof data === 'object' && !Array.isArray(data) ? { ...head, ...data } : { ...head, result: data };
}

const asText = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const asError = e => ({
  isError: true,
  content: [{ type: 'text', text: `${e instanceof RelayError ? e.code : 'internal'}: ${e.message}` }],
});

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.tools.map(listedTool) }));

// Any name is forwarded: a tool the app lacks answers unknown_tool from the
// page, which says whether to reload the app or update the server.
mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const name = String(req.params.name || '');
  try {
    const raw = req.params.arguments;
    const { app, ...rest } = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = await forward(name, rest, typeof app === 'string' && app ? app : null);
    if (out instanceof Notice) return { content: [{ type: 'text', text: out.text }] };
    const hook = TOOL_HOOKS[registry.tools.find(t => t.name === name)?.hook];
    return asText(labelled(hook ? await hook(out) : out, { tool: true }));
  } catch (e) { return asError(e); }
});

mcp.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: registry.resources.filter(r => r.uri).map(r => ({ uri: r.uri, name: r.name, description: r.description, mimeType: 'application/json' })),
}));
mcp.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: registry.resources.filter(r => r.uriTemplate)
    .map(r => ({ uriTemplate: r.uriTemplate, name: r.name, description: r.description, mimeType: 'application/json' })),
}));

// Every resource takes `?app=<name>` (setup spec section 6, row 5). Hook `apps`
// is answered by the server: the app tabs connected to it.
mcp.setRequestHandler(ReadResourceRequestSchema, async req => {
  const uri = String(req.params.uri);
  const hit = matchResource(registry.resources, uri);
  if (!hit) throw new McpError(ErrorCode.InvalidParams, `unknown resource ${uri}`);
  const json = data => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] });
  if (hit.resource.hook === 'apps') return json(relay.listApps());
  if (!hit.resource.tool) throw new McpError(ErrorCode.InvalidParams, `${uri} needs a newer Zenit Week server`);
  const out = await forward(hit.resource.tool, hit.args, hit.app);
  if (out instanceof Notice) return { contents: [{ uri, mimeType: 'text/plain', text: out.text }] };
  return json(labelled(out));
});

// ── Page side: loopback only ──
// Resolves to the listening server, or null when the port is taken.
function tryListen(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port,
      maxPayload: 4 * 1024 * 1024,
      // The added sites are read on every connection: `origins add` needs no restart.
      verifyClient: ({ origin }) => isAllowedOrigin(origin, readOrigins()),
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
  tab.peerPort = req.socket.remotePort; // show_task finds the browser by it
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
