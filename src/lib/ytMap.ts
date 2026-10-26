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
  const out: VideoDay[] = [];
  for (const line of lines.slice(1)) {
    const c = cells(line), id = c[iVideo]?.trim(), d = c[iDate]?.trim();
    if (!id || !d || d.length !== 8) continue;
    out.push({
      yt_video_id: id,
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      impressions: Number(c[iImp]) || 0,
      ctr_pct: Math.round((Number(c[iCtr]) || 0) * 100 * 1e4) / 1e4,
    });
  }
  return out;
}

const DAY = 864e5;
const mondayOf = (d: string) => {
  const t = Date.parse(d + "T00:00:00Z");
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * VideoDay rows (Analytics and Reach rows of the same video-day may be separate entries) → one row per Monday week.
 * watch_hours = Σ minutes / 60; avd_min = view-weighted mean of avd_sec / 60; ctr_pct = impression-weighted mean.
 * Metrics with no data in a week are null, not 0 (Reach lags Analytics by ~2 days).
 */
export function toWeeks(rows: VideoDay[]): WeekRow[] {
  type Acc = { views: number; minutes: number; subs: number; avdW: number; avdViews: number; imp: number; clicks: number; hasA: boolean; hasR: boolean };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const k = mondayOf(r.date);
    const a = acc.get(k) ?? { views: 0, minutes: 0, subs: 0, avdW: 0, avdViews: 0, imp: 0, clicks: 0, hasA: false, hasR: false };
    if (r.views != null) { a.hasA = true; a.views += r.views; a.minutes += r.watch_minutes ?? 0; a.subs += r.subs_net ?? 0; a.avdW += (r.avd_sec ?? 0) * r.views; a.avdViews += r.views; }
    if (r.impressions != null) { a.hasR = true; a.imp += r.impressions; a.clicks += r.impressions * (r.ctr_pct ?? 0) / 100; }
    acc.set(k, a);
  }
  return [...acc.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([week_start, a]) => ({
    week_start,
    views: a.views,
    watch_hours: r2(a.minutes / 60),
    subs_net: a.subs,
    avd_min: a.hasA && a.avdViews ? r2(a.avdW / a.avdViews / 60) : null,
    impressions: a.hasR ? a.imp : null,
    ctr_pct: a.hasR && a.imp ? r2((a.clicks / a.imp) * 100) : null,
  }));
}
