#!/usr/bin/env node
// Publishes mcp/ to npm as zenit-week-mcp. Separate from `npm run release`:
// the package version is independent of the app version.
//
// Flow:
//   1. Run the server tests (tests/mcp-server.test.js).
//   2. Refuse if the version in mcp/package.json is already on npm.
//   3. Run `npm publish` in mcp/. Extra arguments are passed through,
//      e.g. `npm run mcp:publish -- --otp 123456` or `-- --dry-run`.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_DIR = resolve(REPO_ROOT, 'mcp');
const { name, version } = JSON.parse(readFileSync(resolve(MCP_DIR, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function die(msg) {
  process.stderr.write(`mcp:publish: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env });
  if (r.status !== 0) die(`\`${cmd} ${args.join(' ')}\` failed`);
}

// The versions already on npm; none when the package was never published.
function publishedVersions() {
  const r = spawnSync(npm, ['view', name, 'versions', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    if (/E404/.test(r.stdout + r.stderr)) return [];
    die(`could not ask npm for the versions of ${name}:\n${r.stderr}`);
  }
  const v = JSON.parse(r.stdout || '[]');
  return Array.isArray(v) ? v : [v];
}

console.log(`Publishing ${name}@${version}\n`);

console.log('1/3 Server tests');
// Same Node flag as `npm test`.
run(npx, ['vitest', 'run', 'tests/mcp-server.test.js'], REPO_ROOT,
  { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' });

console.log('\n2/3 Version check');
if (publishedVersions().includes(version)) {
  die(`${name}@${version} is already on npm. Bump "version" in mcp/package.json first.`);
}
console.log(`${version} is new.`);

console.log('\n3/3 npm publish');
run(npm, ['publish', ...process.argv.slice(2)], MCP_DIR);
const dryRun = process.argv.includes('--dry-run');
console.log(`\n${dryRun ? 'Dry run done, nothing published:' : 'Published'} ${name}@${version}.`);
