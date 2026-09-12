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

// supabase.auth.signOut() acts on whatever session the shared client last
// stored in memory, not on any particular request's token — unsafe with one
// client shared across concurrent users. Log out the exact token the caller
// sent by hitting GoTrue's logout endpoint directly instead.
async function signOutUser(token) {
  const res = await fetch(`${url}/auth/v1/logout?scope=global`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Logout failed with status ${res.status}`);
  }
}

module.exports = { supabase, checkSupabase, signOutUser };
