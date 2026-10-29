import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// Browser-only client; the session lives in localStorage and RLS (public.has_role / is_owner) guards every table
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
    });
  }
  return client;
}
