import type { SupabaseClient } from "@supabase/supabase-js";
import { mapAnalytics, mapReach, toWeeks, type VideoDay } from "../ytMap";
import * as g from "./google";

/** Reports downloaded per integration per run (Workers Paid; a 30-day backfill fits in one run) */
export const MAX_REPORTS = 40;
/** Videos per Analytics query: 7 × 28 days = 196 rows, under the 200-row default cap of a day×video query */
const VIDEOS_PER_QUERY = 7;
const WINDOW_DAYS = 28;
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
async function recomputeWeeks(db: SupabaseClient, projectId: string, fromDate: string, today: string): Promise<number> {
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
  const complete = toWeeks(rows).filter((w) => iso(Date.parse(w.week_start) + 6 * DAY) < today);
  if (!complete.length) return 0;
  const archived = new Set(
    (must(await db.from("weekly_stats").select("week_start").eq("project_id", projectId).not("archived_at", "is", null).in("week_start", complete.map((w) => w.week_start))) as { week_start: string }[])
      .map((r) => r.week_start));
  const out = complete.filter((w) => !archived.has(w.week_start)).map((w) => ({ project_id: projectId, ...w, source: "yt_api" }));
  await upsertChunks(db, "weekly_stats", out, "project_id,week_start");
  return out.length;
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
    const ids = await g.uploadIds(at, channel.uploads);
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
    const weeks = await recomputeWeeks(db, pid, minDate, today);
    await patch({ yt_channel_id: channel.id, last_sync_at: new Date(now).toISOString(), last_error: null });
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
