# SPEC - Agent Bridge (local MCP server, "Door 3")

> Status: Draft for discussion
> Scope: a device-local channel that lets a general-purpose AI agent (Claude Code, Claude Desktop, any MCP client) read and change Zenit Week data through the app's own actions. Touches `zenit-week.html` (bridge client, Settings, CSP) and adds one tooling package under `mcp/`. No data-model change.

---

## 1. Objective

Let the user say to an agent running on their computer "plan my week from this email", "mark the gym done", "what is still open on Thursday" and have it act on the real app, with every invariant the app enforces (cascades, `_ts` / `_posTs` stamps, day leaves, counter magic, undo, Drive sync) applied exactly as if the user had clicked.

**The agent never touches `weekData`.** It calls named verbs; the page executes them with the same functions the UI uses.

**Success:** with the app open in one desktop tab and the bridge enabled, an MCP client lists the tools, reads the current week as structured JSON, adds a task with weekdays and a counter, marks another done, and the change shows up on the user's phone through Drive sync within the normal poll interval, with one undo entry per agent call and a toast saying what the agent did.

### Non-goals

| # | Excluded | Why |
|---|---|---|
| 1 | Reaching the app on a phone from a computer | A phone's browser cannot connect to another machine's loopback, and exposing the bridge on the LAN would mean plaintext secrets on a shared network. The phone is served by Drive sync (section 8). |
| 2 | Agents running elsewhere (Claude mobile app, a cloud agent) | They have no local process to host the server. That is "Door 1" (Drive as the bus) and a separate spec. |
| 3 | Writing to a week that is not in view | Would need a second mutation path that bypasses render and undo. The agent calls `open_week` first; one path for every write. |
| 4 | Letting the agent run arbitrary JavaScript in the page | The whole point is a typed verb surface. No `eval` tool, ever. |
| 5 | Headless "always on" host | Attractive (agent works with the browser closed) but needs a signed-in headless profile. Listed as a future option in section 10, not v1. |
| 6 | Replacing Drive sync or merging in the server | `sw.js` rules apply: no CRDT, hashing or layout outside `zenit-week.html`. The server is a dumb relay plus MCP framing. |

---

## 2. Topology

```
 MCP client (Claude Code, Claude Desktop, ...)
      | stdio, MCP protocol
 zenit-week-mcp  (Node process, lives in mcp/)
      | WebSocket, 127.0.0.1:<port>, loopback only
 zenit-week.html tab(s)  (the page is the WebSocket *client*)
      | existing: saveWeek -> IndexedDB + BroadcastChannel + Drive upload
 other tabs, other devices (phone) via Drive
```

Direction matters: the page connects outward. The server never pushes anything into a page that did not open the socket and present a valid pairing token. The server binds loopback only; it is never reachable from another host.

Why the page and not a browser extension or CDP: the page already knows how to act on itself, the extension would be a third exception to the single-file policy, and CDP needs a debugging port that exposes every tab.

---

## 3. Opt-in and pairing

Off by default on every device. Nothing connects anywhere until the user turns it on.

| # | Element | Behaviour |
|---|---|---|
| 1 | Settings section "Agent bridge" | Below Theme. A toggle, a pairing-code field, a status line. Reuses `.settings-section`, `.settings-label`, `.dialog-field`, `.agenda-action-btn`. |
| 2 | Pairing code | The server prints a one-line code on first start (`port.token`, token 32 random bytes base64url) and copies it to the clipboard. The user pastes it into the field. The page stores it and connects. This is the single pairing mechanism; no URL-hash variant. |
| 3 | Storage | `zenit-week-bridge` in `localStorage`: `{ enabled, port, token }`. **Device-local, never in the synced colors/settings blob.** A phone must never learn the desktop's token or try to connect. |
| 4 | Status line | `Off` / `Waiting for server` / `Connected - <client name>` / `Refused (wrong code)`. Driven by socket state and the `hello` reply. |
| 5 | Forget | A "Disconnect and forget" button clears the record and closes the socket. Sign-out and reset (`reloadAppFresh`) also clear it. |

The server keeps its token in `~/.config/zenit-week-mcp/token` (0600). `zenit-week-mcp pair` prints the code again; `zenit-week-mcp rotate` makes a new one, which invalidates every paired tab.

---

## 4. Security model

