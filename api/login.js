import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.PASSWORD_SALT || 'ams-salt-2024').digest('hex');
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

  // ── GET /api/login → read Google OAuth cookie session ──────────────
  if (req.method === 'GET') {
    const cookies = parseCookies(req);
    const token = cookies.ams_session;
    const name = cookies.ams_name;
    const plan = cookies.ams_plan;
    const isNew = cookies.ams_new === '1';
    if (!token) return res.status(200).json({ found: false });
    res.setHeader('Set-Cookie', `ams_new=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
    return res.status(200).json({ found: true, token, name, plan, isNew });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, token, session_id } = req.body;

  // ── Verify Stripe license (replaces verify.js) ─────────────────────
  if (action === 'verify-license') {
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    try {
      const sql = neon(process.env.POSTGRES_URL);
      const rows = await sql`SELECT plan, email FROM ams_licenses WHERE session_id = ${session_id}`;
      if (rows.length === 0) return res.status(404).json({ valid: false });
      return res.status(200).json({ valid: true, plan: rows[0].plan, email: rows[0].email });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // ── Verify session token ───────────────────────────────────────────
    if (action === 'verify-token') {
      if (!token) return res.status(400).json({ valid: false });
      const rows = await sql`
        SELECT u.email, u.plan, u.name FROM ams_sessions s
        JOIN ams_users u ON s.email = u.email
        WHERE s.token = ${token}
      `;
      if (rows.length === 0) return res.status(200).json({ valid: false });
      return res.status(200).json({ valid: true, email: rows[0].email, plan: rows[0].plan, name: rows[0].name || rows[0].email.split('@')[0] });
    }

    // ── Change password ────────────────────────────────────────────────
    if (action === 'change-password') {
      const { newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const session = await sql`SELECT email FROM ams_sessions WHERE token = ${token}`;
      if (session.length === 0) return res.status(403).json({ error: 'Invalid session' });
      const newHash = hashPassword(newPassword);
      await sql`UPDATE ams_users SET password_hash = ${newHash} WHERE email = ${session[0].email}`;
      return res.status(200).json({ success: true });
    }

    // ── Login ──────────────────────────────────────────────────────────
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const users = await sql`SELECT * FROM ams_users WHERE email = ${email.toLowerCase()}`;
    if (users.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
    const user = users[0];
    if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google login — please sign in with Google' });
    const passwordHash = hashPassword(password);
    if (user.password_hash !== passwordHash) return res.status(401).json({ error: 'Invalid email or password' });
    await sql`CREATE TABLE IF NOT EXISTS ams_sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`;
    const newToken = crypto.randomBytes(32).toString('hex');
    await sql`INSERT INTO ams_sessions (token, email) VALUES (${newToken}, ${email.toLowerCase()})`;
    return res.status(200).json({ success: true, token: newToken, plan: user.plan, email: user.email, name: user.name || user.email.split('@')[0] });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
}
