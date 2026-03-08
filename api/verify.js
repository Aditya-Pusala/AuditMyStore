import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`SELECT plan, email FROM ams_licenses WHERE session_id = ${session_id}`;
    if (rows.length === 0) return res.status(404).json({ valid: false });
    return res.status(200).json({ valid: true, plan: rows[0].plan, email: rows[0].email });
  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
