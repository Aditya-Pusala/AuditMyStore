import { getToken } from './callback.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function shopifyAdmin(shop, token, path) {
  const url = `https://${shop}/admin/api/2024-01/${path}`;
  const r = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`Admin API ${path} → HTTP ${r.status}`);
  return r.json();
}

async function fetchAdminData(shop, token) {
  const results = {};
  const errors = [];

  const safe = async (label, fn) => {
    try { results[label] = await fn(); }
    catch (e) { errors.push(`${label}: ${e.message}`); }
  };

  await safe('shop', async () => (await shopifyAdmin(shop, token, 'shop.json')).shop);

  await safe('orders', async () => {
    const d = await shopifyAdmin(shop, token, 'orders.json?limit=250&status=any&fields=id,total_price,subtotal_price,financial_status,fulfillment_status,created_at,line_items,customer');
    return d.orders || [];
  });

  await safe('products', async () => {
    const d = await shopifyAdmin(shop, token, 'products.json?limit=250&fields=id,title,status,variants,images,body_html,product_type,vendor,tags');
    return d.products || [];
  });

  await safe('customerCount', async () => (await shopifyAdmin(shop, token, 'customers/count.json')).count);

  await safe('customers', async () => {
    const d = await shopifyAdmin(shop, token, 'customers.json?limit=50&fields=id,orders_count,total_spent,created_at,accepts_marketing');
    return d.customers || [];
  });

  await safe('abandonedCheckouts', async () => {
    const d = await shopifyAdmin(shop, token, 'checkouts.json?limit=250&fields=id,total_price,created_at,completed_at');
    return d.checkouts || [];
  });

  await safe('collections', async () => {
    const d = await shopifyAdmin(shop, token, 'custom_collections.json?limit=250&fields=id,title,products_count');
    return d.custom_collections || [];
  });

  await safe('smartCollections', async () => {
    const d = await shopifyAdmin(shop, token, 'smart_collections.json?limit=250&fields=id,title,products_count');
    return d.smart_collections || [];
  });

  await safe('priceRules', async () => {
    const d = await shopifyAdmin(shop, token, 'price_rules.json?limit=100&fields=id,title,value,value_type,usage_count');
    return d.price_rules || [];
  });

  // ── Derived metrics from real data ──────────────────────────────────────────
  const orders = results.orders || [];
  if (orders.length) {
    const paid = orders.filter(o => ['paid', 'partially_paid'].includes(o.financial_status));
    const totals = paid.map(o => parseFloat(o.total_price));
    const revenue = totals.reduce((a, b) => a + b, 0);
    const aov = totals.length ? revenue / totals.length : 0;

    // Revenue by month (last 6 months)
    const now = new Date();
    const byMonth = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      byMonth[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
    }
    paid.forEach(o => {
      const key = o.created_at?.slice(0, 7);
      if (key && byMonth[key] !== undefined) byMonth[key] += parseFloat(o.total_price);
    });

    // Repeat customer rate
    const custCounts = {};
    orders.forEach(o => { if (o.customer?.id) custCounts[o.customer.id] = (custCounts[o.customer.id] || 0) + 1; });
    const repeatCustomers = Object.values(custCounts).filter(c => c > 1).length;
    const totalUnique = Object.keys(custCounts).length;

    results.metrics = {
      totalOrders: orders.length,
      paidOrders: paid.length,
      totalRevenue: revenue.toFixed(2),
      monthlyRevenue: (revenue / Math.max(Object.keys(byMonth).length, 1)).toFixed(2),
      aov: aov.toFixed(2),
      revenueByMonth: byMonth,
      repeatCustomerRate: totalUnique ? ((repeatCustomers / totalUnique) * 100).toFixed(1) : '0',
      currency: results.shop?.currency || 'USD',
    };
  }

  // Abandoned cart metrics
  const checkouts = results.abandonedCheckouts || [];
  if (checkouts.length) {
    const abandoned = checkouts.filter(c => !c.completed_at);
    results.abandonedCartRate = ((abandoned.length / checkouts.length) * 100).toFixed(1);
    results.abandonedRevenue = abandoned.reduce((s, c) => s + parseFloat(c.total_price || 0), 0).toFixed(2);
  }

  // Customer LTV & email opt-in
  const customers = results.customers || [];
  if (customers.length) {
    const ltv = customers.map(c => parseFloat(c.total_spent || 0));
    results.avgLTV = (ltv.reduce((a, b) => a + b, 0) / ltv.length).toFixed(2);
    results.emailOptInRate = ((customers.filter(c => c.accepts_marketing).length / customers.length) * 100).toFixed(1);
  }

  return { ...results, errors };
}

