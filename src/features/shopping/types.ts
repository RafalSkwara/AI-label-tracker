export type ShoppingList = {
  id: string;
  owner_id: string;
  /** set by the database on insert */
  owner_email: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

export type ShoppingItem = {
  id: string;
  list_id: string;
  name: string;
  quantity: string | null;
  /** total for the line, PLN */
  price: number | null;
  barcode: string | null;
  checked: boolean;
  created_at: string;
  updated_at: string;
};
