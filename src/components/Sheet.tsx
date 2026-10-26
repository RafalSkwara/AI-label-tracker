"use client";

import { useEffect, useRef, useState } from "react";
import { iso, monday, num } from "@/lib/format";
import type { Coll, Project } from "@/lib/types";

type Field = { k: string; l: string; t: "text" | "select" | "date" | "number" | "textarea" | "check" | "url" | "project"; o?: string[]; wide?: boolean; req?: boolean; step?: string };

const FIELDS: Record<Coll, Field[]> = {
  tasks: [
    { k: "title", l: "Zadanie", t: "text", wide: true, req: true },
    { k: "phase", l: "Faza", t: "select", o: ["F0", "F1", "F2", "F3"] },
    { k: "due", l: "Termin", t: "date" },
    { k: "project_id", l: "Projekt", t: "project" },
    { k: "note", l: "Notatka", t: "textarea", wide: true },
    { k: "done", l: "Zrobione", t: "check" },
  ],
  items: [
    { k: "title", l: "Tytuł roboczy", t: "text", wide: true, req: true },
    { k: "kind", l: "Rodzaj", t: "select", o: ["film", "EP", "short"] },
    { k: "status", l: "Status", t: "select", o: ["pomysł", "produkcja", "zaplanowany", "live"] },
    { k: "project_id", l: "Projekt", t: "project" },
    { k: "publish_date", l: "Data publikacji", t: "date" },
    { k: "url", l: "Link", t: "url", wide: true },
    { k: "note", l: "Notatka", t: "textarea", wide: true },
  ],
  weeks: [
    { k: "week_start", l: "Poniedziałek tygodnia", t: "date", req: true },
    { k: "project_id", l: "Projekt", t: "project", req: true },
    { k: "uploads", l: "Opublikowane filmy", t: "number" },
    { k: "views", l: "Wyświetlenia", t: "number" },
    { k: "watch_hours", l: "Godziny oglądania", t: "number", step: "0.1" },
    { k: "subs_net", l: "Nowi subskrybenci (netto)", t: "number" },
    { k: "ctr_pct", l: "CTR miniatur (%)", t: "number", step: "0.1" },
    { k: "avd_min", l: "Śr. czas oglądania (min)", t: "number", step: "0.1" },
    { k: "revenue_pln", l: "Przychód (zł)", t: "number", step: "0.01" },
    { k: "note", l: "Notatka", t: "textarea", wide: true },
  ],
  subs: [
    { k: "name", l: "Usługa", t: "text", req: true },
    { k: "plan", l: "Plan", t: "text" },
    { k: "price", l: "Cena netto", t: "number", step: "0.01", req: true },
    { k: "currency", l: "Waluta", t: "select", o: ["USD", "PLN"] },
    { k: "cycle", l: "Rozliczenie", t: "select", o: ["mies", "rok"] },
    { k: "status", l: "Status", t: "select", o: ["aktywna", "planowana", "anulowana"] },
    { k: "started_at", l: "Od kiedy", t: "date" },
    { k: "paid_until", l: "Opłacone do", t: "date" },
    { k: "renew", l: "Następna płatność", t: "date" },
    { k: "plan_details", l: "Szczegóły planu", t: "textarea", wide: true },
    { k: "project_id", l: "Projekt", t: "project" },
    { k: "dashboard_url", l: "Link do dashboardu", t: "url", wide: true },
    { k: "note", l: "Notatka", t: "textarea", wide: true },
  ],
};

function defaults(coll: Coll, projects: Project[]): Record<string, unknown> {
  const ch = projects[0]?.id ?? null;
  if (coll === "tasks") return { phase: "F0", done: false };
  if (coll === "items") return { kind: "film", status: "pomysł", project_id: ch };
  if (coll === "subs") return { currency: "USD", cycle: "mies", status: "planowana" };
  const d = new Date(); d.setDate(d.getDate() - 7);
  return { week_start: monday(iso(d)), project_id: ch };
}

type Props = {
  coll: Coll; rec: Record<string, unknown> | null; projects: Project[]; noun: string;
  onClose: () => void; onSave: (out: Record<string, unknown>) => void; onDelete: () => void;
};

export default function Sheet({ coll, rec, projects, noun, onClose, onSave, onDelete }: Props) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...defaults(coll, projects), ...(rec ?? {}) }));
  const [armed, setArmed] = useState(false);
  const [miss, setMiss] = useState("");
  const first = useRef<HTMLDivElement>(null);
  const fields = FIELDS[coll];

  useEffect(() => {
    first.current?.querySelector<HTMLElement>("input,select,textarea")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const x = v[f.k];
      out[f.k] = f.t === "check" ? !!x : f.t === "number" ? num(x) : typeof x === "string" ? x.trim() || null : x ?? null;
    }
    const m = fields.find((f) => f.req && (out[f.k] == null || out[f.k] === ""));
    if (m) { setMiss(m.l); return; }
    if (coll === "weeks") out.week_start = monday(String(out.week_start));
    onSave(out);
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV({ ...v, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={(rec ? "Edytuj " : "Dodaj ") + noun} ref={first}>
        <h2>{(rec ? "Edycja: " : "Nowe: ") + noun}</h2>
        <form noValidate onSubmit={submit}>
          {fields.map((f) => {
            const id = `f-${coll}-${f.k}`, val = v[f.k];
            if (f.t === "check") return (
              <div key={f.k} className={"field check" + (f.wide ? " wide" : "")}>
                <input id={id} type="checkbox" checked={!!val} onChange={set(f.k)} /><label htmlFor={id}>{f.l}</label>
              </div>
            );
            let input;
            if (f.t === "select") input = <select id={id} value={String(val ?? "")} onChange={set(f.k)}>{f.o!.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
            else if (f.t === "project") input = (
              <select id={id} value={String(val ?? "")} onChange={set(f.k)}>
                {!f.req && <option value="">—</option>}
                {projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            );
            else if (f.t === "textarea") input = <textarea id={id} value={String(val ?? "")} onChange={set(f.k)} />;
            else input = (
              <input id={id} type={f.t} step={f.step ?? (f.t === "number" ? "1" : undefined)} inputMode={f.t === "number" ? "decimal" : undefined}
                value={val == null ? "" : f.t === "date" ? String(val).slice(0, 10) : String(val)} onChange={set(f.k)} />
            );
            return <div key={f.k} className={"field" + (f.wide ? " wide" : "")}><label className="label" htmlFor={id}>{f.l}</label>{input}</div>;
          })}
          {miss && <p className="sub down wide" style={{ margin: 0 }}>Uzupełnij pole: {miss}</p>}
          <div className="actions">
            {rec ? (
              <button type="button" className={"btn danger" + (armed ? " armed" : "")} onClick={() => (armed ? onDelete() : setArmed(true))}>
                {armed ? "Na pewno usunąć?" : "Usuń"}
              </button>
            ) : <span />}
            <div>
              <button type="button" className="btn" onClick={onClose}>Anuluj</button>
              <button type="submit" className="btn primary">{rec ? "Zapisz" : "Dodaj"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
