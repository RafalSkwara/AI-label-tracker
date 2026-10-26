import { localDateTime, nf, syncErrorPl } from "./format";
import type { Data, Gate, GateRule } from "./types";

export type Alert = {
  kind: "task_late" | "task_soon" | "renewal" | "ctr_low" | "impressions_drop" | "gate" | "sync_failed";
  severity: "high" | "med" | "low";
  title: string;
  detail: string;
  ref: string;
  projectId?: string;
};

export type RuleStatus = { value: number | null; target: number | null; ok: boolean | null; label: string };
export type GateStatus = { value: number | null; target: number | null; ok: boolean | null; daysLeft: number; label: string };

const DAY = 864e5;
const MIN_IMPRESSIONS = 100;
const CTR_MIN_PCT = 3;
const HOURS_36 = 36 * 3600e3;

// All date maths is UTC on YYYY-MM-DD strings, so results do not depend on the device time zone
const ms = (d: string) => Date.parse(d.slice(0, 10) + "T00:00:00Z");
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fmt(ms(d) + n * DAY);
const diffDays = (a: string, b: string) => Math.round((ms(a) - ms(b)) / DAY);
const mondayOf = (d: string) => addDays(d, -((new Date(ms(d)).getUTCDay() + 6) % 7));
const dmy = (d: string) => d.slice(0, 10).split("-").reverse().join(".");
const pct1 = (n: number) => nf(1).format(n) + "%";
/** "dziś" / "jutro" / "za 5 dni" / "3 dni temu": the one day phrase used by alerts and gate cards */
export const when = (n: number) =>
  n === 0 ? "dziś" : n === 1 ? "jutro" : n === -1 ? "wczoraj" : n < 0 ? `${-n} dni temu` : `za ${n} dni`;

/**
 * Week starts (Mondays) of the `n` most recent complete weeks, oldest first.
 * A week is complete when its Sunday is at least 3 days before today (covers the ~2-day report lag).
 */
export function completeWeeks(today: string, n: number): string[] {
  const lastSunday = addDays(today, -3);
  let ws = mondayOf(lastSunday);
  if (addDays(ws, 6) > lastSunday) ws = addDays(ws, -7);
  return Array.from({ length: n }, (_, i) => addDays(ws, -7 * (n - 1 - i)));
}

/** A manually entered week has no report lag: complete once its Sunday is before today */
const latestManualWeek = (today: string) => {
  const ws = mondayOf(addDays(today, -1));
  return addDays(ws, 6) < today ? ws : addDays(ws, -7);
};

type Series = Map<string, { v: number; manual: boolean }>;

/** Last complete week of a series: the newest manual week if one is entered, else the lagged last complete week */
function anchorWeek(s: Series, today: string): string {
  const m = latestManualWeek(today);
  return s.get(m)?.manual ? m : completeWeeks(today, 1)[0];
}

/** v_video_recent covers `date >= current_date - 42`, so its oldest week can be cut; such a week is not trusted */
const videoWeekOk = (ws: string, today: string) => ws >= addDays(today, -42);

const val = (v: unknown): number | null => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

/** Per-week project total: manual or synced `weekly_stats` first, per-video sums fill the weeks it lacks */
function projectWeeks(d: Data, projectId: string, metric: "impressions" | "hours", today: string): Series {
  const m: Series = new Map();
  for (const w of d.weeks) {
    if (w.project_id !== projectId) continue;
    const v = val(metric === "hours" ? w.watch_hours : w.impressions);
    if (v != null) m.set(w.week_start, { v, manual: w.source === "manual" });
  }
  const fromVideos = new Map<string, number>();
  for (const v of d.videos) {
    if (v.project_id !== projectId) continue;
    for (const w of v.weeks ?? []) {
      if (!videoWeekOk(w.week_start, today)) continue;
      const x = metric === "hours" ? (val(w.watch_minutes) ?? 0) / 60 : (val(w.impressions) ?? 0);
      fromVideos.set(w.week_start, (fromVideos.get(w.week_start) ?? 0) + x);
    }
  }
  for (const [k, x] of fromVideos) if (!m.has(k)) m.set(k, { v: x, manual: false });
  return m;
}

/** Impression change between the last two complete weeks, in percent; null when either week is missing */
function impressionsWow(d: Data, projectId: string, today: string): number | null {
  const s = projectWeeks(d, projectId, "impressions", today);
  const lastW = anchorWeek(s, today), prevW = addDays(lastW, -7);
  const a = s.get(prevW)?.v, b = s.get(lastW)?.v;
  if (a == null || b == null || a <= 0) return null;
  return ((b - a) / a) * 100;
}

