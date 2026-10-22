import { iso, monday, num, today } from "./format";
import type { Data, Item, Sub, Settings, Week } from "./types";

export const LEVELS = ["Nowicjusz", "Kurator nastroju", "Reżyser scen", "Mistrz pętli", "Architekt klimatu", "Magnat relaksu", "Legenda lo-fi"];
export const XP_PER_LEVEL = 150;

export const xpTotal = (d: Data) => d.xp.reduce((s, e) => s + (Number(e.xp) || 0), 0);
export const levelOf = (xp: number) => Math.floor(xp / XP_PER_LEVEL);
export const levelName = (lvl: number) => LEVELS[Math.min(lvl, LEVELS.length - 1)];

export function monthly(s: Sub, st: Settings) {
  const p = Number(s.price) || 0;
  const gross = s.currency === "PLN" ? p : p * (Number(st.usd_pln) || 0) * (1 + (Number(st.vat_pct) || 0) / 100);
  return s.cycle === "rok" ? gross / 12 : gross;
}
export function costTotals(d: Data) {
  let active = 0, planned = 0;
  for (const s of d.subs) {
    if (s.status === "aktywna") active += monthly(s, d.settings);
    else if (s.status === "planowana") planned += monthly(s, d.settings);
  }
  return { active, planned, total: active + planned };
}

/** Watch hours summed across channels per week, oldest first */
export function weeksAgg(weeks: Week[]) {
  const m = new Map<string, { week_start: string; watch_hours: number | null }>();
  for (const w of weeks) {
    const a = m.get(w.week_start) ?? { week_start: w.week_start, watch_hours: null };
    const v = num(w.watch_hours);
    if (v != null) a.watch_hours = (a.watch_hours ?? 0) + v;
    m.set(w.week_start, a);
  }
  return [...m.values()].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
}
export function trend(weeks: Week[]) {
  const w = weeksAgg(weeks);
  if (w.length < 2) return null;
  const a = w[w.length - 2].watch_hours, b = w[w.length - 1].watch_hours;
  if (a == null || b == null) return null;
  if (a === 0) return b > 0 ? { pct: null, dir: "up" as const } : { pct: 0, dir: "flat" as const };
  const pct = ((b - a) / a) * 100;
  return { pct, dir: pct > 2 ? ("up" as const) : pct < -2 ? ("down" as const) : ("flat" as const) };
}
export const totalHours = (d: Data) => d.weeks.reduce((s, w) => s + (num(w.watch_hours) ?? 0), 0);
export const totalSubs = (d: Data) => d.weeks.reduce((s, w) => s + (num(w.subs_net) ?? 0), 0);
const live = (items: Item[], k?: Item["kind"]) => items.filter((i) => i.status === "live" && (!k || i.kind === k));

/** Consecutive weeks with a live film; the current week does not break the streak until it ends */
export function streak(d: Data) {
  const weeks = new Set(live(d.items, "film").map((i) => monday(i.publish_date ?? i.live_at ?? i.updated_at)));
  const cur = new Date(monday(today()) + "T00:00:00");
  if (!weeks.has(iso(cur))) cur.setDate(cur.getDate() - 7);
  let n = 0;
  while (weeks.has(iso(cur))) { n++; cur.setDate(cur.getDate() - 7); }
  return n;
}

export function badges(d: Data) {
  const f0 = d.tasks.filter((t) => t.phase === "F0"), hrs = totalHours(d), subs = totalSubs(d), s = streak(d), c = costTotals(d);
  return [
    { n: "Fundamenty", on: f0.length > 0 && f0.every((t) => t.done), hint: "wszystkie zadania F0" },
    { n: "Pierwszy film", on: live(d.items, "film").length >= 1, hint: "1 film live" },
    { n: "Pierwszy short", on: live(d.items, "short").length >= 1, hint: "1 short live" },
    { n: "Seria 4", on: s >= 4, hint: "4 tygodnie z rzędu z filmem" },
    { n: "Seria 12", on: s >= 12, hint: "cała walidacja F1 bez przerwy" },
    { n: "Kronikarz", on: weeksAgg(d.weeks).length >= 4, hint: "4 wpisane tygodnie" },
    { n: "100 h", on: hrs >= 100, hint: "100 h oglądania" },
    { n: "1000 h", on: hrs >= 1000, hint: "1000 h oglądania" },
    { n: "100 subów", on: subs >= 100, hint: "100 subskrybentów" },
    { n: "YPP", on: hrs >= 4000 && subs >= 1000, hint: "4000 h i 1000 subów" },
    { n: "Pierwsza złotówka", on: d.weeks.some((w) => (num(w.revenue_pln) ?? 0) > 0), hint: "pierwszy przychód" },
    { n: "W budżecie", on: c.active > 0 && c.total <= (Number(d.settings.budget_max) || 0), hint: "koszt ≤ max budżetu" },
  ];
}
