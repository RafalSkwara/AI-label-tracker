import { safeEqual } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { secret } from "@/lib/server/env";
import { sendCalendarReminders, sendRenewalReminders } from "@/lib/server/push";
import { snapshotAll, syncAll } from "@/lib/server/ytSync";

/** Called by worker.ts `scheduled` through openNext.fetch with the shared secret; `x-cron-kind` is "daily" (sync), "hourly" (snapshots) or "push" (subscription renewal reminders), "reminders" (calendar, every 10 min), anything else is rejected */
export async function POST(req: Request) {
  if (!safeEqual(req.headers.get("x-cron-secret") ?? "", secret("CRON_SECRET"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const kind = req.headers.get("x-cron-kind");
  if (kind === "hourly") return Response.json({ results: await snapshotAll(serviceDb()) });
  if (kind === "reminders") return Response.json({ results: await sendCalendarReminders(serviceDb()) });
  if (kind === "push") return Response.json({ results: await sendRenewalReminders(serviceDb()) });
  if (kind === "daily") return Response.json({ results: await syncAll(serviceDb()) });
  return Response.json({ error: "unknown cron kind" }, { status: 400 });
}
