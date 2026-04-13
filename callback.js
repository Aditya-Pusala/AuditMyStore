import { getSupabase } from '../../_supabase.js';
import crypto from 'crypto';

async function sendWelcomeEmail(email, name) {
  const firstName = name?.split(' ')[0] || 'there';
  try {
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
  } catch(e) { console.error('Welcome email failed:', e); }
}

export default async function handler(req, res) {
  const { code, error } = req.query;
  const appUrl = process.env.APP_URL;
  if (error) return res.redirect(302, `${appUrl}/login?error=google_denied`);
  if (!code) return res.redirect(302, `${appUrl}/login?error=no_code`);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token from Google');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const { email, name, picture, id: googleId } = await userRes.json();
    if (!email) throw new Error('No email from Google');

    const sb = getSupabase();
    const { data: existing } = await sb.from('ams_users').select('id,plan,welcome_sent').eq('email', email).single();

    let userId, plan = 'free', isNew = false;
    if (!existing) {
      const { data: newUser } = await sb.from('ams_users')
        .insert({ email, name: name || '', avatar: picture || '', google_id: googleId, plan: 'free' })
        .select('id').single();
      userId = newUser?.id;
      isNew = true;
      await sendWelcomeEmail(email, name);
    } else {
      userId = existing.id;
      plan = existing.plan || 'free';
      // Update google info if missing
      await sb.from('ams_users').update({
        name: existing.name || name || '',
        avatar: existing.avatar || picture || '',
        google_id: existing.google_id || googleId,
      }).eq('email', email);
    }

    const token = crypto.randomBytes(32).toString('hex');
    await sb.from('ams_sessions').insert({ token, email, user_id: userId });

    res.setHeader('Set-Cookie', [
      `ams_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
      `ams_name=${encodeURIComponent(name || email)}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
      `ams_plan=${plan}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
      `ams_new=${isNew ? '1' : '0'}; Path=/; Max-Age=60; SameSite=Lax; Secure`,
    ]);
    res.redirect(302, `${appUrl}/app`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect(302, `${appUrl}/login?error=oauth_failed`);
  }
}
