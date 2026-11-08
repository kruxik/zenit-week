#!/usr/bin/env node
// Builds the Claude Desktop extension: mcp/dist/zenit-week.mcpb
// (docs/specs/agent-bridge-setup.md section 3.2). The output is not committed;
// the production deploy builds it and attaches it to every app release.
//
// Flow:
//   1. Check that mcp/manifest.json and mcp/package.json agree on the version.
//   2. Stage the server in mcp/dist/bundle: manifest, server, core, package
//      files, licence, readme, icon - nothing else from the repository.
//   3. Install the production dependencies there (`npm ci --omit=dev`).
//   4. Validate the manifest and pack with the official tool
//      (`npx -y @anthropic-ai/mcpb validate` / `pack`).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_DIR = resolve(REPO_ROOT, 'mcp');
const DIST = resolve(MCP_DIR, 'dist');
const STAGE = resolve(DIST, 'bundle');
const OUT = resolve(DIST, 'zenit-week.mcpb');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// What goes into the bundle, besides node_modules. `from` is relative to the
// repository root, `to` to the bundle.
export const BUNDLE_FILES = [
  { from: 'mcp/manifest.json', to: 'manifest.json' },
  { from: 'mcp/server.js', to: 'server.js' },
  { from: 'mcp/core.js', to: 'core.js' },
  { from: 'mcp/package.json', to: 'package.json' },
  { from: 'mcp/package-lock.json', to: 'package-lock.json' },
  { from: 'mcp/LICENSE', to: 'LICENSE' },
  { from: 'mcp/README.md', to: 'README.md' },
  { from: 'assets/icon-512.png', to: 'icon.png' },
];

function die(msg) {
  process.stderr.write(`mcp:bundle: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) die(`\`${cmd} ${args.join(' ')}\` failed`);
}

const read = p => JSON.parse(readFileSync(resolve(REPO_ROOT, p), 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = read('mcp/package.json');
  const manifest = read('mcp/manifest.json');
  console.log(`Bundling zenit-week.mcpb ${version}\n`);

  console.log('1/4 Version check');
  if (manifest.version !== version) die(`mcp/manifest.json says ${manifest.version}, mcp/package.json says ${version}. Make them equal.`);

  console.log('2/4 Stage');
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  for (const f of BUNDLE_FILES) copyFileSync(resolve(REPO_ROOT, f.from), resolve(STAGE, f.to));

  console.log('3/4 Production dependencies');
  run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], STAGE);

  console.log('4/4 Validate and pack');
  run(npx, ['-y', '@anthropic-ai/mcpb', 'validate', 'manifest.json'], STAGE);
  run(npx, ['-y', '@anthropic-ai/mcpb', 'pack', STAGE, OUT], REPO_ROOT);
  console.log(`\nWrote ${OUT}`);
}
