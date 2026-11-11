import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, type CalEvent, hm, localToday, occurrences, reminderAt, shortDay } from "@/lib/calendar";
import { dueRenewals, renewalMessage, warsawToday } from "@/lib/reminders";
import { secret } from "./env";

export type PushData = { title: string; body: string; url: string; tag?: string };
type Row = { endpoint: string; user_id: string; p256dh: string; auth: string; failed_count: number };

const vapid = (): VapidKeys => ({ subject: secret("VAPID_SUBJECT"), publicKey: secret("VAPID_PUBLIC_KEY"), privateKey: secret("VAPID_PRIVATE_KEY") });

/** Sends one message to each live subscription of the given users; 404/410 (gone) archive the subscription */
export async function sendToUsers(db: SupabaseClient, userIds: string[], data: PushData): Promise<{ sent: number; failed: number }> {
  if (!userIds.length) return { sent: 0, failed: 0 };
  const { data: rows, error } = await db.from("push_subscriptions").select("endpoint,user_id,p256dh,auth,failed_count")
    .in("user_id", userIds).is("archived_at", null);
  if (error) throw new Error(error.message);
  const keys = vapid();
  let sent = 0, failed = 0;
  for (const r of (rows ?? []) as Row[]) {
    let status = 0;
    try {
      const payload = await buildPushPayload({ data, options: { ttl: 12 * 3600, urgency: "normal", topic: (data.tag ?? "sha").slice(0, 32) } },
        { endpoint: r.endpoint, expirationTime: null, keys: { p256dh: r.p256dh, auth: r.auth } }, keys);
      status = (await fetch(r.endpoint, payload)).status;
    } catch (e) {
      console.error("push send:", (e as Error).message);
    }
    const ok = status >= 200 && status < 300;
    if (ok) sent++; else failed++;
    const gone = status === 404 || status === 410;
    await db.from("push_subscriptions").update(ok
      ? { last_ok_at: new Date().toISOString(), failed_count: 0 }
      : { failed_count: r.failed_count + 1, ...(gone || r.failed_count + 1 >= 10 ? { archived_at: new Date().toISOString() } : {}) },
    ).eq("endpoint", r.endpoint);
  }
  return { sent, failed };
}

/** Daily: per user, one notification about active subscriptions paid in 3 days, tomorrow or today */
export async function sendRenewalReminders(db: SupabaseClient, now = new Date()) {
  const { data, error } = await db.from("subscriptions").select("id,owner_id,name,price,currency,status,renew")
    .is("archived_at", null).eq("status", "aktywna").not("renew", "is", null);
  if (error) throw new Error(error.message);
  const today = warsawToday(now);
  const byUser = new Map<string, typeof data>();
  for (const s of data ?? []) byUser.set(s.owner_id, [...(byUser.get(s.owner_id) ?? []), s]);
  const out: { userId: string; due: number; sent: number; failed: number }[] = [];
  for (const [userId, subs] of byUser) {
    const due = dueRenewals(subs, today);
    if (!due.length) continue;
    const msg = renewalMessage(due);
    out.push({ userId, due: due.length, ...(await sendToUsers(db, [userId], { ...msg, url: "/dashboard?tab=koszty", tag: `renew-${today}` })) });
  }
  return out;
}

/** Every 10 min: calendar reminders due in the last 30 min that were not sent yet, to the owner and everyone the calendar is shared with */
export async function sendCalendarReminders(db: SupabaseClient, now = Date.now()) {
  const { data, error } = await db.from("calendar_events")
    .select("id,calendar_id,title,starts_on,start_time,end_time,repeat,repeat_until,remind_minutes,calendars!inner(name,archived_at)")
    .is("archived_at", null).not("remind_minutes", "is", null).is("calendars.archived_at", null);
  if (error) throw new Error(error.message);
  const today = localToday(new Date(now));
  const out: { event: string; on: string; sent: number }[] = [];
  for (const ev of (data ?? []) as unknown as (CalEvent & { calendars: { name: string } })[]) {
    // a reminder fires at most 14 days before, so occurrences from yesterday to 15 days ahead cover every due one
    for (const on of occurrences(ev, addDays(today, -1), addDays(today, 15))) {
      const at = reminderAt(ev, on);
      if (at == null || at > now || at <= now - 30 * 6e4) continue;
      const { error: dup } = await db.from("calendar_reminders_sent").insert({ event_id: ev.id, occurs_on: on });
      if (dup) continue; // already sent (primary key), or the table is missing
      const { data: rec } = await db.rpc("calendar_recipients", { c: ev.calendar_id });
      const ids = ((rec ?? []) as { user_id: string }[]).map((r) => r.user_id);
      const when = `${on === today ? "dziś" : shortDay(on)}${ev.start_time ? `, ${hm(ev.start_time)}` : ""}`;
      const r = await sendToUsers(db, ids, { title: ev.title, body: `${when} · ${ev.calendars.name}`, url: `/kalendarz?dzien=${on}`, tag: `cal-${ev.id}-${on}` });
      out.push({ event: ev.id, on, sent: r.sent });
    }
  }
  return out;
}
