# Third-Party Notices

Zenit Week is MIT-licensed (see [LICENSE](LICENSE)). It ships the following
third-party software, each under its own licence as reproduced below.

| Software | Used for | Licence |
|---|---|---|
| [Tabler Icons](https://tabler.io/icons) | UI icons (inline SVG sprite in `zenit-week.html`) | MIT |
| [ProseMirror](https://prosemirror.net) | Rich comment editor (lazy-loaded `vendor/editor.<hash>.js`) | MIT |

## AI agents server (`mcp/`)

The optional MCP server for AI agents (the `zenit-week-mcp` npm package and the
`zenit-week.mcpb` Claude Desktop extension) is not part of the web app. It
depends on the packages below. npm installs them from the registry, and the
`.mcpb` bundle ships them in its `node_modules`, each with its own licence file.

| Software | Used for | Licence |
|---|---|---|
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MCP server protocol | MIT |
| [ws](https://github.com/websockets/ws) | Loopback connection to the app | MIT |
| [zod](https://zod.dev) | Tool argument schemas | MIT |

Their own dependencies (96 packages in all) are under MIT, ISC, BSD-2-Clause or
BSD-3-Clause, all permissive. `npm ls --omit=dev --all` in `mcp/` lists them.

## Tabler Icons

Copyright (c) 2020-2026 Paweł Kuna

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

<!-- BEGIN editor bundle notices (generated) -->
## Comment editor bundle

The lazy-loaded comment editor (`vendor/editor.<hash>.js`) bundles the
following packages, each used under the licence terms that follow its list.

- `orderedmap` (MIT) - Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-commands` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-history` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-inputrules` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-keymap` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-model` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-schema-list` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-state` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-transform` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `prosemirror-view` (MIT) - Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others
- `rope-sequence` (MIT) - Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin>
- `w3c-keyname` (MIT) - Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
<!-- END editor bundle notices -->
