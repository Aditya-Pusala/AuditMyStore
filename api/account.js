import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Find customer by email
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length === 0) {
      return res.status(404).json({ error: 'No account found with this email' });
    }
    const customer = customers.data[0];

    if (action === 'portal') {
      // Create Stripe customer portal session
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: process.env.APP_URL,
      });
      return res.status(200).json({ url: portalSession.url });
    }

    // Default: fetch subscription info
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 1,
      status: 'all',
    });

    // Check for one-time lifetime purchase
    const payments = await stripe.paymentIntents.list({
      customer: customer.id,
      limit: 5,
    });

    let plan = null;
    let status = null;
    let currentPeriodEnd = null;
    let cancelAtPeriodEnd = false;

    if (subscriptions.data.length > 0) {
      const sub = subscriptions.data[0];
      plan = 'Monthly';
      status = sub.status;
      currentPeriodEnd = sub.current_period_end;
      cancelAtPeriodEnd = sub.cancel_at_period_end;
    } else if (payments.data.some(p => p.status === 'succeeded')) {
      plan = 'Lifetime';
      status = 'active';
      currentPeriodEnd = null;
    }

    if (!plan) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    return res.status(200).json({
      email: customer.email,
      plan,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      customerId: customer.id,
    });

  } catch (err) {
    console.error('Account error:', err);
    return res.status(500).json({ error: err.message });
  }
}
