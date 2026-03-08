import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';

async function getDb() {
  const sql = neon(process.env.POSTGRES_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS ams_licenses (
      session_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  return sql;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // req.body must be raw buffer — Vercel provides it as string
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const sql = await getDb();
      await sql`
        INSERT INTO ams_licenses (session_id, plan, email)
        VALUES (${session.id}, ${session.metadata?.plan || 'lifetime'}, ${session.customer_details?.email || ''})
        ON CONFLICT (session_id) DO NOTHING
      `;
      console.log('✅ License saved for session:', session.id);
    } catch (err) {
      console.error('DB error saving license:', err);
    }
  }

  return res.status(200).json({ received: true });
}

export const config = { api: { bodyParser: false } };
