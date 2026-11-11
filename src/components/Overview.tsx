"use client";

import { useMemo, useState } from "react";
import { change, channelView, insights, type WeekPoint } from "@/lib/channel";
import { dfmt, dmy, nf, pln } from "@/lib/format";
import { costTotals } from "@/lib/money";
import type { Alert } from "@/lib/rules";
import type { Data, Project } from "@/lib/types";
import Integrations from "./Integrations";

const SEV = { high: "Pilne", med: "Ważne", low: "Info" } as const;
const YPP_HOURS = 4000, YPP_SUBS = 1000;
const ALERTS_SHOWN = 3;

/** Alerts that open a record are tappable; the rest are informational */
export const opensRecord = (a: Alert) => a.kind !== "gate" && a.kind !== "sync_failed";

/** Sparkline: area + line + endpoint, optional dashed threshold (gate target) */
function Spark({ values, thr, tone = "acc" }: { values: (number | null)[]; thr?: number; tone?: "acc" | "bad" }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <svg className="k-spark" aria-hidden="true" />;
  const W = 160, H = 34, P = 3;
  const max = Math.max(...pts.map((p) => p.v), thr ?? 0) * 1.08 || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(values.length - 1, 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = pts.map((p, k) => (k ? "L" : "M") + x(p.i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  const col = tone === "bad" ? "var(--bad)" : "var(--accent)";
  return (
    <svg className="k-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${x(last.i)} ${H - P} L${x(pts[0].i)} ${H - P} Z`} fill={col} fillOpacity={0.14} />
      {thr != null && <line x1={0} x2={W} y1={y(thr)} y2={y(thr)} stroke="var(--warn)" strokeDasharray="3 3" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
      <path d={line} fill="none" stroke={col} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.6} fill={col} />
    </svg>
  );
}

type MetricKey = "views" | "watch_hours" | "ctr_pct" | "impressions" | "avd_min" | "subs_net";
const METRICS: { k: MetricKey; label: string; fmt: (v: number) => string; thr?: number }[] = [
  { k: "views", label: "Wyświetlenia", fmt: (v) => nf().format(v) },
  { k: "watch_hours", label: "Godz. oglądania", fmt: (v) => nf(1).format(v) },
  { k: "ctr_pct", label: "CTR · próg 3%", fmt: (v) => nf(2).format(v) + "%", thr: 3 },
  { k: "impressions", label: "Miniatury pokazane", fmt: (v) => nf().format(v) },
  { k: "avd_min", label: "Śr. czas oglądania", fmt: (v) => nf(1).format(v) + " min" },
  { k: "subs_net", label: "Subskrypcje", fmt: (v) => (v > 0 ? "+" : "") + nf().format(v) },
];

function delta(k: MetricKey, prev: WeekPoint | null, last: WeekPoint | null) {
  const a = prev?.[k], b = last?.[k];
  if (a == null || b == null) return { text: "brak tygodnia do porównania", cls: "fl" };
  if (k === "ctr_pct") { const d = b - a; return { text: `${d >= 0 ? "▲" : "▼"} ${nf(2).format(Math.abs(d))} pp`, cls: d > 0.05 ? "up" : d < -0.05 ? "dn" : "fl" }; }
  if (k === "avd_min" || k === "subs_net") { const d = b - a; return { text: `${d >= 0 ? "▲" : "▼"} z ${nf(1).format(a)}`, cls: d > 0 ? "up" : d < 0 ? "dn" : "fl" }; }
  const p = change(a, b);
  if (p == null) return { text: "—", cls: "fl" };
  return { text: `${p >= 0 ? "▲" : "▼"} ${nf(0).format(Math.abs(p))}% t/t`, cls: p > 2 ? "up" : p < -2 ? "dn" : "fl" };
}

const RUN_OK = new Set(["success"]);

export default function Overview({ data, today, list, onOpen, onReload, flash }: { data: Data; today: string; list: Alert[]; onOpen: (a: Alert) => void; onReload: () => void; flash: (m: string) => void }) {
  const channels = useMemo(() => data.projects
    .filter((p: Project) => (p.kind === "yt_channel" || p.kind === "both") && p.status !== "zamknięty")
    .sort((a, b) => (a.status === "aktywny" ? 0 : 1) - (b.status === "aktywny" ? 0 : 1)), [data.projects]);
  const [pick, setPick] = useState<string | null>(null);
  const [allAlerts, setAllAlerts] = useState(false);
  const p = channels.find((c) => c.id === pick) ?? channels[0];
  const c = useMemo(() => (p ? channelView(data, p.id, today) : null), [data, p, today]);
  const notes = useMemo(() => (c ? insights(c, today) : []), [c, today]);
  const cost = costTotals(data), st = data.settings;
  const own = list.filter((a) => !a.projectId || !p || a.projectId === p.id || !channels.some((ch) => ch.id === a.projectId));

  return (
    <div className="kok">
      {channels.length > 1 && (
        <div className="k-chips" role="group" aria-label="Kanał">
          {channels.map((ch) => (
            <button key={ch.id} aria-pressed={ch.id === p?.id} onClick={() => setPick(ch.id)}>{ch.name}</button>
          ))}
        </div>
      )}

      {p && c && (
        <div className="k-title">
          <h2>{p.name}</h2>
          <span className="num">{c.last ? `tydz. ${dfmt(c.last.week_start)}–${dfmt(new Date(Date.parse(c.last.week_start) + 6 * 864e5).toISOString())}` : "brak danych tygodniowych"}</span>
        </div>
      )}

      {own.length > 0 && (
        <section className="k-alarms" aria-label="Alerty">
          {(allAlerts ? own : own.slice(0, ALERTS_SHOWN)).map((a) => {
            const body = (<><i className={"k-led " + a.severity} aria-hidden="true" /><span className="k-at"><b>{a.title}</b><span>{SEV[a.severity]} · {a.detail}</span></span></>);
            return opensRecord(a)
              ? <button key={a.kind + a.ref} className={"k-alarm " + a.severity} onClick={() => onOpen(a)}>{body}</button>
              : <div key={a.kind + a.ref} className={"k-alarm " + a.severity}>{body}</div>;
          })}
          {own.length > ALERTS_SHOWN && (
            <button className="linkbtn k-morealerts" onClick={() => setAllAlerts(!allAlerts)}>{allAlerts ? "Pokaż mniej" : `Pokaż wszystkie alerty (${own.length})`}</button>
          )}
        </section>
      )}

      {!p && <div className="empty"><strong>Brak kanałów YouTube</strong><span>Dodaj projekt typu kanał YT, żeby zobaczyć metryki.</span></div>}

      {p && c && (
        <>
          {notes.length > 0 && (
            <section className="k-panel k-notes" aria-label="Wnioski">
              <span className="k-key">Wnioski</span>
              <ul>{notes.map((n, i) => <li key={i} className={n.tone}>{n.text}</li>)}</ul>
            </section>
          )}

          <div className="k-grid">
            {METRICS.map((m) => {
              const v = c.last?.[m.k], d = delta(m.k, c.prev, c.last);
              const bad = m.thr != null && v != null && v < m.thr;
              return (
                <div key={m.k} className="k-panel k-m">
                  <span className="k-key">{m.label}</span>
                  <span className={"k-v num" + (bad ? " dn" : "")}>{v == null ? "—" : m.fmt(v)}</span>
                  <span className={"k-d num " + (m.k === "subs_net" ? "fl" : d.cls)}>{m.k === "subs_net" ? `łącznie ${nf().format(c.totalSubs)}` : d.text}</span>
                  <Spark values={c.weeks.map((w) => w[m.k])} thr={m.thr} tone={bad ? "bad" : "acc"} />
                </div>
              );
            })}
            <div className="k-panel k-m">
              <span className="k-key">Ostatnie 24 h</span>
              <span className="k-v num">{c.views24 == null ? "—" : "+" + nf().format(c.views24)}</span>
              <span className="k-d fl">licznik publiczny, co godzinę</span>
            </div>
            <div className="k-panel k-m">
              <span className="k-key">Koszt / mies.</span>
              <span className={"k-v num" + (cost.total > (Number(st.budget_max) || Infinity) ? " dn" : "")}>{pln(cost.total)}</span>
              <span className="k-d fl">budżet {nf().format(st.budget_min)}–{nf().format(st.budget_max)} zł</span>
            </div>
          </div>

          {c.traffic.length > 0 && (
            <section className="k-panel" aria-label="Źródła ruchu">
              <span className="k-key">Źródła ruchu · 28 dni{c.trafficEnd ? ` do ${dmy(c.trafficEnd)}` : ""}</span>
              <div className="k-bars">
                {c.traffic.map((g) => (
                  <div key={g.group}><span>{g.group}</span><span className="k-bar" aria-hidden="true"><i style={{ width: Math.round((g.views / c.traffic[0].views) * 100) + "%" }} /></span><span className="num">{nf().format(g.views)} · {Math.round(g.share * 100)}%</span></div>
                ))}
              </div>
            </section>
          )}

          {c.terms.length > 0 && (
            <section className="k-panel" aria-label="Wyszukiwania">
              <span className="k-key">Frazy z wyszukiwarki YouTube · 28 dni</span>
              <div className="k-terms">{c.terms.map((t) => <span key={t.term}><b className="num">{nf().format(t.views)}</b>{t.term}</span>)}</div>
            </section>
          )}

          {c.videos.length > 0 && (
            <section className="k-panel" aria-label="Filmy">
              <span className="k-key">Filmy · ostatnie 42 dni</span>
              <div className="k-vids">
                <div className="h"><span className="t">Film</span><span>Wyśw.</span><span>Godz.</span><span>CTR</span></div>
                {c.videos.map((v) => (
                  <div key={v.id}><span className="t">{v.title}</span><span className="num">{nf().format(v.views)}</span><span className="num">{nf(1).format(v.hours)}</span><span className={"num" + (v.ctr != null && v.ctr < 3 ? " dn" : "")}>{v.ctr == null ? "—" : nf(1).format(v.ctr) + "%"}</span></div>
                ))}
              </div>
            </section>
          )}

          {c.gates.map(({ gate, status, rules }) => {
            const state = status.ok === true ? "ok" : status.ok === false ? "no" : "nd";
            return (
              <section key={gate.id} className="k-panel k-gate" aria-label={gate.title}>
                <div className="k-gh">
                  <span className="k-key">{gate.title} · {dmy(gate.due)}</span>
                  <span className={"k-pill " + state}>{status.ok === true ? "spełniona" : status.ok === false ? "niespełniona" : "brak danych"} · {status.daysLeft >= 0 ? `${status.daysLeft} d` : "po terminie"}</span>
                </div>
                <ul>{rules.map((r, i) => <li key={i} className={r.ok === true ? "ok" : r.ok === false ? "no" : "nd"}><span aria-hidden="true">{r.ok === true ? "✓" : r.ok === false ? "✗" : "–"}</span>{r.label}</li>)}</ul>
                {gate.note && <p className="sub">{gate.note}</p>}
              </section>
            );
          })}

          <section className="k-panel" aria-label="Plan">
            <span className="k-key">Plan publikacji</span>
            {c.next.length ? (
              <div className="k-plan">{c.next.map((i) => <div key={i.id}><span className="num">{dfmt(i.publish_date)}</span><span className="t">{i.title}</span><span className="k-kind">{i.kind}</span></div>)}</div>
            ) : <p className="sub">Nic nie jest zaplanowane.</p>}
            {c.runs.length > 0 && (
              <div className="k-runs" aria-label="Ostatnie uruchomienia automatyzacji">
                {c.runs.slice().reverse().map((r) => (
                  <a key={r.run_id + "-" + r.run_attempt} href={r.run_url} target="_blank" rel="noopener noreferrer" title={`${r.workflow} · ${r.status}${r.slug ? " · " + r.slug : ""}`}
                    className={RUN_OK.has(r.status) ? "ok" : r.status === "running" ? "run" : "no"} />
                ))}
                <span>automatyzacja · ostatni: {c.runs[0].workflow} {c.runs[0].status === "success" ? "OK" : c.runs[0].status}{c.runs[0].slug ? ` (${c.runs[0].slug})` : ""}</span>
              </div>
            )}
          </section>

          <section className="k-panel k-ypp" aria-label="Próg YPP">
            <span className="k-key">Próg YPP</span>
            <div><span>Subskrybenci</span><span className="k-bar"><i style={{ width: Math.min(100, (c.totalSubs / YPP_SUBS) * 100) + "%" }} /></span><span className="num">{nf().format(c.totalSubs)} / {nf().format(YPP_SUBS)}</span></div>
            <div><span>Godziny</span><span className="k-bar"><i style={{ width: Math.min(100, (c.totalHours / YPP_HOURS) * 100) + "%" }} /></span><span className="num">{nf(1).format(c.totalHours)} / {nf().format(YPP_HOURS)}</span></div>
          </section>
        </>
      )}

      <Integrations data={data} onDone={onReload} flash={flash} />
    </div>
  );
}
