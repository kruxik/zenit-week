// The Umami relay (api/umami-send.js). These tests pin what reaches Umami:
// the visitor's IP in x-umami-client-ip (without it every visit lands in
// Vercel's Frankfurt), the tracker's own headers, and the body unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/umami-send.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.send = (body) => { res.body = body; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('api/umami-send', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{"cache":"abc"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes the visitor IP, the tracker headers and the body to Umami', async () => {
    const req = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 test',
        'x-umami-website-id': 'site',
        'x-umami-cache': 'token',
        'x-real-ip': '203.0.113.7',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        cookie: 'zw_rt=secret',
      },
      body: { type: 'event', payload: { url: '/' } },
    };
    const res = mockRes();
    await handler(req, res);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gateway.umami.is/api/send');
    expect(init.headers['x-umami-client-ip']).toBe('203.0.113.7');
    expect(init.headers['user-agent']).toBe('Mozilla/5.0 test');
    expect(init.headers['x-umami-cache']).toBe('token');
    expect(init.headers.cookie).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual(req.body);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"cache":"abc"}');
  });

  it('falls back to the first X-Forwarded-For entry without x-real-ip', async () => {
    const req = { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }, body: {} };
    await handler(req, mockRes());
    expect(fetchMock.mock.calls[0][1].headers['x-umami-client-ip']).toBe('198.51.100.4');
  });

  it('rejects anything but POST without calling Umami', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 502 when Umami is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(502);
  });
});
