"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRole } from "@/shell/useRoles";
import { type AdminUser, ROLE_LABEL, ROLE_ORDER, invite, listUsers, newLink, revokeAll, setRole } from "./api";

function LinkCard({ email, link, onClose }: { email: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Cześć! Oto Twój link do Side Hustle Assistant: ${link}`;
  return (
    <div className="panel linkcard">
      <strong>Link dla {email}</strong>
      <input readOnly value={link} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      <div className="row">
        <button className="btn primary" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => {})}>{copied ? "Skopiowano" : "Kopiuj link"}</button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button className="btn" onClick={() => navigator.share({ text }).catch(() => {})}>Udostępnij</button>
        )}
        <a className="btn" href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Zaproszenie do Side Hustle Assistant")}&body=${encodeURIComponent(text)}`}>Wyślij e-mailem</a>
        <button className="linkbtn" onClick={onClose}>Zamknij</button>
      </div>
      <p className="sub">Link działa raz i wygasa po godzinie.</p>
    </div>
  );
}

function RoleBoxes({ value, onChange }: { value: AppRole[]; onChange: (role: AppRole, on: boolean) => void }) {
  return (
    <div className="roleboxes">
      {ROLE_ORDER.map((r) => (
        <label key={r} className="rolebox">
          <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(r, e.target.checked)} />
          {ROLE_LABEL[r]}
        </label>
      ))}
    </div>
  );
}

export default function UsersAdmin({ userId }: { userId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["zapasy"]);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ email: string; link: string } | null>(null);
  const [armed, setArmed] = useState("");

  const flash = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const load = useCallback(async () => {
    try { setUsers(await listUsers()); setError(""); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    let live = true;
    listUsers().then((us) => live && setUsers(us), (e) => live && setError((e as Error).message));
    return () => { live = false; clearTimeout(toastTimer.current); };
  }, []);

  const patch = (id: string, fn: (r: AppRole[]) => AppRole[]) =>
    setUsers((us) => us && us.map((u) => (u.id === id ? { ...u, roles: fn(u.roles) } : u)));

  async function toggle(u: AdminUser, role: AppRole, on: boolean) {
    patch(u.id, (r) => (on ? [...r, role] : r.filter((x) => x !== role)));
    try { await setRole(u.id, role, on); } catch (e) {
      patch(u.id, (r) => (on ? r.filter((x) => x !== role) : [...r, role]));
      flash((e as Error).message);
    }
  }

  async function revoke(u: AdminUser) {
    if (armed !== u.id) { setArmed(u.id); setTimeout(() => setArmed((a) => (a === u.id ? "" : a)), 4000); return; }
    setArmed("");
    const before = u.roles;
    patch(u.id, () => []);
    try { await revokeAll(u.id); } catch (e) { patch(u.id, () => before); flash((e as Error).message); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const link = await invite(email, roles);
      setMade({ email: email.trim().toLowerCase(), link });
      setEmail("");
    } catch (err) { flash((err as Error).message); }
    setBusy(false);
    load();
  }

  async function relink(u: AdminUser) {
    try { setMade({ email: u.email, link: await newLink(u.id) }); } catch (e) { flash((e as Error).message); }
  }

  return (
    <div className="wrap">
      <header className="top"><h1>Użytkownicy</h1></header>

      <section className="panel" aria-label="Zaproś">
        <h2>Zaproś</h2>
        <form className="panel" onSubmit={create}>
          <div className="field">
            <label className="label" htmlFor="inv-email">E-mail</label>
            <input id="inv-email" type="email" inputMode="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <RoleBoxes value={roles} onChange={(r, on) => setRoles((cur) => (on ? [...cur, r] : cur.filter((x) => x !== r)))} />
          <button className="btn primary" disabled={busy || !roles.length}>{busy ? "Chwila…" : "Utwórz zaproszenie"}</button>
        </form>
        {made && <LinkCard {...made} onClose={() => setMade(null)} />}
      </section>

      <section className="panel" aria-label="Użytkownicy">
        <h2>Użytkownicy</h2>
        {error && <div className="banner"><span>{error}</span><button className="btn" onClick={load}>Spróbuj ponownie</button></div>}
        {!users && !error && <p className="sub">Wczytywanie…</p>}
        {users?.map((u) => (
          <div key={u.id} className="usercard">
            <div className="head">
              <strong className="mail">{u.email}</strong>
              {u.id === userId && <span className="sub">(Ty)</span>}
              {u.invited && <span className="chip">zaproszony</span>}
            </div>
            <RoleBoxes value={u.roles} onChange={(r, on) => toggle(u, r, on)} />
            <div className="row">
              <button className="btn" onClick={() => relink(u)}>Nowy link</button>
              <button className={"btn danger" + (armed === u.id ? " armed" : "")} onClick={() => revoke(u)} disabled={!u.roles.length}>
                {armed === u.id ? "Na pewno odebrać?" : "Odbierz dostęp"}
              </button>
            </div>
          </div>
        ))}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
