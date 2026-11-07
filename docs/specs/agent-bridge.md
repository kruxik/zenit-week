# SPEC - Agent Bridge (local MCP server, "Door 3")

> Status: Draft for discussion, revision 3 (second code review folded in: tick model, merge race, exact mappings)
> Scope: a device-local channel that lets a general-purpose AI agent (Claude Code, Claude Desktop, any MCP client) read and change Zenit Week data through the app's own actions. Touches `zenit-week.html` (bridge client, Settings, CSP, a few small extractions so the bridge and the UI share one path) and adds one tooling package under `mcp/`. No data-model change.

---

## 1. Objective

Let the user say to an agent running on their computer "plan my week from this email", "mark the gym done", "what is still open on Thursday" and have it act on the real app, with every invariant the app enforces (cascades, `_ts` / `_posTs` stamps, day leaves, `Nx` tick magic, undo, Drive sync) applied exactly as if the user had clicked.

**The agent never touches `weekData`.** It calls named verbs; the page executes them with the same functions the UI uses.

**The agent is a user, not a new kind of writer.** Every rule below follows from that one sentence: one call is one user action, it lands in the same undo stack, it is stamped, saved, synced and merged like a click, and it meets the same guards a click meets. Where the UI has no single function for what a tool does, the fix is to extract one that both the UI and the bridge call ("one way per action") - never a bridge-only copy.

**Success:** with the app open in one desktop tab and the bridge enabled, an MCP client lists the tools, reads the current week as structured JSON, adds a task with weekdays and another with an `Nx` count, records a tick, marks a task done, and the change shows up on the user's phone through Drive sync within the normal poll interval, with exactly one undo entry per agent call and a toast saying what the agent did.

### Non-goals

| # | Excluded | Why |
|---|---|---|
| 1 | Reaching the app on a phone from a computer | A phone's browser cannot connect to another machine's loopback, and exposing the bridge on the LAN would mean plaintext secrets on a shared network. The phone is served by Drive sync (section 9). |
| 2 | Agents running elsewhere (Claude mobile app, a cloud agent) | They have no local process to host the server. That is "Door 1" (Drive as the bus) and a separate spec. |
| 3 | Writing to a week that is not in view | Would need a second mutation path that bypasses render and undo. The agent calls `open_week` first; one path for every write. |
| 4 | Reading derived views (agenda, stats) of a week that is not in view | `computeWeekStats` and the agenda grouping read the global `weekData`. Making them pure is a refactor of its own. The agent opens the week first, as the user would. Raw week data of any week stays readable (section 8.1). |
| 5 | Letting the agent run arbitrary JavaScript in the page | The whole point is a typed verb surface. No `eval` tool, ever. |
| 6 | Headless "always on" host | Attractive (agent works with the browser closed) but needs a signed-in headless profile. Listed as a future option in section 11, not v1. |
| 7 | Replacing Drive sync or merging in the server | `sw.js` rules apply: no CRDT, hashing or layout outside `zenit-week.html`. The server is a dumb relay plus MCP framing. |

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

Direction matters: the page connects outward. The server never pushes anything into a page that did not open the socket and complete the handshake (section 6). The server binds loopback only; it is never reachable from another host.

Why the page and not a browser extension or CDP: the page already knows how to act on itself, the extension would be a third exception to the single-file policy, and CDP needs a debugging port that exposes every tab.

---

## 3. Network-policy exception (approved 2026-11-07)

The project rule is "the network is for Google Drive sync and nothing else, and no network operation may ever block startup". The bridge is a second thing the page talks to, so it is an **explicit, owner-approved exception**, recorded the same way the comment-editor bundle was. Approved by the owner on 2026-11-07, on one condition: the privacy text gains a line saying that with the bridge on, the week is read by the AI agent the user connected and goes to that agent's provider under its terms. Zenit Week itself still runs no servers and stores nothing.

Why it is a narrow exception and not a precedent:

| # | Property | How it holds |
|---|---|---|
| 1 | Never leaves the machine | `ws://` to `127.0.0.1` or `localhost` only. The client refuses any other host even if the stored record is tampered with, and CSP enforces the same. |
| 2 | Off is off | With `enabled: false` the bridge code path is never entered; no socket object is created, no timer runs. |
| 3 | Never blocks boot | The client starts from a `requestIdleCallback` after the first render, only when `enabled` is true. |
| 4 | Silent when the server is down | Reconnect with backoff 1 s to 30 s, capped, no toast. The Settings status line is the only signal. |
| 5 | Independent of connectivity | Loopback works offline and on a slow link, so it is not gated on `isDefinitelyOffline()`. It never delays or competes with Drive traffic. |

