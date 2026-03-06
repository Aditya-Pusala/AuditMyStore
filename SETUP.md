# ShopifyAI Analyzer — Setup Guide

## Files in this release
```
index.html          ← frontend (drop in project root)
api/auth.js         ← OAuth start: redirects to Shopify consent
api/callback.js     ← OAuth callback: exchanges code for token
api/chat.js         ← AI chat + public & admin data fetching
vercel.json         ← routing config (updated with 3 API routes)
```

---

## Step 1 — Create a Shopify Partner App

1. Go to https://partners.shopify.com → **Apps → Create app**
2. Choose **Custom app** (for your own stores) or **Public app** (for any store owner)
3. Under **App setup → URLs**, set:
   - **App URL:** `https://your-app.vercel.app`
   - **Allowed redirection URL:** `https://your-app.vercel.app/api/callback`
4. Copy your **Client ID** and **Client Secret**

---

## Step 2 — Set Environment Variables in Vercel

In your Vercel project → **Settings → Environment Variables**, add:

| Variable               | Value                                      |
|------------------------|--------------------------------------------|
| `SHOPIFY_CLIENT_ID`    | Your app's Client ID from Partners         |
| `SHOPIFY_CLIENT_SECRET`| Your app's Client Secret from Partners     |
| `APP_URL`              | `https://your-app.vercel.app` (no slash)   |
| `GROQ_API_KEY`         | Your Groq API key                          |

---

## Step 3 — Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy from your project folder
vercel --prod
```

Or connect your GitHub repo to Vercel for automatic deploys.

---

## How it works

### Quick Analyze (no auth)
Store owner enters URL → fetches public `/products.json`, homepage HTML → AI analysis

### Connect Store (full access)
1. Store owner enters domain → clicks **Connect Store**
2. Redirected to `GET /api/auth?shop=their-store.myshopify.com`
3. Shopify shows consent screen with your requested scopes
4. Owner approves → Shopify calls `GET /api/callback?code=...&shop=...`
5. Your backend exchanges code for access token → stores it
6. Owner redirected back to your app with `?shop=...&authorized=1`
7. Owner clicks **Run Full Analysis** → `POST /api/chat` with `type: "shopify-admin-fetch"`
8. Backend uses stored token to call Admin API → real orders, revenue, customers, LTV, abandoned carts

### Data fetched with Admin API
- **Orders** — revenue, AOV, monthly trends (last 6 months)
- **Customers** — count, LTV, email opt-in rate, repeat buyer rate
- **Abandoned checkouts** — abandonment rate, revenue at risk
- **Products** — with/without descriptions, with/without images
- **Collections** — smart + custom
- **Price rules / discounts** — active promotions

---

## Token Storage Note

Currently tokens are stored in-memory (`global.__shopifyTokens`).
This resets on each Vercel cold start. For production, replace with:

```js
// Vercel KV (recommended)
import { kv } from '@vercel/kv';
await kv.set(`token:${shop}`, accessToken);
const token = await kv.get(`token:${shop}`);

// Or Supabase, PlanetScale, Redis, etc.
```

---

## Scopes requested
`read_orders`, `read_all_orders`, `read_analytics`, `read_customers`,
`read_products`, `read_inventory`, `read_reports`, `read_marketing_events`,
`read_checkouts`, `read_price_rules`, `read_discounts`
