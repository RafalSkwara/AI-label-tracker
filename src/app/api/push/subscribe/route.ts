import { requireAnyRole } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";

type Body = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** Stores this device's push subscription for the caller (an endpoint moves to whoever registers it last) */
export async function POST(req: Request) {
  const me = await requireAnyRole(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const endpoint = str(b.endpoint, 1000), p256dh = str(b.keys?.p256dh, 200), auth = str(b.keys?.auth, 100);
  if (!endpoint || !endpoint.startsWith("https://") || !p256dh || !auth) return Response.json({ error: "subscription" }, { status: 400 });
  const { error } = await serviceDb().from("push_subscriptions").upsert(
    { endpoint, user_id: me.userId, p256dh, auth, failed_count: 0, archived_at: null }, { onConflict: "endpoint" });
  if (error) { console.error("push subscribe:", error.message); return Response.json({ error: "failed" }, { status: 500 }); }
  return Response.json({ ok: true });
}

/** Turns notifications off on this device (soft: archived_at) */
export async function DELETE(req: Request) {
  const me = await requireAnyRole(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const endpoint = str(((await req.json().catch(() => ({}))) as Body).endpoint, 1000);
  if (!endpoint) return Response.json({ error: "endpoint" }, { status: 400 });
  const { error } = await serviceDb().from("push_subscriptions").update({ archived_at: new Date().toISOString() })
    .eq("endpoint", endpoint).eq("user_id", me.userId);
  if (error) { console.error("push unsubscribe:", error.message); return Response.json({ error: "failed" }, { status: 500 }); }
  return Response.json({ ok: true });
}
