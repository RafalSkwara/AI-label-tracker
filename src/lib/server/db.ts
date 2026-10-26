import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { secret } from "./env";

/** Service-role client (Supabase secret key): bypasses RLS, server only */
export function serviceDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
