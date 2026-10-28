import type { SupabaseClient } from "@supabase/supabase-js";
import { firstMondayOnOrAfter, mapAnalytics, mapReach, mapSearchTerms, mapStats, mapTraffic, toWeeks, type VideoDay } from "../ytMap";
import * as g from "./google";

/** Reports downloaded per integration per run (Workers Paid; a 30-day backfill fits in one run) */
export const MAX_REPORTS = 40;
/** Videos per Analytics query: 7 × 28 days = 196 rows, under the 200-row default cap of a day×video query */
const VIDEOS_PER_QUERY = 7;
const WINDOW_DAYS = 28;
/** Videos uploaded within this many days get traffic sources and hourly counters */
const RECENT_DAYS = 90;
/**
 * Videos with traffic queries per integration per daily run, newest first (2 Analytics calls each).
 * Workers Paid allows 10,000 subrequests per invocation; 40 videos = 80 calls, far below that and
 * well inside the 30 s CPU limit (the time goes to waiting on Google). On Workers Free (50) lower it to 8.
 */
export const MAX_TRAFFIC_VIDEOS = 40;
/** Hourly snapshots older than this are removed by the hourly run */
const SNAPSHOT_KEEP_DAYS = 14;
const DAY = 864e5;

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const mondayOf = (d: string) => {
  const t = Date.parse(d + "T00:00:00Z");
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
};

type Row = { project_id: string; yt_channel_id: string | null; refresh_token: string; reporting_job_id: string | null; reports_cursor: string | null };
export type SyncResult = { projectId: string; ok: boolean; error?: string; videos?: number; reports?: number; weeks?: number };

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

async function upsertChunks(db: SupabaseClient, table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) must(await db.from(table).upsert(rows.slice(i, i + 500), { onConflict }));
}

/** Writes complete Monday weeks (Sunday before `today`) from video_daily; never touches manual fields or archived weeks */
async function recomputeWeeks(db: SupabaseClient, projectId: string, fromDate: string, windowStart: string, today: string): Promise<number> {
  const first = mondayOf(fromDate);
  const rows: VideoDay[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db.from("video_daily").select("yt_video_id,date,views,watch_minutes,subs_net,avd_sec,impressions,ctr_pct")
      .eq("project_id", projectId).gte("date", first).lt("date", today).order("date").order("yt_video_id").range(from, from + 999)) as Record<string, unknown>[];
    for (const r of page) {
      const n = (v: unknown) => (v == null ? undefined : Number(v));
      rows.push({ yt_video_id: String(r.yt_video_id), date: String(r.date), views: n(r.views), watch_minutes: n(r.watch_minutes), subs_net: n(r.subs_net), avd_sec: n(r.avd_sec), impressions: n(r.impressions), ctr_pct: n(r.ctr_pct) });
    }
    if (page.length < 1000) break;
  }
  const complete = toWeeks(rows, firstMondayOnOrAfter(windowStart)).filter((w) => iso(Date.parse(w.week_start) + 6 * DAY) < today);
  if (!complete.length) return 0;
  const archived = new Set(
    (must(await db.from("weekly_stats").select("week_start").eq("project_id", projectId).not("archived_at", "is", null).in("week_start", complete.map((w) => w.week_start))) as { week_start: string }[])
      .map((r) => r.week_start));
  const todo = complete.filter((w) => !archived.has(w.week_start));
  // Weeks without Reach data yet must not send impressions/ctr_pct, or a manual Studio value would be overwritten with null
  const withReach = todo.filter((w) => w.impressions != null).map((w) => ({ project_id: projectId, ...w, source: "yt_api" }));
  const noReach = todo.filter((w) => w.impressions == null).map((w) => ({ project_id: projectId, week_start: w.week_start, views: w.views, watch_hours: w.watch_hours, subs_net: w.subs_net, avd_min: w.avd_min, source: "yt_api" }));
  await upsertChunks(db, "weekly_stats", withReach, "project_id,week_start");
  await upsertChunks(db, "weekly_stats", noReach, "project_id,week_start");
  return todo.length;
}

