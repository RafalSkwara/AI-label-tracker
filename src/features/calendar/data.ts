import type { CalEvent } from "@/lib/calendar";
import { supabase } from "@/lib/supabase";

/** Own calendars and calendars shared with the user by e-mail (RLS). Removal is soft: archived_at. */
export type Calendar = { id: string; owner_id: string; owner_email: string | null; name: string; color: number; updated_at: string };
export type EventFields = Pick<CalEvent, "calendar_id" | "title" | "starts_on" | "start_time" | "end_time" | "repeat" | "repeat_until" | "remind_minutes" | "note">;
/** Active subscription payment shown read-only in the calendar (dashboard users only) */
export type Renewal = { id: string; name: string; renew: string };

const CAL_COLS = "id,owner_id,owner_email,name,color,updated_at";
const EV_COLS = "id,calendar_id,title,starts_on,start_time,end_time,repeat,repeat_until,remind_minutes,note,updated_at";
const now = () => new Date().toISOString();

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error || data == null) throw new Error(error?.message ?? "brak odpowiedzi");
  return data as T;
}

export async function loadCalendar(withRenewals: boolean): Promise<{ calendars: Calendar[]; events: CalEvent[]; renewals: Renewal[] }> {
  const db = supabase();
  const [calendars, events, subs] = await Promise.all([
    must<Calendar[]>(db.from("calendars").select(CAL_COLS).is("archived_at", null).order("created_at")),
    must<CalEvent[]>(db.from("calendar_events").select(EV_COLS).is("archived_at", null).order("starts_on")),
    withRenewals ? db.from("subscriptions").select("id,name,renew").is("archived_at", null).eq("status", "aktywna").not("renew", "is", null) : null,
  ]);
  // payments are a bonus: a failure there must not hide the calendar
  return { calendars, events, renewals: (subs && !subs.error ? subs.data : []) as Renewal[] };
}

export const insertCalendar = (name: string, color: number) =>
  must<Calendar>(supabase().from("calendars").insert({ name, color }).select(CAL_COLS).single());
export const updateCalendar = (id: string, patch: Partial<Pick<Calendar, "name" | "color">> & { archived_at?: string }) =>
  must<Calendar>(supabase().from("calendars").update(patch).eq("id", id).select(CAL_COLS).single());
export const archiveCalendar = (id: string) => updateCalendar(id, { archived_at: now() });

export const insertEvent = (f: EventFields) =>
  must<CalEvent>(supabase().from("calendar_events").insert(f).select(EV_COLS).single());
export const updateEvent = (id: string, f: Partial<EventFields>) =>
  must<CalEvent>(supabase().from("calendar_events").update(f).eq("id", id).select(EV_COLS).single());
/** archived = false restores (undo) */
export const archiveEvent = (id: string, archived = true) =>
  must<CalEvent>(supabase().from("calendar_events").update({ archived_at: archived ? now() : null }).eq("id", id).select(EV_COLS).single());
