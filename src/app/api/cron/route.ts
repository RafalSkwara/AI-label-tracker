import { safeEqual } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { secret } from "@/lib/server/env";
import { snapshotAll, syncAll } from "@/lib/server/ytSync";

/** Called by worker.ts `scheduled` through openNext.fetch with the shared secret; `x-cron-kind: hourly` takes snapshots, anything else is the daily run (phase 5 adds the push there) */
export async function POST(req: Request) {
  if (!safeEqual(req.headers.get("x-cron-secret") ?? "", secret("CRON_SECRET"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (req.headers.get("x-cron-kind") === "hourly") return Response.json({ results: await snapshotAll(serviceDb()) });
  return Response.json({ results: await syncAll(serviceDb()) });
}
