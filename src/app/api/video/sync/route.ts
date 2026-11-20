import { ownerDb } from "@/lib/server/auth";
import { dispatch } from "@/lib/server/github";

/** POST → runs the pipeline's sync (Slowfall scene readiness + YouTube state); results land in video_jobs in ~1 min */
export async function POST(req: Request) {
  if (!(await ownerDb(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await dispatch("sync.yml");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
