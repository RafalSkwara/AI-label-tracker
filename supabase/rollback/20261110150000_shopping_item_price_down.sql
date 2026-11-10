-- Rollback of 20261110150000_shopping_item_price.sql. Prices are lost.

alter table public.shopping_items drop column price;
