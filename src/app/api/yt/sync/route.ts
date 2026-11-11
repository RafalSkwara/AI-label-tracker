import { ownedProjects } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { type SyncResult, syncAll } from "@/lib/server/ytSync";

/** Manual sync ("Synchronizuj teraz") of the caller's own projects; body { projectId? } limits it to one of them */
export async function POST(req: Request) {
  const mine = await ownedProjects(req);
  if (!mine) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (projectId && !mine.includes(projectId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const db = serviceDb(), results: SyncResult[] = [];
  for (const id of projectId ? [projectId] : mine) results.push(...(await syncAll(db, id)));
  return Response.json({ results });
}
