"use client";

import { useState } from "react";
import { localDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Data, Integration, Project } from "@/lib/types";

/** One line of status per YouTube project, in Polish */
export function ytStatus(i: Integration | undefined): { text: string; tone: "ok" | "no" | "nd" } {
  if (!i) return { text: "Niepołączony", tone: "nd" };
  if (i.last_error) return /invalid_grant/.test(i.last_error)
    ? { text: "Wymagane ponowne połączenie konta", tone: "no" }
    : { text: "Błąd synchronizacji: " + i.last_error, tone: "no" };
  const when = i.last_sync_at ? "ostatnia synchronizacja " + localDateTime(i.last_sync_at) : "jeszcze nie synchronizowano";
  return i.reporting_job_id && !i.reports_cursor
    ? { text: `Połączony, ${when} · czekam na pierwszy raport CTR (1–2 dni)`, tone: "ok" }
    : { text: `Połączony, ${when}`, tone: "ok" };
}

async function api(path: string, body: object) {
  const { data } = await supabase().auth.getSession();
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(r.status === 401 ? "Brak uprawnień" : "Błąd serwera (" + r.status + ")");
  return r.json();
}

export default function Integrations({ data, onDone, flash }: { data: Data; onDone: () => void; flash: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const projects = data.projects.filter((p: Project) => (p.kind === "yt_channel" || p.kind === "both") && p.status !== "zamknięty");
  if (!projects.length) return null;

  async function connect(p: Project) {
    setBusy(p.id);
    try { window.location.href = (await api("/api/yt/connect", { projectId: p.id })).url; }
    catch (e) { flash("Nie połączono: " + (e as Error).message); setBusy(null); }
  }
  async function sync(p: Project) {
    setBusy(p.id);
    try {
      const res = (await api("/api/yt/sync", { projectId: p.id })).results as { ok: boolean; error?: string }[];
      flash(res[0]?.ok ? "Zsynchronizowano" : "Synchronizacja nie powiodła się: " + (res[0]?.error ?? "brak połączenia"));
    } catch (e) { flash("Nie zsynchronizowano: " + (e as Error).message); }
    setBusy(null);
    onDone();
  }

  return (
    <section className="integrations" aria-label="YouTube">
      <span className="label">YouTube</span>
      {projects.map((p) => {
        const i = data.integrations.find((x) => x.project_id === p.id), s = ytStatus(i);
        return (
          <article key={p.id} className="gate">
            <div className="head">
              <div style={{ minWidth: 0 }}>
                <h3>{p.name}</h3>
                <p className={"sub ytstate " + s.tone}>{s.text}</p>
              </div>
            </div>
            <div className="actions">
              {i && <button className="btn" disabled={busy === p.id} onClick={() => sync(p)}>{busy === p.id ? "Synchronizuję…" : "Synchronizuj teraz"}</button>}
              <button className={i && !i.last_error ? "linkbtn" : "btn primary"} disabled={busy === p.id} onClick={() => connect(p)}>{i ? "Połącz ponownie" : "Połącz YouTube"}</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
