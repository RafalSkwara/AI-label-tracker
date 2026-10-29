import { requireRole } from "@/lib/server/auth";
import { makeLink } from "@/lib/server/adminLink";
import { serviceDb } from "@/lib/server/db";

const ROLES = ["admin", "dashboard", "zapasy"];

/** Admin only: creates the user (no e-mail is sent), grants the roles and returns the one-time link to share */
export async function POST(req: Request) {
  const me = await requireRole(req, "admin");
  if (!me) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; roles?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const roles = Array.isArray(body.roles) ? [...new Set(body.roles)] : [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "email" }, { status: 400 });
  if (!roles.length || !roles.every((r) => typeof r === "string" && ROLES.includes(r))) return Response.json({ error: "roles" }, { status: 400 });

  const made = await makeLink(new URL(req.url).origin, email, "invite");
  if ("error" in made || !made.user) {
    const msg: string = "error" in made ? String(made.error) : "no user";
    console.error("admin invite:", msg);
    return /already|registered|exists/i.test(msg) ? Response.json({ error: "exists" }, { status: 409 }) : Response.json({ error: "failed" }, { status: 500 });
  }
  const newId = made.user.id;
  const { error } = await serviceDb().from("user_roles").insert(roles.map((role) => ({ user_id: newId, role, granted_by: me.userId })));
  if (error) {
    console.error("admin invite roles:", error.message);
    return Response.json({ error: "roles-failed" }, { status: 500 });
  }
  return Response.json({ link: made.link });
}
