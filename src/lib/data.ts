import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Coll, Data, Week } from "./types";

const TABLE: Record<Coll, string> = { tasks: "tasks", items: "content_items", weeks: "weekly_stats", subs: "subscriptions" };

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function loadAll(db: SupabaseClient = supabase()): Promise<Data> {
  const [tasks, items, weeks, subs, projects, gates, videos, integrations, settings, xp] = await Promise.all([
    db.from("tasks").select("*").is("archived_at", null).order("created_at"),
    db.from("content_items").select("*").is("archived_at", null),
    db.from("weekly_stats").select("*").is("archived_at", null),
    db.from("subscriptions").select("*").is("archived_at", null),
    db.from("projects").select("id,slug,name,niche,kind,status,yt_channel_id,distrokid_artist").is("archived_at", null).order("created_at"),
    db.from("gates").select("id,project_id,title,due,rules,note").is("archived_at", null).order("due"),
    db.from("v_video_recent").select("*"),
    db.rpc("integration_status"),
    db.from("settings").select("budget_min,budget_max,usd_pln,vat_pct").maybeSingle(),
    db.from("v_xp_events").select("*").order("at", { ascending: false }),
  ]);
  return {
    tasks: check(tasks),
    items: check(items),
    weeks: check(weeks),
    subs: check(subs),
    projects: check(projects),
    gates: check(gates),
    videos: check(videos),
    integrations: check(integrations) ?? [],
    settings: check(settings) ?? { budget_min: 200, budget_max: 500, usd_pln: 3.7, vat_pct: 23 },
    xp: check(xp),
  };
}

type Row = Record<string, unknown>;

export async function saveRow(coll: Coll, prev: Row | null, out: Row) {
  const db = supabase();
  if (coll === "weeks") {
    const p = prev as Week | null;
    // Moving a week to another date or project archives the old row, the key is (project_id, week_start)
    if (p && (p.week_start !== out.week_start || p.project_id !== out.project_id)) {
      check(await db.from("weekly_stats").update({ archived_at: new Date().toISOString() }).eq("project_id", p.project_id).eq("week_start", p.week_start));
    }
    check(await db.from("weekly_stats").upsert({ ...out, source: "manual", archived_at: null }, { onConflict: "project_id,week_start" }));
    return;
  }
  if (prev) check(await db.from(TABLE[coll]).update(out).eq("id", prev.id as string));
  else check(await db.from(TABLE[coll]).insert(out));
}

/** "Usuń" archives: the row stays in the database, hidden from the app and XP */
export async function archiveRow(coll: Coll, row: Row) {
  const db = supabase();
  const q = db.from(TABLE[coll]).update({ archived_at: new Date().toISOString() });
  if (coll === "weeks") check(await q.eq("project_id", row.project_id as string).eq("week_start", row.week_start as string));
  else check(await q.eq("id", row.id as string));
}

export async function setTaskDone(id: string, done: boolean) {
  check(await supabase().from("tasks").update({ done }).eq("id", id));
}

export async function saveSettings(patch: Row) {
  check(await supabase().from("settings").update(patch).eq("id", true));
}
