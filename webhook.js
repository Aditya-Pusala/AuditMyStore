import { getSupabase } from './_supabase.js';
import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sb = getSupabase();
    const plan = session.metadata?.plan || (session.mode === 'subscription' ? 'monthly' : 'lifetime');
    // Save license
    await sb.from('ams_licenses').upsert({
      session_id: session.id,
      plan,
      email: session.customer_details?.email || null
    });
    // Upgrade user if email known
    if (session.customer_details?.email) {
      await sb.from('ams_users')
        .update({ plan, stripe_session_id: session.id })
        .eq('email', session.customer_details.email.toLowerCase());
    }
  }

  return res.status(200).json({ received: true });
}
