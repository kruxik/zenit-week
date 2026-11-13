// The server's bundled baseline manifest is the page's manifest
// (docs/specs/mcp-updates.md section 3.4, row 1 and section 7, row 7): a
// server on its first start, with no tab yet, lists exactly what the app
// offers. `npm run mcp:baseline` rewrites the file; otherwise a drift fails.
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import { bridgeManifest } from './setup.js';
import { validateManifest } from '../mcp/core.js';

const FILE = new URL('../mcp/baseline-manifest.json', import.meta.url);

describe('baseline manifest', () => {
  const page = validateManifest(bridgeManifest());

  test('the page manifest passes the server check', () => {
    expect(page).toBeTruthy();
  });

  test('mcp/baseline-manifest.json equals it (run npm run mcp:baseline after a tool change)', () => {
    const text = JSON.stringify(page, null, 2) + '\n';
    if (process.env.ZW_WRITE_BASELINE === '1') fs.writeFileSync(FILE, text);
    expect(fs.readFileSync(FILE, 'utf8')).toBe(text);
  });
});
