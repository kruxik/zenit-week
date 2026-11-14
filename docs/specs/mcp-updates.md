# MCP updates - new features reach every user, nothing goes stale silently

Status: plan, 2026-11-13. Steps 1 (section 5) and 2 (section 3) implemented 2026-11-13, step 3 prepared (section 4.1); both ship as server 1.2.0, so `minServer` is 1.2.0. The baseline (`mcp/baseline-manifest.json`) is rewritten by `npm run mcp:baseline` and does not by itself make a server release. Extends `agent-bridge.md` (sections 8, 9) and `agent-bridge-setup.md` (sections 3, 4.5, 4.6).

## 1. Objective

A user who installed the Zenit Week MCP server once gets every new agent feature without doing anything, or at worst by restarting their agent app. When something on their side is out of date, they are told - in the app and by their agent - with the one action that fixes it for their install. Never a silent gap.

### Today (the problem)

| # | Part | Updates how | Gap |
|---|---|---|---|
| 1 | Page half of every tool (behaviour, result shape) | With the app release, automatically | None |
| 2 | Server half (tool list, schemas, agent instructions, resource descriptions) | npx `@1`: next agent start after `mcp:publish`. `.mcpb` from a file: never by itself. Repo: by hand | A new tool is invisible to users whose server is older |
| 3 | Telling the user | Settings status line, only on a protocol mismatch (`PROTOCOL` 2 on both sides) | Within 1.x nobody is ever told; the hint lives only in Settings, which nobody opens to check |

### Non-goals

- A hosted (remote) MCP server. The network policy allows Drive and the loopback bridge only, and a remote server could not reach the tab anyway.
- Self-updating the server binary from the page. The page never writes to the user's machine.

## 2. Industry baseline

| # | Practice | Who does it | Used here as |
|---|---|---|---|
| 1 | Thin local connector, features defined by the app it fronts | Browser-driving MCP servers, IDE bridges | Section 3 |
| 2 | Store-managed auto-update of the connector | Claude Desktop extension directory (directory installs update automatically; file installs do not), VS Code marketplace, browser extension stores | Section 4 |
| 3 | Version handshake plus an in-product "update available" with one action | Every client/server product with two halves (VS Code remote server, Docker Desktop, browser extension + native host) | Section 5 |
| 4 | `notifications/tools/list_changed` for tools that appear at runtime | MCP spec; client support is uneven (Claude Code and Claude Desktop both have open reports of ignoring it) | Section 3.4, with a restart as the reliable fallback |

## 3. Option 1 - the page defines the tools

### 3.1 Idea

The server stops hard-coding tools, resources and instructions. The page sends a **manifest** describing them; the server registers whatever the manifest says and forwards calls as today. A new tool then ships with the app release. The server changes only when its own small set of local capabilities changes (section 3.3).

### 3.2 Manifest

Sent by the page right after `ready` (an authenticated, paired tab only), and again whenever it changes (a reload into a new release).

| # | Field | Content |
|---|---|---|
| 1 | `manifestVersion` | Content hash of the manifest; the server compares it, not a semver |
| 2 | `minServer` | The lowest server version this manifest needs (for the hooks it names) |
| 3 | `instructions` | The agent instructions text (today the `instructions` array in `server.js`) |
| 4 | `tools` | Name, description, JSON Schema for the input (without `app`, which the server adds), annotations, optional `hook` (section 3.3) |
| 5 | `resources` | URI or URI template, description, the read tool it maps to, the argument mapping (a fixed small vocabulary: `day` as integer, `week` with `current` meaning none) |

The page builds the manifest from `BRIDGE_TOOLS` plus a description table next to it, so a tool and its description live in one place. The schemas move from zod in `server.js` to JSON Schema in the page; argument validation stays where it already is, in the page (`_bridgeBad`).

**Safety.** The manifest comes from an allowed, paired origin over the authenticated socket, so it is as trusted as the calls themselves. The server still bounds it: tool names `^[a-z_]{1,64}$`, at most 64 tools and 32 resources, descriptions and instructions capped in length, schemas limited to plain JSON Schema keywords (no `$ref` to outside). A manifest that fails the check is ignored and logged; the cached one stays.

### 3.3 Server hooks - the only reason the server still changes

Some tools need work only the local process can do. These stay in the server as named hooks; the manifest refers to them by name.

| # | Hook | Today | Used by |
|---|---|---|---|
| 1 | `raise-browser` | `raiseBrowser()` after the call | `show_task` |
| 2 | `apps` | `relay.listApps()`, answered by the server | `zenit://apps` |
| 3 | `pairing` notices | `pairFirst()` | every call |

A manifest naming an unknown hook, or with `minServer` above the server's version, triggers the update prompt of section 5. The tool is still registered and called without the hook (for `show_task`: the map moves, the browser is not raised), so the user loses the extra, never the feature.

### 3.4 When the manifest arrives