**CSP.** `connect-src` gains `ws://127.0.0.1:* ws://localhost:*`. The comment at the avatar-photo code (line ~8537) states the stance against widening `connect-src`; that comment is updated to name this exception and why loopback cannot reach the network. Run `npm run csp` after the inline-script edit. `tests/network-guards.test.js` gains a case asserting the bridge never opens a socket to a non-loopback host.

---

## 4. Browser support and the local-network permission (to verify before implementation)

Two browser mechanisms decide whether an `https://zenitweek.com` page may open `ws://127.0.0.1` at all. Both are tested in Chrome, Firefox and Safari **before** the bridge client is written, and the findings replace the "expected" column below.

| # | Mechanism | What it is | Expected (unverified) |
|---|---|---|---|
| 1 | Mixed content | An `https` page opening a plain `ws://` socket. Loopback is a "potentially trustworthy" origin in the spec, so it should be allowed. | Chrome and Firefox allow. Safari has historically blocked it. |
| 2 | Local network access permission | Recent Chrome versions ask the user before a public site may reach the user's own machine ("zenitweek.com wants to access other apps and services on this device"). Whether WebSocket is covered, and from which version, must be confirmed. Firefox is moving toward a similar prompt. | Chrome may prompt once per site. Firefox and Safari unknown. |

**Probe.** A throwaway test page (not shipped, lives in the scratchpad) served from the production origin opens a socket to a tiny local echo server and records: connected / prompted / blocked, plus the browser's console message. Run it in current stable Chrome, Firefox and Safari on macOS, and on the `localhost` dev origin for comparison.

**What the findings drive:**

| # | Finding | Consequence for the spec |
|---|---|---|
| 1 | A permission prompt appears | Pairing (section 5) gets an explicit step: "your browser will ask to let Zenit Week reach apps on this computer - choose Allow". The status line gains `Blocked by browser` with a one-line hint on how to re-allow in site settings. |
| 2 | Safari blocks plain `ws://` from `https` | v1 ships for Chrome and Firefox; the status line says `Not supported in this browser yet`. A follow-up adds `wss://` with a certificate the server generates and the user trusts once (section 11). Safari support is a goal, not a v1 promise. |
| 3 | All three allow without a prompt | No change. |

---

## 5. Opt-in and pairing

Off by default on every device. Nothing connects anywhere until the user turns it on.

| # | Element | Behaviour |
|---|---|---|
| 1 | Settings section "Agent bridge" | Below Theme. A toggle, a pairing-code field, a status line, a "Disconnect and forget" button. Reuses `.settings-section`, `.settings-label`, `.dialog-field`, `.agenda-action-btn`. Hidden when `(pointer: fine)` does not match - on a phone it can only confuse. |
| 2 | Pairing code | The server prints a one-line code on first start (`port.token`, token 32 random bytes base64url) and copies it to the clipboard. The user pastes it into the field. The page stores it and connects. This is the single pairing mechanism; no URL-hash variant. If section 4 finds a browser prompt, the browser asks here, once. |
| 3 | Storage | `zenit-week-bridge` in `localStorage`: `{ enabled, port, token }`. **Device-local, never in the synced colors/settings blob.** A phone must never learn the desktop's token or try to connect. |
| 4 | Status line | `Off` / `Waiting for server` / `Connected - <client name>` / `Refused (wrong code)` / `Blocked by browser` / `Not supported in this browser yet`. Driven by socket state and the handshake: `Connected` once the page has verified `proof` and sent `hello`; the client name comes from `proof.client`. `Refused` when the server closes with code `refused` after `hello`. |
| 5 | Forget | "Disconnect and forget" clears the record and closes the socket. Sign-out and reset (`reloadAppFresh`) also clear it: sign-out means "this browser stops being my workspace", and a paired agent must not keep access to whoever signs in next. |

The server keeps its token in `~/.config/zenit-week-mcp/token` (0600). `zenit-week-mcp pair` prints the code again; `zenit-week-mcp rotate` makes a new one, which invalidates every paired tab.

