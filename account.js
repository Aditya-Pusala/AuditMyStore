import { getSupabase } from './_supabase.js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, action } = req.body;
  if (!token) return res.status(401).json({ error: 'No session token' });

  const sb = getSupabase();
  const { data: session } = await sb.from('ams_sessions').select('email, ams_users(plan, name, stripe_session_id)').eq('token', token).single();
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  const user = session.ams_users;

  if (action === 'get-info') {
    return res.status(200).json({
      email: session.email,
      name: user?.name,
      plan: user?.plan || 'free',
    });
  }

  if (action === 'portal') {
    if (!user?.stripe_session_id) return res.status(400).json({ error: 'No Stripe subscription found' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const checkout = await stripe.checkout.sessions.retrieve(user.stripe_session_id);
      const customerId = checkout.customer;
      if (!customerId) return res.status(400).json({ error: 'No Stripe customer found' });
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.APP_URL}/account`,
      });
      return res.status(200).json({ url: portalSession.url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
