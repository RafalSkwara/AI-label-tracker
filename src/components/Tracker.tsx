"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { archiveRow, loadAll, saveRow, saveSettings, setTaskDone } from "@/lib/data";
import { daysTo, dfmt, dmy, inDays, nf, num, pln, today } from "@/lib/format";
import { XP_PER_LEVEL, badges, costTotals, levelName, levelOf, monthly, streak, totalHours, totalSubs, trend, weeksAgg, xpTotal } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import type { Coll, Data, Item, Settings, Sub, Task, Week } from "@/lib/types";
import Sheet from "./Sheet";
import WeeksChart from "./WeeksChart";

const TABS = [
  { id: "zadania", name: "Zadania", coll: "tasks" },
  { id: "pipeline", name: "Pipeline", coll: "items" },
  { id: "tygodnie", name: "Tygodnie", coll: "weeks" },
  { id: "koszty", name: "Koszty", coll: "subs" },
  { id: "subskrypcje", name: "Subskrypcje", coll: "subs" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const NOUN: Record<Coll, string> = { tasks: "zadanie", items: "pozycję", weeks: "tydzień", subs: "subskrypcję" };
type Editing = { coll: Coll; rec: Record<string, unknown> | null } | null;

export default function Tracker({ email }: { email: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  // Tracker mounts only on the client (after the session check), so localStorage is safe here
  const [tab, setTab] = useState<TabId>(() => {
    try { const s = localStorage.getItem("tab"); if (TABS.some((t) => t.id === s)) return s as TabId; } catch {}
    return "zadania";
  });
  const [editing, setEditing] = useState<Editing>(null);
  const [toast, setToast] = useState<{ msg: string; xp?: boolean } | null>(null);
  const loadedAt = useRef(0);
  const prevXp = useRef<number | null>(null);

  const flash = useCallback((msg: string, xp?: boolean) => {
    setToast({ msg, xp });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const apply = useCallback((d: Data) => {
    const after = xpTotal(d), before = prevXp.current;
    if (before != null && after > before) {
      flash(levelOf(after) > levelOf(before) ? `Poziom ${levelOf(after) + 1}: ${levelName(levelOf(after))}!` : `+${after - before} XP`, true);
    }
    prevXp.current = after;
    loadedAt.current = Date.now();
    setData(d);
    setError("");
    setBusy(false);
  }, [flash]);
  const fail = useCallback((e: unknown) => { setError((e as Error).message); setBusy(false); }, []);

  const load = useCallback(async () => {
    setBusy(true);
    await loadAll().then(apply, fail);
  }, [apply, fail]);

  useEffect(() => {
    loadAll().then(apply, fail);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - loadedAt.current > 60e3) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [apply, fail, load]);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) flash(ok); }
    catch (e) { flash("Nie zapisano: " + (e as Error).message); }
    await load();
  }

  function pickTab(id: TabId) {
    setTab(id);
    try { localStorage.setItem("tab", id); } catch {}
  }

  const xp = data ? xpTotal(data) : 0, lvl = levelOf(xp), into = xp - lvl * XP_PER_LEVEL;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Tracker Wydawnictwa</h1>
          <p className="sub">Faza F1 · walidacja sceny sezonowe · 12 tygodni od 24.10.2026</p>
        </div>
        <div className="conn">
          <span className={"dot " + (error ? "off" : busy ? "busy" : "on")} />
          <span>{error ? "Błąd bazy" : busy ? "Synchronizacja…" : "Supabase"}</span>
          <button className="linkbtn" onClick={load}>Odśwież</button>
          <button className="linkbtn" onClick={() => supabase().auth.signOut()} title={email}>Wyloguj</button>
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
          <section className="progress" aria-label="Postęp">
            <div>
              <div className="lvl">
                <span className="badge num">{lvl + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{levelName(lvl)}</div>
                  <div className="sub num">{nf().format(xp)} XP · {XP_PER_LEVEL - into} do poziomu {lvl + 2}</div>
                </div>
              </div>
              <div className="xpbar" role="progressbar" aria-label="Postęp do następnego poziomu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((into / XP_PER_LEVEL) * 100)}>
                <i style={{ width: (into / XP_PER_LEVEL) * 100 + "%" }} />
              </div>
              <div className="facts">
                <div><div className="label">Seria tygodni z filmem</div><div className="v">{streak(data)}</div></div>
                <div><div className="label">Do YPP (godziny)</div><div className="v">{nf().format(Math.max(0, 4000 - totalHours(data)))}</div></div>
                <div><div className="label">Odznaki</div><div className="v">{badges(data).filter((b) => b.on).length}/{badges(data).length}</div></div>
              </div>
              <div className="badges">
                {badges(data).map((b) => <span key={b.n} className={"bd" + (b.on ? " on" : "")} title={b.hint}>{(b.on ? "★ " : "") + b.n}</span>)}
              </div>
            </div>
            <div>
              <span className="label">Ostatnie XP</span>
              <div className="feed">
                {data.xp.length ? data.xp.slice(0, 6).map((e) => (
                  <div key={e.kind + e.ref}><span>{e.title}</span><span className="xp">+{e.xp}</span></div>
                )) : <div><span>Odhacz pierwsze zadanie, żeby zdobyć XP.</span></div>}
              </div>
              <p className="sub" style={{ fontSize: ".8rem", margin: 0 }}>Zadanie +10 · film +50 · EP +40 · short +15 · wpisany tydzień +5</p>
            </div>
          </section>

          <Strip data={data} />

          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" id={"tab-" + t.id} aria-selected={tab === t.id} onClick={() => pickTab(t.id)}>
                {t.name}
                <span className="count">{t.coll === "tasks" ? data.tasks.filter((x) => !x.done).length : data[t.coll].length}</span>
              </button>
            ))}
          </nav>

          <main className="panel" role="tabpanel" aria-labelledby={"tab-" + tab}>
            {tab === "zadania" && <TasksPanel data={data} onAdd={() => setEditing({ coll: "tasks", rec: null })} onEdit={(t) => setEditing({ coll: "tasks", rec: t })}
              onToggle={(t, done) => {
                setData({ ...data, tasks: data.tasks.map((x) => (x.id === t.id ? { ...x, done } : x)) });
                run(() => setTaskDone(t.id, done));
              }} />}
            {tab === "pipeline" && <PipelinePanel data={data} onAdd={() => setEditing({ coll: "items", rec: null })} onEdit={(i) => setEditing({ coll: "items", rec: i })} />}
            {tab === "tygodnie" && <WeeksPanel data={data} onAdd={() => setEditing({ coll: "weeks", rec: null })} onEdit={(w) => setEditing({ coll: "weeks", rec: w })} />}
            {tab === "koszty" && <CostsPanel data={data} onAdd={() => setEditing({ coll: "subs", rec: null })} onEdit={(s) => setEditing({ coll: "subs", rec: s })}
              onSettings={(k, v) => run(() => saveSettings({ [k]: v }), "Zapisano ustawienia")} />}
            {tab === "subskrypcje" && <SubsPanel data={data} onAdd={() => setEditing({ coll: "subs", rec: null })} onEdit={(s) => setEditing({ coll: "subs", rec: s })} />}
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

      {toast && <div className={"toast" + (toast.xp ? " xp" : "")} role="status">{toast.msg}</div>}
    </div>
  );
}

