#!/usr/bin/env node
// Build-time version injector — replaces __APP_VERSION__ in zenit-week.html
// with `git describe --tags --abbrev=0`. Runs on Vercel via `npm run build`.
// Never executed in the browser. Modifying the HTML in-place is fine on
// Vercel's ephemeral build container; locally, avoid running unless you intend
// to commit the resolved version (you shouldn't — the placeholder must stay in
// source).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = '__APP_VERSION__';
const VERSION_REGEX = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;
const FALLBACK_REGEX = /^dev(-[0-9a-f]{7})?$/;

export function resolveVersion({ runGit = runGitDescribe, env = process.env } = {}) {
  let tag = null;
  try { tag = runGit(); } catch (_) { /* swallow */ }
  if (tag && VERSION_REGEX.test(tag)) return tag;
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (sha && /^[0-9a-f]{7,}$/i.test(sha)) return `dev-${sha.slice(0, 7).toLowerCase()}`;
  return 'dev';
}

export function validateResolvedVersion(v) {
  return VERSION_REGEX.test(v) || FALLBACK_REGEX.test(v);
}

export function substitutePlaceholder(html, version) {
  const matches = html.match(new RegExp(PLACEHOLDER, 'g'));
  const count = matches ? matches.length : 0;
  if (count === 0) throw new Error(`Placeholder ${PLACEHOLDER} not found in HTML`);
  if (count > 1) throw new Error(`Placeholder ${PLACEHOLDER} found ${count} times; expected exactly 1`);
  return html.replace(PLACEHOLDER, version);
}

function runGitDescribe() {
  // Vercel checks out a shallow clone (depth ~10) without tags. We need both
  // the tag refs and enough history for the tag's commit to be reachable.
  // Try unshallow first; on already-complete clones it errors harmlessly.
  try { execSync('git fetch --tags --unshallow', { stdio: 'pipe' }); } catch (_) {
    try { execSync('git fetch --tags', { stdio: 'pipe' }); } catch (_) { /* fall through */ }
  }
  return execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

export function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = resolve(__dirname, '..', 'zenit-week.html');
  const version = resolveVersion();
  if (!validateResolvedVersion(version)) {
    throw new Error(`Resolved version "${version}" failed validation`);
  }
  const html = readFileSync(htmlPath, 'utf8');
  const out = substitutePlaceholder(html, version);
  writeFileSync(htmlPath, out);
  console.log(`[inject-version] ${PLACEHOLDER} -> ${version}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
