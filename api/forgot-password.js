import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token, newPassword, email } = req.body;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Create reset tokens table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS ams_reset_tokens (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── Send reset email ──────────────────────────────────────
    if (action === 'send') {
      if (!email) return res.status(400).json({ error: 'Email required' });

      // Check user exists
      const users = await sql`SELECT email FROM ams_users WHERE email = ${email.toLowerCase()}`;
      if (users.length === 0) {
        // Don't reveal if email exists or not for security
        return res.status(200).json({ success: true });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Delete any existing tokens for this email
      await sql`DELETE FROM ams_reset_tokens WHERE email = ${email.toLowerCase()}`;

      // Save new token
      await sql`
        INSERT INTO ams_reset_tokens (token, email, expires_at)
        VALUES (${resetToken}, ${email.toLowerCase()}, ${expiresAt.toISOString()})
      `;

      const resetUrl = `${process.env.APP_URL}/?reset_token=${resetToken}`;

      // Send email via Resend
      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'AuditMyStore <onboarding@resend.dev>',
          to: email.toLowerCase(),
          subject: 'Reset your AuditMyStore password',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px">
              <div style="text-align:center;margin-bottom:24px">
                <div style="background:#164e63;display:inline-block;padding:12px 20px;border-radius:10px;margin-bottom:12px">
                  <span style="color:#22d3ee;font-weight:bold;font-size:20px">AuditMyStore</span>
                </div>
                <h2 style="color:#f8fafc;margin:0">Reset Your Password</h2>
              </div>
              <p style="color:#94a3b8;margin-bottom:24px">We received a request to reset your password. Click the button below to choose a new password. This link expires in <strong style="color:#22d3ee">30 minutes</strong>.</p>
              <div style="text-align:center;margin-bottom:24px">
                <a href="${resetUrl}" style="background:linear-gradient(135deg,#0891b2,#0e7490);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
                  Reset Password →
                </a>
              </div>
              <p style="color:#64748b;font-size:12px;text-align:center">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
              <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0">
              <p style="color:#475569;font-size:11px;text-align:center">AuditMyStore — AI-Powered Shopify Analysis</p>
            </div>
          `
        })
      });

      if (!emailResp.ok) {
        const err = await emailResp.json();
        console.error('Resend error:', err);
        return res.status(500).json({ error: 'Failed to send email' });
      }

      return res.status(200).json({ success: true });
    }

    // ── Verify reset token ────────────────────────────────────
    if (action === 'verify') {
      if (!token) return res.status(400).json({ valid: false });
      const rows = await sql`
        SELECT email FROM ams_reset_tokens
        WHERE token = ${token}
        AND expires_at > NOW()
        AND used = FALSE
      `;
      if (rows.length === 0) return res.status(200).json({ valid: false });
      return res.status(200).json({ valid: true, email: rows[0].email });
    }

    // ── Reset password ────────────────────────────────────────
    if (action === 'reset') {
      if (!token || !newPassword) return res.status(400).json({ error: 'Token and password required' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const rows = await sql`
        SELECT email FROM ams_reset_tokens
        WHERE token = ${token}
        AND expires_at > NOW()
        AND used = FALSE
      `;
      if (rows.length === 0) return res.status(400).json({ error: 'Reset link expired or already used' });

      const userEmail = rows[0].email;
      const passwordHash = crypto.createHash('sha256')
        .update(newPassword + (process.env.PASSWORD_SALT || 'ams-salt-2024'))
        .digest('hex');

      // Update password
      await sql`UPDATE ams_users SET password_hash = ${passwordHash} WHERE email = ${userEmail}`;

      // Mark token as used
      await sql`UPDATE ams_reset_tokens SET used = TRUE WHERE token = ${token}`;

      // Create new session
      const newToken = crypto.randomBytes(32).toString('hex');
      await sql`
        CREATE TABLE IF NOT EXISTS ams_sessions (
          token TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `;
      await sql`INSERT INTO ams_sessions (token, email) VALUES (${newToken}, ${userEmail})`;

      return res.status(200).json({ success: true, token: newToken, email: userEmail });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: err.message });
  }
}