| # | Threat | Control |
|---|---|---|
| 1 | Any website on the machine opens `ws://127.0.0.1:<port>` and issues commands | Server checks the `Origin` header against an allowlist: `https://zenitweek.com`, `https://www.zenitweek.com`, `http://localhost:*`, `http://127.0.0.1:*`. Then requires the pairing token in the first frame within 2 s or closes. |
| 2 | A rogue local process listens on the port and the page hands it the week | The page sends the token only after the server proves knowledge of it: the server's first frame carries `HMAC(token, nonce-from-page)`; the page verifies before sending anything else. Mutual, cheap, no TLS. |
| 3 | Token in browser history or URLs | Never in a URL. Pasted into a field, stored in `localStorage` only. |
| 4 | Agent escalates beyond the verb surface | No eval tool. Every tool has a JSON schema; unknown tool or malformed args is rejected by the page, not only by the server. |
| 5 | Agent writes unsafe content | Labels and comments pass through the same code as typed input: `textContent` everywhere, `tokenizeComment` round-trip for comments, `isSafeCommentUrl` for links. Nothing new to audit. |
| 6 | Runaway agent | Server-side budget: at most 20 write calls in flight, 200 per minute. Page-side: each write is one `beginAtomicOp` / `endAtomicOp` section, so a Drive merge never interleaves with a half-applied call. |

**CSP.** `connect-src` gains `ws://127.0.0.1:* ws://localhost:*`. The comment at the avatar-photo code (line ~8520) states the stance against widening `connect-src`; loopback is the one widening that cannot reach the network. Run `npm run csp` after the inline-script edit.

**Mixed content.** Chrome, Edge and Firefox treat loopback as a potentially trustworthy origin, so a `ws://127.0.0.1` socket from the `https://zenitweek.com` page is allowed. Safari does not grant that exception as of this writing; Safari is unsupported for the bridge in v1 and the status line says so. (To verify in Safari before closing the spec.)

---

## 5. Network-policy compliance

The project rule is "Drive sync only, never blocking startup". The bridge respects it as follows:

| # | Rule | Implementation |
|---|---|---|
| 1 | Never blocks boot | The client starts from a `requestIdleCallback` after the first render, only when `enabled` is true. |
| 2 | Silent when the server is down | Reconnect with backoff 1 s to 30 s, capped, no toast. The Settings status line is the only signal. |
| 3 | Pauses when hidden | On `visibilitychange` to hidden the socket stays open but the page sends `pause`; the server routes to another visible tab if one exists. |
| 4 | Loopback only | `ws://` to `127.0.0.1` or `localhost`; the client refuses any other host even if the stored record is tampered with. |
| 5 | Off is off | With `enabled: false` the bridge code path is never entered; no socket object is created. |

---

## 6. Wire protocol (page <-> server)

JSON text frames, one object per frame. `id` correlates a request and its reply.

| # | Frame | Direction | Fields |
|---|---|---|---|
| 1 | `challenge` | page -> server | `nonce` |
| 2 | `proof` | server -> page | `hmac` (HMAC-SHA256 of nonce with token, base64url), `client` (MCP client name if known) |
| 3 | `hello` | page -> server | `token`, `tabId`, `appVersion`, `week` (in view), `lang`, `visible` |
| 4 | `call` | server -> page | `id`, `tool`, `args` |
| 5 | `result` | page -> server | `id`, `ok: true`, `data` |
| 6 | `result` | page -> server | `id`, `ok: false`, `error: { code, message }` |
| 7 | `event` | page -> server | `type: 'week-saved' | 'view' | 'focus' | 'pause'`, plus `wk`, `sig` where relevant |

`week-saved` is forwarded from the existing `tabChannel` post sites (both `saveWeek` and the Drive merge path), so the server learns about every change from any origin: user, other tab, Drive. The server turns it into MCP `notifications/resources/updated` for subscribed clients.

Error codes: `no_app_tab`, `unknown_tool`, `bad_args`, `not_found` (node id), `wrong_type` (e.g. tick on a non-counter), `week_locked` (atomic op or week lock busy, retry), `refused` (pairing).

---

## 7. MCP surface

### 7.1 Resources (read, any week, no view change)

Reads call `loadWeekIDB(wk)` and serialize; they never switch the view and never touch `weekData`.

