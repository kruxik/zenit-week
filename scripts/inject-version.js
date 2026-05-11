#!/usr/bin/env node
// Build-time version injector — replaces __APP_VERSION__ in zenit-week.html
// with the CalVer git tag. Runs on Vercel via `npm run build`. Never
// executed in the browser. Vercel strips the .git directory from its build
// container, so the canonical path is the GitHub API; git CLI is used only
// as a local-dev / non-Vercel-CI convenience.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER     = '__APP_VERSION__';
const VERSION_REGEX   = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;
const FALLBACK_REGEX  = /^dev(-[0-9a-f]{7})?$/;

export async function resolveVersion(opts = {}) {
  const env        = opts.env        || process.env;
  const runGit     = opts.runGit     || runGitDescribe;
  const fetchTags  = opts.fetchTags  || fetchLatestCalverTagFromGitHub;

  // Diagnostic logging — useful for understanding Vercel build env.
  console.log(`[inject-version] VERCEL_GIT_COMMIT_REF=${env.VERCEL_GIT_COMMIT_REF || '(unset)'}`);
  console.log(`[inject-version] VERCEL_GIT_REPO_OWNER=${env.VERCEL_GIT_REPO_OWNER || '(unset)'}`);
  console.log(`[inject-version] VERCEL_GIT_REPO_NAME=${env.VERCEL_GIT_REPO_NAME || '(unset)'}`);
  console.log(`[inject-version] VERCEL_GIT_REPO_SLUG=${env.VERCEL_GIT_REPO_SLUG || '(unset)'}`);

  // 1. Tag-push deploys on Vercel: VERCEL_GIT_COMMIT_REF is the tag name.
  const ref = env.VERCEL_GIT_COMMIT_REF;
  if (ref && VERSION_REGEX.test(ref)) return ref;

  // 2. Local dev or any CI that ships a real .git: derive nearest tag.
  let tag = null;
  try { tag = runGit(); } catch (err) {
    console.warn('[inject-version] git describe failed:', err && err.message);
  }
  if (tag && VERSION_REGEX.test(tag)) return tag;

  // 3. Vercel build (no .git): fetch tags via GitHub API. Only attempted
  //    when a repo slug is resolvable — keeps tests offline by default.
  const slug = resolveRepoSlug(env);
  if (slug) {
    try {
      const apiTag = await fetchTags(slug);
      if (apiTag && VERSION_REGEX.test(apiTag)) return apiTag;
    } catch (err) {
      console.warn('[inject-version] GitHub tag fetch failed:', err && err.message);
    }
  }

  // 4. SHA fallback — still ships a self-consistent build, just not a release.
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (sha && /^[0-9a-f]{7,}$/i.test(sha)) return `dev-${sha.slice(0, 7).toLowerCase()}`;
  return 'dev';
}

function resolveRepoSlug(env) {
  // VERCEL_GIT_REPO_OWNER + _NAME is the canonical pair on Vercel. The bare
  // VERCEL_GIT_REPO_SLUG turns out to be just the repo name (no owner), so
  // it can't be used as a full GitHub slug on its own.
  if (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_NAME) {
    return `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_NAME}`;
  }
  // Only honor REPO_SLUG when it actually has the owner/name shape.
  if (env.VERCEL_GIT_REPO_SLUG && env.VERCEL_GIT_REPO_SLUG.includes('/')) {
    return env.VERCEL_GIT_REPO_SLUG;
  }
  // On Vercel without the slug env vars (older runtime, or slug stripped to
  // just the repo name as observed), hardcode the known repo.
  if (env.VERCEL) return 'kruxik/zenit-week';
  return null;
}

async function fetchLatestCalverTagFromGitHub(slug) {
  const url = `https://api.github.com/repos/${slug}/tags?per_page=50`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'zenit-week-inject-version' } });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
  const tags = await resp.json();
  // GitHub returns tags in repo order (usually most-recent first by commit
  // date). For CalVer the alphabetic sort coincides with chronological, so
  // sorting descending by name is also correct and resilient to ordering
  // changes.
  const calvers = tags.map(t => t.name).filter(n => VERSION_REGEX.test(n)).sort().reverse();
  return calvers[0] || null;
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
  const fetchAttempts = [
    'git fetch --tags --unshallow',
    'git fetch --tags --depth=100',
    'git fetch --tags',
  ];
  for (const cmd of fetchAttempts) {
    try {
      execSync(cmd, { stdio: 'pipe' });
      break;
    } catch (err) {
      console.warn(`[inject-version] '${cmd}' failed:`, (err.stderr || err.message || '').toString().trim().slice(0, 200));
    }
  }
  return execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

export async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = resolve(__dirname, '..', 'zenit-week.html');
  const version = await resolveVersion();
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
