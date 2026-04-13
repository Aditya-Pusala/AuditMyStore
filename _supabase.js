import { createClient } from '@supabase/supabase-js';

let _client = null;
export function getSupabase() {
  if (_client) return _client;
  _client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
  return _client;
}
