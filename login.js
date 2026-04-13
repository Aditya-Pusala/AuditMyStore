import { getSupabase } from './_supabase.js';
import crypto from 'crypto';

function hashPassword(password) {
  return crypto.createHash('sha256')
    .update(password + (process.env.PASSWORD_SALT || 'ams-salt-2024'))
    .digest('hex');
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    }).filter(([k]) => k)
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = getSupabase();

  // GET — read Google OAuth cookie
  if (req.method === 'GET') {
    const cookies = parseCookies(req);
    const token = cookies.ams_session;
    const name  = cookies.ams_name;
    const plan  = cookies.ams_plan;
    const isNew = cookies.ams_new === '1';
    if (!token) return res.status(200).json({ found: false });
    res.setHeader('Set-Cookie', `ams_new=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
    return res.status(200).json({ found: true, token, name, plan, isNew });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, token, session_id } = req.body;

  // Verify Stripe license
  if (action === 'verify-license') {
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const { data, error } = await sb.from('ams_licenses').select('plan,email').eq('session_id', session_id).single();
    if (error || !data) return res.status(404).json({ valid: false });
    return res.status(200).json({ valid: true, plan: data.plan, email: data.email });
  }

  // Verify session token
  if (action === 'verify-token') {
    if (!token) return res.status(400).json({ valid: false });
    const { data, error } = await sb
      .from('ams_sessions')
      .select('email, ams_users(plan, name)')
      .eq('token', token)
      .single();
    if (error || !data) return res.status(200).json({ valid: false });
    const user = data.ams_users;
    return res.status(200).json({
      valid: true, email: data.email,
      plan: user?.plan || 'free',
      name: user?.name || data.email.split('@')[0]
    });
  }

  // Change password
  if (action === 'change-password') {
    const { newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
    const { data: session } = await sb.from('ams_sessions').select('email').eq('token', token).single();
    if (!session) return res.status(403).json({ error: 'Invalid session' });
    await sb.from('ams_users').update({ password_hash: hashPassword(newPassword) }).eq('email', session.email);
    return res.status(200).json({ success: true });
  }

  // Login
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { data: user, error: userErr } = await sb.from('ams_users').select('*').eq('email', email.toLowerCase()).single();
  if (userErr || !user) return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google login — please sign in with Google' });
  if (user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Invalid email or password' });
  const newToken = crypto.randomBytes(32).toString('hex');
  await sb.from('ams_sessions').insert({ token: newToken, email: email.toLowerCase(), user_id: user.id });
  return res.status(200).json({ success: true, token: newToken, plan: user.plan, email: user.email, name: user.name || user.email.split('@')[0] });
}
