"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import Login from "./Login";
import Tracker from "./Tracker";

export default function App() {
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

  if (session === undefined) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;
  if (!session) return <Login />;
  return <Tracker email={session.user.email ?? ""} />;
}
