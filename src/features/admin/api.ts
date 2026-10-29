import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/shell/useRoles";

export type AdminUser = { id: string; email: string; createdAt: string; lastSignInAt: string | null; invited: boolean; roles: AppRole[] };

export const ROLE_LABEL: Record<AppRole, string> = { admin: "Administrator", dashboard: "Dashboard", zapasy: "Zapasy" };
export const ROLE_ORDER: AppRole[] = ["admin", "dashboard", "zapasy"];

const ERRORS: Record<string, string> = {
  exists: "Ten adres ma już konto. Użyj „Nowy link” przy tym użytkowniku.",
  email: "Podaj poprawny adres e-mail.",
  roles: "Wybierz co najmniej jedną rolę.",
  "roles-failed": "Konto powstało, ale nie udało się nadać ról. Zaznacz je na liście użytkowników.",
  forbidden: "Brak uprawnień.",
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${data.session?.access_token ?? ""}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(ERRORS[json.error ?? ""] ?? "Coś poszło nie tak. Spróbuj ponownie.");
  return json as T;
}

export const listUsers = () => call<{ users: AdminUser[] }>("/api/admin/users").then((r) => r.users);
export const invite = (email: string, roles: AppRole[]) => call<{ link: string }>("/api/admin/invite", { email, roles }).then((r) => r.link);
export const newLink = (userId: string) => call<{ link: string }>("/api/admin/link", { userId }).then((r) => r.link);

/** Role writes go straight to the database under RLS; the last-admin trigger refuses the rest */
export async function setRole(userId: string, role: AppRole, on: boolean) {
  const t = supabase().from("user_roles");
  const { error } = on ? await t.insert({ user_id: userId, role }) : await t.delete().eq("user_id", userId).eq("role", role);
  if (error) throw lastAdmin(error) ? new Error("Musi zostać co najmniej jeden administrator.") : error;
}

export async function revokeAll(userId: string) {
  const { error } = await supabase().from("user_roles").delete().eq("user_id", userId);
  if (error) throw lastAdmin(error) ? new Error("Musi zostać co najmniej jeden administrator.") : error;
}

const lastAdmin = (e: { message: string; hint?: string }) => e.hint === "keep_admin" || /last admin/i.test(e.message);