function Meter({ ratio }: { ratio: number }) {
  const r = Math.max(0, ratio);
  return <div className={"meter" + (r > 1 ? " over" : "")}><i style={{ width: Math.min(100, r * 100) + "%" }} /></div>;
}

function Strip({ data }: { data: Data }) {
  const c = costTotals(data), st = data.settings, hours = totalHours(data), subs = totalSubs(data), t = trend(data.weeks), agg = weeksAgg(data.weeks);
  return (
    <section className="strip" aria-label="Podsumowanie">
      <div className="stat"><span className="label">Koszt / mies.</span><span className="v">{pln(c.total)}</span><Meter ratio={st.budget_max ? c.total / st.budget_max : 0} />
        <span className="d">budżet {nf().format(st.budget_min)}–{nf().format(st.budget_max)} zł · aktywne {pln(c.active)}</span></div>
      <div className="stat"><span className="label">Godziny oglądania</span><span className="v">{nf(1).format(hours)}</span><Meter ratio={hours / 4000} /><span className="d">próg YPP 4 000 h</span></div>
      <div className="stat"><span className="label">Trend t/t (godziny)</span>
        <span className={"v " + (t?.dir ?? "")}>{!t ? "—" : t.pct == null ? "↑ nowe" : (t.pct > 0 ? "↑ +" : t.pct < 0 ? "↓ " : "→ ") + nf(0).format(t.pct) + "%"}</span>
        <span className="d">{t ? "tydzień od " + dfmt(agg[agg.length - 1].week_start) : "potrzeba 2 tygodni danych"}</span></div>
      <div className="stat"><span className="label">Subskrybenci</span><span className="v">{nf().format(subs)}</span><Meter ratio={subs / 1000} /><span className="d">próg YPP 1 000</span></div>
    </section>
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
      <Head title="Zadania" sub="Każde odhaczone zadanie to +10 XP" noun={NOUN.tasks} onAdd={onAdd} />
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
      <Head title="Pipeline" sub="Film live to +50 XP, short +15, EP +40" noun={NOUN.items} onAdd={onAdd} />
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

function WeeksPanel({ data, onAdd, onEdit }: { data: Data; onAdd: () => void; onEdit: (w: Week) => void }) {
  const w = [...data.weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const multi = data.projects.length > 1;
  const f = (v: number | null, d: number, suffix = "") => (num(v) == null ? "—" : nf(d).format(Number(v)) + suffix);
  return (
    <>
      <Head title="Tygodnie" sub="Dane z YouTube Studio co poniedziałek, +5 XP za wpis. W F2 uzupełni je automat." noun={NOUN.weeks} onAdd={onAdd} />
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

function CostsPanel({ data, onAdd, onEdit, onSettings }: { data: Data; onAdd: () => void; onEdit: (s: Sub) => void; onSettings: (k: keyof Settings, v: number) => void }) {
  const c = costTotals(data), st = data.settings;
  const pname = (id: string | null) => data.projects.find((p) => p.id === id)?.name;
  const order: Record<string, number> = { aktywna: 0, planowana: 1, anulowana: 2 };
  const field = (k: keyof Settings, l: string, step = "1") => (
    <div className="field" key={k}>
      <label className="label" htmlFor={"set-" + k}>{l}</label>
      <input id={"set-" + k} type="number" step={step} defaultValue={st[k]} onBlur={(e) => { const v = num(e.target.value); if (v != null && v !== Number(st[k])) onSettings(k, v); }} />
    </div>
  );
  return (
    <>
      <Head title="Koszty" sub="Ceny netto w USD przeliczane z VAT; plany roczne rozłożone na miesiące" noun={NOUN.subs} onAdd={onAdd} />
      <div className="totals">
        <div><div className="label">Razem / mies.</div><div className="num" style={{ fontSize: "1.3rem" }}>{pln(c.total)}</div></div>
        <div><div className="label">Aktywne</div><div className="num">{pln(c.active)}</div></div>
        <div><div className="label">Planowane</div><div className="num">{pln(c.planned)}</div></div>
        <div><div className="label">Zapas do max budżetu</div><div className={"num " + (st.budget_max - c.total < 0 ? "down" : "")}>{pln(st.budget_max - c.total)}</div></div>
      </div>
      {!data.subs.length ? <Empty title="Brak subskrypcji" body="Dodaj Suno, Midjourney, Kling i DistroKid, żeby zobaczyć koszt miesięczny." /> : (
        <div className="subs">
          {[...data.subs].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || monthly(b, st) - monthly(a, st)).map((s) => (
            <button key={s.id} className={"subrow" + (s.status === "anulowana" ? " cancel" : "")} onClick={() => onEdit(s)}>
              <div style={{ minWidth: 0 }}>
                <div className="n">{s.name + (s.plan ? " · " + s.plan : "") + (pname(s.project_id) ? " · " + pname(s.project_id) : "")}</div>
                <div className="p">{`${nf(2).format(Number(s.price) || 0)} ${s.currency} / ${s.cycle === "rok" ? "rok" : "mies."}` + (s.note ? " · " + s.note : "")}</div>
              </div>
              <span className={"st " + s.status}>{s.status}</span>
              <span className="m">{pln(monthly(s, st))}</span>
            </button>
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


function SubsPanel({ data, onAdd, onEdit }: { data: Data; onAdd: () => void; onEdit: (s: Sub) => void }) {
  const st = data.settings, order: Record<string, number> = { aktywna: 0, planowana: 1, anulowana: 2 };
  const pname = (id: string | null) => data.projects.find((p) => p.id === id)?.name;
  const act = data.subs.filter((s) => s.status === "aktywna");
  const next = act.filter((s) => s.renew && daysTo(s.renew) >= 0).sort((a, b) => a.renew!.localeCompare(b.renew!))[0];
  const rel = (d: string) => { const n = daysTo(d); return n === 0 ? "dziś" : n > 0 ? `za ${n} ${n === 1 ? "dzień" : "dni"}` : `${-n} ${n === -1 ? "dzień" : "dni"} temu`; };
  const row = (l: string, v: React.ReactNode) => <><dt className="label">{l}</dt><dd>{v}</dd></>;
  return (
    <>
      <Head title="Subskrypcje" sub="Przegląd usług: od kiedy, do kiedy opłacone, następna płatność i link do panelu" noun={NOUN.subs} onAdd={onAdd} />
      <div className="totals">
        <div><div className="label">Aktywne subskrypcje</div><div className="num">{act.length}</div></div>
        <div><div className="label">Najbliższa płatność</div><div className="num">{next ? `${next.name} · ${dmy(next.renew)}` : "—"}</div></div>
        <div><div className="label">Koszt aktywnych / mies.</div><div className="num">{pln(costTotals(data).active)}</div></div>
      </div>
      {!data.subs.length ? <Empty title="Brak subskrypcji" body="Dodaj pierwszą subskrypcję przyciskiem powyżej." /> : (
        <div className="subcards">
          {[...data.subs].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.renew ?? "9").localeCompare(b.renew ?? "9")).map((s) => (
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
              {s.plan_details && <p className="details">{s.plan_details}</p>}
              {s.dashboard_url && /^https?:\/\//.test(s.dashboard_url) && <a href={s.dashboard_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Otwórz dashboard</a>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
