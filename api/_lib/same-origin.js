// Shared by the Vercel functions (files under api/_lib are not routes).

export function isLocalHost(req) {
  const host = (req.headers.host || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

// Sec-Fetch-Site is the browser's own verdict and wins when present; only
// same-origin passes (same-site would admit a sibling subdomain, and 'none' is
// a user-typed navigation, never the page's own fetch). Without it, Origin
// must be this deployment's full origin: https:// plus the Host, with http://
// accepted only on a localhost dev server. Anything else fails closed - an
// opaque 'null' Origin, and a request with neither header. The page's own
// calls (exchangeToken, and sw.js mintAccessToken) are same-origin POST
// fetches, which every browser sends with Origin, so the only callers that
// arrive with neither are non-browsers, and nothing here is for them.
export function isSameOriginRequest(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return String(site).toLowerCase() === 'same-origin';
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = String(req.headers.host || '').toLowerCase();
  if (!host) return false;
  let parsed;
  try { parsed = new URL(String(origin)); } catch { return false; }
  const allowed = [`https://${host}`];
  if (isLocalHost(req)) allowed.push(`http://${host}`);
  return allowed.includes(parsed.origin.toLowerCase());
}
