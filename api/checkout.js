import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan } = req.body;
  const appUrl = process.env.APP_URL;

  const priceId = plan === 'monthly'
    ? process.env.STRIPE_MONTHLY_PRICE_ID
    : process.env.STRIPE_LIFETIME_PRICE_ID;

  if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const isRecurring = plan === 'monthly';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isRecurring ? 'subscription' : 'payment',
      success_url: `${appUrl}/app?unlocked=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/`,
      metadata: { plan },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
