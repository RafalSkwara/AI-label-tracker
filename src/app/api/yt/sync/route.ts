import { requireOwner } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { syncAll } from "@/lib/server/ytSync";

/** Owner-only manual sync ("Synchronizuj teraz"); body { projectId? } limits it to one project */
export async function POST(req: Request) {
  if (!(await requireOwner(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  return Response.json({ results: await syncAll(serviceDb(), projectId) });
}