/** Uploads from the last RECENT_DAYS days; the playlist is already newest first */
const recent = (vids: g.Upload[], now: number) => vids.filter((v) => v.publishedAt && Date.parse(v.publishedAt) >= now - RECENT_DAYS * DAY);

/**
 * 28-day window ending at the latest day Analytics returned: per video the source-type totals and the top
 * search terms. Rows of older windows are removed so only the current breakdown stays.
 */
async function syncTraffic(db: SupabaseClient, pid: string, at: string, vids: g.Upload[], analytics: VideoDay[], fallbackEnd: string) {
  if (!vids.length) return;
  const periodEnd = analytics.reduce((m, r) => (r.date > m ? r.date : m), "") || fallbackEnd;
  const periodStart = iso(Date.parse(periodEnd) - (WINDOW_DAYS - 1) * DAY);
  for (const v of vids) {
    const traffic = mapTraffic(await g.trafficSources(at, v.id, periodStart, periodEnd));
    await upsertChunks(db, "video_traffic", traffic.map((r) => ({ project_id: pid, yt_video_id: v.id, period_end: periodEnd, ...r })), "yt_video_id,period_end,source_type");
    must(await db.from("video_traffic").delete().eq("yt_video_id", v.id).lt("period_end", periodEnd));
    // Search terms only exist when YouTube search sent views; the extra call is skipped otherwise
    const terms = traffic.some((r) => r.source_type === "YT_SEARCH" && r.views > 0)
      ? mapSearchTerms(await g.searchTerms(at, v.id, periodStart, periodEnd)) : [];
    must(await db.from("video_search_terms").delete().eq("yt_video_id", v.id));
    await upsertChunks(db, "video_search_terms", terms.map((t) => ({ project_id: pid, yt_video_id: v.id, period_end: periodEnd, ...t })), "yt_video_id,period_end,term");
  }
}

export async function syncIntegration(db: SupabaseClient, row: Row, now = Date.now()): Promise<SyncResult> {
  const pid = row.project_id;
  const patch = async (p: Record<string, unknown>) => must(await db.from("integrations").update(p).eq("project_id", pid).eq("provider", "youtube"));
  try {
    const at = await g.refreshAccess(row.refresh_token);
    const today = iso(now), start = iso(now - WINDOW_DAYS * DAY), end = iso(now - DAY);
    const channel = await g.myChannel(at);
    if (row.yt_channel_id && row.yt_channel_id !== channel.id) throw new Error("Token belongs to a different channel");

    // 1. Analytics: per video and day for the last 28 days
    const vids = await g.uploads(at, channel.uploads);
    const ids = vids.map((v) => v.id);
    let minDate = start;
    const analytics: VideoDay[] = [];
    for (let i = 0; i < ids.length; i += VIDEOS_PER_QUERY) {
      analytics.push(...mapAnalytics(await g.analytics(at, ids.slice(i, i + VIDEOS_PER_QUERY), start, end)));
    }
    // Disjoint columns: this upsert never sends impressions/ctr_pct
    await upsertChunks(db, "video_daily", analytics.map((r) => ({
      project_id: pid, yt_video_id: r.yt_video_id, date: r.date, views: r.views, watch_minutes: r.watch_minutes, subs_net: r.subs_net, avd_sec: r.avd_sec,
    })), "yt_video_id,date");

    // 2. Reach: new reports since the cursor, oldest first, newest correction wins; the cursor moves after every report
    const jobId = row.reporting_job_id ?? (await g.ensureReachJob(at));
    if (jobId !== row.reporting_job_id) await patch({ reporting_job_id: jobId });
    const reports = (await g.listReports(at, jobId, row.reports_cursor)).slice(0, MAX_REPORTS);
    for (const rep of reports) {
      const reach = mapReach(await g.downloadReport(at, rep.downloadUrl));
      // This upsert never sends views/watch_minutes/subs_net/avd_sec
      await upsertChunks(db, "video_daily", reach.map((r) => ({ project_id: pid, yt_video_id: r.yt_video_id, date: r.date, impressions: r.impressions, ctr_pct: r.ctr_pct })), "yt_video_id,date");
      for (const r of reach) if (r.date < minDate) minDate = r.date;
      await patch({ reports_cursor: rep.createTime });
    }

    // 3. Weekly totals for every complete week touched
    const weeks = await recomputeWeeks(db, pid, minDate, start, today);
    await patch({ yt_channel_id: channel.id, last_sync_at: new Date(now).toISOString(), last_error: null });

    // 4. Traffic sources and search terms; a failure here is reported but never undoes the data above
    try {
      await syncTraffic(db, pid, at, recent(vids, now).slice(0, MAX_TRAFFIC_VIDEOS), analytics, end);
    } catch (e) {
      const msg = ("Traffic: " + ((e as Error).message || "failed")).slice(0, 300);
      try { await patch({ last_error: msg }); } catch {}
      return { projectId: pid, ok: false, error: msg, videos: ids.length, reports: reports.length, weeks };
    }
    return { projectId: pid, ok: true, videos: ids.length, reports: reports.length, weeks };
  } catch (e) {
    const msg = ((e as Error).message || "sync failed").slice(0, 300);
    try { await patch({ last_error: msg }); } catch {}
    return { projectId: pid, ok: false, error: msg };
  }
}

