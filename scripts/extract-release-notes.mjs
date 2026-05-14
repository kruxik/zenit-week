#!/usr/bin/env node
// Extract the CHANGELOG.md section for a specific version tag and write it
// to stdout. Used in CI to feed `gh release create --notes-file`.
//
// Usage:  node scripts/extract-release-notes.mjs v2026.05.14
//
// Matches the first heading like `## [v2026.05.14] - ...` (or `## v2026.05.14`)
// and returns everything until the next `## ` heading.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATH = resolve(__dirname, '..', 'CHANGELOG.md');

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: extract-release-notes.mjs <tag>');
  process.exit(2);
}

const src = readFileSync(CHANGELOG_PATH, 'utf8');
const lines = src.split('\n');

// Build a regex tolerant of `[vX]`, `[vX] - DATE`, or bare `vX`.
const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headingRe = new RegExp(`^##\\s+\\[?${esc}\\]?\\b`);

let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (headingRe.test(lines[i])) { start = i; break; }
}
if (start === -1) {
  console.error(`No section found for tag ${tag} in CHANGELOG.md`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s+/.test(lines[i])) { end = i; break; }
}

// Strip the heading itself — GitHub Release UI already shows the tag.
// Trim leading and trailing blank lines.
const body = lines.slice(start + 1, end).join('\n').replace(/^\s+|\s+$/g, '');
process.stdout.write(body + '\n');
