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
  // 1. Tag-push deploys: Vercel sets VERCEL_GIT_COMMIT_REF to the tag name.
  //    Most reliable signal — no git CLI dependency.
  const ref = env.VERCEL_GIT_COMMIT_REF;
  if (ref && VERSION_REGEX.test(ref)) return ref;
  // 2. Branch-push deploys: derive the nearest tag reachable from HEAD via
  //    `git describe`. May fail on Vercel's shallow clone without tag refs.
  let tag = null;
  try { tag = runGit(); } catch (err) {
    console.warn('[inject-version] git describe failed:', err && err.message);
  }
  if (tag && VERSION_REGEX.test(tag)) return tag;
  // 3. Fallback to short SHA (still self-consistent, just not a release label).
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
  // Vercel ships a shallow clone (depth ~10) without tag refs. Try the
  // broadest fetch first; degrade gracefully on already-complete clones or
  // when origin isn't configured for fetch.
  const fetchAttempts = [
    'git fetch --tags --unshallow',
    'git fetch --tags --depth=100',
    'git fetch --tags',
  ];
  for (const cmd of fetchAttempts) {
    try {
      execSync(cmd, { stdio: 'pipe' });
      break; // first success is enough
    } catch (err) {
      console.warn(`[inject-version] '${cmd}' failed:`, (err.stderr || err.message || '').toString().trim().slice(0, 200));
    }
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
