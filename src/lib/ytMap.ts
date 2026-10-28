// Pure mapping from YouTube API payloads to our tables. No I/O, so the integration test can run it on real responses.

/** One video on one day. Analytics fills the first four metrics, Reach fills the last two; the others stay undefined. */
export type VideoDay = {
  yt_video_id: string;
  date: string;
  views?: number;
  watch_minutes?: number;
  subs_net?: number;
  avd_sec?: number;
  impressions?: number;
  ctr_pct?: number;
};

export type WeekRow = {
  week_start: string;
  views: number;
  watch_hours: number;
  subs_net: number;
  avd_min: number | null;
  impressions: number | null;
  ctr_pct: number | null;
};

type AnalyticsJson = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] | null };

/** Analytics `reports.query` with dimensions=day,video → one VideoDay per row. Columns are found by header name. */
export function mapAnalytics(json: AnalyticsJson): VideoDay[] {
  const names = (json.columnHeaders ?? []).map((h) => h.name);
  const at = (n: string) => names.indexOf(n);
  const [iDay, iVideo] = [at("day"), at("video")];
  if (iDay < 0 || iVideo < 0) throw new Error("Analytics response lacks day/video columns");
  const [iViews, iMin, iAvd, iGain, iLost] = ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained", "subscribersLost"].map(at);
  const n = (r: (string | number)[], i: number) => (i < 0 ? 0 : Number(r[i]) || 0);
  return (json.rows ?? []).map((r) => ({
    yt_video_id: String(r[iVideo]),
    date: String(r[iDay]),
    views: n(r, iViews),
    watch_minutes: n(r, iMin),
    subs_net: n(r, iGain) - n(r, iLost),
    avd_sec: n(r, iAvd),
  }));
}

/** Splits one CSV line; handles quoted fields (reach reports have none, but a stray comma must not shift columns) */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Reporting API `channel_reach_basic_a1` CSV → VideoDay rows. `date` is YYYYMMDD; the CTR column is a fraction
 * (0.0483), stored as a percent. Rows without a video id (channel-level lines) are skipped.
 */
export function mapReach(csv: string): VideoDay[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = cells(lines[0]);
  const [iDate, iVideo, iImp, iCtr] = ["date", "video_id", "video_thumbnail_impressions", "video_thumbnail_impressions_ctr"].map((n) => head.indexOf(n));
  if (iDate < 0 || iVideo < 0 || iImp < 0 || iCtr < 0) throw new Error("Reach report lacks the expected columns");
  // A video-day may be split over several lines; one upsert must not hit the same key twice, so sum them
  const byKey = new Map<string, { id: string; date: string; imp: number; clicks: number }>();
  for (const line of lines.slice(1)) {
    const c = cells(line), id = c[iVideo]?.trim(), d = c[iDate]?.trim();
    if (!id || !d || d.length !== 8) continue;
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, imp = Number(c[iImp]) || 0;
    const a = byKey.get(id + "|" + date) ?? { id, date, imp: 0, clicks: 0 };
    a.imp += imp;
    a.clicks += imp * (Number(c[iCtr]) || 0);
    byKey.set(id + "|" + date, a);
  }
  return [...byKey.values()].map((a) => ({
    yt_video_id: a.id, date: a.date, impressions: a.imp,
    ctr_pct: a.imp ? Math.round((a.clicks / a.imp) * 100 * 1e4) / 1e4 : 0,
  }));
}

