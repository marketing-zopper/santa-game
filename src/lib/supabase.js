// Browser Supabase client. Uses ONLY the public publishable (anon) key — never a service-role key.
// Row Level Security + Edge Functions are what protect the data; see supabase/migrations.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

/** False when the env vars are missing: OTP sign-in is then unavailable, but guest play still works. */
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