/** Impression-weighted CTR (Σ clicks / Σ impressions) of the 3 most recent live films with enough impressions */
function ctrLast3(d: Data, projectId: string, today: string): { value: number; films: number } | null {
  const weeks = new Set(completeWeeks(today, 4).filter((w) => videoWeekOk(w, today)));
  const wk = projectWeeks(d, projectId, "impressions", today);
  const anchor = anchorWeek(wk, today), chWeeks = new Set([0, 7, 14, 21].map((n) => addDays(anchor, -n)));
  const films = d.items
    .filter((i) => i.project_id === projectId && i.kind === "film" && i.status === "live" && i.yt_video_id)
    .sort((a, b) => (b.publish_date ?? b.live_at ?? b.updated_at).localeCompare(a.publish_date ?? a.live_at ?? a.updated_at));
  let imp = 0, clicks = 0, n = 0;
  for (const f of films) {
    if (n === 3) break;
    const v = d.videos.find((x) => x.project_id === projectId && x.yt_video_id === f.yt_video_id);
    let fi = 0, fc = 0;
    for (const w of v?.weeks ?? []) if (weeks.has(w.week_start)) { fi += val(w.impressions) ?? 0; fc += val(w.clicks) ?? 0; }
    if (fi < MIN_IMPRESSIONS) continue;
    imp += fi; clicks += fc; n++;
  }
  if (n) return { value: (clicks / imp) * 100, films: n };
  // No per-video data: fall back to the channel-level weeks (manual entry or synced)
  let wi = 0, wc = 0;
  for (const w of d.weeks) {
    const i = val(w.impressions), c = val(w.ctr_pct);
    if (w.project_id !== projectId || !chWeeks.has(w.week_start) || i == null || c == null) continue;
    wi += i; wc += (i * c) / 100;
  }
  return wi >= MIN_IMPRESSIONS ? { value: (wc / wi) * 100, films: 0 } : null;
}

/** Watch hours of days [from, from+days) with each week spread evenly over its 7 days; null when a day has no data */
function hoursInRange(series: Series, from: string, days: number): number | null {
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const h = series.get(mondayOf(addDays(from, i)));
    if (h == null) return null;
    sum += h.v / 7;
  }
  return sum;
}

function ruleStatus(r: GateRule, g: Gate, d: Data, today: string): RuleStatus {
  if (r.rule === "ctr_last3_weighted") {
    const c = ctrLast3(d, g.project_id, today);
    if (!c) return { value: null, target: r.min_pct, ok: null, label: `CTR ostatnich 3 filmów: brak danych (min ${r.min_pct}%)` };
    const from = c.films ? `${c.films} ${c.films === 1 ? "film" : "filmy"}` : "kanał";
    return { value: c.value, target: r.min_pct, ok: c.value >= r.min_pct, label: `CTR ostatnich 3 filmów: ${pct1(c.value)} (min ${r.min_pct}%, ${from})` };
  }
  if (r.rule === "impressions_wow_rising") {
    const p = impressionsWow(d, g.project_id, today);
    if (p == null) return { value: null, target: 0, ok: null, label: "Wyświetlenia miniatur t/t: brak danych (cel: rosną)" };
    return { value: p, target: 0, ok: p > 0, label: `Wyświetlenia miniatur t/t: ${p > 0 ? "+" : ""}${nf(0).format(p)}% (cel: rosną)` };
  }
  // watch_hours_month_vs: the same day range of both months, up to the last complete day of the target month
  const monthEnd = fmt(Date.UTC(+r.month.slice(0, 4), +r.month.slice(5, 7), 0));
  const s = projectWeeks(d, g.project_id, "hours", today);
  // Data is weekly, so the range ends at the Sunday of the last complete week, never inside a partial one
  const weekEnd = addDays(anchorWeek(s, today), 6);
  const lastDay = weekEnd < monthEnd ? weekEnd : monthEnd;
  const first = r.month + "-01", vsFirst = r.vs + "-01";
  const vsLen = diffDays(fmt(Date.UTC(+r.vs.slice(0, 4), +r.vs.slice(5, 7), 0)), vsFirst) + 1;
  const days = Math.min(diffDays(lastDay, first) + 1, vsLen);
  const none = { value: null, target: null, ok: null, label: `Godziny ${r.month} vs ${r.vs}: brak danych` };
  if (days < 1) return none;
  const a = hoursInRange(s, first, days), b = hoursInRange(s, vsFirst, days);
  if (a == null || b == null) return none;
  return { value: a, target: b, ok: a > b, label: `Godziny ${r.month} vs ${r.vs} (dni 1–${days}): ${nf(1).format(a)} h vs ${nf(1).format(b)} h` };
}