| # | Moment | What the server does |
|---|---|---|
| 1 | Server starts, no tab yet | Registers the **cached** manifest of the last used site (`~/.config/zenit-week-mcp/manifest-<site>.json`, owner-only, beside `pairings.json`). First run ever: the baseline manifest bundled in the package |
| 2 | A tab connects with the same `manifestVersion` | Nothing |
| 3 | A tab connects with a different one | Saves it to the cache, updates the registered tools and resources, sends `tools/list_changed` and `resources/list_changed` |
| 4 | Client ignores `list_changed` | The next tool result in that session carries a one-time note: "Zenit Week has new tools for this session. If one is missing, ask the user to restart the agent app." Instructions are fixed at session start in MCP, so new instructions always take effect on the next start |

### 3.5 Several apps (production and dev)

Each site has its own cached manifest. The registered set is the manifest of the app a call would go to by default (the focused tab), plus the tools of other connected apps, so a dev-only tool is callable with `app`. A tool the target app lacks answers `unknown_tool` with "this app is older - reload it" (from the page, which already returns `unknown_tool`).

### 3.6 Migration

The manifest is additive on the wire: an older page sends none, and the server falls back to its bundled baseline, which equals today's hard-coded list. `PROTOCOL` stays 2. This server release is the **last one most users need** for a long time; section 5 makes sure they are told to take it.

## 4. Option 2 - auto-updating distribution

| # | Install | Plan |
|---|---|---|
| 1 | Claude Desktop extension | **Superseded, see 4.1 row 5 and 4.2.** Submit `zenit-week.mcpb` to Anthropic's extension directory. Directory installs update automatically. The manifest sets `tools_generated: true`, since the tool list now comes from the page. The setup guide and Settings link to the directory listing instead of the file download once it is listed; the file stays for people outside the directory |
| 2 | npx `zenit-week-mcp@1` | Already updates on the next agent start after `mcp:publish`. Verify that npx re-resolves `@1` on every start rather than reusing its cache; if it does not, switch the documented command to one that does and note it in Settings |
| 3 | Repository | Developers only. No change; section 5 tells them to pull |

Directory prerequisites to check before submitting: privacy policy (exists), icon, annotations on every tool (`readOnlyHint` / `destructiveHint`), a support link, and the review time per update (which section 3 makes rare).

### 4.1 Findings (2026-11-13)

| # | Item | Finding |
|---|---|---|
| 1 | npx `@1` | npm 12 revalidates the `zenit-week-mcp` registry entry on every start (`--loglevel=http` shows `GET 200 ... (cache revalidated)`), and the npx cache moved from 1.0.0 to 1.1.0 on its own. The documented command stays; a new 1.x arrives on the next agent start. Offline, the cached copy runs. |
| 2 | Extension manifest | `tools_generated: true` and `privacy_policies` (`https://zenitweek.com/privacy`, which has section 2.3 on AI agents) added; `mcpb validate` passes the schema. The `tools` list stays as the declared baseline, kept equal to `baseline-manifest.json` by a test. |
| 3 | Annotations | Every tool carries `readOnlyHint`; the two deletes carry `destructiveHint: true`, other writes `false`, navigation `idempotentHint: true`. |
| 4 | Icon, support link | Both exist (`assets/icon-512.png` bundled as `icon.png`, the GitHub issues link). |
| 5 | Directory (2026-11-14) | **Row 1 of the plan above no longer holds.** Anthropic's directory no longer accepts desktop extensions (MCPB); a local server is listed only inside a **plugin** (a folder in a public GitHub repository, `.claude-plugin/plugin.json` plus `.mcp.json`). Updates then come from merging to the tracked branch: the directory scans each commit and serves it to people who have the plugin. See 4.2. |

### 4.2 Plugin route: what it reaches and what it costs

Source: claude.com/docs `directory/publish`, `plugins/platform-support`, `plugins/pre-submission-checklist`, read 2026-11-14.

