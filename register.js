import { getSupabase } from './_supabase.js';
import crypto from 'crypto';

function hashPassword(p) {
  return crypto.createHash('sha256').update(p + (process.env.PASSWORD_SALT || 'ams-salt-2024')).digest('hex');
}

async function sendWelcomeEmail(email, name) {
  const firstName = name?.split(' ')[0] || 'there';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'Debbie at AuditMyStore <onboarding@resend.dev>',
      to: email,
      subject: `Welcome to AuditMyStore, ${firstName}! 🚀`,
      html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#ea580c,#f97316);padding:32px;text-align:center;border-radius:12px 12px 0 0">
          <h1 style="color:white;margin:0;font-size:24px">Welcome, ${firstName}! 🎉</h1>
        </div>
        <div style="padding:28px;background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
          <p style="color:#334155;font-size:15px;line-height:1.7">I'm <strong>Debbie</strong>, your AI Shopify consultant. You have <strong>2 free audits</strong> to get started.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${process.env.APP_URL}/app" style="background:linear-gradient(135deg,#ea580c,#f97316);color:white;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">Analyze My First Store →</a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center">— Debbie, AuditMyStore AI Consultant</p>
        </div>
      </div>`
    })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, session_id, name } = req.body;
  if (!email || !password || !session_id) return res.status(400).json({ error: 'Email, password and session_id required' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const sb = getSupabase();

  // Determine plan
  let plan = 'free';
  if (session_id !== 'email-signup') {
    const { data: license } = await sb.from('ams_licenses').select('plan').eq('session_id', session_id).single();
    if (!license) return res.status(403).json({ error: 'Invalid session — payment not verified' });
    plan = license.plan || 'monthly';
  }

  const passwordHash = hashPassword(password);

  // Check existing user
  const { data: existing } = await sb.from('ams_users').select('id,plan').eq('email', email.toLowerCase()).single();
  if (existing) {
    if (session_id !== 'email-signup') {
      // Upgrade existing user
      await sb.from('ams_users').update({ plan }).eq('email', email.toLowerCase());
      const token = crypto.randomBytes(32).toString('hex');
      await sb.from('ams_sessions').insert({ token, email: email.toLowerCase(), user_id: existing.id });
      return res.status(200).json({ success: true, token, plan, email: email.toLowerCase(), name: name || email.split('@')[0], upgraded: true });
    }
    return res.status(409).json({ error: 'Email already registered — please log in instead' });
  }

  // Create new user
  const { data: newUser, error: insertErr } = await sb.from('ams_users')
    .insert({ email: email.toLowerCase(), name: name || '', password_hash: passwordHash, plan, stripe_session_id: session_id })
    .select('id').single();
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // Send welcome email
  try { await sendWelcomeEmail(email, name); } catch(e) { console.error('Welcome email failed:', e); }

  const token = crypto.randomBytes(32).toString('hex');
  await sb.from('ams_sessions').insert({ token, email: email.toLowerCase(), user_id: newUser.id });
  return res.status(200).json({ success: true, token, plan, email: email.toLowerCase(), name: name || email.split('@')[0] });
}
