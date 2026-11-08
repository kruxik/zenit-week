#!/usr/bin/env node
// Publishes mcp/ to npm as zenit-week-mcp. The production deploy runs it
// (deploy-production.yml, with --if-new) before the app goes live, so a
// release ships the app, the server and the extension together; the version
// itself is raised by `npm run release` when the server changed. By hand it
// still works, e.g. `npm run mcp:publish -- --dry-run`.
//
// Flow:
//   1. Run the server tests (tests/mcp-server.test.js).
//   2. If the version in mcp/package.json is already on npm: refuse, or with
//      --if-new say so and exit 0 (a re-run deploy, or an app-only release).
//   3. Run `npm publish` in mcp/. Other arguments are passed through,
//      e.g. `-- --otp 123456` or `-- --dry-run`. In CI npm authenticates by
//      trusted publishing (OIDC); no token is stored.

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
export function publishedVersions() {
  const r = spawnSync(npm, ['view', name, 'versions', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    if (/E404/.test(r.stdout + r.stderr)) return [];
    die(`could not ask npm for the versions of ${name}:\n${r.stderr}`);
  }
  const v = JSON.parse(r.stdout || '[]');
  return Array.isArray(v) ? v : [v];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ifNew = process.argv.includes('--if-new');
  const passThrough = process.argv.slice(2).filter(a => a !== '--if-new');
  if (ifNew && publishedVersions().includes(version)) {
    console.log(`${name}@${version} is already on npm; nothing to publish.`);
    process.exit(0);
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
  run(npm, ['publish', ...passThrough], MCP_DIR);
  const dryRun = passThrough.includes('--dry-run');
  console.log(`\n${dryRun ? 'Dry run done, nothing published:' : 'Published'} ${name}@${version}.`);
}
