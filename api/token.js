// Vercel Node serverless function — Google OAuth token exchange proxy
// Holds GOOGLE_CLIENT_SECRET server-side so it never appears in browser code.
// The Google refresh token is kept in an HttpOnly cookie (never exposed to JS)
// rather than returned to the client. Handles authorization_code and
// refresh_token grants plus a revoke action for sign-out.

const GOOGLE_CLIENT_ID = '458902252486-kh8ptv2b2b2q1echn99soes191smr56p.apps.googleusercontent.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const REFRESH_COOKIE = 'zw_rt';
const COOKIE_MAX_AGE = 180 * 24 * 60 * 60; // 180 days

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function isLocalHost(req) {
  const host = req.headers.host || '';
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

function setRefreshCookie(req, res, token) {
  const attrs = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/token',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (!isLocalHost(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearRefreshCookie(req, res) {
  const attrs = [
    `${REFRESH_COOKIE}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/token',
    'Max-Age=0',
  ];
  if (!isLocalHost(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return res.status(500).json({ error: 'server_misconfigured' });

  const { grant_type, code, code_verifier, redirect_uri, refresh_token } = req.body || {};

  // Sign-out: revoke the refresh token held in the cookie and clear it.
  if (grant_type === 'revoke') {
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    clearRefreshCookie(req, res);
    if (cookieToken) {
      try {
        await fetch(GOOGLE_REVOKE_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({ token: cookieToken }),
        });
      } catch { /* best-effort */ }
    }
    return res.status(204).end();
  }

  const params = { grant_type, client_id: GOOGLE_CLIENT_ID, client_secret: secret };
  // Whether to (re)issue the HttpOnly cookie from a body-supplied refresh token.
  // This only happens during one-time migration of a legacy localStorage token.
  // TODO: remove after 2026-07-28 — legacy localStorage refresh-token migration;
  // drop the body `refresh_token` fallback so the cookie is the sole source.
  let migrateToken = null;

  if (grant_type === 'authorization_code') {
    if (!code || !code_verifier || !redirect_uri)
      return res.status(400).json({ error: 'missing_params' });
    Object.assign(params, { code, code_verifier, redirect_uri });
  } else if (grant_type === 'refresh_token') {
    // Prefer the HttpOnly cookie; fall back to a body token for migration only.
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    // TODO: remove after 2026-07-28 — once migration ends, require the cookie:
    //   const token = cookieToken;  (drop `|| refresh_token` and `migrateToken`)
    const token = cookieToken || refresh_token;
    if (!token) return res.status(400).json({ error: 'missing_params' });
    params.refresh_token = token;
    if (!cookieToken && refresh_token) migrateToken = refresh_token;
  } else {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  try {
    const upstream = await fetch(GOOGLE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams(params),
    });
    const data = await upstream.json();

    if (upstream.ok) {
      // Move any refresh token into the HttpOnly cookie and strip it from the
      // JSON so it never reaches browser JavaScript.
      if (data.refresh_token) {
        setRefreshCookie(req, res, data.refresh_token);
        delete data.refresh_token;
      } else if (migrateToken) {
        setRefreshCookie(req, res, migrateToken);
      }
    }
    return res.status(upstream.status).json(data);
  } catch {
    return res.status(500).json({ error: 'token_exchange_failed' });
  }
}
