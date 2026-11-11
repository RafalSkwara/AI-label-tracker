"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { archiveRow, loadAll, saveRow, saveSettings, setTaskDone } from "@/lib/data";
import { daysTo, dfmt, dmy, inDays, localDateTime, nf, num, pln, today } from "@/lib/format";
import { costTotals, monthly, weeksAgg } from "@/lib/money";
import type { Coll, Data, Item, Settings, Sub, Task, Week } from "@/lib/types";
import { type Alert, alerts, awaitingApproval } from "@/lib/rules";
import PushToggle from "@/features/push/PushToggle";
import RoyaltiesPanel from "./RoyaltiesPanel";
import Sheet from "./Sheet";
import Overview from "./Overview";
import WeeksChart from "./WeeksChart";

const TABS = [
  { id: "dzis", name: "Przegląd", coll: null },
  { id: "zadania", name: "Zadania", coll: "tasks" },
  { id: "pipeline", name: "Pipeline", coll: "items" },
  { id: "tygodnie", name: "Tygodnie", coll: "weeks" },
  { id: "koszty", name: "Koszty", coll: "subs" },
  { id: "muzyka", name: "Muzyka", coll: "none" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const NOUN: Record<Coll, string> = { tasks: "zadanie", items: "pozycję", weeks: "tydzień", subs: "subskrypcję" };
type Editing = { coll: Coll; rec: Record<string, unknown> | null } | null;

export default function Tracker({ email }: { email: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  // Tracker mounts only on the client (after the session check), so window and sessionStorage are safe here.
  // Start tab: ?tab= from the URL, else the tab remembered for this session (reloads), else Dziś on every launch.
  const [tab, setTab] = useState<TabId>(() => {
    const ok = (s: string | null) => TABS.some((t) => t.id === s);
    try {
      let q = new URL(window.location.href).searchParams.get("tab");
      if (q === "subskrypcje") q = "koszty"; // old links: subscriptions are part of Koszty now
      if (ok(q)) return q as TabId;
    } catch {}
    try { const s = sessionStorage.getItem("tab"); if (ok(s)) return s as TabId; } catch {}
    return "dzis";
  });
  // Drop ?tab= after reading it (outside render: replaceState during render updates the router mid-render); keep other params, e.g. yt
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.has("tab")) { u.searchParams.delete("tab"); history.replaceState(null, "", u.pathname + u.search + u.hash); }
  }, []);
  const [editing, setEditing] = useState<Editing>(null);
  const [toast, setToast] = useState<string | null>(null);
  const loadedAt = useRef(0);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }, []);

  const apply = useCallback((d: Data) => {
    loadedAt.current = Date.now();
    setData(d);
    setError("");
    setBusy(false);
  }, []);
  const fail = useCallback((e: unknown) => { setError((e as Error).message); setBusy(false); }, []);

  const load = useCallback(async () => {
    setBusy(true);
    await loadAll().then(apply, fail);
  }, [apply, fail]);

  useEffect(() => {
    // Result of the Google redirect (?yt=ok|denied|wrong-channel|error): tell the owner once, then drop it from the URL
    try {
      const u = new URL(window.location.href), y = u.searchParams.get("yt");
      if (y) {
        u.searchParams.delete("yt"); history.replaceState(null, "", u.pathname + u.search + u.hash);
        setTimeout(() => flash(({ ok: "Połączono z YouTube", denied: "Anulowano łączenie z YouTube", "wrong-channel": "To konto YouTube to inny kanał niż w projekcie", "no-channel": "To konto Google nie ma kanału YouTube", "no-refresh-token": "Google nie przekazał trwałego dostępu — spróbuj połączyć ponownie i zaakceptuj wszystkie uprawnienia" } as Record<string, string>)[y] ?? "Nie udało się połączyć z YouTube"), 0);
      }
    } catch {}
    loadAll().then(apply, fail);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - loadedAt.current > 60e3) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [apply, fail, load, flash]);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) flash(ok); }
    catch (e) { flash("Nie zapisano: " + (e as Error).message); }
    await load();
  }

  function pickTab(id: TabId) {
    setTab(id);
    try { sessionStorage.setItem("tab", id); } catch {}
  }

  function openAlert(a: Alert) {
    if (!data) return;
    const find = <T extends { id: string }>(l: T[]) => l.find((x) => x.id === a.ref);
    if (a.kind === "task_late" || a.kind === "task_soon") { const t = find(data.tasks); if (t) setEditing({ coll: "tasks", rec: t }); else pickTab("zadania"); }
    else if (a.kind === "renewal") { const s = find(data.subs); if (s) setEditing({ coll: "subs", rec: s }); else pickTab("koszty"); }
    else if (a.kind === "ctr_low") { const i = find(data.items); if (i) setEditing({ coll: "items", rec: i }); else pickTab("tygodnie"); }
    else if (a.kind === "impressions_drop") pickTab("tygodnie");
    else if (a.kind === "automation") pickTab("pipeline");
  }

  const alertList = useMemo(() => (data ? alerts(data, today()) : []), [data]);

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Kanały</h1>
        </div>
        <div className="conn">
          <span className={"dot " + (error ? "off" : busy ? "busy" : "on")} />
          <span>{error ? "Błąd bazy" : busy ? "Synchronizacja…" : "Supabase"}</span>
          <button className="linkbtn" onClick={load}>Odśwież</button>
        </div>
      </header>

      {error && (
        <div className="banner">
          <span>{/permission|policy|42501/i.test(error) ? `Konto ${email} nie ma dostępu do danych.` : error}</span>
          <button className="btn" onClick={load}>Spróbuj ponownie</button>
        </div>
      )}

      {data && (
        <>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" id={"tab-" + t.id} aria-selected={tab === t.id} onClick={() => pickTab(t.id)}>
                {t.name}
                <span className="count">{t.coll === "none" ? null : t.coll === null ? alertList.filter((a) => a.severity !== "low").length : t.coll === "tasks" ? data.tasks.filter((x) => !x.done).length : data[t.coll].length}</span>
              </button>
            ))}
          </nav>

          <main className="panel" role="tabpanel" aria-labelledby={"tab-" + tab}>
            {tab === "dzis" && <Overview data={data} today={today()} list={alertList} onOpen={openAlert} onReload={load} flash={flash} />}
            {tab === "zadania" && <TasksPanel data={data} onAdd={() => setEditing({ coll: "tasks", rec: null })} onEdit={(t) => setEditing({ coll: "tasks", rec: t })}
              onToggle={(t, done) => {
                setData({ ...data, tasks: data.tasks.map((x) => (x.id === t.id ? { ...x, done } : x)) });
                run(() => setTaskDone(t.id, done));
              }} />}
            {tab === "pipeline" && <PipelinePanel data={data} onAdd={() => setEditing({ coll: "items", rec: null })} onEdit={(i) => setEditing({ coll: "items", rec: i })} />}
            {tab === "tygodnie" && <WeeksPanel data={data} onAdd={() => setEditing({ coll: "weeks", rec: null })} onEdit={(w) => setEditing({ coll: "weeks", rec: w })} />}
            {tab === "koszty" && <CostsPanel data={data} onAdd={() => setEditing({ coll: "subs", rec: null })} onEdit={(s) => setEditing({ coll: "subs", rec: s })}
              onSettings={(k, v) => run(() => saveSettings({ [k]: v }), "Zapisano ustawienia")} flash={flash} />}
            {tab === "muzyka" && <RoyaltiesPanel data={data} flash={flash} />}
          </main>
        </>
      )}

      {!data && !error && <div className="empty"><strong>Wczytywanie…</strong><span>Dane przychodzą z Supabase.</span></div>}

      {editing && data && (
        <Sheet coll={editing.coll} rec={editing.rec} projects={data.projects} noun={NOUN[editing.coll]}
          onClose={() => setEditing(null)}
          onSave={(out) => { const e = editing; setEditing(null); run(() => saveRow(e.coll, e.rec, out), e.rec ? "Zapisano" : "Dodano"); }}
          onDelete={() => { const e = editing; setEditing(null); if (e.rec) run(() => archiveRow(e.coll, e.rec!), "Usunięto"); }} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}


function Head({ title, sub, noun, onAdd }: { title: string; sub: string; noun: string; onAdd: () => void }) {
  return (
    <div className="panelhead">
      <div><h2>{title}</h2><p className="sub">{sub}</p></div>
      <button className="btn primary" onClick={onAdd}>Dodaj {noun}</button>
    </div>
  );
}
const Empty = ({ title, body }: { title: string; body: string }) => <div className="empty"><strong>{title}</strong><span>{body}</span></div>;

function TasksPanel({ data, onAdd, onEdit, onToggle }: { data: Data; onAdd: () => void; onEdit: (t: Task) => void; onToggle: (t: Task, done: boolean) => void }) {
  const t0 = today(), soon = inDays(3);
  const pname = (id: string | null) => data.projects.find((p) => p.id === id)?.name;
  return (
    <>
      <Head title="Zadania" sub="Lista zadań i terminy" noun={NOUN.tasks} onAdd={onAdd} />
      {!data.tasks.length && <Empty title="Brak zadań" body="Dodaj pierwsze zadanie przyciskiem powyżej." />}
      {(["F0", "F1", "F2", "F3"] as const).map((ph) => {
        const list = data.tasks.filter((t) => t.phase === ph).sort((a, b) =>
          Number(a.done) - Number(b.done) || (a.due ?? "9").localeCompare(b.due ?? "9") || a.title.localeCompare(b.title));
        if (!list.length) return null;
        return (
          <div className="group" key={ph}>
            <span className="label">{ph} · {list.filter((t) => t.done).length}/{list.length}</span>
            {list.map((t) => (
              <div key={t.id} className={"task" + (t.done ? " done" : "")}>
                <input type="checkbox" id={"t-" + t.id} checked={t.done} aria-label={"Oznacz jako zrobione: " + t.title} onChange={(e) => onToggle(t, e.target.checked)} />
                <label className="t" htmlFor={"t-" + t.id}>{t.title}{pname(t.project_id) && <span className="chip" style={{ marginLeft: ".5rem" }}>{pname(t.project_id)}</span>}</label>
                {t.due ? <span className={"chip" + (!t.done && t.due < t0 ? " late" : !t.done && t.due <= soon ? " soon" : "")}>{dfmt(t.due)}</span> : <span />}
                <button className="icon" aria-label="Edytuj" onClick={() => onEdit(t)}>Edytuj</button>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function PipelinePanel({ data, onAdd, onEdit }: { data: Data; onAdd: () => void; onEdit: (i: Item) => void }) {
  const chan = (id: string | null) => data.projects.find((c) => c.id === id)?.name;
  return (
    <>
      <Head title="Pipeline" sub="Filmy, EP-ki i shorty" noun={NOUN.items} onAdd={onAdd} />
      <Automation data={data} />
      {!data.items.length ? <Empty title="Pipeline jest pusty" body="Dodaj pierwszy film, np. jesienną scenę na weekend." /> : (
        <div className="board">
          {(["pomysł", "produkcja", "zaplanowany", "live"] as const).map((st) => {
            const list = data.items.filter((i) => i.status === st).sort((a, b) => (a.publish_date ?? "9").localeCompare(b.publish_date ?? "9"));
            return (
              <div className="col" key={st}>
                <span className="label"><span>{st}</span><span className="num">{list.length}</span></span>
                {list.map((i) => (
                  <div key={i.id} className={"card st-" + st} role="button" tabIndex={0}
                    onClick={(e) => { if ((e.target as HTMLElement).tagName !== "A") onEdit(i); }} onKeyDown={(e) => { if (e.key === "Enter") onEdit(i); }}>
                    <span className="t">{i.title}</span>
                    <div className="meta">
                      <span className="chip">{i.kind}</span>
                      {chan(i.project_id) && <span className="chip">{chan(i.project_id)}</span>}
                      {i.publish_date && <span className="chip">{dfmt(i.publish_date)}</span>}
                    </div>
                    {i.url && /^https?:\/\//.test(i.url) && <a href={i.url} target="_blank" rel="noopener">Otwórz link</a>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const WF = { build: "Build", approve: "Publikacja", check: "Połączenia" } as const;
const RUN_ST = { running: "w toku", success: "OK", failure: "błąd", cancelled: "przerwany", skipped: "pominięty" } as const;
const RUN_CLS = { running: "soon", success: "ok", failure: "late", cancelled: "late", skipped: "soon" } as const;

/** Last runs of the automated pipelines (GitHub Actions), newest first */
function Automation({ data }: { data: Data }) {
  if (!data.runs.length) return null;
  const waiting = awaitingApproval(data.runs);
  return (
    <section className="runs" aria-label="Automatyzacja">
      <span className="label">Automatyzacja{waiting.length ? ` · czeka na /publish: ${waiting.length}` : ""}</span>
      {data.runs.slice(0, 8).map((r) => (
        <a key={r.run_id + "-" + r.run_attempt} className="card run" href={r.run_url} target="_blank" rel="noopener">
          <span className="t">{WF[r.workflow]}{r.slug ? " · " + r.slug : ""}</span>
          <div className="meta">
            <span className={"chip " + RUN_CLS[r.status]}>{RUN_ST[r.status]}</span>
            {waiting.some((w) => w.run_id === r.run_id) && <span className="chip soon">czeka na /publish</span>}
            <span className="chip">{localDateTime(r.started_at)}</span>
            {r.finished_at && <span className="chip">{Math.max(1, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 60e3))} min</span>}
          </div>
          {r.detail && <span className="d">{r.detail}</span>}
        </a>
      ))}
    </section>
  );
}

function WeeksPanel({ data, onAdd, onEdit }: { data: Data; onAdd: () => void; onEdit: (w: Week) => void }) {
  const w = [...data.weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const multi = data.projects.length > 1;
  const f = (v: number | null, d: number, suffix = "") => (num(v) == null ? "—" : nf(d).format(Number(v)) + suffix);
  return (
    <>
      <Head title="Tygodnie" sub="Dane z YouTube, synchronizowane codziennie" noun={NOUN.weeks} onAdd={onAdd} />
      {!w.length ? <Empty title="Brak danych tygodniowych" body="Po pierwszym tygodniu od publikacji wpisz godziny oglądania, wyświetlenia, CTR i średni czas oglądania." /> : (
        <>
          <div className="chartbox"><span className="label">Godziny oglądania / tydzień</span><WeeksChart weeks={weeksAgg(data.weeks)} /></div>
          <div className="tablewrap">
            <table>
              <thead><tr>{["Tydzień", "Filmy", "Wyśw.", "Godz.", "Δ t/t", "Suby", "CTR", "AVD", "Przychód", "Notatka"].map((t) => <th key={t} scope="col">{t}</th>)}</tr></thead>
              <tbody>
                {[...w].reverse().map((r) => {
                  const prev = w.filter((x) => x.project_id === r.project_id && x.week_start < r.week_start).pop();
                  const a = prev ? num(prev.watch_hours) : null, b = num(r.watch_hours);
                  let delta = "—", cls = "flat";
                  if (a != null && b != null && a > 0) { const pc = ((b - a) / a) * 100; delta = (pc > 0 ? "+" : "") + nf(0).format(pc) + "%"; cls = pc > 2 ? "up" : pc < -2 ? "down" : "flat"; }
                  return (
                    <tr key={r.project_id + r.week_start} tabIndex={0} onClick={() => onEdit(r)} onKeyDown={(e) => { if (e.key === "Enter") onEdit(r); }}>
                      <td>{dfmt(r.week_start)}{multi ? " · " + (data.projects.find((c) => c.id === r.project_id)?.name ?? "") : ""}</td>
                      <td>{f(r.uploads, 0)}</td><td>{f(r.views, 0)}</td><td>{f(r.watch_hours, 1)}</td>
                      <td className={cls}>{delta}</td><td>{f(r.subs_net, 0)}</td><td>{f(r.ctr_pct, 1, "%")}</td>
                      <td>{f(r.avd_min, 1, " min")}</td><td>{f(r.revenue_pln, 2, " zł")}</td>
                      <td className="note">{(r.source === "yt_api" ? "[API] " : "") + (r.note ?? "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function CostsPanel({ data, onAdd, onEdit, onSettings, flash }: { data: Data; onAdd: () => void; onEdit: (s: Sub) => void; onSettings: (k: keyof Settings, v: number) => void; flash: (msg: string) => void }) {
  const c = costTotals(data), st = data.settings;
  const pname = (id: string | null) => data.projects.find((p) => p.id === id)?.name;
  const order: Record<string, number> = { aktywna: 0, planowana: 1, anulowana: 2 };
  const act = data.subs.filter((s) => s.status === "aktywna");
  const next = act.filter((s) => s.renew && daysTo(s.renew) >= 0).sort((a, b) => a.renew!.localeCompare(b.renew!))[0];
  const rel = (d: string) => { const n = daysTo(d); return n === 0 ? "dziś" : n > 0 ? `za ${n} ${n === 1 ? "dzień" : "dni"}` : `${-n} ${n === -1 ? "dzień" : "dni"} temu`; };
  const row = (l: string, v: React.ReactNode) => <><dt className="label">{l}</dt><dd>{v}</dd></>;
  const field = (k: keyof Settings, l: string, step = "1") => (
    <div className="field" key={k}>
      <label className="label" htmlFor={"set-" + k}>{l}</label>
      <input id={"set-" + k} type="number" step={step} defaultValue={st[k]} onBlur={(e) => { const v = num(e.target.value); if (v != null && v !== Number(st[k])) onSettings(k, v); }} />
    </div>
  );
  return (
    <>
      <Head title="Koszty i subskrypcje" sub="Ceny netto w USD przeliczane z VAT; plany roczne rozłożone na miesiące" noun={NOUN.subs} onAdd={onAdd} />
      <div className="totals">
        <div><div className="label">Razem / mies.</div><div className="num" style={{ fontSize: "1.3rem" }}>{pln(c.total)}</div></div>
        <div><div className="label">Aktywne ({act.length})</div><div className="num">{pln(c.active)}</div></div>
        <div><div className="label">Planowane</div><div className="num">{pln(c.planned)}</div></div>
        <div><div className="label">Zapas do max budżetu</div><div className={"num " + (st.budget_max - c.total < 0 ? "down" : "")}>{pln(st.budget_max - c.total)}</div></div>
        <div><div className="label">Najbliższa płatność</div><div className="num">{next ? `${next.name} · ${dmy(next.renew)}` : "—"}</div></div>
      </div>
      <PushToggle flash={flash} />
      {!data.subs.length ? <Empty title="Brak subskrypcji" body="Dodaj Suno, Midjourney, Kling i DistroKid, żeby zobaczyć koszt miesięczny." /> : (
        <div className="subcards">
          {[...data.subs].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || monthly(b, st) - monthly(a, st)).map((s) => (
            <div key={s.id} className={"card subcard" + (s.status === "anulowana" ? " cancel" : "")} role="button" tabIndex={0}
              onClick={() => onEdit(s)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onEdit(s); }}>
              <div className="head">
                <div style={{ minWidth: 0 }}><div className="t">{s.name}</div><div className="sub">{(s.plan ?? "—") + (pname(s.project_id) ? " · " + pname(s.project_id) : "")}</div></div>
                <span className={"st " + s.status}>{s.status}</span>
              </div>
              <dl>
                {row("Cena", <>{`${nf(2).format(Number(s.price) || 0)} ${s.currency} / ${s.cycle === "rok" ? "rok" : "mies."}`}<span className="sub"> · {pln(monthly(s, st))} / mies.</span></>)}
                {row("Od", dmy(s.started_at))}
                {row("Opłacone do", dmy(s.paid_until))}
                {row("Następna płatność", s.renew ? <>{dmy(s.renew)} <span className={daysTo(s.renew) < 0 ? "down" : "sub"}>({rel(s.renew)})</span></> : "—")}
              </dl>
              {s.note && <p className="details">{s.note}</p>}
              {s.plan_details && <p className="details">{s.plan_details}</p>}
              {s.dashboard_url && /^https?:\/\//.test(s.dashboard_url) && <a href={s.dashboard_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Otwórz dashboard</a>}
            </div>
          ))}
        </div>
      )}
      <div className="settings">
        {field("usd_pln", "Kurs USD/PLN", "0.01")}{field("vat_pct", "VAT %")}{field("budget_min", "Budżet min (zł)")}{field("budget_max", "Budżet max (zł)")}
        <p>VAT dolicza się tylko do cen w USD. Kurs zaktualizuj przy rozliczeniu miesiąca.</p>
      </div>
    </>
  );
}
