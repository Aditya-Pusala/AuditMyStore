import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

// Token storage using Vercel Postgres (Neon)
async function getDb() {
  const sql = neon(process.env.POSTGRES_URL);
  // Create table if it doesn't exist
  await sql`
    CREATE TABLE IF NOT EXISTS shopify_tokens (
      shop TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  return sql;
}

export async function getToken(shop) {
  try {
    const sql = await getDb();
    const rows = await sql`SELECT token FROM shopify_tokens WHERE shop = ${shop}`;
    return rows[0]?.token || null;
  } catch (e) {
    console.error('DB getToken error:', e);
    return null;
  }
}

export async function saveToken(shop, token) {
  try {
    const sql = await getDb();
    await sql`
      INSERT INTO shopify_tokens (shop, token)
      VALUES (${shop}, ${token})
      ON CONFLICT (shop) DO UPDATE SET token = ${token}, created_at = NOW()
    `;
  } catch (e) {
    console.error('DB saveToken error:', e);
  }
}

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

  // 2. Validate state (CSRF) — skip if cookie missing (some browsers block cross-site cookies)
  const cookieState = (req.headers.cookie || '')
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('shopify_oauth_state='))
    ?.split('=')[1];

  if (cookieState && cookieState !== state) {
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
    await saveToken(shop, access_token);

    // 5. Clear the CSRF cookie and redirect to the app with shop param
    res.setHeader(
      'Set-Cookie',
      'shopify_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    );

    return res.redirect(302, `${appUrl}/app?shop=${encodeURIComponent(shop)}&authorized=1`);
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Internal error: ' + err.message);
  }
}
