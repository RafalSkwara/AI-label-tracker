export type SupplyTab = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  archived: boolean;
  updated_at: string;
};

export type SupplyItem = {
  id: string;
  tab_id: string;
  category: string;
  name: string;
  quantity: string | null;
  details: string | null;
  price_min: number | null;
  price_max: number | null;
  price_label: string | null;
  own_price: number | null;
  checked: boolean;
  checked_initial: string | null;
  removed: boolean;
  sort_order: number;
  updated_at: string;
};

export type ItemFields = Partial<Omit<SupplyItem, "id" | "updated_at" | "checked_initial">>;
export type TabFields = Partial<Omit<SupplyTab, "id" | "updated_at">>;
export type Status = "connecting" | "live" | "offline";
