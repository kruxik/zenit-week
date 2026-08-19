#!/usr/bin/env node
// Build-time seed injector — mirrors assets/playground-seed.json into the
// `const PLAYGROUND_SEED = …` block in zenit-week.html (between the
// PLAYGROUND_SEED_START/END markers). The JSON file is the single editable
// source of truth for the onboarding playground; this keeps the inlined copy
// in sync (the app ships as one file and runs from file://, so it can't fetch
// the sibling JSON at runtime).
//
// Idempotent: re-running with an unchanged JSON leaves the HTML byte-identical.
// Runs via `npm run build` (before inject-version) and can be run standalone.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '/* PLAYGROUND_SEED_START */';
const END = '/* PLAYGROUND_SEED_END */';

// Build the `const PLAYGROUND_SEED = {…};` line from the JSON source.
// Only `week` and `colors` are inlined — the `_comment` doc field is dropped.
export function buildSeedBlock(jsonText) {
  const parsed = JSON.parse(jsonText);
  const seed = { week: parsed.week, colors: parsed.colors };
  if (!seed.week || !Array.isArray(seed.week.nodes) || !seed.colors) {
    throw new Error('playground-seed.json must contain { week: { nodes: [...] }, colors: {...} }');
  }
  return `${START}\nconst PLAYGROUND_SEED = ${JSON.stringify(seed)};\n${END}`;
}

export function substituteSeed(html, block) {
  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Seed markers ${START} / ${END} not found in HTML`);
  }
  if (endIdx < startIdx) throw new Error('Seed END marker precedes START marker');
  const before = html.slice(0, startIdx);
  const after = html.slice(endIdx + END.length);
  return before + block + after;
}

export function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(__dirname, '..');
  const htmlPath = resolve(repo, 'zenit-week.html');
  const jsonPath = resolve(repo, 'assets', 'playground-seed.json');

  const jsonText = readFileSync(jsonPath, 'utf8');
  const html = readFileSync(htmlPath, 'utf8');
  const block = buildSeedBlock(jsonText);
  const out = substituteSeed(html, block);
  if (out !== html) {
    writeFileSync(htmlPath, out);
    console.log('[inject-playground-seed] PLAYGROUND_SEED updated from assets/playground-seed.json');
  } else {
    console.log('[inject-playground-seed] PLAYGROUND_SEED already up to date');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
