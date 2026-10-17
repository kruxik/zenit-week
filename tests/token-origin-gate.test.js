// The token proxy (api/token.js) answers only same-origin JSON POSTs. A
// cross-site top-level form POST could otherwise overwrite the HttpOnly zw_rt
// cookie with an attacker's refresh token (SameSite=Lax restricts sending a
// cookie, not setting one) or clear it with a logout.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/token.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.json = (body) => { res.body = body; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

function post(headers, body) {
  return { method: 'POST', headers: { host: 'zenitweek.com', ...headers }, body };
}

const CODE_BODY = {
  grant_type: 'authorization_code',
  code: 'attacker-code',
  code_verifier: 'attacker-verifier',
  redirect_uri: 'https://zenitweek.com/app',
};

describe('api/token origin and content-type gate', () => {
  let fetchMock;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'at', refresh_token: 'rt' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('rejects a cross-site request by Sec-Fetch-Site before exchanging anything', async () => {
    const res = mockRes();
    await handler(post({
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
      'content-type': 'application/json',
    }, CODE_BODY), res);
    expect(res.statusCode).toBe(403);
    expect(res.headers['Set-Cookie']).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects same-site (a sibling subdomain) as well', async () => {
    const res = mockRes();
    await handler(post({ 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, CODE_BODY), res);
    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a mismatched Origin when Sec-Fetch-Site is absent', async () => {
    const res = mockRes();
    await handler(post({ origin: 'https://evil.example', 'content-type': 'application/json' }, CODE_BODY), res);
    expect(res.statusCode).toBe(403);
    expect(res.headers['Set-Cookie']).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a form-urlencoded body even from the same origin', async () => {
    const res = mockRes();
    await handler(post({
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
    }, CODE_BODY), res);
    expect(res.statusCode).toBe(415);
    expect(res.headers['Set-Cookie']).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a cross-site logout without touching the cookie', async () => {
    const res = mockRes();
    await handler(post({
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
      'content-type': 'application/x-www-form-urlencoded',
    }, { grant_type: 'logout' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('accepts a same-origin JSON code exchange and moves the refresh token into the cookie', async () => {
    const res = mockRes();
    await handler(post({
      'sec-fetch-site': 'same-origin',
      origin: 'https://zenitweek.com',
      'content-type': 'application/json; charset=utf-8',
    }, CODE_BODY), res);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ access_token: 'at' });
    expect(res.headers['Set-Cookie']).toMatch(/^zw_rt=rt;/);
  });

  it('accepts a localhost dev request whose Origin matches the host', async () => {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: { grant_type: 'logout' },
    }, res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Set-Cookie']).toMatch(/^zw_rt=;/);
  });

  it.each([
    ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['[::1]:3000', 'http://[::1]:3000'],
  ])('accepts a loopback dev request on %s whose Origin matches the host', async (host, origin) => {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host, origin, 'content-type': 'application/json' },
      body: { grant_type: 'logout' },
    }, res);
    expect(res.statusCode).toBe(204);
  });

  it('rejects a localhost Origin whose port differs from the Host', async () => {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:4000', 'content-type': 'application/json' },
      body: { grant_type: 'logout' },
    }, res);
    expect(res.statusCode).toBe(403);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('rejects a localhost Origin whose host differs from the Host', async () => {
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
      body: { grant_type: 'logout' },
    }, res);
    expect(res.statusCode).toBe(403);
  });

  it('fails closed when neither Sec-Fetch-Site nor Origin is sent', async () => {
    const res = mockRes();
    await handler(post({ 'content-type': 'application/json' }, { grant_type: 'logout' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('rejects an opaque Origin: null (sandboxed frame, data: URL)', async () => {
    const res = mockRes();
    await handler(post({ origin: 'null', 'content-type': 'application/json' }, CODE_BODY), res);
    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Sec-Fetch-Site: none (a user-initiated navigation, not the page)', async () => {
    const res = mockRes();
    await handler(post({
      'sec-fetch-site': 'none',
      origin: 'https://zenitweek.com',
      'content-type': 'application/json',
    }, CODE_BODY), res);
    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an http:// Origin on a non-localhost host even when the host matches', async () => {
    const res = mockRes();
    await handler(post({ origin: 'http://zenitweek.com', 'content-type': 'application/json' }, CODE_BODY), res);
    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the full https:// origin when Sec-Fetch-Site is absent', async () => {
    const res = mockRes();
    await handler(post({ origin: 'https://zenitweek.com', 'content-type': 'application/json' }, { grant_type: 'logout' }), res);
    expect(res.statusCode).toBe(204);
  });

  it('keeps OPTIONS and the 405 for other methods', async () => {
    const opt = mockRes();
    await handler({ method: 'OPTIONS', headers: {} }, opt);
    expect(opt.statusCode).toBe(204);
    const get = mockRes();
    await handler({ method: 'GET', headers: {} }, get);
    expect(get.statusCode).toBe(405);
  });
});
