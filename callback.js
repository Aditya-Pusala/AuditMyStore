import crypto from 'crypto';

// ── Simple in-memory token store ─────────────────────────────────────────────
// For production replace with Vercel KV / Supabase / PlanetScale:
//   import { kv } from '@vercel/kv';
//   await kv.set(`token:${shop}`, accessToken, { ex: 60 * 60 * 24 * 365 });
const TOKEN_STORE = global.__shopifyTokens || (global.__shopifyTokens = {});

export function getToken(shop) { return TOKEN_STORE[shop] || null; }
export function saveToken(shop, token) { TOKEN_STORE[shop] = token; }

// ── HMAC validation ───────────────────────────────────────────────────────────
function verifyHmac(query, secret) {
  const { hmac, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

export default async function handler(req, res) {
  const { code, shop, state, hmac } = req.query;

  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const appUrl       = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    return res.status(500).send('Missing environment variables');
  }

  // 1. Validate HMAC
  if (!hmac || !verifyHmac(req.query, clientSecret)) {
    return res.status(400).send('Invalid HMAC — request may be forged');
  }

  // 2. Validate state (CSRF)
  const cookieState = (req.headers.cookie || '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('shopify_oauth_state='))
    ?.split('=')[1];

  if (!cookieState || cookieState !== state) {
    return res.status(403).send('State mismatch — possible CSRF attack');
  }

  // 3. Exchange code for access token
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', err);
      return res.status(400).send('Token exchange failed: ' + err);
    }

    const { access_token, scope } = await tokenRes.json();
    console.log(`✅ Authorized shop: ${shop} | scopes: ${scope}`);

    // 4. Store the token
    saveToken(shop, access_token);

    // 5. Clear the CSRF cookie and redirect to the app with shop param
    res.setHeader(
      'Set-Cookie',
      'shopify_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    );

    return res.redirect(302, `${appUrl}/?shop=${encodeURIComponent(shop)}&authorized=1`);
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Internal error: ' + err.message);
  }
}