| # | Fact | Consequence for Zenit Week |
|---|---|---|
| 1 | A plugin's local MCP server loads in Claude Code and in Cowork running on the user's computer; in **Chat** (claude.ai, the Claude desktop app's chat, mobile) it is ignored | A plugin does not serve people who chat with Claude Desktop. For them the `.mcpb` file stays the only install, and it does not update itself: section 5 (toast, Settings, agent note) is their update path |
| 2 | An `npx` launcher must pin an exact version (`zenit-week-mcp@1.2.0`); a range such as `@1` blocks submission, and even a pinned package is always held for a reviewer | Each server release means a plugin version bump (`plugin.json` and `.mcp.json`), which `npm run release` can write, and a review of that version |
| 3 | Bundling the server into the plugin instead (`node ${CLAUDE_PLUGIN_ROOT}/server.js`) avoids the launcher but files over 256 KiB, a lockfile install or a program the validator cannot read through are held for a reviewer too | No cheaper path; npx pinned is the simpler one |
| 4 | Required: README of 40 words or more and a licence in the plugin folder; name not built on reserved words (`mcp`, `claude`, `plugin`); everything the plugin runs and sends described in the README | A `zenit-week` plugin folder with its own README; the privacy page already covers the bridge |
| 5 | Claude Code users already update by themselves through `npx zenit-week-mcp@1` (4.1, row 1) | The plugin adds discovery in the directory and Cowork, not faster updates for Claude Code |

## 5. Option 3 - never fail silently

### 5.1 Handshake

The `welcome` frame gains `version` (the server's package version); it already carries `install`. The page knows the latest server version: `npm run release` writes the current `mcp/package.json` version into a `BRIDGE_SERVER_LATEST` constant, next to `BRIDGE_PROTOCOL`.

| # | Server vs page | State | Severity |
|---|---|---|---|
| 1 | Below the manifest's `minServer` | `update-needed` | A feature is degraded (section 3.3) |
| 2 | Below `BRIDGE_SERVER_LATEST` | `update-available` | Soft |
| 3 | Equal or newer | `connected` | None |
| 4 | Newer than the page | `reload-app` (exists) | The page is the old side |

### 5.2 What the user sees

| # | Where | What |
|---|---|---|
| 1 | Map, once per server version per device | A non-blocking toast with the single action for the install path: Claude Desktop extension - **Download update** (directory install: none, it updates itself); npx - "Restart your agent app to update"; repo - "Pull and restart". Dismissed, it does not return until the next server version |
| 2 | Settings > AI agents | The status line shows the state with the same action, using the existing `bridge.state.update-server-*` hints; the agent row names its version |
| 3 | The agent | The server learns `BRIDGE_SERVER_LATEST` from the page's `ready` frame. When it is older, the first result of each session carries: "This Zenit Week server is 1.1.0; 1.2.0 is out. Tell the user: <install action>." The agent says it in its own reply |
| 4 | A missing tool | `unknown_tool` from the page names the fix: reload the app, or update the server, whichever side is older |

Copy goes through `t()` in English and Czech. The toast is built from the existing toast component; no new UI kind.

## 6. Build order

| # | Step | Ships in | User effect |
|---|---|---|---|
| 1 | Section 5: `version` in `welcome`, `BRIDGE_SERVER_LATEST` written by release, states, map toast, agent note | Server 1.2.0 and the app | From now on every user hears about every server update |
| 2 | Section 3: manifest, hooks, cache, dynamic registration, baseline | Server 1.3.0 (wire stays protocol 2) and the app | The last server update most users need; step 1 tells them to take it |
| 3 | Section 4: directory submission, npx check | Store listing, docs | Extension users stop downloading files |

Step 1 comes first so the step 2 server reaches people.

## 7. Tests

| # | Test | Where |
|---|---|---|
| 1 | Manifest built from `BRIDGE_TOOLS` covers every tool, every tool has a description and schema | `tests/agent-bridge.test.js` |
| 2 | Server registers the manifest, a changed manifest updates the list and sends `list_changed`, a bad manifest is ignored and the cache kept | `tests/mcp-server.test.js` |
| 3 | Cached manifest used at start with no tab; baseline on first run | `tests/mcp-server.test.js` |
| 4 | Unknown hook or `minServer` above the version: tool still works, update state raised | both |
| 5 | Version states 1-4 of section 5.1 and the once-per-version toast | `tests/agent-bridge.test.js` |
| 6 | Release writes `BRIDGE_SERVER_LATEST`; the guard fails when it lags `mcp/package.json` | new release test |
| 7 | Baseline manifest equals the page manifest at release time (no drift) | release check |

## 8. Documentation to update

`agent-bridge.md` sections 8 and 9 (manifest frame, tools defined by the page), `agent-bridge-setup.md` 3.2 and 4.5 (directory, version states), `mcp/README.md` (setup and updates), the Settings copy, and `CLAUDE.md` if the bridge rules there mention where tools are defined.

## 9. Acceptance criteria

- [ ] A tool added only in `zenit-week.html` is callable by an agent after an app release, with no server release, at worst after an agent restart.
- [ ] A server older than the latest one shows the user a toast with the right action for their install, once per version, and the agent says so in its first reply of a session.
- [ ] No state exists in which a feature is missing and neither the app nor the agent says why.
- [ ] Production and a dev copy with different tool sets work side by side; a call to the older one says to reload it.
- [ ] ~~The extension updates itself when installed from the directory.~~ Not possible any more (4.2 row 1): Claude Desktop chat users update the `.mcpb` by hand, prompted by section 5.

## 10. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| 1 | Does npx re-resolve `@1` on each start or reuse its cache? | Answered in 4.1, row 1: it re-resolves |
| 2 | Directory review: time per update and listing requirements | Answered in 4.2: MCPB no longer accepted; a plugin version with a pinned npx package is always held for a reviewer, review time not fixed |
| 5 | Ship a `zenit-week` plugin (Claude Code, Cowork) for the directory listing? | Decided 2026-11-14: no. Steps 1 and 2 cover updates; Claude Desktop chat stays on the `.mcpb` file |
| 3 | Should the map toast also appear for `update-available` (soft), or only for `update-needed`? | Both, once per version; soft is still a real update |
| 4 | Do other agent apps (Cursor, Zed, others) honour `list_changed`? | Restart note of 3.4 row 4 covers them |
