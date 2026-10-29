"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** Supabase session: undefined while loading, null when signed out */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const db = supabase();
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = db.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // drop the one-time ?code= from the magic link
      if (s && location.search.includes("code=")) history.replaceState(null, "", location.pathname);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return session;
}
