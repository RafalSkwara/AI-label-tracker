-- household-supplies, phase 3: shared household supplies list (isolated tables, realtime).
-- Additive and safe to apply before the merge: nothing existing changes.
-- Rollback: supabase/rollback/20261029110000_supplies_down.sql (run before the roles rollback).

create table public.supply_tabs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_by uuid null default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supply_items (
  id uuid primary key default gen_random_uuid(),
  key text not null unique default gen_random_uuid()::text,
  tab_id uuid not null references public.supply_tabs (id),
  category text not null default 'Inne',
  name text not null check (length(trim(name)) > 0),
  quantity text null,
  details text null,
  price_min numeric(10,2) null check (price_min >= 0),
  price_max numeric(10,2) null,
  price_label text null,
  own_price numeric(10,2) null check (own_price >= 0),
  checked boolean not null default false,
  checked_by uuid null references auth.users (id) on delete set null,
  checked_initial text null,
  checked_at timestamptz null,
  removed boolean not null default false,
  sort_order int not null default 0,
  created_by uuid null default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price_max is null or (price_min is not null and price_max >= price_min))
);
create index supply_items_tab_idx on public.supply_items (tab_id, category, sort_order);

-- Own trigger function (not shared with the dashboard): updated_at plus who/when checked an item.
create function public.supply_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_table_name = 'supply_items' then
    if new.checked then
      if tg_op = 'INSERT' or not old.checked then
        new.checked_by := auth.uid();
        new.checked_at := now();
        new.checked_initial := upper(left(auth.jwt() ->> 'email', 1));
      end if;
    else
      new.checked_by := null;
      new.checked_at := null;
      new.checked_initial := null;
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.supply_touch() from public, anon, authenticated;

create trigger supply_tabs_touch before insert or update on public.supply_tabs
  for each row execute function public.supply_touch();
create trigger supply_items_touch before insert or update on public.supply_items
  for each row execute function public.supply_touch();

alter table public.supply_tabs enable row level security;
alter table public.supply_items enable row level security;
create policy supply_rw on public.supply_tabs for all to authenticated
  using ((select public.has_role('zapasy'))) with check ((select public.has_role('zapasy')));
create policy supply_rw on public.supply_items for all to authenticated
  using ((select public.has_role('zapasy'))) with check ((select public.has_role('zapasy')));

-- Soft removal only: no delete grant.
revoke all on public.supply_tabs, public.supply_items from anon, authenticated;
grant select, insert, update on public.supply_tabs, public.supply_items to authenticated;

alter publication supabase_realtime add table public.supply_tabs, public.supply_items;
