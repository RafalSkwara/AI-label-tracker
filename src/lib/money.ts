import { num } from "./format";
import type { Data, Sub, Settings, Week } from "./types";

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