Port: fixed default `47831`, `--port` to override. CSP uses the port wildcard either way.

---

## 6. Security model

| # | Threat | Control |
|---|---|---|
| 1 | Any website on the machine opens `ws://127.0.0.1:<port>` and issues commands | Server checks the `Origin` header against an allowlist: `https://zenitweek.com`, `https://www.zenitweek.com`, `http://localhost:*`, `http://127.0.0.1:*`. A local page on an allowed dev origin still needs the token. The server closes any socket that has not completed the handshake within 2 s. |
| 2 | A rogue local process listens on the port and the page hands it the week | The page sends the token only after the server proves knowledge of it: the server's first frame carries `HMAC(token, nonce-from-page)`; the page verifies before sending anything else. Mutual, cheap, no TLS. |
| 3 | Token in browser history or URLs | Never in a URL. Pasted into a field, stored in `localStorage` only. |
| 4 | Agent escalates beyond the verb surface | No eval tool. Every tool has a JSON schema; unknown tool or malformed args is rejected by the page (`unknown_tool`, `bad_args`), not only by the server. |
| 5 | Agent writes unsafe content | Labels and comments pass through the same code as typed input: `textContent` everywhere, `tokenizeComment` for comments, `isSafeCommentUrl` for links. Nothing new to audit. |
| 6 | Runaway agent | Server-side budget: 200 write calls per minute, then `rate_limited`. Page-side: one call at a time (section 7). |

---

## 7. Execution model - an agent call is a user action

This section is the contract that makes agent writes indistinguishable from the user's own.

### 7.1 One call at a time

The page keeps a FIFO queue of incoming `call` frames and runs them strictly one after another. A call is taken from the queue only when the previous one has finished - its promise resolved (several tools are async: `open_week`, `transfer_*`, `send_to_date`, `delete_task` on an occurrence, `undo` / `redo`), its render done and `saveWeek` queued. The user's own clicks are not queued; they run as they always have, between agent calls.

### 7.2 The week lock - closing the merge window

A Drive pull (`syncWeekFromDrive`) and a peer-tab merge (`_flushPendingMerge`) run under `withWeekLock(wk)`: they read the local week, merge, `await saveWeekIDB`, and only then assign `weekData = mergedData` (`_commitRemoteMerge`). The "skip while busy" guard (`isAtomicOpActive() || hasEditingNode()`) is checked once, before those awaits. A synchronous edit that lands inside the window is therefore overwritten in memory. A person rarely hits the window; an agent issuing hundreds of calls will.

