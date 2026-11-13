# zenit-week-mcp

A local [MCP](https://modelcontextprotocol.io/) server that lets an AI agent - Claude Code, Claude Desktop or any MCP client - plan your week in [Zenit Week](https://zenitweek.com).

Zenit Week has no server holding your plans: the app and your data live in your browser (and, if you sync, in your own Google Drive). So the agent never touches your data directly. The server passes each request to the Zenit Week tab open in your browser, and the app does the work as if you clicked:

- Every change shows a toast and is one undo step.
- Your phone follows through Drive sync, if you use it.
- Nothing leaves your computer except what the agent itself reads, which goes to the agent's provider.

Works with Zenit Week in desktop Chrome and Firefox. Safari is not supported yet.

## How it works

```
MCP client  --stdio-->  zenit-week-mcp  --WebSocket on 127.0.0.1-->  Zenit Week tab
```

The MCP client starts the server. The app connects to it once you turn on **Settings > AI agents** and approve your agent once.

## Setup

**Claude Desktop:** download [zenit-week.mcpb](https://github.com/kruxik/zenit-week/releases/latest/download/zenit-week.mcpb), open it and confirm in Claude Desktop. It brings its own runtime, so you need nothing else. Then continue with step 2. An extension installed from a file does not update itself: when Zenit Week asks you to update it, download the new one the same way. If Claude does not see the new tools, restart Claude Desktop.

**Other agent apps** need [Node.js](https://nodejs.org/) 20 or newer. The agent app downloads and starts the server with `npx`; there is nothing to install by hand.

1. Register the server with your agent.
   - Claude Code:
     ```sh
     claude mcp add --scope user zenit-week -- npx -y zenit-week-mcp@1
     ```
   - Claude Desktop without the extension: add it to `claude_desktop_config.json` and restart Claude Desktop:
     ```json
     {
       "mcpServers": {
         "zenit-week": {
           "command": "npx",
           "args": ["-y", "zenit-week-mcp@1"]
         }
       }
     }
     ```
   - Any other MCP client: a stdio server with the command `npx -y zenit-week-mcp@1`.
2. Open [zenitweek.com/app](https://zenitweek.com/app), go to **Settings > AI agents** and turn on **AI agents**. Your browser then asks to let Zenit Week reach apps on this computer: choose **Allow**. In Firefox, also tick **Remember my choice**.
3. Ask your agent something about your week. Zenit Week shows a 6-digit code and your agent shows the same one. Check that they match and click **Allow**.
4. Settings shows **Connected**. From now on requests run at once, also after a restart.

`@1` pins the major version: updates within 1.x arrive the next time your agent app starts the server, and a new major version never arrives unannounced.

### Running from the repository

For working on the server itself, run it from a clone instead of npm:

1. Install the dependencies:
   ```sh
   cd mcp && npm install
   ```
2. Register it, for Claude Code:
   ```sh
   claude mcp add --scope user zenit-week -- node "$PWD/server.js"
   ```
   For another client, the command is `node /path/to/zenit-week/mcp/server.js`.
3. Continue with step 2 above.

## Updates

The tools your agent sees come from the Zenit Week app itself: when the app adds one, your agent gets it after the app updates, without a new server. Some agent apps pick up new tools only when they restart; the agent then says so. The server itself changes rarely. When it does, Zenit Week shows a note once, Settings > AI says how to update for your install, and the agent mentions it in its first reply.

## Commands and options

`zenit-week-mcp` below stands for `npx -y zenit-week-mcp@1` (or `node server.js` in a clone).

| Command | What it does |
|---|---|
| `zenit-week-mcp` | Runs the server. This is what the MCP client launches. |
| `zenit-week-mcp unpair <site>` | Forgets a site's pairing, for example `unpair zenitweek.com`. The app then shows "Unpaired on the agent side" and pairs again on the next request. |
| `zenit-week-mcp unpair --all` | Forgets every pairing. |
| `zenit-week-mcp origins add <https-url>` | Lets another site connect, for example an ngrok dev tunnel. `https` only, compared exactly, stored in `~/.config/zenit-week-mcp/config.json`. Every server on the computer accepts it at once, no restart. |
| `zenit-week-mcp origins remove <site>` | Removes an added site. |
| `zenit-week-mcp origins list` | Lists the built-in sites (`https://zenitweek.com`, `https://www.zenitweek.com`, `http://localhost:*`, `http://127.0.0.1:*`) and the added ones. |

| Option | What it does |
|---|---|
| `--open` | Opens the site you used last (production or a dev copy) when a request arrives and no tab is connected. |

Options go after the package name, for example `npx -y zenit-week-mcp@1 --open`.

### Several agent apps at once

Every agent app starts its own copy of the server: Claude Desktop at launch, Claude Code per session, Cursor per window. Each copy listens on the first free port from `47831` to `47838`, and the app connects to all of them, so they can run side by side. Pairings are shared through one file, so approving one agent app pairs the site for all of them. Settings lists every connected agent app. A copy that finds all eight ports taken says "Too many Zenit Week servers running" and exits. Calls from two agents never interleave: the app runs them one at a time.

### Production and a dev copy side by side

The agent can talk to several Zenit Week sites at once, for example production and an ngrok tunnel to a development copy. Each site pairs once on its own.

- `zenit://apps` lists the connected app tabs: the app name (`Zenit Week` for production, the host name for any other site), whether it is paired, the week in view, and which tab is in front.
- Every tool and resource takes an optional `app`: a tool argument, or `?app=` on a resource URI such as `zenit://week/current?app=abc.ngrok-free.app`. Without it, the most recently focused visible tab runs the call, as before.
- Every result says which app ran it in `app`. When more than one app is open and the call named none, the result also carries a warning: "Two apps are open (Zenit Week, abc.ngrok-free.app); this went to Zenit Week."

### Working on the server itself

A development copy of the app may speak a newer protocol than the published server. Register a second server from your clone, scoped to that folder only:

```sh
cd /path/to/zenit-week && claude mcp add zenit-week-dev -- node mcp/server.js
```

It takes its own port next to the published one. Your dev tab connects to both: a published server that speaks another protocol is listed in Settings as needing an update, for that server only, and the dev server pairs normally. Pairings are per site, so your production pairing is untouched.

## What the agent can do

Writes act on the record open in the app: a week, or the Vision. Use `open_week` first to work on another week, and `open_vision` before writing to an intention. An id from the record that is not in view answers `not_in_view`.

The Vision is the user's long view: a mind map of intentions, with life areas as branches and the why in the comments. Read `zenit://vision` before proposing what the coming weeks should carry.

| Tool | What it does |
|---|---|
| `open_week` | Shows a week in the app, creating it if absent. Also leaves the Vision. |
| `open_vision` | Shows the Vision. Required before writing to an intention. |
| `show_task` | "Show me": brings the browser to the front (macOS), opens the week or the Vision holding the task, zooms in on it and pulses it. |
| `add_task` | Adds a task to a branch, optionally under a parent, with days, priority and a comment. A label like "Pushups 10x" makes 10 ticks. |
| `rename_task` | Renames a task. |
| `set_status` | Marks a task done, undone, dropped, unplanned or planned. On the Vision only dropped (let go) and undone (take back). |
| `set_horizon` | Vision only: when an intention is meant to happen (year, years, someday, none). |
| `set_priority` | Sets normal, high or critical priority. |
| `set_days` | Replaces a task's weekdays (1 = Monday ... 7 = Sunday). |
| `tick_task` | Records repetitions of an Nx task. |
| `set_comment` | Replaces a task's comment (Markdown). |
| `set_reusable` | Marks a task to be copied into next week. |
| `delete_task` | Deletes a task. |
| `send_to_date` | Moves a task to a date, optionally repeating. |
| `transfer_unfinished` | Copies last week's unfinished tasks into this week. |
| `transfer_reusable` | Copies last week's reusable tasks into this week. |
| `add_branch` | Adds a branch (category) to the record in view. |
| `rename_branch` | Renames a branch of the record in view. |
| `delete_branch` | Deletes a branch of the record in view with everything under it; the last branch stays. |
| `undo` / `redo` | Undoes or redoes the last action on the record in view, whoever made it. The result names the record. |
| `get_stats` | Completion statistics of the week in view. |

Read-only resources:

| Resource | Content |
|---|---|
| `zenit://week/current` | The week in view: branches, tasks, days, ticks, status and ids. |
| `zenit://week/{YYYY-WW}` | Any stored week. |
| `zenit://weeks` | Weeks stored on this device, with task counts. |
| `zenit://schedule` | Dated and repeating entries (the Later tab). |
| `zenit://agenda/{1-7}` | The agenda of one day of the week in view. Its Done group is that day's log of what you finished, oldest first, each row with its `doneAt`. |
| `zenit://vision` | The Vision: areas and intentions with priority, horizon, let-go state and comments. |
| `zenit://apps` | The connected app tabs, answered by the server itself. |

Every tool and resource above also takes `app` (see "Production and a dev copy side by side").

On the Vision, `set_days`, `tick_task`, `set_reusable`, `send_to_date` and the transfers answer `wrong_type`, and `add_task` refuses days and an `Nx` label: an intention has no days, repetitions or done.

## Security

- **Your computer only.** The server listens on `127.0.0.1` and accepts connections only from `https://zenitweek.com`, local development origins and any site you add with `origins add`. A website cannot add itself: only that command on your computer changes the list.
- **Approve once, by code.** On the agent's first request the app and the server agree a key (ECDH P-256 with a commitment) and both show a 6-digit code derived from it; you compare them and click Allow. A program sitting in between cannot make the two codes match. Afterwards both sides prove the key on every connection; it never crosses the socket again. Before pairing the app sends only its protocol version and whether it is in front. Pairings live in `~/.config/zenit-week-mcp/pairings.json` (owner-only, or under `$XDG_CONFIG_HOME`), one per site.
- **What pairing protects against.** On a computer shared by several user accounts, another account's programs can reach `127.0.0.1` but not your browser profile or `~/.config`. A program running as you can already read both; no local scheme stops it.
- **The app stays in charge.** The server never reads or changes week data itself. The app applies every change through its own actions, and each one can be undone.
- **Rate limit.** At most 200 writes a minute. Reads are not limited.
- **Several tabs.** Requests go to the most recently focused visible tab, or else to the tab that was visible most recently.
- **Turning it off.** **Unpair** in Settings, signing out or resetting the app removes the pairing. `unpair` on the server side forgets it there; the app keeps its own key until you approve a new pairing, so a program on the port cannot make it drop a good key.

## License

MIT, like the rest of [Zenit Week](https://github.com/kruxik/zenit-week).
