#!/usr/bin/env node
// Comment editor vendor bundle builder — `npm run editor:build`.
//
// Bundles vendor/editor-entry.js (ProseMirror re-exports, nothing else) into
// one minified IIFE at vendor/editor.<contenthash>.js, appends the licence
// notice of every bundled package, deletes the previous hashed file, and
// writes the new file name plus its SRI hash into the marked constant in
// zenit-week.html. The file name, the SRI hash and the page constant all come
// from the same bytes in one run, so they can never disagree.
//
// The bundle is built locally and committed: Vercel installs with --omit=dev
// and never builds it, so the reviewed bytes are the deployed bytes.
// tests/build-editor.test.js fails if the committed bundle, its name and the
// page constant drift apart.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCsp } from './csp-hashes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'vendor/editor-entry.js';
const VENDOR_DIR = 'vendor';
// Browser global the IIFE assigns — the loader in zenit-week.html reads it.
export const GLOBAL_NAME = 'ZenitProseMirror';
export const BUNDLE_FILE_REGEX = /^editor\.[0-9a-f]{16}\.js$/;

// Anything outside this list stops the build. Widening it is a deliberate,
// reviewed decision — never a quick fix to get a release out.
export const ALLOWED_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];

// The marked constant in the main app script. Only the object literal between
// the two marker comments is rewritten.
const CONSTANT_REGEX = /(\/\* editor-bundle:start \*\/)[\s\S]*?(\/\* editor-bundle:end \*\/)/;

export function contentHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

