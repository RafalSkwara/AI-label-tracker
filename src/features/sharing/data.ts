import { supabase } from "@/lib/supabase";

/** Share tables: one row per (shared thing, recipient e-mail). RLS: the owner adds/removes, a recipient may remove only their own row. */
export type ShareKind = { table: "shopping_list_shares"; key: "list_id" } | { table: "supply_tab_shares"; key: "tab_id" };
export const SHOPPING: ShareKind = { table: "shopping_list_shares", key: "list_id" };
export const SUPPLIES: ShareKind = { table: "supply_tab_shares", key: "tab_id" };

/** Recipient e-mails by shared-thing id */
export type Shares = Record<string, string[]>;

export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function loadShares(kind: ShareKind): Promise<Shares> {
  const { data, error } = await supabase().from(kind.table).select(`${kind.key},email`).order("created_at");
  if (error) throw new Error(error.message);
  const out: Shares = {};
  for (const r of (data ?? []) as unknown as Record<string, string>[]) (out[r[kind.key]] ??= []).push(r.email);
  return out;
}

export async function addShare(kind: ShareKind, id: string, email: string) {
  const { error } = await supabase().from(kind.table).insert({ [kind.key]: id, email: normEmail(email) });
  if (!error) return;
  if (error.code === "23505") throw new Error("ta osoba już ma dostęp");
  if (error.code === "42501") throw new Error("nie możesz udostępnić tego sobie ani cudzej liście");
  throw new Error(error.message);
}

export async function removeShare(kind: ShareKind, id: string, email: string) {
  const { error } = await supabase().from(kind.table).delete().eq(kind.key, id).eq("email", normEmail(email));
  if (error) throw new Error(error.message);
}

/** "Udostępniona 1 osobie / 3 osobom" */
export const sharedLabel = (n: number) => `Udostępniona ${n} ${n === 1 ? "osobie" : "osobom"}`;
