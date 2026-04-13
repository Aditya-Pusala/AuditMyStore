import { getSupabase } from './_supabase.js';
import crypto from 'crypto';

function hashPassword(p) {
  return crypto.createHash('sha256').update(p + (process.env.PASSWORD_SALT || 'ams-salt-2024')).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, token, newPassword } = req.body;
  const sb = getSupabase();

  if (action === 'send') {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await sb.from('ams_reset_tokens').insert({ token: resetToken, email: email.toLowerCase(), expires_at: expires });
    const link = `${process.env.APP_URL}/login?reset_token=${resetToken}`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'AuditMyStore <onboarding@resend.dev>',
        to: email,
        subject: 'Reset your AuditMyStore password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#0f172a">Reset your password</h2>
          <p style="color:#64748b">Click the button below to reset your password. This link expires in 30 minutes.</p>
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#ea580c,#f97316);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Reset Password</a>
          <p style="color:#94a3b8;font-size:12px">If you didn't request this, ignore this email.</p>
        </div>`
      })
    });
    return res.status(200).json({ success: true });
  }

  if (action === 'verify') {
    const { data } = await sb.from('ams_reset_tokens')
      .select('email,expires_at,used').eq('token', token).single();
    if (!data || data.used || new Date(data.expires_at) < new Date())
      return res.status(200).json({ valid: false });
    return res.status(200).json({ valid: true, email: data.email });
  }

  if (action === 'reset') {
    if (!token || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Invalid request' });
    const { data: rt } = await sb.from('ams_reset_tokens')
      .select('email,expires_at,used').eq('token', token).single();
    if (!rt || rt.used || new Date(rt.expires_at) < new Date())
      return res.status(400).json({ error: 'Reset link expired or already used' });
    await sb.from('ams_users').update({ password_hash: hashPassword(newPassword) }).eq('email', rt.email);
    await sb.from('ams_reset_tokens').update({ used: true }).eq('token', token);
    const newToken = crypto.randomBytes(32).toString('hex');
    const { data: user } = await sb.from('ams_users').select('id').eq('email', rt.email).single();
    if (user) await sb.from('ams_sessions').insert({ token: newToken, email: rt.email, user_id: user.id });
    return res.status(200).json({ success: true, token: newToken });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
