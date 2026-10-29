"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Password is the default: it needs no email, so it works without custom SMTP and inside the installed PWA
export default function Login() {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    const auth = supabase().auth;
    const { error } = mode === "password"
      ? await auth.signInWithPassword({ email: email.trim(), password })
      : await auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin, shouldCreateUser: false } });
    if (error) { setError(error.message); setState("idle"); }
    else setState(mode === "link" ? "sent" : "idle");
  }

  return (
    <main className="login">
      <h1>Side Hustle Assistant</h1>
      {state === "sent" ? (
        <p className="sub">Link do logowania wysłany na {email}. Otwórz go w tej przeglądarce.</p>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode === "password" && (
            <div className="field">
              <label className="label" htmlFor="password">Hasło</label>
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <button className="btn primary" disabled={state === "sending"}>
            {state === "sending" ? "Chwila…" : mode === "password" ? "Zaloguj" : "Wyślij link"}
          </button>
          <button type="button" className="linkbtn" onClick={() => { setMode(mode === "password" ? "link" : "password"); setError(""); }}>
            {mode === "password" ? "Zaloguj linkiem z maila" : "Zaloguj hasłem"}
          </button>
          {error && <p className="sub down">{error}</p>}
        </form>
      )}
    </main>
  );
}
