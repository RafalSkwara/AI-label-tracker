import { safeEqual } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { secret } from "@/lib/server/env";
import { syncAll } from "@/lib/server/ytSync";

/** Called by worker.ts `scheduled` through openNext.fetch with the shared secret; phase 5 adds the push here */
export async function POST(req: Request) {
  if (!safeEqual(req.headers.get("x-cron-secret") ?? "", secret("CRON_SECRET"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const results = await syncAll(serviceDb());
  return Response.json({ results });
}
