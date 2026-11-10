-- personal-assistant, step 1: personal shopping lists (separate module, isolated tables).
-- Additive and safe to apply before the merge: nothing existing changes.
-- Lists are private to their owner (owner_id = auth.uid()); any signed-in user may keep their own.
-- Soft removal only (archived_at); no delete grant.
-- Rollback: supabase/rollback/20261110100000_shopping_lists_down.sql

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
create index shopping_lists_owner_idx on public.shopping_lists (owner_id) where archived_at is null;

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  quantity text null check (length(quantity) <= 40),
  checked boolean not null default false,
  checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
create index shopping_items_list_idx on public.shopping_items (list_id, created_at) where archived_at is null;

-- updated_at, checked_at, and an owner that clients cannot change
create function public.shopping_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  end if;
  if tg_table_name = 'shopping_items' then
    if not new.checked then
      new.checked_at := null;
    elsif tg_op = 'INSERT' or not old.checked then
      new.checked_at := now();
    else
      new.checked_at := old.checked_at;
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.shopping_touch() from public, anon, authenticated;

create trigger shopping_lists_touch before insert or update on public.shopping_lists
  for each row execute function public.shopping_touch();
create trigger shopping_items_touch before insert or update on public.shopping_items
  for each row execute function public.shopping_touch();

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
create policy shopping_own on public.shopping_lists for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- an item may only live in one of the caller's own lists
create policy shopping_own on public.shopping_items for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.shopping_lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  );

revoke all on public.shopping_lists, public.shopping_items from anon, authenticated;
grant select, insert, update on public.shopping_lists, public.shopping_items to authenticated;