export function sriHash(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

export function bundleFileName(bytes) {
  return `editor.${contentHash(bytes)}.js`;
}

// An SPDX expression is allowed when every AND-term is allowed and, within an
// OR-group, at least one alternative is. Parentheses are ignored — nothing we
// bundle nests them, and a nested expression falls through to "not allowed".
export function isLicenseAllowed(license) {
  if (typeof license !== 'string' || !license.trim()) return false;
  const expr = license.replace(/[()]/g, ' ').trim();
  return expr.split(/\s+AND\s+/).every(term =>
    term.split(/\s+OR\s+/).some(alt => ALLOWED_LICENSES.includes(alt.trim())));
}

export function checkLicenses(packages) {
  const bad = packages.filter(p => !isLicenseAllowed(p.license));
  if (bad.length) {
    const list = bad.map(p => `${p.name}@${p.version} (${p.license || 'no licence'})`).join(', ');
    throw new Error(`[editor-build] disallowed licence: ${list}. Allowed: ${ALLOWED_LICENSES.join(', ')}`);
  }
  return packages;
}

// Package directory for a metafile input path such as
// "node_modules/prosemirror-model/dist/index.js" or a scoped equivalent.
export function packageDirOf(inputPath) {
  const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(inputPath);
  if (!m) return null;
  return inputPath.slice(0, m.index + m[0].length - 1).replace(/^\//, '');
}

function readLicenseText(dir) {
  const file = readdirSync(dir).find(f => /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(f));
  if (!file) throw new Error(`[editor-build] no licence file in ${dir}`);
  return readFileSync(join(dir, file), 'utf8').trim();
}

// Every third-party package that contributed bytes to the bundle, sorted by
// name so the notice block — and therefore the content hash — is stable.
export function collectPackages(metafile, root = ROOT) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const dir = packageDirOf(input);
    if (dir) dirs.add(dir);
  }
  return [...dirs].map(dir => {
    const abs = resolve(root, dir);
    const pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license
      : Array.isArray(pkg.licenses) ? pkg.licenses.map(l => l.type).join(' OR ') : '';
    return { name: pkg.name, version: pkg.version, license, licenseText: readLicenseText(abs) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ProseMirror's sources carry no /*! */ legal comments, so esbuild's
// --legal-comments=eof alone would ship the bundle without the MIT notices.
// This block appends them; `/*!` keeps them through any later minifier.
export function buildNotices(packages) {
  const body = packages.map(p =>
    `--- ${p.name}@${p.version} (${p.license}) ---\n${p.licenseText}`).join('\n\n');
  const escaped = body.replace(/\*\//g, '*\\/').split('\n').map(l => ` * ${l}`.trimEnd()).join('\n');
  return `/*! Third-party software bundled in this file and its licences:\n *\n${escaped}\n */\n`;
}

// LICENSE carries the notices for everything the app ships, so the editor's
// packages are listed there too — generated from the same package walk as the
// bundle, between two marker lines, so a dependency added or dropped by an
// update can never leave LICENSE behind. Packages sharing identical licence
// terms (all of ProseMirror is MIT) are grouped: each copyright line is kept,
// the terms are printed once per group. `npm run editor:build` owns the
// section; never edit it by hand.
const LICENSE_START = '--- BEGIN editor bundle notices (generated) ---';
const LICENSE_END = '--- END editor bundle notices ---';

function splitLicense(text) {
  const lines = text.split('\n');
  const copyright = lines.filter(l => /^\s*copyright\b/i.test(l)).map(l => l.trim());
  const terms = lines.filter(l => !/^\s*copyright\b/i.test(l)).join('\n').trim();
  return { copyright, terms };
}

export function buildLicenseSection(packages) {
  const groups = new Map();
  for (const p of packages) {
    const { copyright, terms } = splitLicense(p.licenseText);
    if (!groups.has(terms)) groups.set(terms, []);
    groups.get(terms).push({ ...p, copyright });
  }
  const parts = [...groups.entries()].map(([terms, pkgs]) => {
    const list = pkgs.map(p => `- ${p.name} (${p.license})${p.copyright.length ? ` — ${p.copyright.join('; ')}` : ''}`);
    return `${list.join('\n')}\n\n${terms}`;
  });
  return [
    LICENSE_START,
    '',
    'The lazy-loaded comment editor bundle (vendor/editor.<hash>.js) includes the',
    'following packages, used under the licence terms that follow each list:',
    '',
    parts.join('\n\n'),
    '',
    LICENSE_END,
  ].join('\n');
}

export function applyLicenseSection(license, section) {
  const start = license.indexOf(LICENSE_START);
  const end = license.indexOf(LICENSE_END);
  if (start !== -1 && end > start) {
    return license.slice(0, start) + section + license.slice(end + LICENSE_END.length);
  }
  return `${license.replace(/\s*$/, '')}\n\n${section}\n`;
}

export function readLicenseSection(license) {
  const start = license.indexOf(LICENSE_START);
  const end = license.indexOf(LICENSE_END);
  return start !== -1 && end > start ? license.slice(start, end + LICENSE_END.length) : null;
}

export function applyEditorConstant(html, { src, integrity }) {
  if (!CONSTANT_REGEX.test(html)) throw new Error('[editor-build] editor-bundle marker not found in zenit-week.html');
  const literal = `{ src: '${src}', integrity: '${integrity}' }`;
  return html.replace(CONSTANT_REGEX, (_m, start, end) => `${start} ${literal} ${end}`);
}

export function readEditorConstant(html) {
  const m = CONSTANT_REGEX.exec(html);
  if (!m) return null;
  const src = /src:\s*'([^']*)'/.exec(m[0])?.[1];
  const integrity = /integrity:\s*'([^']*)'/.exec(m[0])?.[1];
  return { src, integrity };
}

export async function bundle({ root = ROOT } = {}) {
  const { build } = await import('esbuild');
  const result = await build({
    absWorkingDir: root,
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: GLOBAL_NAME,
    minify: true,
    legalComments: 'eof',
    target: 'es2019',
    platform: 'browser',
    charset: 'utf8',
    metafile: true,
    write: false,
  });
  const packages = checkLicenses(collectPackages(result.metafile, root));
  const code = result.outputFiles[0].text + buildNotices(packages);
  return { bytes: Buffer.from(code, 'utf8'), packages };
}

export async function main() {
  const { bytes, packages } = await bundle();
  const fileName = bundleFileName(bytes);
  const vendorDir = resolve(ROOT, VENDOR_DIR);

  writeFileSync(join(vendorDir, fileName), bytes);
  for (const f of readdirSync(vendorDir)) {
    if (BUNDLE_FILE_REGEX.test(f) && f !== fileName) unlinkSync(join(vendorDir, f));
  }

  const htmlPath = resolve(ROOT, 'zenit-week.html');
  const html = readFileSync(htmlPath, 'utf8');
  // The constant sits inside the main inline script, so its CSP hash moves
  // with it — refresh the hashes in the same write.
  const out = applyCsp(applyEditorConstant(html, { src: `/${VENDOR_DIR}/${fileName}`, integrity: sriHash(bytes) }));
  if (out !== html) writeFileSync(htmlPath, out);

  const licensePath = resolve(ROOT, 'LICENSE');
  const license = readFileSync(licensePath, 'utf8');
  const licenseOut = applyLicenseSection(license, buildLicenseSection(packages));
  if (licenseOut !== license) writeFileSync(licensePath, licenseOut);

  console.log(`[editor-build] ${VENDOR_DIR}/${fileName} — ${bytes.length} bytes, ${packages.length} packages`
    + (out === html ? ', page already up to date' : ', page constant + CSP updated')
    + (licenseOut === license ? '' : ', LICENSE notices updated'));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
