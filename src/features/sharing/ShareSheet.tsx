"use client";

import { useState } from "react";
import { normEmail, validEmail } from "./data";
import s from "./sharing.module.css";

type Props = {
  /** e.g. "listę „Biedronka”" */
  what: string;
  emails: string[];
  owner: boolean;
  ownerEmail: string | null;
  onAdd: (email: string) => Promise<void>;
  onRemove: (email: string) => Promise<void>;
  /** recipient only: remove own access */
  onLeave: () => Promise<void>;
  onClose: () => void;
};

/** Who can see a list; the owner adds and removes people by e-mail, a recipient can leave */
export default function ShareSheet({ what, emails, owner, ownerEmail, onAdd, onRemove, onLeave, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [armed, setArmed] = useState("");

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = normEmail(email);
    if (!validEmail(v)) return setError("Podaj poprawny adres e-mail.");
    await act("add", async () => { await onAdd(v); setEmail(""); });
  }

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${s.sheet}`} role="dialog" aria-label="Udostępnianie">
        <strong>Udostępnianie</strong>
        <p className="sub">
          {owner ? `Osoby z dostępem widzą i edytują ${what}. Zmieniać nazwę i udostępniać możesz tylko Ty.` : `${what[0].toUpperCase() + what.slice(1)} należy do ${ownerEmail ?? "innej osoby"}.`}
        </p>

        <ul className={s.people} aria-label="Osoby z dostępem">
          {!owner && ownerEmail && <li className={s.person}><span className={s.mail}>{ownerEmail}</span><span className="sub">właściciel</span></li>}
          {emails.map((m) => (
            <li key={m} className={s.person}>
              <span className={s.mail}>{m}</span>
              {owner && (
                <button className={`btn danger ${armed === m ? "armed" : ""}`} disabled={!!busy}
                  onClick={() => { if (armed !== m) return setArmed(m); setArmed(""); act(m, () => onRemove(m)); }}>
                  {busy === m ? "…" : armed === m ? "Na pewno?" : "Usuń dostęp"}
                </button>
              )}
            </li>
          ))}
          {owner && emails.length === 0 && <li className="sub">Nikt poza Tobą nie ma dostępu.</li>}
        </ul>

        {owner ? (
          <form className={s.add} onSubmit={add}>
            <input type="email" inputMode="email" autoComplete="email" aria-label="E-mail osoby" placeholder="e-mail osoby" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn primary" disabled={!email.trim() || !!busy}>{busy === "add" ? "…" : "Udostępnij"}</button>
          </form>
        ) : (
          <button className="btn danger" disabled={!!busy} onClick={() => act("leave", onLeave)}>Opuść {what}</button>
        )}
        {owner && <p className="sub">Osoba zobaczy to po zalogowaniu się tym adresem (konto zakłada administrator).</p>}
        {error && <p className={s.err} role="alert">{error}</p>}
        <button className="btn" onClick={onClose}>Zamknij</button>
      </div>
    </div>
  );
}
