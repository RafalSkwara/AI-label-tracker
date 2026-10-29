import { supabase } from "@/lib/supabase";
import type { ItemFields, Status, SupplyItem, SupplyTab, TabFields } from "./types";

const TAB_COLS = "id,name,description,sort_order,archived,updated_at";
const ITEM_COLS = "id,tab_id,category,name,quantity,details,price_min,price_max,price_label,own_price,checked,checked_initial,removed,sort_order,updated_at";

export async function loadSupplies(): Promise<{ tabs: SupplyTab[]; items: SupplyItem[] }> {
  const db = supabase();
  const [t, i] = await Promise.all([
    db.from("supply_tabs").select(TAB_COLS).order("sort_order"),
    db.from("supply_items").select(ITEM_COLS).order("sort_order"),
  ]);
  if (t.error) throw t.error;
  if (i.error) throw i.error;
  return { tabs: t.data as SupplyTab[], items: i.data as SupplyItem[] };
}

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error || data == null) throw new Error(error?.message ?? "brak odpowiedzi");
  return data as T;
}

export const updateItem = (id: string, patch: ItemFields) =>
  must<SupplyItem>(supabase().from("supply_items").update(patch).eq("id", id).select(ITEM_COLS).single());
export const insertItem = (fields: ItemFields) =>
  must<SupplyItem>(supabase().from("supply_items").insert(fields).select(ITEM_COLS).single());
export const updateTab = (id: string, patch: TabFields) =>
  must<SupplyTab>(supabase().from("supply_tabs").update(patch).eq("id", id).select(TAB_COLS).single());
export const insertTab = (fields: TabFields) =>
  must<SupplyTab>(supabase().from("supply_tabs").insert(fields).select(TAB_COLS).single());

/** One channel for both tables; returns the unsubscribe function */
export function subscribe(onTab: (t: SupplyTab) => void, onItem: (i: SupplyItem) => void, onStatus: (s: Status) => void) {
  const db = supabase();
  const ch = db.channel("supplies")
    .on("postgres_changes", { event: "*", schema: "public", table: "supply_tabs" }, (p) => { if ("id" in p.new) onTab(p.new as SupplyTab); })
    .on("postgres_changes", { event: "*", schema: "public", table: "supply_items" }, (p) => { if ("id" in p.new) onItem(p.new as SupplyItem); })
    .subscribe((s) => onStatus(s === "SUBSCRIBED" ? "live" : s === "CLOSED" ? "connecting" : "offline"));
  return () => { db.removeChannel(ch); };
}
