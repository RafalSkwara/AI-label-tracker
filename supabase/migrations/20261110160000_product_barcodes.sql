-- personal-assistant: barcodes on shopping-list lines and a shared product lookup cache.
-- Additive and safe to apply before the merge.
-- product_cache is filled only by the Worker (service role) from Open Food Facts / Open Beauty Facts /
-- Open Products Facts (ODbL, attribution shown in the app). No client access: RLS on, no policies, no grants.
-- Rollback: supabase/rollback/20261110160000_product_barcodes_down.sql

alter table public.shopping_items
  add column barcode text null check (barcode ~ '^[0-9]{8,14}$');
create index shopping_items_barcode_idx on public.shopping_items (owner_id, barcode) where barcode is not null;

create table public.product_cache (
  barcode text primary key check (barcode ~ '^[0-9]{8,14}$'),
  found boolean not null,
  name text null,
  brand text null,
  quantity text null,
  source text null check (source in ('off', 'obf', 'opf')),
  fetched_at timestamptz not null default now()
);
alter table public.product_cache enable row level security;
revoke all on public.product_cache from anon, authenticated;