| # | URI | Content |
|---|---|---|
| 1 | `zenit://weeks` | List of week keys present in IndexedDB with node counts and completion. |
| 2 | `zenit://week/current` | The week in view, as section 7.3. |
| 3 | `zenit://week/{YYYY-WW}` | Any stored week, same shape. |
| 4 | `zenit://schedule` | The `schedule` record (Later tab) as the `schedule` skill documents it. |
| 5 | `zenit://agenda/{YYYY-WW}/{1-7}` | That day's agenda rows in render order: Scheduled, Done, Any day, Dropped. Same grouping `buildAgendaItem` uses. |

### 7.2 Tools

Every write targets the week in view, runs inside `beginAtomicOp` / `endAtomicOp`, pushes exactly one undo entry, goes through `saveWeek`, and shows a toast `Agent: <summary>`. "Maps to" names the existing function so no second mutation path is written.

| # | Tool | Args | Maps to | Notes |
|---|---|---|---|---|
| 1 | `open_week` | `week` | `openWeekIntoView` | Required before writing a non-current week. Creates the week if absent, like the week bar does. |
| 2 | `add_task` | `branch`, `label`, `parent?`, `days?`, `priority?`, `comment?` | `childActivityOf` + `applyMagicLabel` + `setActivityDays` | Label magic applies: `Pushups 10x` creates the counter. `days` is an array of 1-7 and becomes day leaves. Returns the new id (and counter id). |
| 3 | `rename_task` | `id`, `label` | `commitEdit` path | Re-runs magic label like the editor does. |
| 4 | `set_status` | `id`, `status` in `done, undone, dropped, unplanned, planned` | `setStatus` | Cascades, timestamps, mutual exclusion all inherited. `undone` is the way back from both closed states. |
| 5 | `set_priority` | `id`, `priority` in `normal, high, critical` | `cyclePriority` target or its setter | Cascades to descendants. |
| 6 | `set_days` | `id`, `days` | `setActivityDays` | Keeps leaves of kept days, buries removed ones. |
| 7 | `tick_counter` | `id`, `n` (default 1, may be negative) | counter increment path | Appends `ticks` timestamps, auto-done at max. |
| 8 | `set_comment` | `id`, `markdown` | comment save path | Rejected unless `tokenizeComment` then `serializeComment` reproduces the input byte for byte. Links filtered by `isSafeCommentUrl`. |
| 9 | `set_reusable` | `id`, `on` | `toggleReusableNode` | Idempotent wrapper. |
| 10 | `delete_task` | `id` | `deleteNode` | Deletes at once, no question, like every other entry point. Occurrence exception per the `schedule` skill. |
| 11 | `send_to_date` | `id`, `date`, `repeat?` | `sendNodeToDate` | Same options object the Reschedule dialog builds. |
| 12 | `transfer_unfinished` / `transfer_reusable` | none | `transferUnfinished` / `transferReusable` | Act on the week in view exactly as the context menu does. |
| 13 | `add_branch` | `label`, `side?`, `color?` | `addBranch` + `applyBranchColor` | |
| 14 | `undo` / `redo` | none | `undo` / `redo` | Lets the agent back out its own last step; the user keeps the same stack. |
| 15 | `get_stats` | `week?` | `computeWeekStats` | Read-only but needs the page's code, so it is a tool, not a resource. |

Not offered in v1: moving or reordering nodes (layout only), colour changes beyond `add_branch`, language or theme, Drive sign-in, import/export.

### 7.3 Week JSON shape (as returned to the agent)

A projection of `weekData`, not the raw record. Internal stamps (`_ts`, `_posTs`, `_demo`, `_editing`, `offX`, `offY`, `side`) are omitted; day leaves are folded into a `days` array on the task, which is how the editor shows them. Every node keeps its `id`, since ids are what write tools take.

```
{ week: "2026-45", label: "Week 45", range: "2026-11-02/2026-11-08",
  branches: [{ id, label, color, tasks: [
    { id, label, days: [1,3], priority, done, dropped, unplanned, reusable,
      doneAt, droppedAt, comments, counter: { id, val, max } | null,
      children: [ ...same shape... ] } ] }] }
```

Tool results return the affected node in the same shape so the agent does not need a second read.

---

## 8. Mobile

The user plans on a phone as well. What the bridge means for that:

