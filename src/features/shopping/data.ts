import { supabase } from "@/lib/supabase";
import type { ShoppingItem, ShoppingList } from "./types";

// Rows are private to the signed-in user (RLS on owner_id). Removal is soft: archived_at.
const LIST_COLS = "id,name,created_at,updated_at";
const ITEM_COLS = "id,list_id,name,quantity,checked,created_at,updated_at";
const now = () => new Date().toISOString();

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error || data == null) throw new Error(error?.message ?? "brak odpowiedzi");
  return data as T;
}

export async function loadShopping(): Promise<{ lists: ShoppingList[]; items: ShoppingItem[] }> {
  const db = supabase();
  const [lists, items] = await Promise.all([
    must<ShoppingList[]>(db.from("shopping_lists").select(LIST_COLS).is("archived_at", null).order("created_at")),
    must<ShoppingItem[]>(db.from("shopping_items").select(ITEM_COLS).is("archived_at", null).order("created_at")),
  ]);
  return { lists, items };
}

export const insertList = (name: string) =>
  must<ShoppingList>(supabase().from("shopping_lists").insert({ name }).select(LIST_COLS).single());
export const renameList = (id: string, name: string) =>
  must<ShoppingList>(supabase().from("shopping_lists").update({ name }).eq("id", id).select(LIST_COLS).single());
export const archiveList = (id: string) =>
  must<ShoppingList>(supabase().from("shopping_lists").update({ archived_at: now() }).eq("id", id).select(LIST_COLS).single());

export const insertItem = (list_id: string, name: string, quantity: string | null) =>
  must<ShoppingItem>(supabase().from("shopping_items").insert({ list_id, name, quantity }).select(ITEM_COLS).single());
export const updateItem = (id: string, patch: { name?: string; quantity?: string | null; checked?: boolean }) =>
  must<ShoppingItem>(supabase().from("shopping_items").update(patch).eq("id", id).select(ITEM_COLS).single());
export const uncheckItems = (ids: string[]) =>
  must<ShoppingItem[]>(supabase().from("shopping_items").update({ checked: false }).in("id", ids).select(ITEM_COLS));

/** Product names the user added before (also removed ones), newest first, for suggestions */
export async function loadHistory(): Promise<string[]> {
  const rows = await must<{ name: string }[]>(
    supabase().from("shopping_items").select("name").order("created_at", { ascending: false }).limit(500),
  );
  const seen = new Set<string>(), out: string[] = [];
  for (const { name } of rows) {
    const k = name.trim().toLocaleLowerCase("pl");
    if (!seen.has(k)) { seen.add(k); out.push(name.trim()); }
  }
  return out;
}

/** archived = false restores (undo) */
export const archiveItems = (ids: string[], archived = true) =>
  must<ShoppingItem[]>(supabase().from("shopping_items").update({ archived_at: archived ? now() : null }).in("id", ids).select(ITEM_COLS));
