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

The MCP client starts the server. The app connects to it once you pair them in **Settings > Agent bridge**.

## Setup

You need [Node.js](https://nodejs.org/) 20 or newer. Your agent app downloads and starts the server with `npx`; there is nothing to install by hand.

1. Register the server with your agent.
   - Claude Code:
     ```sh
     claude mcp add --scope user zenit-week -- npx -y zenit-week-mcp@1
     ```
   - Claude Desktop: add it to `claude_desktop_config.json` and restart Claude Desktop:
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
2. Print the pairing code. It is also copied to your clipboard:
   ```sh
   npx -y zenit-week-mcp@1 pair
   ```
3. Open [zenitweek.com/app](https://zenitweek.com/app), go to **Settings > Agent bridge** and paste the code.
4. When the browser asks to let Zenit Week reach apps on this computer, choose **Allow**. In Firefox, also tick **Remember my choice**.
5. Settings shows **Connected**. Ask your agent to look at your week.

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
3. Print the pairing code with `node server.js pair`, then continue with step 3 above.

## Commands and options

`zenit-week-mcp` below stands for `npx -y zenit-week-mcp@1` (or `node server.js` in a clone).

| Command | What it does |
|---|---|
| `zenit-week-mcp` | Runs the server. This is what the MCP client launches. |
| `zenit-week-mcp pair` | Prints the pairing code again and copies it. |
| `zenit-week-mcp rotate` | Makes a new code. Every paired tab has to be paired again. |

| Option | What it does |
|---|---|
| `--open` | Opens the app in your browser when a request arrives and no tab is connected. |
| `--port <n>` | Listens on another port (default `47831`). The port is part of the pairing code, so pair again after changing it. |
| `--allow-origin <https-url>` | Also accepts that page origin, for example an ngrok dev tunnel. Repeatable. |

Options go after the package name, for example `npx -y zenit-week-mcp@1 --open`.

## What the agent can do

Writes act on the record open in the app: a week, or the Vision. Use `open_week` first to work on another week, and `open_vision` before writing to an intention. An id from the record that is not in view answers `not_in_view`.

The Vision is the user's long view: a mind map of intentions, with life areas as branches and the why in the comments. Read `zenit://vision` before proposing what the coming weeks should carry.

| Tool | What it does |
|---|---|
| `open_week` | Shows a week in the app, creating it if absent. Also leaves the Vision. |
| `open_vision` | Shows the Vision. Required before writing to an intention. |
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
| `undo` / `redo` | Undoes or redoes the last action on the record in view, whoever made it. The result names the record. |
| `get_stats` | Completion statistics of the week in view. |

Read-only resources:

| Resource | Content |
|---|---|
| `zenit://week/current` | The week in view: branches, tasks, days, ticks, status and ids. |
| `zenit://week/{YYYY-WW}` | Any stored week. |
| `zenit://weeks` | Weeks stored on this device, with task counts. |
| `zenit://schedule` | Dated and repeating entries (the Later tab). |
| `zenit://agenda/{1-7}` | The agenda of one day of the week in view. |
| `zenit://vision` | The Vision: areas and intentions with priority, horizon, let-go state and comments. |

On the Vision, `set_days`, `tick_task`, `set_reusable`, `send_to_date` and the transfers answer `wrong_type`, and `add_task` refuses days and an `Nx` label: an intention has no days, repetitions or done.

## Security

- **Your computer only.** The server listens on `127.0.0.1` and accepts connections only from `https://zenitweek.com`, local development origins and any origin you add with `--allow-origin`.
- **Pairing code.** A tab must prove it knows the code before it can do anything. The code is stored in `~/.config/zenit-week-mcp/token` (or under `$XDG_CONFIG_HOME`). `rotate` replaces it.
- **The app stays in charge.** The server never reads or changes week data itself. The app applies every change through its own actions, and each one can be undone.
- **Rate limit.** At most 200 writes a minute. Reads are not limited.
- **Several tabs.** Requests go to the most recently focused visible tab, or else to the tab that was visible most recently.
- **Turning it off.** **Disconnect and forget** in Settings, signing out or resetting the app removes the pairing.

## License

MIT, like the rest of [Zenit Week](https://github.com/kruxik/zenit-week).
