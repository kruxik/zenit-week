# SPEC - Agent Bridge setup: install, pairing, production and dev

> Status: Draft for review, revision 2 (2026-11-08). Revision 2 works in a two-persona review (a regular user who knows MCP, and the developer-owner). Phases 1 (npm) and 2 (several agent apps) of section 9 implemented 2026-11-08; the rest not yet.
> Scope: how a user installs `zenit-week-mcp`, pairs it with the app, and how a developer uses the production app and a dev tunnel side by side. Replaces sections 5 (opt-in and pairing), 6 rows 1-2 (origin and server proof), 9 rows 1-3 (handshake frames) and 12 row 2 (distribution) of [agent-bridge.md](agent-bridge.md), and changes 7.5 (which tab executes). Everything else there - execution model, tools, resources, mobile, network-policy exception - stays as it is.

---

## 1. Objective

Turn on the bridge without a terminal, a repository or a pasted secret, the way people already connect apps: install the agent's extension in one click, flip one switch in Zenit Week, confirm a matching code once.

**Success:**
- A user with Claude Desktop and no Node.js goes from "never installed it" to "Claude added a task to my week" in under five minutes: one download, one switch, one browser prompt they were told to expect, one Allow click.
- A developer with Claude Desktop and Claude Code both running, the production app and an ngrok tab open, can talk to either app from either agent, and an agent never writes to the wrong app without saying so.

### Non-goals

| # | Excluded | Why |
|---|---|---|
| 1 | Safari | Blocks plain `ws://` from `https` ([agent-bridge.md](agent-bridge.md) section 4). Unchanged; follows with `wss://` later. |
| 2 | Agents that are not on this computer | Unchanged ([agent-bridge.md](agent-bridge.md) section 1, non-goals 1-2). |
| 3 | Pairing a phone | The bridge stays desktop-only; the phone follows through Drive. |
| 4 | Letting any website pair itself | The server's list of allowed websites stays the guard. An approve button inside a website can be faked by that website, so approval in the app cannot replace the list (section 7). |
| 5 | Our own installer, tray app or background service | The agent app launches the server; we ship a package, not a daemon. |

---

## 2. What changes for the user

| # | Today (v1) | After this spec |
|---|---|---|
| 1 | Clone the repository, `npm install`, register a local path | One-click Claude Desktop extension, or one copied command, or an install link (section 3) |
| 2 | Run `node server.js pair`, copy a 50-character code, paste it in Settings | Flip "Allow AI agents on this computer", compare a 6-digit code, click Allow (section 4) |
| 3 | A second agent app cannot start the server while the first one runs | Every agent app runs its own server on its own port; the app talks to all of them (section 5) |
| 4 | `--allow-origin` on the command line, edited in each agent's config | `zenit-week-mcp origins add <url>` once, for every agent (section 6) |
| 5 | "The tab clicked last wins", silently | The agent sees which apps are connected, can name one, and is warned when more than one is open (section 6) |

---

## 3. Install

### 3.1 npm package

`zenit-week-mcp` is published to npm from `mcp/`. Every command-based install runs `npx -y zenit-week-mcp@1`: the major version is pinned, so a new major never arrives silently against a page that speaks the old protocol, and minor updates still arrive on the next start of the agent app. The package version is independent of the app version; compatibility is checked by a protocol number (section 4.5).

Release: `npm run mcp:publish` from the repository root runs the server tests, checks that the version in `mcp/package.json` is new, and runs `npm publish` in `mcp/`. Separate from the app's `npm run release`.

### 3.2 Claude Desktop extension (`.mcpb`)

A Desktop Extension bundle: `manifest.json`, `server.js`, `core.js` and the production `node_modules`. Claude Desktop ships its own Node runtime for extensions on macOS and Windows, so the user needs no Node install. Installing is: download, double-click, confirm in Claude Desktop.