const DAY = 864e5;
const mondayOf = (d: string) => {
  const t = Date.parse(d + "T00:00:00Z");
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
/** First Monday on or after `d` */
export const firstMondayOnOrAfter = (d: string) => {
  const m = mondayOf(d);
  return m === d ? m : new Date(Date.parse(m + "T00:00:00Z") + 7 * DAY).toISOString().slice(0, 10);
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * VideoDay rows (Analytics and Reach rows of the same video-day may be separate entries) → one row per Monday week.
 * watch_hours = Σ minutes / 60; avd_min = view-weighted mean of avd_sec / 60; ctr_pct = impression-weighted mean.
 * Metrics with no data in a week are null, not 0 (Reach lags Analytics by ~2 days).
 * `from` = first Monday fully inside the Analytics window.
 */
export function toWeeks(rows: VideoDay[], from?: string): WeekRow[] {
  type Acc = { views: number; minutes: number; subs: number; avdW: number; avdViews: number; imp: number; clicks: number; hasA: boolean; hasR: boolean };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const k = mondayOf(r.date);
    const a = acc.get(k) ?? { views: 0, minutes: 0, subs: 0, avdW: 0, avdViews: 0, imp: 0, clicks: 0, hasA: false, hasR: false };
    if (r.views != null) { a.hasA = true; a.views += r.views; a.minutes += r.watch_minutes ?? 0; a.subs += r.subs_net ?? 0; a.avdW += (r.avd_sec ?? 0) * r.views; a.avdViews += r.views; }
    if (r.impressions != null) { a.hasR = true; a.imp += r.impressions; a.clicks += r.impressions * (r.ctr_pct ?? 0) / 100; }
    acc.set(k, a);
  }
  // Only weeks with Analytics data, and (with `from`) only weeks starting on/after it: a week the Analytics window
  // cuts in half, or one that has only Reach rows, would be written with understated or zero metrics.
  return [...acc.entries()].filter(([k, a]) => a.hasA && (!from || k >= from)).sort(([x], [y]) => x.localeCompare(y)).map(([week_start, a]) => ({
    week_start,
    views: a.views,
    watch_hours: r2(a.minutes / 60),
    subs_net: a.subs,
    avd_min: a.hasA && a.avdViews ? r2(a.avdW / a.avdViews / 60) : null,
    impressions: a.hasR ? a.imp : null,
    ctr_pct: a.hasR && a.imp ? r2((a.clicks / a.imp) * 100) : null,
  }));
}

export type TrafficRow = { source_type: string; views: number; watch_minutes: number };
export type SearchTerm = { term: string; views: number };
export type VideoStat = { yt_video_id: string; view_count: number; like_count: number | null; comment_count: number | null };

/** Column lookup by header name, so a reordered response still maps correctly */
function table(json: AnalyticsJson, dims: string[], metrics: string[]) {
  const names = (json.columnHeaders ?? []).map((h) => h.name);
  const idx = [...dims, ...metrics].map((n) => names.indexOf(n));
  if (idx.slice(0, dims.length).some((i) => i < 0)) throw new Error(`Analytics response lacks the ${dims.join("/")} column`);
  return (json.rows ?? []).map((r) => ({
    dims: idx.slice(0, dims.length).map((i) => String(r[i])),
    metrics: idx.slice(dims.length).map((i) => (i < 0 ? 0 : Number(r[i]) || 0)),
  }));
}

/** Analytics `dimensions=insightTrafficSourceType` for one video → one row per source type */
export function mapTraffic(json: AnalyticsJson): TrafficRow[] {
  return table(json, ["insightTrafficSourceType"], ["views", "estimatedMinutesWatched"])
    .map((r) => ({ source_type: r.dims[0], views: r.metrics[0], watch_minutes: r.metrics[1] }));
}

/** Analytics `dimensions=insightTrafficSourceDetail` (type YT_SEARCH) → search terms with views, empty terms skipped */
export function mapSearchTerms(json: AnalyticsJson): SearchTerm[] {
  // Terms that differ only in surrounding whitespace are one term (one upsert must not hit a key twice)
  const sum = new Map<string, number>();
  for (const r of table(json, ["insightTrafficSourceDetail"], ["views"])) {
    const term = r.dims[0].trim();
    if (term) sum.set(term, (sum.get(term) ?? 0) + r.metrics[0]);
  }
  return [...sum].map(([term, views]) => ({ term, views })).sort((a, b) => b.views - a.views);
}

/** Data API `videos.list(part=statistics)` → counters per video. Hidden likes/comments come back absent → null. */
export function mapStats(json: { items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }): VideoStat[] {
  const n = (v?: string) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  return (json.items ?? []).flatMap((it) => {
    const views = n(it.statistics?.viewCount);
    return views == null ? [] : [{ yt_video_id: it.id, view_count: views, like_count: n(it.statistics?.likeCount), comment_count: n(it.statistics?.commentCount) }];
  });
}

/** Display groups for the traffic sources, in the order the app lists them */
export const TRAFFIC_GROUPS = ["Sugerowane", "Wyszukiwarka", "Przeglądanie", "Zewnętrzne", "Playlisty", "Inne"] as const;
export type TrafficGroup = (typeof TRAFFIC_GROUPS)[number];

const GROUP_OF: Record<string, TrafficGroup> = {
  RELATED_VIDEO: "Sugerowane",
  YT_SEARCH: "Wyszukiwarka",
  SUBSCRIBER: "Przeglądanie",
  EXT_URL: "Zewnętrzne", NO_LINK_EMBEDDED: "Zewnętrzne", NO_LINK_OTHER: "Zewnętrzne",
  PLAYLIST: "Playlisty",
};

/** Sums the source types into the six display groups; shares are of total views (0 when there are none) */
export function groupTraffic(rows: { source_type: string; views: number }[]): { group: TrafficGroup; views: number; share: number }[] {
  const sum = new Map<TrafficGroup, number>(TRAFFIC_GROUPS.map((g) => [g, 0]));
  for (const r of rows) {
    const g = GROUP_OF[r.source_type] ?? "Inne";
    sum.set(g, (sum.get(g) ?? 0) + r.views);
  }
  const total = [...sum.values()].reduce((a, b) => a + b, 0);
  return TRAFFIC_GROUPS.map((group) => ({ group, views: sum.get(group) ?? 0, share: total ? (sum.get(group) ?? 0) / total : 0 }));
}
