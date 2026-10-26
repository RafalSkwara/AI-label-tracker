import { requireOwner, signState } from "@/lib/server/auth";
import { authUrl } from "@/lib/server/google";

/** Owner-only: returns the Google consent URL for one project. The state is HMAC-signed (project id + expiry). */
export async function POST(req: Request) {
  if (!(await requireOwner(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
  return Response.json({ url: authUrl(new URL(req.url).origin, await signState(projectId)) });
}
