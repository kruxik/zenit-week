// One release ships the app, the agent server on npm and the Claude Desktop
// extension together (docs/specs/agent-bridge-setup.md section 3):
// `npm run release` raises the server version when it changed, and the
// production deploy publishes it and attaches the extension.
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import {
  nextMinorVersion, planMcpVersion, withVersion, withServerLatest, SERVER_LATEST_RE, MCP_RELEASE_FILES, MCP_VERSION_FILES,
} from '../scripts/release.mjs';

const root = new URL('..', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');

describe('agent server version at release', () => {
  test('a minor step, major kept for npx zenit-week-mcp@1', () => {
    expect(nextMinorVersion('1.0.0')).toBe('1.1.0');
    expect(nextMinorVersion('1.9.3')).toBe('1.10.0');
    expect(() => nextMinorVersion('1.0.0-beta.1')).toThrow();
  });

  test('bumps only when the server changed and its version is already out', () => {
    expect(planMcpVersion({ changed: [], current: '1.0.0', published: ['1.0.0'] }))
      .toMatchObject({ bump: false, version: '1.0.0' });
    expect(planMcpVersion({ changed: ['mcp/core.js'], current: '1.0.0', published: ['1.0.0'] }))
      .toMatchObject({ bump: true, from: '1.0.0', version: '1.1.0' });
    // Raised by hand and not published yet: ships as it is.
    expect(planMcpVersion({ changed: ['mcp/core.js'], current: '1.1.0', published: ['1.0.0'] }))
      .toMatchObject({ bump: false, version: '1.1.0' });
  });

  test('the README alone is no server change; every version file is a real file', () => {
    expect(MCP_RELEASE_FILES).not.toContain('mcp/README.md');
    for (const f of MCP_VERSION_FILES) expect(fs.existsSync(new URL(f, root)), f).toBe(true);
  });

  test('writing the version keeps each file byte for byte apart from the version', () => {
    for (const f of MCP_VERSION_FILES) {
      const text = read(f);
      const current = JSON.parse(text).version;
      expect(withVersion(f, text, current), f).toBe(text);
    }
    const lock = JSON.parse(withVersion('mcp/package-lock.json', read('mcp/package-lock.json'), '1.1.0'));
    expect([lock.version, lock.packages[''].version]).toEqual(['1.1.0', '1.1.0']);
  });

  test('package and extension carry the same version today', () => {
    expect(JSON.parse(read('mcp/manifest.json')).version).toBe(JSON.parse(read('mcp/package.json')).version);
    expect(JSON.parse(read('mcp/package-lock.json')).version).toBe(JSON.parse(read('mcp/package.json')).version);
  });
});

describe('the page knows the latest server (mcp-updates.md 5.1)', () => {
  test('BRIDGE_SERVER_LATEST equals the mcp/package.json version', () => {
    const m = SERVER_LATEST_RE.exec(read('zenit-week.html'));
    expect(m, 'BRIDGE_SERVER_LATEST in zenit-week.html').toBeTruthy();
    expect(m[1], 'run npm run release, or set BRIDGE_SERVER_LATEST to the mcp/package.json version').toBe(JSON.parse(read('mcp/package.json')).version);
  });

  test('release rewrites only that line', () => {
    const html = read('zenit-week.html');
    const next = withServerLatest(html, '9.8.7');
    expect(SERVER_LATEST_RE.exec(next)[1]).toBe('9.8.7');
    expect(withServerLatest(next, SERVER_LATEST_RE.exec(html)[1])).toBe(html);
    expect(() => withServerLatest('nothing here', '1.0.0')).toThrow();
  });
});

describe('production deploy ships the server with the app', () => {
  const wf = read('.github/workflows/deploy-production.yml');
  const at = s => { const i = wf.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };

  test('trusted publishing: OIDC permission, no stored npm token', () => {
    at('id-token: write');
    expect(wf).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  test('extension built, then package published, then the app deployed', () => {
    const bundle = at('npm run mcp:bundle');
    const publish = at('node scripts/mcp-publish.mjs --if-new');
    const vercel = at('npx vercel --prod');
    expect(bundle).toBeLessThan(publish);
    expect(publish).toBeLessThan(vercel);
  });

  test('every app release carries the extension the Download link points at', () => {
    const creates = wf.match(/gh release create [^\n]*/g);
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) expect(c).toContain('mcp/dist/zenit-week.mcpb');
    expect(read('zenit-week.html')).toContain("'https://github.com/kruxik/zenit-week/releases/latest/download/zenit-week.mcpb'");
  });
});
