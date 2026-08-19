// Vercel Node serverless function — Google OAuth token exchange proxy
// Holds GOOGLE_CLIENT_SECRET server-side so it never appears in browser code.
// The Google refresh token is kept in an HttpOnly cookie (never exposed to JS)
// rather than returned to the client. Handles authorization_code and
// refresh_token grants, a revoke action for sign-out, and revoke_legacy for
// retiring plaintext tokens left in localStorage before the cookie change.

const GOOGLE_CLIENT_ID = '458902252486-kh8ptv2b2b2q1echn99soes191smr56p.apps.googleusercontent.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const REFRESH_COOKIE = 'zw_rt';
const COOKIE_MAX_AGE = 180 * 24 * 60 * 60; // 180 days

// revoke_legacy is transitional: it relays a caller-supplied token to Google
// with no session of its own, so it is an open (if harmless) relay. It stays
// only long enough for stragglers to open the app once after the cookie
// change (2026-07-28). Past this date it answers 410 and the whole action —
// plus purgeLegacyRefreshToken()'s network call in zenit-week.html — should
// be deleted outright.
const LEGACY_REVOKE_SUNSET = Date.parse('2026-11-01T00:00:00Z');

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
  const host = (req.headers.host || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
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

  // Legacy cleanup: revoke a plaintext refresh token the client found left over
  // in localStorage from before the cookie change. The cookie is untouched —
  // this token is not a session here, just a credential to retire.
  if (grant_type === 'revoke_legacy') {
    if (Date.now() >= LEGACY_REVOKE_SUNSET) return res.status(410).json({ error: 'gone' });
    if (typeof refresh_token === 'string' && refresh_token) {
      try {
        await fetch(GOOGLE_REVOKE_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({ token: refresh_token }),
        });
      } catch { /* best-effort */ }
    }
    return res.status(204).end();
  }

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

  if (grant_type === 'authorization_code') {
    if (!code || !code_verifier || !redirect_uri)
      return res.status(400).json({ error: 'missing_params' });
    Object.assign(params, { code, code_verifier, redirect_uri });
  } else if (grant_type === 'refresh_token') {
    // The HttpOnly cookie is the sole source — a body-supplied token is ignored.
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    if (!cookieToken) return res.status(400).json({ error: 'missing_params' });
    params.refresh_token = cookieToken;
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
      }
    }
    return res.status(upstream.status).json(data);
  } catch {
    return res.status(500).json({ error: 'token_exchange_failed' });
  }
}
