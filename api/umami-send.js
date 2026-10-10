// Vercel Node serverless function — first-party relay for Umami Cloud events.
// The tracker posts to /u/api/send (rewritten here in vercel.json). A plain
// rewrite to gateway.umami.is reaches Umami from Vercel's own IP, so every
// visitor showed up in Frankfurt. This relay passes the visitor's IP along in
// x-umami-client-ip, the header Umami Cloud reads before anything else
// (umami src/lib/ip.ts, cloud mode). X-Forwarded-For is not enough: Cloudflare
// in front of the gateway sets cf-connecting-ip, which Umami prefers over it.
// Tested 2026-10-10: x-umami-client-ip moved a test visit to its own country,
// X-Forwarded-For left it on the sender's.

const UMAMI_SEND_URL = 'https://gateway.umami.is/api/send';

// Request headers the tracker sets that Umami needs to see.
const FORWARDED_HEADERS = ['content-type', 'user-agent', 'x-umami-website-id', 'x-umami-hostname', 'x-umami-cache'];

// Vercel sets x-real-ip to the connecting client and overwrites any value the
// client sent, so it cannot be spoofed from the browser.
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? String(forwarded).split(',')[0].trim() : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const headers = {};
  for (const name of FORWARDED_HEADERS) {
    if (req.headers[name]) headers[name] = String(req.headers[name]);
  }
  const ip = clientIp(req);
  if (ip) headers['x-umami-client-ip'] = ip;

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

  try {
    const upstream = await fetch(UMAMI_SEND_URL, { method: 'POST', headers, body });
    const text = await upstream.text();
    const type = upstream.headers.get('content-type');
    if (type) res.setHeader('Content-Type', type);
    return res.status(upstream.status).send(text);
  } catch {
    return res.status(502).json({ error: 'umami_unreachable' });
  }
}
