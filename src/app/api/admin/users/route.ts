import { requireRole } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";

/** Admin only: all users with their roles */
export async function GET(req: Request) {
  if (!(await requireRole(req, "admin"))) return Response.json({ error: "forbidden" }, { status: 403 });
  const db = serviceDb();
  const [{ data: list, error }, { data: roles, error: rolesError }] = await Promise.all([
    db.auth.admin.listUsers({ perPage: 200 }),
    db.from("user_roles").select("user_id, role"),
  ]);
  if (error || rolesError) {
    console.error("admin users:", (error ?? rolesError)?.message);
    return Response.json({ error: "failed" }, { status: 500 });
  }
  const users = list.users.map((u) => ({
    id: u.id,
    email: u.email ?? "",
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    invited: !u.last_sign_in_at,
    roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as string),
  }));
  return Response.json({ users });
}