| # | Decision | Detail |
|---|---|---|
| 1 | Built by | `npm run mcp:bundle` (the official `mcpb pack` tool) from `mcp/`. Output is not committed. |
| 2 | Hosted on | GitHub Releases of this repository, as `zenit-week.mcpb`, attached to an `mcp-v<version>` tag. Anthropic's extension directory no longer takes submissions, and zenitweek.com stays the app only (single-file policy). |
| 3 | Linked from | Settings (section 3.4), the README and the landing page's "How to connect an agent" link, always to the latest release asset. |
| 4 | Updates | An extension installed from a file does not update itself. The update hint for this path is "Download the new Zenit Week extension" with the link (section 4.5). |
| 5 | User config in the manifest | None. Dev sites are added with the `origins` command (section 6), the one way for every install path. |
| 6 | Signing | Unsigned first; `mcpb sign` once a certificate exists (open question 1). The install screen is tested on macOS and Windows before release, signed or not. |
| 7 | Known quirk | New tools may only appear after Claude Desktop restarts. The Settings guide says so (section 3.4, row 4). |

### 3.3 Other agent apps

All of these need Node.js 20 or newer; the guide says so next to each one.

| # | Agent app | Install |
|---|---|---|
| 1 | Claude Code | One command to copy: `claude mcp add --scope user zenit-week -- npx -y zenit-week-mcp@1`. `--scope user` registers it for every folder; the default scope is the current project only. |
| 2 | Cursor | An "Add to Cursor" link: `cursor://anysphere.cursor-deeplink/mcp/install?name=zenit-week&config=<base64 of the server JSON>`. |
| 3 | VS Code | An "Add to VS Code" link: `vscode:mcp/install?<URL-encoded server JSON>`, wrapped in `https://vscode.dev/redirect?url=` so it works from a web page. |
| 4 | Any other MCP app | A copyable config block: a stdio server running `npx -y zenit-week-mcp@1`. |

The two link formats were checked against the Cursor and VS Code documentation on 2026-11-08.

### 3.4 Settings becomes the guide

