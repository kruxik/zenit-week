// The Umami relay (api/umami-send.js) answers only same-origin POSTs, using the
// same rule as api/token.js, and refuses oversized bodies.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/umami-send.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  return res;
}

function post(headers, body = { type: 'event', payload: { name: 'x' } }) {
  return { method: 'POST', headers: { host: 'zenitweek.com', ...headers }, body };
}

describe('api/umami-send origin and size gate', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects cross-site and same-site by Sec-Fetch-Site', async () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      const res = mockRes();
      await handler(post({ 'sec-fetch-site': site, origin: 'https://zenitweek.com' }), res);
      expect(res.statusCode).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a foreign Origin, an opaque null Origin and no headers at all', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, {}]) {
      const res = mockRes();
      await handler(post(headers), res);
      expect(res.statusCode).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('relays a same-origin POST (Sec-Fetch-Site or matching Origin)', async () => {
    for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { origin: 'https://zenitweek.com' }]) {
      const res = mockRes();
      await handler(post(headers), res);
      expect(res.statusCode).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts http Origin only on localhost', async () => {
    const ok = mockRes();
    await handler(post({ host: 'localhost:3000', origin: 'http://localhost:3000' }), ok);
    expect(ok.statusCode).toBe(200);
    const bad = mockRes();
    await handler(post({ origin: 'http://zenitweek.com' }), bad);
    expect(bad.statusCode).toBe(403);
  });

  it('answers 413 above 8 KB, for object and string bodies, without relaying', async () => {
    const big = 'x'.repeat(8 * 1024 + 1);
    for (const body of [{ payload: { data: big } }, big]) {
      const res = mockRes();
      await handler(post({ 'sec-fetch-site': 'same-origin' }, body), res);
      expect(res.statusCode).toBe(413);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still rejects non-POST with 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: { host: 'zenitweek.com' } }, res);
    expect(res.statusCode).toBe(405);
  });
});
