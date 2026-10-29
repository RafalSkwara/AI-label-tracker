"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Hasło musi mieć co najmniej 8 znaków.");
    if (password !== again) return setError("Hasła nie są takie same.");
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.updateUser({ password });
    if (error) { setError(error.message); setBusy(false); } else router.replace("/");
  }

  return (
    <main className="login">
      <h1>Ustaw hasło</h1>
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="pw1">Nowe hasło</label>
          <input id="pw1" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw2">Powtórz hasło</label>
          <input id="pw2" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <button className="btn primary" disabled={busy}>{busy ? "Chwila…" : "Zapisz hasło"}</button>
        {error && <p className="sub down">{error}</p>}
      </form>
    </main>
  );
}
