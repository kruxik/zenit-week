// Betterstack uptime monitors check each page for its own keyword, so the
// page is known to serve the expected content and not just a 200. The
// homepage token was lost once when index.html was replaced by a redesign;
// this test keeps any page rewrite from dropping a token again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TOKENS = {
  'index.html': 'a3f7e1b9c2d40856e7f3a1b9c2d40e56',
  'zenit-week.html': 'd6b2f4e8c1a30975b4e2d6f8c1a30e79',
};

describe('Betterstack verification tokens', () => {
  for (const [page, token] of Object.entries(TOKENS)) {
    it(`${page} carries its keyword`, () => {
      const html = readFileSync(resolve(REPO, page), 'utf8');
      expect(html).toContain(`<!-- bstack-verify: ${token} -->`);
    });
  }
});