**Rule:** the body of every synchronous write tool runs inside `withWeekLock(currentWeekKey, ...)`, so it waits for an in-flight merge to finish and no merge can start while it runs. This makes agent writes at least as safe as a click (the user's own clicks keep their current behaviour; closing the window for them too is a separate fix, noted in section 11).

The lock is not re-entrant, so these tools are **not** wrapped, because they take it themselves or call code that does: `open_week` (`loadAndRender` / `openWeekIntoView`), `transfer_unfinished`, `transfer_reusable`, `undo`, `redo` (`_applySnapshot`), and `delete_task` on an occurrence. The implementation adds a test that each wrapped body never reaches `withWeekLock` for the same key.

There is no `week_locked` error: a call waits for the lock rather than failing.

### 7.2a The user editing

If the user is typing in the inline editor or the comment panel when a write arrives, the call waits until the editor closes, so the agent never rewrites a node under the user's cursor. After 30 s it fails with `user_busy` and the agent may retry. Reads are never held back.

### 7.3 One call, one undo entry - no fragments

**Rule:** every write tool takes exactly one `takeSnapshot()` at its start and then runs its steps through the shared helpers that do not snapshot. Pressing undo once after an agent call restores the state from before that call - all of it, never part of it. Redo replays all of it. This holds whether the user presses `Ctrl+Z` or the agent calls `undo`.

How each composite tool keeps to it:

| # | Tool | Steps inside one snapshot |
|---|---|---|
| 1 | `add_task` | create the node, apply label magic (`Nx` ticks), set days, set priority, set comment |
| 2 | `rename_task` | set label, re-apply label magic, rewrite day leaves if the label carried day tokens |
| 3 | `tick_task` with `n` other than 1 | close (or reopen) `n` tick leaves, then the status roll-up once at the end |
| 4 | `add_branch` | create the branch, set its label, set its colour |

Functions that take their own snapshot today and must be split into "snapshot + body" for the bridge: `setStatus`, `toggleReusableNode`, `addBranch`, `applyBranchColor`, and the comment write inside `persistCommentDraft` (whose snapshot is conditional on the open panel). The UI keeps calling the outer function; the bridge calls `takeSnapshot()` once and then the bodies. Undo scope markers that operations already record after the fact (next-week additions, schedule entries touched) attach to that one snapshot, so `transfer_*` and `send_to_date` undo across weeks and the schedule exactly as they do from the menu.

Reads take no snapshot. A call that fails validation takes none either and leaves nothing behind. A call that fails after its snapshot (it should not, since validation runs first) is rolled back by popping that entry off `undoStack` and applying it in memory - **not** by calling `undo()`, which would push a redo entry and force a Drive push. The redo stack is left as it was before the call.

### 7.4 Visible like a click

Every successful write shows a toast `Agent: <summary>` in the UI language. The summary is built by the page from the tool name and its arguments via i18n keys `bridge.toast.<tool>` in EN and CS (e.g. "Agent: added Pushups 10x", "Agent: Gym marked done"). Affected nodes get a brief highlight pulse on the map, reusing the existing drop-target highlight style.

### 7.5 Which tab executes

Several tabs may be connected. The server routes each call to the most recently focused visible tab. When no tab is visible, the most recently visible one executes - a hidden tab still has a working socket and the app's write path does not depend on visibility. The page reports changes through `event` frames (`focus`, `view`, `pause` on hide) so the server can keep this choice current.

---

## 8. MCP surface

### 8.1 Resources (read)

The week in view is read from memory (`weekData`), never from IndexedDB, because IndexedDB lags the last completed write (the comment at the Drive merge path, line ~9580, explains the same trap). Other weeks are read with `loadWeekIDB(wk)`. Reads never switch the view.

The projection to section 8.3 is a pure function over a week record, so the same code serves the week in view and stored weeks.

| # | URI | Content |
|---|---|---|
| 1 | `zenit://weeks` | List of week keys present in IndexedDB with node counts and completion. |
| 2 | `zenit://week/current` | The week in view, as section 8.3, from memory. |
| 3 | `zenit://week/{YYYY-WW}` | Any stored week, same shape. From memory if it is the week in view. |
| 4 | `zenit://schedule` | The `schedule` record (Later tab) as the `schedule` skill documents it. |
| 5 | `zenit://agenda/{1-7}` | The agenda of the week in view for that day, rows in render order: Scheduled, Done, Any day, Dropped - produced by the same grouping code `renderAgenda` uses, extracted so it returns data instead of DOM. |

### 8.2 Tools

Every write targets the week in view and follows section 7: queued, one snapshot, saved through `saveWeek`, toast. "Maps to" names the existing code; where it says "extract", the UI is changed to call the extracted function too, so there is still one path.

Day numbers: the agent uses ISO weekdays `1`-`7` (Monday = 1, Sunday = 7). The page converts to the internal `dayIndex` (`0` = Sunday, as `isoWeekPos` documents) at the edge; nothing else changes.

| # | Tool | Args | Maps to | Notes |
|---|---|---|---|---|
| 1 | `open_week` | `week` | `loadAndRender` | Sets `currentWeekKey`, the hash, the week picker and renders - `openWeekIntoView` alone does none of that. Required before writing a non-current week. Creates the week if absent, like the week bar does. Not an undo entry (navigation, like the week arrows). |
| 2 | `add_task` | `branch`, `label`, `parent?`, `days?`, `priority?`, `comment?` | extract `createTask(parentId, label, opts)` from `startAddNode` + `commitEdit` (new-node branch); both the UI and the bridge call it | `createTask` owns everything the UI does on create: insert into `weekData.nodes` and `parent.children`, `syncStatusUp` under a closed parent, `noteTaskCreated`, label magic (`Pushups 10x` creates ten tick leaves). Bridge adds **ignore** the user's active day filter (the filter is a view, not an instruction). Relative-day tokens (`today`, `tomorrow`, `now` and Czech forms) are refused with `bad_args`: the agent passes `days` instead, so a "tomorrow" on Sunday can never silently move the task to next week. `days` and an `Nx` label together are refused, because days win over `Nx` and the count would be discarded. Returns the new node in section 8.3 shape. |
| 3 | `rename_task` | `id`, `label` | extract the post-edit part of `commitEdit` into `applyLabelEdit(nodeId, label)`; `commitEdit` reads the input box and calls it | Re-runs label magic exactly as the editor does. Same refusal of relative-day tokens as `add_task`. |
| 4 | `set_status` | `id`, `status` in `done, undone, dropped, unplanned, planned` | body of `setStatus` | Cascades, timestamps, mutual exclusion all inherited. `undone` reopens from either closed state: on a dropped node the bridge passes `undropped`, the same redirect the context menu makes; on a done node `undone`. |
| 5 | `set_priority` | `id`, `priority` in `normal, high, critical` | extract `setPriority(id, value)` - an absolute setter - from the `prio-*` branches of `setStatus`, which toggle (setting `high` on a `high` task clears it). `setStatus('prio-*')` and `cyclePriority` call the new setter. | Cascades to descendants, pins to the top of the agenda on raise, as today. Setting the current value is a no-op: no snapshot, no toast. |
| 6 | `set_days` | `id`, `days` | `setActivityDays` | Keeps leaves of kept days, buries removed ones. Empty array removes all days. Days on a task with `Nx` ticks remove the ticks (days win, as in the UI); the result says so. |
| 7 | `tick_task` | `id` (a task with `Nx` ticks), `n` (integer, default 1, may be negative) | body of `setStatus` on tick leaves, picked the way the agenda picks them (`pickRepresentativeTick`: next pending for positive, last done for negative) | Positive `n` closes the next `n` pending ticks, negative reopens the last `|n|` done ones. `bad_args` if fewer are available, so a call never half-applies. Parent roll-up via `syncStatusUp` as in the UI. `wrong_type` on a task without ticks. Per-tick day scheduling is not in v1. |
| 8 | `set_comment` | `id`, `markdown` | extract the write from `persistCommentDraft` into `writeComment(nodeId, text)` | Stored as given; any string is valid in the grammar (unrecognised syntax is literal text). Refused with `bad_args` if it contains a link whose target fails `isSafeCommentUrl`. Max 20 000 characters. If the comment panel is open on the same node, the call waits (section 7.2a). |
| 9 | `set_reusable` | `id`, `on` | body of `toggleReusableNode` | Idempotent: no snapshot and no toast if already in the wanted state. |
| 10 | `delete_task` | `id`, `scope?` in `occurrence, series` | `deleteNode`; for an occurrence of a repeating entry, the two paths behind `confirmDeleteOccurrence` called directly (`deleteEntryWithNode` for the series) | Deletes at once, no question. `deleteNode` on an occurrence opens a dialog the agent cannot answer, so the bridge never reaches that dialog: on an occurrence without `scope` it returns `needs_choice` listing both scopes; with `scope` it runs that path. Details per the `schedule` skill. |
| 11 | `send_to_date` | `id`, `date`, `repeat?` | `sendNodeToDate` | Same options object the Reschedule dialog builds. Async; not wrapped in the week lock (it saves the schedule itself). |
| 12 | `transfer_unfinished` / `transfer_reusable` | none | `transferUnfinished` / `transferReusable` | Act on the week in view exactly as the context menu does. Async; they load the other week and lock internally. |
| 13 | `add_branch` | `label`, `side?`, `color?` | body of `addBranch(side)` without the editor: created with the given label and **no** `_editing` flag, never calls `_openInlineInput` (an `_editing` node is dropped by `takeSnapshot` and `saveWeek`); then the body of `applyBranchColor` | Side defaults to the side with fewer branches. One snapshot for all three steps. |
| 14 | `undo` / `redo` | none | `undo` / `redo` | The shared stack: it undoes the last action whoever made it, as `Ctrl+Z` does. The result says which action was undone so the agent can tell. |
| 15 | `get_stats` | none | `computeWeekStats` | The week in view. Read-only, no snapshot. |

Not offered in v1: moving or reordering nodes (layout only), colour changes beyond `add_branch`, language or theme, Drive sign-in, import/export.

### 8.3 Week JSON shape (as returned to the agent)

A projection of a week record, not the raw record. Internal stamps (`_ts`, `_posTs`, `_demo`, `_editing`, `offX`, `offY`, `side`) are omitted; day leaves are folded into a `days` array (ISO `1`-`7`) on the task, computed with `taskDays(node)` so a single day kept in the label of a task with sub-tasks is included. Tick leaves are folded into `ticks: { done, total }`. Legacy `type: 'counter'` nodes that older weeks may still hold are projected into the same `ticks` field (`val` / `max`) so the agent sees one model; they are read-only in v1 (`tick_task` returns `wrong_type` on them). Every node keeps its `id`, since ids are what write tools take.

```
{ week: "2026-45", label: "Week 45", range: "2026-11-02/2026-11-08",
  branches: [{ id, label, color, tasks: [
    { id, label, days: [1,3], priority, done, dropped, unplanned, reusable,
      doneAt, droppedAt, comments, ticks: { done, total } | null,
      children: [ ...same shape, day and tick leaves excluded... ] } ] }] }
```

Tool results return the affected node in the same shape so the agent does not need a second read.

---

## 9. Wire protocol (page <-> server)

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

The server answers a bad token by closing with reason `refused`; there is no separate reply frame to `hello`.

`week-saved` is emitted from two places: `saveWeek` (user, agent) and `_commitRemoteMerge` **whenever the merged content differs from what the page held** - not only at the existing `tabChannel` post, which fires only when `scheduleUpload` is true and so stays silent on a clean Drive pull. Together they cover every origin: user, agent, other tab, Drive. The server turns it into MCP `notifications/resources/updated` for subscribed clients.

Error codes: `no_app_tab`, `unknown_tool`, `bad_args`, `not_found` (node id), `wrong_type` (e.g. tick on a task without ticks), `needs_choice` (delete of an occurrence without `scope`), `user_busy` (section 7.2a), `rate_limited`, `refused` (pairing).

---

## 10. Mobile

| # | Situation | What happens |
|---|---|---|
| 1 | Agent edits on the desktop while the phone has the app open | `saveWeek` uploads to Drive; the phone's change feed sees it on its next poll (`POLL_INTERVAL_MS`, 10 s, when visible) and merges with `mergeWeekData`. Same path as any two devices today. |
| 2 | Phone and agent edit the same week at once | Existing CRDT: last `_ts` per node wins, tombstones union. Agent writes are stamped by `touchNode` inside the app functions, so they are first-class peers, not overrides. |
| 3 | Phone settings | The bridge section is hidden (section 5, row 1); the record is device-local, so the phone never learns a token. |
| 4 | User talks to Claude on the phone and wants the week changed | Not covered by this door. Needs Door 1 (Drive as bus) or the headless host (section 11). The Help panel text says so. |
| 5 | No desktop tab is open when the agent calls | The server answers `no_app_tab` with a hint. With `--open` the server launches the app URL in the default browser and waits up to 15 s for a `hello`. |

Net: for the mobile user the bridge is "the desktop is where the agent works; the phone follows through Drive." That is the honest v1 and it needs no new sync code.

---

## 11. Future options, explicitly out of v1

| # | Option | Unlocks | Cost |
|---|---|---|---|
| 1 | `wss://` with a locally generated certificate | Safari, if section 4 finds it blocks plain `ws://` | Certificate generation, a one-time trust step in the OS keychain, renewal. |
| 2 | Headless host mode (`zenit-week-mcp --headless`) | Agent works with no browser window open | A persistent Playwright profile signed in to Drive; sign-in UX in headless; keeping the profile alive. |
| 3 | Door 1, Drive as the bus | Phone-only users, cloud agents | Reuse the app's OAuth client and `/api/token`; run `mergeWeekData` in Node via the test harness loader. |
| 4 | Close the merge window for the user's own clicks too (section 7.2) | The same in-memory overwrite can, rarely, hit a person | Decide whether clicks also take the week lock or the merge re-reads memory after its awaits. A sync fix of its own, not bridge work. |
| 5 | Per-tick day scheduling and editing legacy counters | Full parity with the agenda's tick handling | More verbs; little agent demand expected. |
| 6 | Pure `computeWeekStats` and agenda grouping | Stats and agenda of any week without opening it | Refactor both to take a week record instead of reading globals. |
| 7 | Write to a week not in view | Fewer `open_week` round trips | A second mutation path; probably never worth it. |

---

## 12. Repository layout and build

| # | Where | What |
|---|---|---|
| 1 | `zenit-week.html` | Bridge client (connect, handshake, queue, dispatch table, projection to 8.3), Settings section, i18n keys `bridge.*` in EN and CS, CSP change, and the extractions named in 7.3 and 8.2 (`createTask`, `applyLabelEdit`, `setPriority`, `writeComment`, snapshot-free bodies, data-returning agenda grouping), each adopted by the UI in the same change so there stays one path per action. Stays inside the single file. |
| 2 | `mcp/server.js`, `mcp/package.json` | The MCP server: `@modelcontextprotocol/sdk` over stdio, `ws` listener on loopback, origin and token checks, rate budget, tab routing, tool and resource schemas, forwarding. Tooling, like `scripts/`, not part of the app. Publishable later as `npx zenit-week-mcp`. |
| 3 | `tests/agent-bridge.test.js` | Page side: handshake, refusal of non-loopback hosts, queue order, every tool dispatches to the named function with a fake socket, exactly one undo entry per write and one undo restores the full pre-call state, projection omits internal stamps, current week read from memory. |
| 4 | `tests/mcp-server.test.js` | Server side: origin allowlist, handshake timeout, rate budget, tab routing, `no_app_tab`, resource update notification on `week-saved`. |
| 5 | `tests/network-guards.test.js` | New case: the bridge never targets a non-loopback host. |
| 6 | `docs/` and Help panel | One paragraph: what it is, that it is desktop-only, how to pair, how to forget, which browsers are supported. |

Client configuration for the user (Claude Code example): one `claude mcp add zenit-week -- node mcp/server.js` line in the README.

---

## 13. Acceptance criteria

- [x] Owner has approved the network-policy exception (section 3) and it is recorded.
- [ ] Privacy text carries the agent-provider line required by section 3.
- [ ] Browser probe (section 4) run in Chrome, Firefox and Safari; findings written into section 4 and the status-line states adjusted.
- [ ] Bridge off: no socket is created, no timer runs, boot timing unchanged.
- [ ] Pairing: wrong code shows `Refused`, right code shows `Connected` within 1 s (after any one-time browser prompt); forgetting, sign-out and reset clear the record.
- [ ] Origin check: a page served from any origin outside the allowlist is closed before `hello`.
- [ ] Every tool in 8.2 is covered by a test that asserts the mapped app function ran.
- [ ] Every write tool pushes exactly one undo entry; one undo after it restores the exact pre-call state, one redo reapplies all of it. Covered for `add_task` with `Pushups 10x`, `add_task` with days and a comment, `tick_task` with `n = 3`, `add_branch` with label and colour, and `transfer_unfinished`.
- [ ] `add_task` with `Pushups 10x` produces one activity with ten tick leaves; `add_task` with `Run` and days `[1,3,5]` produces one activity with three day leaves; both visible in map and agenda without reload. `days` together with an `Nx` label is refused.
- [ ] `add_task` with `tomorrow` in the label is refused; with the user's day filter on, the new task gets only the days the agent passed.
- [ ] `set_priority(high)` on a high task leaves it high; `set_status(undone)` reopens both a done and a dropped task.
- [ ] `delete_task` on an occurrence without `scope` returns `needs_choice` and opens no dialog.
- [ ] `set_comment` with an unsafe link is refused and the node is untouched; any other string is stored byte for byte.
- [ ] Calls arriving together run in order; a call during `open_week` waits and then succeeds; a call while the user edits waits, and fails with `user_busy` after 30 s.
- [ ] A write issued while a Drive merge is between its IDB read and its `weekData` assignment waits for the lock and survives; a remote change to another node in the same merge survives too.
- [ ] A failed call is rolled back without touching the redo stack and without a Drive force-push.
- [ ] `week-saved` from the user, the agent, a second tab and Drive each produce one resource update notification.
- [ ] Phone with the app visible shows an agent-added task within one poll interval.
- [ ] `npm test`, `npm run validate`, `npm run csp` clean; no em dash anywhere.

---

## 14. Open questions

| # | Question | Leaning |
|---|---|---|
| 1 | Browser behaviour | Decided by the probe in section 4, not by guessing. |
