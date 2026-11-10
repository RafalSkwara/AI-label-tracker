-- Rollback of 20261110160000_product_barcodes.sql. Cached products and item barcodes are lost.

drop table public.product_cache;
drop index public.shopping_items_barcode_idx;
alter table public.shopping_items drop column barcode;
