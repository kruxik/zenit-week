// Vercel Edge Function — Google OAuth token exchange proxy
// Holds GOOGLE_CLIENT_SECRET server-side so it never appears in browser code.
// Handles both authorization_code and refresh_token grant types.

const GOOGLE_CLIENT_ID = '458902252486-kh8ptv2b2b2q1echn99soes191smr56p.apps.googleusercontent.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return res.status(500).json({ error: 'server_misconfigured' });

  const { grant_type, code, code_verifier, redirect_uri, refresh_token } = req.body || {};

  const params = { grant_type, client_id: GOOGLE_CLIENT_ID, client_secret: secret };

  if (grant_type === 'authorization_code') {
    if (!code || !code_verifier || !redirect_uri)
      return res.status(400).json({ error: 'missing_params' });
    Object.assign(params, { code, code_verifier, redirect_uri });
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token)
      return res.status(400).json({ error: 'missing_params' });
    params.refresh_token = refresh_token;
  } else {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  try {
    const upstream = await fetch(GOOGLE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams(params),
    });
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(500).json({ error: 'token_exchange_failed' });
  }
}
