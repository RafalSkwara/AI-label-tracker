import { requireRole } from "@/lib/server/auth";
import { makeLink } from "@/lib/server/adminLink";
import { serviceDb } from "@/lib/server/db";

/** Admin only: a fresh link for an existing user (expired invite, forgotten password) */
export async function POST(req: Request) {
  if (!(await requireRole(req, "admin"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const { userId } = (await req.json().catch(() => ({}))) as { userId?: string };
  if (!userId) return Response.json({ error: "userId" }, { status: 400 });
  const { data, error } = await serviceDb().auth.admin.getUserById(userId);
  if (error || !data.user?.email) return Response.json({ error: "not-found" }, { status: 404 });
  const made = await makeLink(new URL(req.url).origin, data.user.email, data.user.email_confirmed_at ? "magiclink" : "invite");
  if ("error" in made) {
    console.error("admin link:", made.error);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  return Response.json({ link: made.link });
}