/** Every integration (or one project's), one after another; a failure never stops the others */
export async function syncAll(db: SupabaseClient, projectId?: string): Promise<SyncResult[]> {
  let q = db.from("integrations").select("project_id,yt_channel_id,refresh_token,reporting_job_id,reports_cursor").eq("provider", "youtube");
  if (projectId) q = q.eq("project_id", projectId);
  const rows = must(await q) as Row[];
  const out: SyncResult[] = [];
  for (const r of rows) out.push(await syncIntegration(db, r));
  return out;
}

type SnapshotRow = Pick<Row, "project_id" | "yt_channel_id" | "refresh_token">;
export type SnapshotResult = { projectId: string; ok: boolean; error?: string; videos?: number };

/** Hourly: public counters of the recent uploads of one integration (token refresh + playlist + videos.list) */
export async function snapshotIntegration(db: SupabaseClient, row: SnapshotRow, now = Date.now()): Promise<SnapshotResult> {
  try {
    const at = await g.refreshAccess(row.refresh_token);
    // The uploads playlist id follows from the channel id, which saves a channels.list call
    const playlist = (row.yt_channel_id && g.uploadsPlaylistOf(row.yt_channel_id)) || (await g.myChannel(at)).uploads;
    const ids = recent(await g.uploads(at, playlist), now).map((v) => v.id);
    const takenAt = new Date(Math.floor(now / 36e5) * 36e5).toISOString();
    const stats = [];
    for (let i = 0; i < ids.length; i += 50) stats.push(...mapStats(await g.videoStatistics(at, ids.slice(i, i + 50))));
    await upsertChunks(db, "video_stats_hourly", stats.map((s) => ({ project_id: row.project_id, taken_at: takenAt, ...s })), "yt_video_id,taken_at");
    must(await db.from("video_stats_hourly").delete().eq("project_id", row.project_id).lt("taken_at", new Date(now - SNAPSHOT_KEEP_DAYS * DAY).toISOString()));
    return { projectId: row.project_id, ok: true, videos: stats.length };
  } catch (e) {
    return { projectId: row.project_id, ok: false, error: ((e as Error).message || "snapshot failed").slice(0, 300) };
  }
}

/** Every connected integration, one after another; a failure never stops the others (and stays out of `last_error`, which belongs to the daily sync) */
export async function snapshotAll(db: SupabaseClient): Promise<SnapshotResult[]> {
  const rows = must(await db.from("integrations").select("project_id,yt_channel_id,refresh_token").eq("provider", "youtube")) as SnapshotRow[];
  const out: SnapshotResult[] = [];
  for (const r of rows) out.push(await snapshotIntegration(db, r));
  return out;
}