| # | Situation | What happens |
|---|---|---|
| 1 | Agent edits on the desktop while the phone has the app open | `saveWeek` uploads to Drive; the phone's change feed sees it on its next poll (`POLL_INTERVAL_MS`, 10 s, when visible) and merges with `mergeWeekData`. Same path as any two devices today. |
| 2 | Phone and agent edit the same week at once | Existing CRDT: last `_ts` per node wins, tombstones union. Agent writes are stamped by `touchNode` inside the app functions, so they are first-class peers, not overrides. |
| 3 | Phone app has bridge enabled | Impossible by construction: the record is device-local and the phone never received a code. Settings on the phone show the section with the toggle off; turning it on and pasting nothing does nothing. Consider hiding the section on touch-only devices to avoid confusion. |
| 4 | User talks to Claude on the phone and wants the week changed | Not covered by this door. Needs Door 1 (Drive as bus) or the headless host (section 10). The spec should say so in the Help panel text for the feature. |
| 5 | No desktop tab is open when the agent calls | The server answers `no_app_tab` with a hint. With `--open` the server launches the app URL in the default browser and waits up to 15 s for a `hello`. |

Net: for the mobile user the bridge is "the desktop is where the agent works; the phone follows through Drive." That is the honest v1 and it needs no new sync code.

---

## 9. Repository layout and build

| # | Where | What |
|---|---|---|
| 1 | `zenit-week.html` | Bridge client (connect, challenge, dispatch table, projection to 7.3), Settings section, i18n keys `bridge.*` in EN and CS, CSP change. Stays inside the single file. |
| 2 | `mcp/server.js`, `mcp/package.json` | The MCP server: `@modelcontextprotocol/sdk` over stdio, `ws` listener on loopback, origin and token checks, tool and resource schemas, forwarding. Tooling, like `scripts/`, not part of the app. Publishable later as `npx zenit-week-mcp`. |
| 3 | `tests/agent-bridge.test.js` | Page side: challenge and proof, refusal of non-loopback hosts, every tool dispatches to the named function with a fake socket, one undo entry per call, projection omits internal stamps. |
| 4 | `tests/mcp-server.test.js` | Server side: origin allowlist, token timeout, rate budget, `no_app_tab`, resource update notification on `week-saved`. |
| 5 | `docs/` and Help panel | One paragraph: what it is, that it is desktop-only, how to pair, how to forget. |

Client configuration for the user (Claude Code example): one `claude mcp add zenit-week -- node mcp/server.js` line in the README.

---

## 10. Future options, explicitly out of v1

| # | Option | Unlocks | Cost |
|---|---|---|---|
| 1 | Headless host mode (`zenit-week-mcp --headless`) | Agent works with no browser window open | A persistent Playwright profile signed in to Drive; sign-in UX in headless; keeping the profile alive. |
| 2 | Door 1, Drive as the bus | Phone-only users, cloud agents | Reuse the app's OAuth client and `/api/token`; run `mergeWeekData` in Node via the test harness loader. |
| 3 | Write to a week not in view | Fewer `open_week` round trips | A second mutation path; probably never worth it. |

---

## 11. Acceptance criteria

- [ ] Bridge off: no socket is created, no CSP change is exercised, boot timing unchanged.
- [ ] Pairing: wrong code shows `Refused`, right code shows `Connected` within 1 s; forgetting clears the record.
- [ ] Origin check: a page served from any origin outside the allowlist is closed before `hello`.
- [ ] Every tool in 7.2 is covered by a test that asserts the mapped app function ran and exactly one undo entry was pushed.
- [ ] `add_task` with `Pushups 10x` and days `[1,3,5]` produces one activity, one counter, three day leaves, visible in map and agenda without reload.
- [ ] `set_comment` with invalid grammar is refused and the node is untouched.
- [ ] A write while a Drive merge is in flight returns `week_locked` and leaves `weekData` consistent.
- [ ] `week-saved` from the user, from a second tab and from Drive each produce one resource update notification.
- [ ] Phone with the app visible shows an agent-added task within one poll interval.
- [ ] `npm test`, `npm run validate`, `npm run csp` clean; no em dash anywhere.

---

## 12. Open questions

| # | Question | Leaning |
|---|---|---|
| 1 | Fixed default port or ephemeral? | Fixed default (e.g. 47831) so the pairing code is short and stable; `--port` to override. CSP uses the port wildcard either way. |
| 2 | Hide the Settings section on phones? | Yes, when no `(pointer: fine)` match; it can only confuse there. |
| 3 | Should agent writes be visually marked on the map for a few seconds? | A brief highlight pulse on affected nodes reusing the existing drop-target highlight style, plus the toast. Cheap and makes the agent's work legible. |
| 4 | Safari | Confirm the loopback mixed-content behaviour on current Safari before deciding whether to document it as unsupported or to offer a `wss` option with a local certificate. |
