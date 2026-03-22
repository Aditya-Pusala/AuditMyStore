export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    })
  );

  const token = cookies.ams_session;
  const name = cookies.ams_name;
  const plan = cookies.ams_plan;
  const isNew = cookies.ams_new === '1';

  if (!token) return res.status(200).json({ found: false });

  // Clear the short-lived new flag cookie
  res.setHeader('Set-Cookie', `ams_new=; Path=/; Max-Age=0; SameSite=Lax; Secure`);

  return res.status(200).json({ found: true, token, name, plan, isNew });
}
