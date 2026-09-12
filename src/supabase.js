const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in .env");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

async function checkSupabase() {
  const res = await fetch(`${url}/auth/v1/health`, {
    headers: { apikey: key },
  });

  if (!res.ok) {
    throw new Error(`Supabase health check failed with status ${res.status}`);
  }
}

module.exports = { supabase, checkSupabase };