/** One entry per rule of the gate, for cards that list the rules separately */
export function gateRules(g: Gate, d: Data, today: string): RuleStatus[] {
  return g.rules.map((r) => ruleStatus(r, g, d, today));
}

/** The gate passes when all rules pass; any failed rule fails it, missing data is "no data", never false */
export function gateStatus(g: Gate, d: Data, today: string): GateStatus {
  const rs = gateRules(g, d, today);
  const ok = rs.some((r) => r.ok === false) ? false : rs.length && rs.every((r) => r.ok === true) ? true : null;
  return { value: rs[0]?.value ?? null, target: rs[0]?.target ?? null, ok, daysLeft: diffDays(g.due, today), label: rs.map((r) => r.label).join(" · ") };
}

const RANK = { high: 0, med: 1, low: 2 } as const;

export function alerts(d: Data, today: string, nowMs: number = Date.now()): Alert[] {
  const out: Alert[] = [];
  const gateDues = new Set(d.gates.map((g) => g.due));

  for (const t of d.tasks) {
    if (t.done || !t.due || gateDues.has(t.due)) continue;
    const n = diffDays(t.due, today);
    if (n < 0) out.push({ kind: "task_late", severity: "high", title: t.title, detail: `Termin ${dmy(t.due)} minął (${when(n)})`, ref: t.id, projectId: t.project_id ?? undefined });
    else if (n <= 3) out.push({ kind: "task_soon", severity: "med", title: t.title, detail: `Termin ${dmy(t.due)} (${when(n)})`, ref: t.id, projectId: t.project_id ?? undefined });
  }

  for (const s of d.subs) {
    if (s.status !== "aktywna" || !s.renew) continue;
    const n = diffDays(s.renew, today);
    if (n >= 0 && n <= 7) out.push({ kind: "renewal", severity: "med", title: s.name + (s.plan ? " · " + s.plan : ""), detail: `Odnowienie ${dmy(s.renew)} (${when(n)})`, ref: s.id, projectId: s.project_id ?? undefined });
  }

  const lastWeek = completeWeeks(today, 1)[0];
  for (const v of d.videos) {
    const w = (v.weeks ?? []).find((x) => x.week_start === lastWeek);
    const imp = val(w?.impressions) ?? 0;
    if (!w || imp < MIN_IMPRESSIONS) continue;
    const ctr = ((val(w.clicks) ?? 0) / imp) * 100;
    if (ctr >= CTR_MIN_PCT) continue;
    const item = d.items.find((i) => i.yt_video_id === v.yt_video_id);
    out.push({ kind: "ctr_low", severity: "med", title: item?.title ?? "Film " + v.yt_video_id, detail: `CTR ${pct1(ctr)} (poniżej ${CTR_MIN_PCT}%) przy ${nf(0).format(imp)} wyświetleniach miniatur w tygodniu od ${dmy(lastWeek)}`, ref: item?.id ?? v.yt_video_id, projectId: v.project_id });
  }

  for (const p of d.projects) {
    const c = impressionsWow(d, p.id, today);
    if (c != null && c < -20) out.push({ kind: "impressions_drop", severity: "med", title: p.name, detail: `Wyświetlenia miniatur spadły o ${nf(0).format(-c)}% t/t`, ref: p.id, projectId: p.id });
  }

  for (const g of d.gates) {
    const s = gateStatus(g, d, today);
    if (s.ok === false && s.daysLeft <= 14) out.push({ kind: "gate", severity: "high", title: g.title, detail: `${s.daysLeft < 0 ? "Termin minął" : "Termin " + dmy(g.due) + " (" + when(s.daysLeft) + ")"}, warunki niespełnione`, ref: g.id, projectId: g.project_id });
  }

  for (const i of d.integrations) {
    const name = d.projects.find((p) => p.id === i.project_id)?.name ?? "YouTube";
    if (i.last_error) {
      out.push({ kind: "sync_failed", severity: "high", title: `Synchronizacja YouTube: ${name}`, detail: syncErrorPl(i.last_error), ref: i.project_id, projectId: i.project_id });
    } else if (i.last_sync_at && nowMs - Date.parse(i.last_sync_at) > HOURS_36) {
      out.push({ kind: "sync_failed", severity: "high", title: `Synchronizacja YouTube: ${name}`, detail: `Ostatnia udana synchronizacja ${localDateTime(i.last_sync_at)} (ponad 36 h temu)`, ref: i.project_id, projectId: i.project_id });
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
