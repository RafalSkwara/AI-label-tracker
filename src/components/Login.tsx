"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setError(error ? error.message : "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: location.origin },
    });
    if (error) { setError(error.message); setState("error"); }
    else setState("sent");
  }

  return (
    <main className="login">
      <h1>Tracker Wydawnictwa</h1>
      {state === "sent" ? (
        // The link signs in the browser that opens it; an installed PWA has its own storage, so it takes the code instead
        <form onSubmit={verify}>
          <p className="sub">Wysłano na {email}. Otwórz link w tej przeglądarce albo wpisz kod z maila.</p>
          <div className="field">
            <label className="label" htmlFor="code">Kod z maila</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn primary" disabled={!code.trim()}>Zaloguj</button>
          {error && <p className="sub down">{error}</p>}
        </form>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn primary" disabled={state === "sending"}>{state === "sending" ? "Wysyłanie…" : "Wyślij link"}</button>
          {state === "error" && <p className="sub down">{error}</p>}
        </form>
      )}
    </main>
  );
}
