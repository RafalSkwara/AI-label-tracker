"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Login from "@/components/Login";
import { supabase } from "@/lib/supabase";
import SetPassword from "@/shell/SetPassword";
import { useSession } from "@/shell/useSession";

const EXPIRED = "Link wygasł lub został już użyty. Poproś administratora o nowy.";

/** Redeems the one-time link (?token_hash=…&type=invite|magiclink), then asks for a password. No role needed. */
export default function Page() {
  const session = useSession();
  const [error, setError] = useState("");
  const [redeeming, setRedeeming] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("token_hash")); // the page shows "Wczytywanie…" until the session is known, so this cannot mismatch hydration
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // one-time token: redeem once, even with React dev double effects
    const q = new URLSearchParams(window.location.search);
    const token_hash = q.get("token_hash"), type = q.get("type");
    if (!token_hash) return;
    started.current = true;
    history.replaceState(null, "", window.location.pathname);
    const redeem = type === "invite" || type === "magiclink"
      ? supabase().auth.verifyOtp({ token_hash, type }).then(({ error }) => !!error)
      : Promise.resolve(true);
    redeem.then((failed) => {
      if (failed) setError(EXPIRED);
      setRedeeming(false);
    });
  }, []);

  if (session === undefined || redeeming) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;
  if (!session) {
    return error ? (
      <main className="login">
        <h1>Side Hustle Assistant</h1>
        <p className="sub down">{error}</p>
        <Link className="btn" href="/">Zaloguj się</Link>
      </main>
    ) : <Login />;
  }
  return <SetPassword />;
}
