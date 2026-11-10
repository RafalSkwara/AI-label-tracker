-- personal-assistant: optional price per shopping-list line (total for the line, PLN).
-- Additive and safe to apply before the merge.
-- Rollback: supabase/rollback/20261110150000_shopping_item_price_down.sql

alter table public.shopping_items
  add column price numeric(10,2) null check (price >= 0 and price < 100000);
