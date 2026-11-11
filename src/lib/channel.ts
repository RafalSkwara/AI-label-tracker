import { dmy, nf, num } from "./format";
import { gateRules, gateStatus, type GateStatus, type RuleStatus, when } from "./rules";
import type { Data, Gate, Item, PipelineRun } from "./types";
import { groupTraffic, type TrafficGroup } from "./ytMap";

const DAY = 864e5;
const diffDays = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / DAY);

export type WeekPoint = {
  week_start: string;
  views: number | null;
  watch_hours: number | null;
  subs_net: number | null;
  impressions: number | null;
  ctr_pct: number | null;
  avd_min: number | null;
};

export type ChannelView = {
  weeks: WeekPoint[];
  last: WeekPoint | null;
  prev: WeekPoint | null;
  traffic: { group: TrafficGroup; views: number; share: number }[];
  trafficTotal: number;
  trafficEnd: string | null;
  terms: { term: string; views: number }[];
  videos: { id: string; title: string; views: number; hours: number; ctr: number | null }[];
  next: Item[];
  lastFilm: Item | null;
  daysSinceFilm: number | null;
  gates: { gate: Gate; status: GateStatus; rules: RuleStatus[] }[];
  views24: number | null;
  runs: PipelineRun[];
  totalSubs: number;
  totalHours: number;
};

/** Keeps only the newest period of each video (traffic and search terms are stored per 28-day period) */
function latestPerVideo<T extends { yt_video_id: string; period_end: string }>(rows: T[]): T[] {
  const end = new Map<string, string>();
  for (const r of rows) if (r.period_end > (end.get(r.yt_video_id) ?? "")) end.set(r.yt_video_id, r.period_end);
  return rows.filter((r) => r.period_end === end.get(r.yt_video_id));
}