async function fetchPublicData(storeUrl) {
  const domain = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
  const baseUrl = `https://${domain}`;
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; EcommerceAnalyzer/1.0)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' };
  const results = {};
  const errors = [];

  const safe = async (label, fn) => { try { results[label] = await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); } };

  const detectPlatform = (host, html = '') => {
    const h = String(host || '').toLowerCase();
    const s = String(html || '').toLowerCase();
    if (h.includes('amazon.')) return 'amazon';
    if (h.includes('etsy.')) return 'etsy';
    if (h.includes('ebay.')) return 'ebay';
    if (h.includes('walmart.')) return 'walmart';
    if (h.includes('myshopify.com') || s.includes('cdn.shopify.com') || s.includes('shopify.theme')) return 'shopify';
    if (s.includes('woocommerce') || s.includes('wp-content/plugins/woocommerce')) return 'woocommerce';
    if (s.includes('bigcommerce')) return 'bigcommerce';
    if (s.includes('squarespace')) return 'squarespace';
    if (s.includes('wix.com') || s.includes('wix-static')) return 'wix';
    return 'generic';
  };

  const extractProductLinks = (html, base, host) => {
    const found = new Set();
    const hrefs = [...String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1]);
    const patterns = [/\/products\//i, /\/dp\/[A-Z0-9]{6,}/i, /\/gp\/product\//i, /\/p\//i, /product/i];
    for (const href of hrefs) {
      try {
        const u = new URL(href, base);
        if (u.hostname !== host) continue;
        if (!patterns.some(p => p.test(u.pathname))) continue;
        found.add(u.toString().split('?')[0]);
      } catch {}
      if (found.size >= 6) break;
    }
    return [...found];
  };

  const readLdProducts = (html) => {
    const out = [];
    const scripts = [...String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object') return;
      const t = node['@type'];
      const isProduct = (Array.isArray(t) && t.includes('Product')) || t === 'Product';
      if (isProduct) {
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const price = offers?.price || offers?.lowPrice || offers?.highPrice || null;
        const image = Array.isArray(node.image) ? node.image[0] : node.image;
        out.push({
          title: node.name || null,
          price: price != null ? parseFloat(price) : null,
          image: image || null,
          description: node.description || null,
        });
      }
      if (node['@graph']) walk(node['@graph']);
    };
    for (const raw of scripts) {
      try { walk(JSON.parse(raw)); } catch {}
    }
    return out;
  };

  const readMetaProduct = (html) => {
    const title = (String(html).match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || [])[1]
      || (String(html).match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]
      || null;
    const desc = (String(html).match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || null;
    const img = (String(html).match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] || null;
    const p1 = (String(html).match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i) || [])[1];
    const p2 = (String(html).match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) || [])[1];
    const price = p1 || p2 ? parseFloat(p1 || p2) : null;
    return { title, description: desc, image: img, price };
  };

  await safe('homepage', async () => {
    const r = await fetch(baseUrl, { headers, redirect: 'follow' });
    const html = await r.text();
    const hasEmailInput = /<input[^>]*type=["']email["'][^>]*>/i.test(html);
    const hasNewsletterCopy = /newsletter|subscribe|get\s*\d+%|email\s+list|join\s+our/i.test(html);
    const platform = detectPlatform(domain, html);
    results.platform = platform;
    return {
      status: r.status,
      title: (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim(),
      metaDescription: (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || [])[1]?.trim(),
      hasStructuredData: html.includes('application/ld+json'),
      hasOpenGraph: /property=["']og:(title|description|image|site_name)["']/i.test(html),
      hasEmailCapture: /klaviyo|mailchimp|omnisend|privy|sendlane|convertkit/i.test(html) || (hasEmailInput && hasNewsletterCopy),
      hasReviews: /yotpo|loox|okendo|judgeme|stamped\.io|ryviu|spr-badge|aggregateRating/i.test(html),
      hasLiveChat: /tidio|gorgias|intercom|freshchat|crisp|zendesk|tawk\.to|chatra/i.test(html),
      themeName: (html.match(/Shopify\.theme\s*=\s*\{[^}]*"name"\s*:\s*"([^"]+)"/) || [])[1],
      html,
    };
  });

  if ((results.platform || 'generic') === 'shopify') {
    await safe('products', async () => {
      const r = await fetch(`${baseUrl}/products.json?limit=250`, { headers });
      return r.ok ? (await r.json()).products || [] : [];
    });
    await safe('collections', async () => {
      const r = await fetch(`${baseUrl}/collections.json?limit=250`, { headers });
      return r.ok ? (await r.json()).collections || [] : [];
    });
  } else {
    results.collections = [];
    await safe('products', async () => {
      const links = extractProductLinks(results.homepage?.html || '', baseUrl, domain);
      const products = [];
      for (const link of links.slice(0, 5)) {
        try {
          const r = await fetch(link, { headers, redirect: 'follow' });
          if (!r.ok) continue;
          const html = await r.text();
          const ld = readLdProducts(html);
          if (ld.length) {
            ld.forEach(p => products.push({
              title: p.title || 'Untitled',
              body_html: p.description || '',
              images: p.image ? [{ src: p.image }] : [],
              variants: [{ price: p.price != null && !Number.isNaN(p.price) ? String(p.price) : null }],
            }));
          } else {
            const p = readMetaProduct(html);
            if (p.title || p.price != null) {
              products.push({
                title: p.title || 'Untitled',
                body_html: p.description || '',
                images: p.image ? [{ src: p.image }] : [],
                variants: [{ price: p.price != null && !Number.isNaN(p.price) ? String(p.price) : null }],
              });
            }
          }
        } catch {}
      }
      return products;
    });
  }

  await safe('hasSitemap', async () => (await fetch(`${baseUrl}/sitemap.xml`, { headers })).ok);

  if (results.products?.length) {
    const prods = results.products;
    const prices = prods.flatMap(p => p.variants?.map(v => parseFloat(v.price)) || []).filter(Boolean);
    results.productSummary = {
      count: prods.length,
      avgPrice: prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : null,
      minPrice: prices.length ? Math.min(...prices).toFixed(2) : null,
      maxPrice: prices.length ? Math.max(...prices).toFixed(2) : null,
      withImages: prods.filter(p => p.images?.length > 0).length,
      withDescriptions: prods.filter(p => p.body_html?.length > 50).length,
      sample: prods.slice(0, 5).map(p => ({ title: p.title, price: p.variants?.[0]?.price })),
    };
  }

  const productCount = results.productSummary?.count || 0;
  const platform = results.platform || 'generic';
  if (platform === 'shopify' && productCount > 0 && errors.length === 0) results.dataConfidence = 'high';
  else if (productCount > 0) results.dataConfidence = 'medium';
  else results.dataConfidence = 'low';

  if (results.homepage && results.homepage.html) delete results.homepage.html;

  return { ...results, errors };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, messages, system, storeUrl, shop } = req.body;

  // Fetch authorized Admin data
  if (type === 'shopify-admin-fetch') {
    if (!shop) return res.status(400).json({ error: 'shop is required' });
    const token = await getToken(shop);
    if (!token) return res.status(401).json({ error: 'not_authorized', shop });
    try {
      return res.status(200).json({ adminData: await fetchAdminData(shop, token) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Fetch public data
  if (type === 'shopify-fetch') {
    if (!storeUrl) return res.status(400).json({ error: 'storeUrl is required' });
    try {
      return res.status(200).json({ shopifyData: await fetchPublicData(storeUrl) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Check if a shop has been authorized
  if (type === 'check-auth') {
    if (!shop) return res.status(400).json({ error: 'shop is required' });
    const token = await getToken(shop);
    return res.status(200).json({ authorized: !!token });
  }

  // Groq AI chat
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const fullMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 2000, temperature: 0.7, messages: fullMessages }),
    });
    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      return res.status(groqRes.status).json({ error: err?.error?.message || `Groq error ${groqRes.status}` });
    }
    const data = await groqRes.json();
    return res.status(200).json({ content: data.choices?.[0]?.message?.content || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error: ' + err.message });
  }
}
