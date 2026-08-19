import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCsp, extractInlineScripts, hashScript } from '../scripts/csp-hashes.mjs';

const htmlPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'zenit-week.html');
const html = readFileSync(htmlPath, 'utf8');

describe('CSP script hashes', () => {
  it('committed HTML carries hashes matching its own inline scripts', () => {
    // Fails whenever an inline <script> is edited without running `npm run csp`.
    expect(applyCsp(html)).toBe(html);
  });

  it('never falls back to unsafe-inline for scripts', () => {
    const scriptSrc = html.match(/script-src\s+([^;]*);/)[1];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('hashes every inline script block', () => {
    const bodies = extractInlineScripts(html);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(html).toContain(hashScript(body));
  });

  it('keeps vercel.live out of the committed policy', () => {
    expect(html).not.toContain('https://vercel.live');
  });

  it('re-adds vercel.live only for preview deployments', () => {
    const preview = applyCsp(html, { allowVercelLive: true });
    expect(preview.match(/script-src\s+([^;]*);/)[1]).toContain('https://vercel.live');
    expect(preview.match(/frame-src\s+([^;]*);/)[1]).toContain('https://vercel.live');
    // Idempotent: a second pass must not duplicate the entry.
    expect(applyCsp(preview, { allowVercelLive: true })).toBe(preview);
  });
});

describe('Landing page CSP headers (vercel.json)', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const vercelJson = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  const cspHeaders = vercelJson.headers
    .flatMap(h => h.headers)
    .filter(h => h.key === 'Content-Security-Policy' && h.value.includes('script-src'))
    .map(h => h.value);

  it('serves a script-src CSP for the landing routes', () => {
    // One for /, /privacy, /terms — one for /cs.
    expect(cspHeaders.length).toBe(2);
  });

  it('carries a hash for every executable inline script on the landing pages', () => {
    // Fails whenever an inline <script> on a landing page is edited without
    // updating the hashes in vercel.json headers.
    for (const page of ['index.html', 'cs/index.html', 'privacy.html', 'terms.html']) {
      const pageHtml = readFileSync(resolve(root, page), 'utf8');
      for (const body of extractInlineScripts(pageHtml)) {
        const hash = hashScript(body);
        for (const csp of cspHeaders) expect(csp, `${page} hash missing`).toContain(hash);
      }
    }
  });

  it('never allows unsafe-inline scripts on landing pages', () => {
    for (const csp of cspHeaders) {
      const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
    }
  });
});
