// Reminder, not a behaviour test: revoke_legacy is transitional and answers 410
// from 2026-11-01 (LEGACY_REVOKE_SUNSET in api/token.js). From that date this
// test fails until the dead code is deleted - the revoke_legacy branch in
// api/token.js and purgeLegacyRefreshToken() with its call in zenit-week.html.
// Delete this test in the same change.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUNSET = Date.parse('2026-11-01T00:00:00Z');

describe('revoke_legacy sunset', () => {
  it('is removed once the sunset date has passed', () => {
    if (Date.now() < SUNSET) return;
    const token = readFileSync(resolve(REPO, 'api/token.js'), 'utf8');
    const page = readFileSync(resolve(REPO, 'zenit-week.html'), 'utf8');
    expect(token, 'delete the revoke_legacy branch from api/token.js').not.toContain('revoke_legacy');
    expect(page, 'delete purgeLegacyRefreshToken() from zenit-week.html').not.toContain('revoke_legacy');
  });
});