/** Everything the channel overview shows for one project, computed once per render */
export function channelView(d: Data, projectId: string, today: string): ChannelView {
  const weeks = d.weeks
    .filter((w) => w.project_id === projectId)
    .map((w) => ({
      week_start: w.week_start, views: num(w.views), watch_hours: num(w.watch_hours), subs_net: num(w.subs_net),
      impressions: num(w.impressions), ctr_pct: num(w.ctr_pct), avd_min: num(w.avd_min),
    }))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
    .slice(-8);

  const traffic = latestPerVideo(d.traffic.filter((t) => t.project_id === projectId));
  const groups = groupTraffic(traffic);
  const trafficTotal = groups.reduce((s, g) => s + g.views, 0);
  const trafficEnd = traffic.reduce<string | null>((m, t) => (m == null || t.period_end > m ? t.period_end : m), null);

  const termSum = new Map<string, number>();
  for (const t of latestPerVideo(d.terms.filter((t) => t.project_id === projectId))) termSum.set(t.term, (termSum.get(t.term) ?? 0) + Number(t.views));
  const terms = [...termSum].map(([term, views]) => ({ term, views })).sort((a, b) => b.views - a.views).slice(0, 8);

  const title = (id: string) => d.items.find((i) => i.yt_video_id === id)?.title ?? id;
  const videos = d.videos
    .filter((v) => v.project_id === projectId)
    .map((v) => {
      const imp = num(v.impressions) ?? 0, clicks = num(v.clicks) ?? 0;
      return { id: v.yt_video_id, title: title(v.yt_video_id), views: num(v.views) ?? 0, hours: (num(v.watch_minutes) ?? 0) / 60, ctr: imp >= 100 ? (clicks / imp) * 100 : null };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  const own = d.items.filter((i) => i.project_id === projectId);
  const next = own.filter((i) => i.status === "zaplanowany" && i.publish_date && i.publish_date >= today)
    .sort((a, b) => (a.publish_date! < b.publish_date! ? -1 : 1)).slice(0, 4);
  const films = own.filter((i) => i.kind === "film" && i.status === "live")
    .map((i) => ({ i, at: (i.publish_date ?? i.live_at ?? i.updated_at).slice(0, 10) }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const lastFilm = films[0]?.i ?? null;

  const gates = d.gates.filter((g) => g.project_id === projectId)
    .map((gate) => ({ gate, status: gateStatus(gate, d, today), rules: gateRules(gate, d, today) }))
    .filter((g) => g.status.daysLeft >= -7);

  // Hourly public counter: sum of gains of the newest snapshot set
  const v24 = d.views24.filter((v) => v.project_id === projectId);
  const newest = v24.reduce((m, v) => (v.taken_at > m ? v.taken_at : m), "");
  const gains = v24.filter((v) => v.taken_at === newest && v.base_view_count != null).map((v) => Math.max(0, v.view_count - (v.base_view_count ?? 0)));

  const all = d.weeks.filter((w) => w.project_id === projectId);
  return {
    weeks, last: weeks.at(-1) ?? null, prev: weeks.at(-2) ?? null,
    traffic: groups.filter((g) => g.views > 0).sort((a, b) => b.views - a.views), trafficTotal, trafficEnd,
    terms, videos, next, lastFilm,
    daysSinceFilm: films[0] ? diffDays(today, films[0].at) : null,
    gates,
    views24: gains.length ? gains.reduce((a, b) => a + b, 0) : null,
    runs: d.runs.filter((r) => r.project_id === projectId).slice(0, 8),
    totalSubs: all.reduce((s, w) => s + (num(w.subs_net) ?? 0), 0),
    totalHours: all.reduce((s, w) => s + (num(w.watch_hours) ?? 0), 0),
  };
}

/** Change in percent from a to b; null when it cannot be computed */
export function change(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

export type Insight = { tone: "bad" | "warn" | "good" | "info"; text: string };

const CTR_TARGET = 3;
const fmtPct = (p: number) => (p > 0 ? "+" : "−") + nf(0).format(Math.abs(p)) + "%";

/** Rule-based conclusions for the overview, most pressing first. Every sentence states the numbers it rests on. */
export function insights(c: ChannelView, today: string): Insight[] {
  const out: Insight[] = [];
  const { last, prev } = c;

  const gate = c.gates.find((g) => g.status.daysLeft >= 0);
  if (gate) {
    const ok = gate.rules.filter((r) => r.ok === true).length, failed = gate.rules.find((r) => r.ok === false);
    const head = `${gate.gate.title} (${dmy(gate.gate.due)}, ${when(gate.status.daysLeft)})`;
    if (gate.status.ok === false) out.push({ tone: "bad", text: `${head}: spełnione ${ok} z ${gate.rules.length} warunków. ${failed?.label ?? ""}.` });
    else if (gate.status.ok === true) out.push({ tone: "good", text: `${head}: wszystkie warunki spełnione.` });
    else out.push({ tone: "info", text: `${head}: za mało danych, żeby ocenić.` });
  }

  if (c.daysSinceFilm != null && c.daysSinceFilm >= 10) {
    const nx = c.next[0];
    out.push({ tone: "warn", text: `${c.daysSinceFilm} dni od ostatniego filmu${nx ? `; następna premiera ${dmy(nx.publish_date)} (${when(diffDays(nx.publish_date!, today))})` : ", a nic nie jest zaplanowane"}.` });
  } else if (!c.next.length) {
    out.push({ tone: "warn", text: "Brak zaplanowanej premiery." });
  }

  const h = change(prev?.watch_hours, last?.watch_hours);
  if (h != null && Math.abs(h) >= 20)
    out.push({ tone: h < 0 ? "bad" : "good", text: `Godziny oglądania ${fmtPct(h)} tydzień do tygodnia (${nf(1).format(prev!.watch_hours!)} → ${nf(1).format(last!.watch_hours!)} h).` });

  const v = change(prev?.views, last?.views);
  if (v != null && Math.abs(v) >= 20)
    out.push({ tone: v < 0 ? "bad" : "good", text: `Wyświetlenia ${fmtPct(v)} tydzień do tygodnia (${nf().format(prev!.views!)} → ${nf().format(last!.views!)}).` });

  if (last?.ctr_pct != null && (last.impressions ?? 0) >= 100 && last.ctr_pct < CTR_TARGET)
    out.push({ tone: "warn", text: `CTR ${nf(2).format(last.ctr_pct)}% przy progu ${CTR_TARGET}%: z ${nf().format(last.impressions!)} pokazanych miniatur klika mniej niż 1 na ${Math.round(100 / Math.max(last.ctr_pct, 0.01))}.` });

  if (last?.avd_min != null && prev?.avd_min != null && Math.abs(last.avd_min - prev.avd_min) >= 0.5)
    out.push({ tone: last.avd_min < prev.avd_min ? "warn" : "good", text: `Średni czas oglądania ${nf(1).format(last.avd_min)} min (tydzień wcześniej ${nf(1).format(prev.avd_min)}).` });

  const top = c.traffic[0];
  if (top && top.share >= 0.4) {
    const noSubs = (last?.subs_net ?? 0) <= 0;
    out.push({ tone: "info", text: `${top.group} daje ${Math.round(top.share * 100)}% wyświetleń z 28 dni${noSubs ? ", a w ostatnim tygodniu nie przybyło subskrypcji" : ""}.` });
  }

  const term = c.terms[0];
  if (term) out.push({ tone: "info", text: `Najczęstsza fraza w wyszukiwarce: „${term.term}” (${nf().format(term.views)} wyśw.).` });

  const rank = { bad: 0, warn: 1, good: 2, info: 3 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 6);
}