The section is renamed from "Agent bridge" to **"AI agents"** in Settings and Help ("bridge" is our word, not the user's). It replaces the README as the place a user learns setup. Same vocabulary as today (`.settings-section`, `.settings-label`, `.dialog-field`, `.agenda-action-btn`); still hidden without `(pointer: fine)`.

| # | Element | Behaviour |
|---|---|---|
| 1 | Switch "Allow AI agents on this computer" | Off by default. The first time it is turned on, a short explainer opens first (row 2); after that it connects at once (section 4.1). Replaces the pairing-code field. |
| 2 | Permission explainer | One dialog in the standard vocabulary, shown once per browser: "Your browser will now ask to let Zenit Week access other apps and services on this device. That is how it reaches your AI agent, on this computer only. Choose Allow." In Firefox it adds "and tick Remember my choice". Continue opens the connection; the X turns the switch back off. |
| 3 | Status line | The states in section 4.6. |
| 4 | "Connect an agent" guide | Shown while no agent is connected, and opened from the `Waiting for the agent app` status. Claude Desktop first ("no setup needed"), then Claude Code, Cursor, VS Code, Other. Each shows one action - Download, Copy command, Install link, Copy config - plus "Needs Node.js 20 or newer" for all but Claude Desktop, and "If your agent does not see Zenit Week, restart it" under each. |
| 5 | Connected agents | One row per agent app connected now (section 5): its name and "Connected". Below them the pairing date and **Unpair**. Replaces "Disconnect and forget". |
| 6 | Blocked by browser | The status carries the way back: "Click the icon left of the address, open the site settings, set 'Apps on this device' (Chrome) or 'Local network' (Firefox) to Allow, then reload." Exact wording checked against both browsers at implementation time. |
| 7 | Safari | Switch disabled, "Not supported in this browser yet", as today. |

---

## 4. Pairing: approve in the app with a matching code

### 4.1 Flow

| # | Step | App | Agent |
|---|---|---|---|
| 1 | User turns the switch on | Explainer (first time only), then the browser prompt, then connects to every listening server in the port range (section 5). | - |
| 2 | Server running, site not paired | Status `Waiting for an agent`. The socket stays open; the page sends only its protocol number and whether it is visible and focused. No week key, tab id or data before pairing. | - |
| 3 | User asks the agent something about the week | The server starts pairing with the tab that would run the call, but only a **visible** one (section 4.3). The app shows the pairing dialog. | The agent gets the code (section 4.2). |
| 4 | User compares and clicks Allow | Stores the pairing key; status `Connected - <agent>`; toast "Paired with <agent>. Unpair in Settings if this was not you." Other open tabs of the same site pick up the key and connect. | With elicitation: the held call runs at once. Without: the user tells the agent to try again, and it runs. |
| 5 | Deny, X, or no answer in 120 s | Dialog closes; status `Waiting for an agent`; no key stored on either side. | The next request starts a new pairing with a new code. |
| 6 | Later sessions | Connects silently with the stored key. | Requests run at once. |

Pairing starts on the agent's first request, not when the server starts, so the dialog only ever appears right after the user asked the agent for something, and both sides show the code at the same moment. Claude Desktop starting its servers at launch never shows a dialog.

**The dialog.** Standard vocabulary (`.dialog-shell`, `.dialog-header`, `.dialog-body`, `.dialog-actions`), Allow is the `.commit` button. Title "Connect an AI agent?". The code is the visual centre, large, in groups of three digits, with "Check that your agent shows the same code." The agent's name is secondary and labelled as its own claim: "It says it is Claude Desktop" - the server cannot verify it.

### 4.2 How the agent shows the code

The code must reach the user even if the model does not pass on an error, and even when the first request is a resource read, which some agent apps show only as a raw error.

| # | Agent app supports | Behaviour |
|---|---|---|
| 1 | MCP elicitation | The server holds the request (up to 120 s) and asks the user through the agent app: "Zenit Week is asking you to approve this agent. The code there should be 482 913. Click Allow in Zenit Week." Accept just closes the message; Decline cancels the pairing in the app. When the app's Allow arrives first, the server cancels the open elicitation and runs the request. Verified for Claude Code and VS Code; unverified for Claude Desktop and Cursor, which fall back to row 2. |
| 2 | No elicitation | The tool call returns a **successful** result (not an error) whose text and structured content say: "Not connected yet. Zenit Week shows a request with the code 482 913. Ask the user to check that the code matches and click Allow there, then call again. Do not retry before the user confirms." A resource read returns content with the same text, not an error. |

**Retries keep the code.** While a pairing is open for a site, every further request gets the same code and the same message, and the dialog is not reopened or reset. A new code appears only after Deny, X or the 120 s timeout. This answers revision 1's open question 1: hold where the agent app can show the code during the hold, return at once where it cannot.

### 4.3 Which tab shows the dialog

| # | Situation | Behaviour |
|---|---|---|
| 1 | A visible tab of an allowed site is connected | The most recently focused visible tab shows the dialog. |
| 2 | Only hidden tabs | No dialog. The request returns "Bring Zenit Week to the front, then ask again." |
| 3 | The user is editing a label or comment, or another dialog or Help is open | The dialog waits behind it, like an agent call waits for an editing user today ([agent-bridge.md](agent-bridge.md) 7.2a); the 120 s start when it is shown. |
| 4 | Production and dev tabs are both visible and unpaired | The focused one, as in row 1. The dialog names the site in its body ("for zenitweek.com" / "for abc.ngrok-free.app"). |

### 4.4 Key agreement and reconnecting

Numeric comparison with a commitment, the scheme of Bluetooth Secure Simple Pairing and of 1Password's browser-extension pairing, using WebCrypto in the page and `node:crypto` in the server. No new dependency.

| # | Frame | Direction | Content |
|---|---|---|---|
| 1 | `pair-start` | server -> page | `commit` = SHA-256 of the server's one-time ECDH P-256 public key and a random nonce, `client` (agent app name) |
| 2 | `pair-key` | page -> server | The page's one-time ECDH public key and nonce |
| 3 | `pair-reveal` | server -> page | The server's public key and nonce; the page checks them against `commit` |
| 4 | - | both | Shared secret from ECDH. Code = 6 decimal digits derived from both public keys and nonces. Pairing key = HKDF of the shared secret. |
| 5 | `pair-ok` / `pair-deny` | page -> server | The user's answer. On `pair-ok` both sides store the key under a new `pairingId`. |

**Reconnecting** is a mutual proof with the stored key, the shape of v1's challenge and proof but keyed per pairing: the page sends `pairingId` and a nonce, the server proves it knows that pairing's key, then the page proves it too. Neither side sends the key again.

| # | Store | Content |
|---|---|---|
| 1 | Page, `localStorage` `zenit-week-bridge` | `{ enabled, explained, pairingId, key, pairedAt }`. Device-local, never in the synced settings blob, as today. Per site by nature, so production and dev each have their own. |
| 2 | Server, `~/.config/zenit-week-mcp/pairings.json` (0600) | `{ pairingId, origin, key, pairedAt }` per site, at most one per site. **One file for every server instance and install path** - the Claude Desktop extension and an `npx` server read the same file, so a site paired through one agent is paired for all. Re-read on every handshake. |

The page stores one key per site; any server instance on the machine can prove it, because they share the file.

### 4.5 Protocol version and updates

The page's first frame carries `protocol: 2`.

| # | Situation | What the page shows |
|---|---|---|
| 1 | v2 page, v1 server | A v1 server ignores the unknown frame and closes with code 4002 after 2 s, sending no proof. The page reads "4002 with no proof" as an old server: `Update your agent's Zenit Week server`, with the hint for its install path (row 4). |
| 2 | v2 server, older page | The server closes with reason `protocol`: `Reload Zenit Week`. |
| 3 | v1 record in the page (`port`, `token`) | Dropped on first load; the site pairs once more. |
| 4 | Update hint by install path | Claude Desktop extension: "Download the new extension" (link). `npx`: "Restart your agent app". The server reports its install path in its first frame so the page can pick the hint; a v1 server cannot, so row 1 shows both. |

### 4.6 Status line states

| # | State | Meaning |
|---|---|---|
| 1 | `Off` | Switch off |
| 2 | `Waiting for the agent app` | No server listening. Opens the "Connect an agent" guide. Replaces `Waiting for server - run zenit-week-mcp`. |
| 3 | `Waiting for permission` | Browser prompt open, as today |
| 4 | `Blocked by browser` | As today, with the way back (section 3.4, row 6) |
| 5 | `Waiting for an agent` | Connected to a server, site not paired yet |
| 6 | `Approve the request` | Pairing dialog open |
| 7 | `Connected - <agent>, <agent>` | Paired; every connected agent app listed |
| 8 | `Unpaired on the agent side` | The server no longer knows this site's pairing (section 4.7) |
| 9 | `Update your agent's Zenit Week server` / `Reload Zenit Week` | Protocol mismatch (section 4.5) |
| 10 | `Not supported in this browser yet` | Safari, as today |

### 4.7 Unpairing

| # | From | Effect |
|---|---|---|
| 1 | Settings "Unpair" | The page tells every connected server, which deletes the site's pairing, then deletes its own key. The only way the page deletes its key. |
| 2 | `zenit-week-mcp unpair <site>` or `unpair --all` | The server deletes the pairing. The page shows `Unpaired on the agent side` but **keeps its key**: a program on the port could otherwise make the page drop a good key and then offer its own pairing. The next approved pairing replaces the key. |
| 3 | Sign-out and reset (`reloadAppFresh`) | Clear the page record, as today. The server's entry stays and is replaced at the next pairing. |

`zenit-week-mcp pair` and `rotate` are removed; `unpair` replaces `rotate`. One way per action.

---

## 5. Several agent apps at once

Every MCP agent app starts its own copy of the server: Claude Desktop at its launch, Claude Code per session, Cursor per window. With one fixed port only the first copy can listen, so the second agent app silently gets nothing. The server therefore takes one port from a small range, and the page talks to all of them.

| # | Element | Behaviour |
|---|---|---|
| 1 | Port range | `47831` to `47838`. A starting server binds the first free port. When all eight are taken it reports "Too many Zenit Week servers running" to its agent app and exits. `--port` is removed. |
| 2 | Page | Connects to every listening port in the range and keeps one socket per server. While the switch is on and no server answers, it retries the whole range with the backoff of [agent-bridge.md](agent-bridge.md) section 3 (1 s to 30 s). One browser permission covers all ports, since the prompt is per site. CSP already allows `ws://127.0.0.1:*`. |
| 3 | Calls | Each server forwards only its own agent's calls. The page already runs one call at a time ([agent-bridge.md](agent-bridge.md) 7.1), so calls from two agents queue, they never interleave. |
| 4 | Pairing | Per site, shared by every server through `pairings.json` (section 4.4). Pairing once through Claude Desktop also pairs Claude Code. |
| 5 | Settings | Lists every connected agent app (section 3.4, row 5). |
| 6 | Server restart | The page sees the socket close and retries the range; the restarted server may take a different port, which needs nothing from the user. |

---

## 6. Production and dev side by side

| # | Element | Behaviour |
|---|---|---|
| 1 | Built-in sites | `https://zenitweek.com`, `https://www.zenitweek.com`, `http://localhost:*`, `http://127.0.0.1:*`, as today. |
| 2 | Added sites | `zenit-week-mcp origins add <https-url>`, `origins remove <url>`, `origins list`. Stored in `~/.config/zenit-week-mcp/config.json` (0600), `https` only, compared exactly. Read on every new connection, so no restart is needed. Replaces `--allow-origin`. A free ngrok account has one permanent domain, so this is done once per machine. |
| 3 | Pairing | Each site pairs once (section 4). Browser storage is per site, so production and dev never share a key. |
| 4 | Seeing the apps | A new resource `zenit://apps` lists the connected app tabs of this server: app name, week in view, visible, focused. |
| 5 | Choosing an app | Every tool and resource takes an optional `app` argument - `"Zenit Week"` or a host name such as `abc.ngrok-free.app`. Without it the default is unchanged: the most recently focused visible tab, else the most recently visible ([agent-bridge.md](agent-bridge.md) 7.5). |
| 6 | Naming in replies | Every result carries `app`: `"Zenit Week"` for the production sites, the host name for any other. The server knows the origin; the page adds nothing. |
| 7 | Warning | When tabs of more than one site are connected and a call has no `app`, the result adds "Two apps are open (Zenit Week, abc.ngrok-free.app); this went to <app>." The server instructions tell the agent to name the app when more than one is open. |
| 8 | `--open` | Opens the site of the last pairing that was used, not always production. |

### 6.1 Developer loop for the bridge itself

A dev build of the app may speak a newer protocol than the published server. The developer registers a second server from the worktree, at project scope so it exists only there: `claude mcp add zenit-week-dev -- node mcp/server.js` run inside the worktree. Thanks to section 5 it takes its own port next to Claude Desktop's published server. The dev tab connects to both: the published server closes it with reason `protocol` if the versions differ, which the page shows for that server only, and the dev server pairs normally. Pairings are per site, so the production key is never touched. Documented in `mcp/README.md`.

---

## 7. Security model (replaces rows 1-2 of agent-bridge.md section 6)

What pairing protects against, in plain terms: on a computer shared by several user accounts, another account can reach `127.0.0.1` but cannot read this user's browser profile or `~/.config`. Pairing is what stops that account's programs from reading or changing the week. A program running as the same user can already read the browser profile; no local scheme stops it, and this spec does not claim to.

| # | Threat | Control |
|---|---|---|
| 1 | A website the user visits connects to a server and asks to pair | The server closes any socket whose `Origin` is not on the list (section 6, rows 1-2) before a single frame. A website cannot add itself: the list is changed only by the `origins` command on this computer. |
| 2 | Another account's program takes a port in the range and pairs with the page | The user sees a pairing request they did not start, and its code matches nothing their agent shows. |
| 3 | A program sits between the page and a real server (possible now that there are eight ports) and relays the pairing | The commitment (section 4.4, row 1) fixes the server-side key before the page's key is known, so the program cannot steer both codes to the same value; the codes differ. |
| 4 | The user clicks Allow without comparing | The dialog appears only right after the user asked their agent for something, only on an allowed site, only in a visible tab, and puts the code first and the agent's self-reported name second. The toast after Allow says how to undo it. |
| 5 | A program on the port tries to make the page drop its key | The page keeps its key when a server says the pairing is unknown (section 4.7, row 2); only Settings "Unpair" or an approved new pairing replaces it. |
| 6 | Leaking data before trust | Before pairing the page sends only its protocol number and visibility: no week key, no tab id, no data. |
| 7 | Stolen pairing key | The key never crosses the socket after pairing. Server file 0600. "Unpair" on either side revokes it. |

Rows 3-6 of [agent-bridge.md](agent-bridge.md) section 6 are unchanged.

---

## 8. Documentation to update when this ships

| # | Where | Change |
|---|---|---|
| 1 | Help panel (EN, CS) | Renamed "AI agents". Setup in one sentence: install the extension or the package, turn on the switch, approve the code. |
| 2 | README | "For everyone" becomes the real path; the developer section shrinks to running from the repository. |
| 3 | `mcp/README.md` | Install paths, `origins` and `unpair`, the pairing flow, several agent apps, the developer loop (section 6.1), the security model. |
| 4 | Landing pages (EN, CS) | "Setup takes a few commands today" becomes a one-click message. |
| 5 | Privacy section 13 | The pairing-code sentence becomes "you approve each agent once in the app by comparing a code". |

---

## 9. Build order

Each phase ships on its own and leaves the bridge working.

| # | Phase | Contents |
|---|---|---|
| 1 | npm | Publish the current server as `zenit-week-mcp`; README commands switch to `npx -y zenit-week-mcp@1` with `--scope user`. |
| 2 | Several agent apps | Section 5: port range, page connects to every server, Settings lists them. Removes `--port`. Fixes today's "second agent app gets nothing". |
| 3 | Pairing v2 | Section 4 and 3.4: switch, explainer, guide, dialog, key agreement, elicitation and fallback, reconnect proof, Unpair, `unpair`, protocol version, "AI agents" rename. Removes the pasted code, `pair` and `rotate`. |
| 4 | Production and dev | Section 6: `origins`, `zenit://apps`, `app` argument and field, warning, `--open` follows the last pairing, developer loop. Removes `--allow-origin`. |
| 5 | Claude Desktop extension | Section 3.2, plus the Download button in Settings. |
| 6 | Documentation | Section 8. |

---

## 10. Acceptance criteria

- [ ] `npx -y zenit-week-mcp@1` runs the server on a machine that has never cloned the repository.
- [ ] Installing `zenit-week.mcpb` in Claude Desktop on a machine without Node.js gives a working server, on macOS and on Windows.
- [ ] The Claude Code command registers the server for every folder (`--scope user`).
- [ ] With Claude Desktop and Claude Code both running, both servers listen, the page connects to both, Settings lists both, and calls from both run.
- [ ] Turning the switch on the first time shows the explainer before the browser prompt; the X turns the switch back off.
- [ ] With the switch on and no pairing, the first request from Claude Code shows the code through elicitation; from an agent app without elicitation it returns a successful result carrying the code; a first resource read also carries it.
- [ ] Repeated requests during an open pairing return the same code and do not reset the dialog.
- [ ] With only hidden tabs, no dialog opens and the request says to bring Zenit Week to the front; with the label editor open, the dialog waits.
- [ ] Allow: the request runs (held) or the retry runs (fallback); other tabs of the site connect without a dialog; a site paired through one agent app is paired for the other; after a browser restart requests run with no dialog.
- [ ] Deny, X, or 120 s: no key on either side; the next request shows a new code.
- [ ] A test relaying frames between page and server with its own keys produces codes that differ on the two sides.
- [ ] Before pairing, the page sends no week key, tab id or data.
- [ ] A socket from a site not on the list is closed before any frame; `origins add` lets it in without a restart; `origins remove` shuts it out.
- [ ] With production and dev tabs both connected: `zenit://apps` lists both; a call with `app` goes there; a call without it goes to the focused tab and its result carries the warning.
- [ ] Settings Unpair removes the server entries and the page key; server `unpair` shows `Unpaired on the agent side` and the page keeps its key until a new pairing is approved.
- [ ] A v2 page against a v1 server shows the update message; a v2 server against an older page shows `Reload Zenit Week`.
- [ ] The developer loop in 6.1 works: dev tab paired with the worktree server while Claude Desktop's published server runs.
- [ ] Settings shows no pairing-code field, and the server has no `pair`, `rotate`, `--allow-origin` or `--port`.
- [ ] `npm test`, `npm run validate`, `npm run csp` clean; no em dash anywhere.

---

## 11. Open questions

| # | Question | Leaning |
|---|---|---|
| 1 | Sign the `.mcpb` bundle? | Ship unsigned first, after testing the install screen on macOS and Windows; sign once a certificate is available. |
| 2 | Does Claude Desktop support MCP elicitation now? | Unverified. Check at implementation time; the fallback (section 4.2, row 2) works either way. |
| 3 | Is a range of eight ports enough? | Yes for one person's agent apps. Raise it if a real setup ever runs out. |
| 4 | npm package name | `zenit-week-mcp` was free on npm on 2026-11-08; reserve it with phase 1. |
| 5 | Dev sites through the Claude Desktop extension's settings, so a developer who uses only Claude Desktop needs no terminal? | Not now: it would be a second way to add a site. Revisit if such a developer appears. |
