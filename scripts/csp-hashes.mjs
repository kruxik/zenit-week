#!/usr/bin/env node
// CSP script hash generator — replaces 'unsafe-inline' in the
// Content-Security-Policy meta tag of zenit-week.html with an explicit
// 'sha256-...' hash for every inline <script> block.
//
// The committed HTML always carries hashes that match its own inline scripts,
// so opening the file straight from disk (file://) works. `npm run build`
// re-runs this AFTER inject-version.js has substituted __APP_VERSION__, since
// that substitution changes the body of the main app script and therefore its
// hash. tests/csp-hashes.test.js fails if the committed hashes drift.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Matches every <script> element. Inline blocks (no src attribute) get hashed;
// blocks with src are left to the host allowlist.
const SCRIPT_REGEX = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SCRIPT_SRC_DIRECTIVE = /(script-src\s+)([^;]*)(;)/;
const FRAME_SRC_DIRECTIVE = /(frame-src\s+)([^;]*)(;)/;

// The Vercel preview comments toolbar only exists on preview deployments.
// Production and the committed file must not grant it script privileges.
const VERCEL_LIVE = 'https://vercel.live';

export function extractInlineScripts(html) {
  const bodies = [];
  for (const [, attrs, body] of html.matchAll(SCRIPT_REGEX)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    // Data blocks (application/ld+json) never execute, so CSP neither blocks
    // them nor needs a hash for them.
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if (type && !/^(text\/javascript|module)$/i.test(type)) continue;
    bodies.push(body);
  }
  return bodies;
}

export function hashScript(body) {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

export function buildScriptSrc(html, { allowVercelLive = false } = {}) {
  const sources = ["'self'", ...extractInlineScripts(html).map(hashScript)];
  if (allowVercelLive) sources.push(VERCEL_LIVE);
  // One source per line, aligned under the directive name — the hash list is
  // far too long to stay readable on a single line.
  return sources.join('\n               ');
}

export function applyCsp(html, { allowVercelLive = false } = {}) {
  const scriptSrc = buildScriptSrc(html, { allowVercelLive });
  if (!SCRIPT_SRC_DIRECTIVE.test(html)) throw new Error('script-src directive not found in HTML');
  if (!FRAME_SRC_DIRECTIVE.test(html)) throw new Error('frame-src directive not found in HTML');
  return html
    .replace(SCRIPT_SRC_DIRECTIVE, (_m, head, _body, tail) => `${head}${scriptSrc}${tail}`)
    .replace(FRAME_SRC_DIRECTIVE, (_m, head, body, tail) => {
      // 'none' is a placeholder, not a source — it must stand alone, so strip
      // it whenever a real source joins the list and restore it when none do.
      const frames = body.split(/\s+/).filter(s => s && s !== VERCEL_LIVE && s !== "'none'");
      if (allowVercelLive) frames.push(VERCEL_LIVE);
      if (!frames.length) frames.push("'none'");
      return `${head}${frames.join(' ')}${tail}`;
    });
}

export function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = resolve(__dirname, '..', 'zenit-week.html');
  const html = readFileSync(htmlPath, 'utf8');
  const out = applyCsp(html, { allowVercelLive: process.env.VERCEL_ENV === 'preview' });
  if (out === html) {
    console.log('[csp-hashes] CSP already up to date');
    return;
  }
  writeFileSync(htmlPath, out);
  console.log(`[csp-hashes] wrote ${extractInlineScripts(html).length} inline script hashes`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
