#!/usr/bin/env node
// Release orchestrator — prepares a CalVer release locally.
//
// Flow:
//   1. Verify the working tree is clean and we're on main.
//   2. Compute next CalVer tag (vYYYY.MM.DD, with .N suffix if today's
//      tag already exists).
//   3. Run git-cliff to prepend a new version section into CHANGELOG.md
//      based on Conventional Commits since the previous tag.
//   4. Open $VISUAL || $EDITOR || vi on CHANGELOG.md so the human can
//      polish the generated entries.
//   5. Confirm, commit "chore(release): vX", tag vX.
//   6. Print the push instruction — never push automatically; tag push
//      is what triggers production deploy via deploy-production.yml.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CHANGELOG_PATH = resolve(REPO_ROOT, 'CHANGELOG.md');
const VERSION_REGEX = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function shInherit(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function assertCleanTree() {
  const status = sh('git status --porcelain');
  if (status) die(`Working tree not clean. Commit or stash first:\n${status}`);
}

function assertOnMain() {
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') die(`Releases must be cut from main (currently on ${branch}).`);
}

function computeNextVersion() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const base = `v${y}.${m}.${d}`;

  // List tags that match today's base. Includes the bare base if it exists.
  const tagsRaw = sh(`git tag --list "${base}" "${base}.*"`);
  const tags = tagsRaw.split('\n').filter(Boolean);

  if (tags.length === 0) return base;

  // Find highest .N suffix already used.
  let maxN = 0;
  let hasBare = false;
  for (const t of tags) {
    if (t === base) { hasBare = true; continue; }
    const m = t.match(/\.(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  if (hasBare && maxN === 0) return `${base}.1`;
  return `${base}.${maxN + 1}`;
}

function latestPriorTag() {
  try {
    return sh('git describe --tags --abbrev=0');
  } catch {
    return null;
  }
}

function splitIntroAndSections(content) {
  // The intro is the prose before the first `## ` heading (file title,
  // Keep-a-Changelog blurb, etc.). git-cliff's --prepend would land new
  // version sections above this intro, so we strip it first and re-attach
  // after the prepend.
  const lines = content.split('\n');
  let firstSection = lines.findIndex(l => /^##\s+/.test(l));
  if (firstSection === -1) return { intro: '', sections: content };
  return {
    intro: lines.slice(0, firstSection).join('\n'),
    sections: lines.slice(firstSection).join('\n'),
  };
}

function runGitCliff(version) {
  // --tag: stamp Unreleased commits with this version
  // --unreleased: only emit commits since last tag
  // --strip header: skip the cliff.toml header in output (intro lives in
  //   CHANGELOG.md, re-attached below after prepend)
  // --prepend: insert generated section at top of the section-only file
  const original = readFileSync(CHANGELOG_PATH, 'utf8');
  const { intro, sections } = splitIntroAndSections(original);
  writeFileSync(CHANGELOG_PATH, sections);
  try {
    shInherit(`npx --yes git-cliff --tag ${version} --unreleased --strip header --prepend ${CHANGELOG_PATH}`);
  } catch (err) {
    writeFileSync(CHANGELOG_PATH, original);
    throw err;
  }
  const prepended = readFileSync(CHANGELOG_PATH, 'utf8');
  const combined = intro ? `${intro}\n${prepended}` : prepended;
  writeFileSync(CHANGELOG_PATH, combined);
}

function openInEditor(file) {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  console.log(`\n📝 Opening ${file} in ${editor} — polish the new section, save, exit.\n`);
  const res = spawnSync(editor, [file], { stdio: 'inherit', shell: false });
  if (res.status !== 0) die(`Editor exited with status ${res.status}.`);
}

async function confirm(rl, prompt) {
  const ans = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
  return ans === 'y' || ans === 'yes';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!dryRun) assertCleanTree();
  assertOnMain();

  const version = computeNextVersion();
  if (!VERSION_REGEX.test(version)) die(`Computed version "${version}" is malformed.`);

  const prior = latestPriorTag();
  console.log(`\n🚀 ${dryRun ? '[DRY RUN] ' : ''}Preparing release: ${version}`);
  console.log(`   Previous tag: ${prior || '(none)'}`);

  // Back up CHANGELOG so dry-run can restore it after the editor closes.
  const changelogBackup = dryRun ? readFileSync(CHANGELOG_PATH, 'utf8') : null;

  runGitCliff(version);
  console.log(`✅ Draft section written to CHANGELOG.md`);

  openInEditor(CHANGELOG_PATH);

  console.log('\n--- Pending CHANGELOG.md diff ---');
  shInherit('git --no-pager diff -- CHANGELOG.md');
  console.log('--- end diff ---\n');

  if (dryRun) {
    writeFileSync(CHANGELOG_PATH, changelogBackup);
    console.log(`🧪 Dry run complete. CHANGELOG.md restored. No commit, no tag.`);
    console.log(`   Would have committed: chore(release): ${version}`);
    console.log(`   Would have tagged:    ${version}\n`);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    if (!(await confirm(rl, `Commit and tag ${version}?`))) {
      console.log('\n⏸  Aborted. CHANGELOG.md left edited; revert with:  git checkout -- CHANGELOG.md\n');
      process.exit(1);
    }
  } finally {
    rl.close();
  }

  shInherit('git add CHANGELOG.md');
  shInherit(`git commit -m "chore(release): ${version}"`);
  shInherit(`git tag ${version}`);

  console.log(`\n🎉 Release ${version} prepared locally.\n`);
  console.log(`   To deploy to production, push the commit and tag:\n`);
  console.log(`     git push --follow-tags origin main\n`);
  console.log(`   Tag push will trigger .github/workflows/deploy-production.yml.\n`);
}

main().catch(err => die(err.stack || err.message));
