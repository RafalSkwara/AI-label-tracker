-- expenses: household expense books shareable by e-mail (same model as calendars), expenses read from a receipt photo
-- (Workers AI) or typed in, optionally linked to a shopping list; receipt photos in the private Storage bucket "receipts".
-- Additive and safe to apply before the merge.
-- Rollback: supabase/rollback/20261111180000_expenses_down.sql

create table public.expense_books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text null,
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
create index expense_books_owner_idx on public.expense_books (owner_id) where archived_at is null;

create table public.expense_book_shares (
  book_id uuid not null references public.expense_books (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (book_id, email)
);
create index expense_book_shares_email_idx on public.expense_book_shares (email);

-- items: receipt lines [{ "name": text, "quantity": text|null, "price": number|null }] (price = line total, PLN)
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.expense_books (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spent_on date not null default current_date,
  shop text null check (length(shop) <= 80),
  total numeric(10, 2) not null check (total >= 0 and total < 100000),
  category text not null default 'inne'
    check (category in ('spozywcze', 'chemia', 'dom', 'zdrowie', 'dzieci', 'transport', 'na_miescie', 'rozrywka', 'inne')),
  note text null check (length(note) <= 500),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  list_id uuid null references public.shopping_lists (id) on delete set null,
  photo_path text null check (length(photo_path) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
create index expenses_book_idx on public.expenses (book_id, spent_on) where archived_at is null;

create function public.expense_book_access(b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.expense_books where id = b and owner_id = auth.uid())
      or exists (select 1 from public.expense_book_shares where book_id = b and email = public.my_email())
$$;
create function public.expense_book_owned(b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.expense_books where id = b and owner_id = auth.uid()) $$;
-- Storage object name "<book id>/<file>": access to the book grants access to the photo
create function public.receipt_access(object_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.expense_book_access(split_part(object_name, '/', 1)::uuid) else false end
$$;
revoke execute on function public.expense_book_access(uuid), public.expense_book_owned(uuid), public.receipt_access(text) from public, anon;
grant execute on function public.expense_book_access(uuid), public.expense_book_owned(uuid), public.receipt_access(text) to authenticated;

-- updated_at; owner, owner_email, creator and created_at cannot be rewritten
create function public.expense_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_table_name = 'expense_books' then
    if tg_op = 'UPDATE' then
      new.owner_id := old.owner_id;
      new.owner_email := old.owner_email;
      new.created_at := old.created_at;
    else
      new.owner_email := public.my_email();
    end if;
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;
revoke execute on function public.expense_touch() from public, anon, authenticated;
create trigger expense_books_touch before insert or update on public.expense_books
  for each row execute function public.expense_touch();
create trigger expenses_touch before insert or update on public.expenses
  for each row execute function public.expense_touch();

alter table public.expense_books enable row level security;
alter table public.expense_book_shares enable row level security;
alter table public.expenses enable row level security;

create policy book_read on public.expense_books for select to authenticated
  using (owner_id = (select auth.uid()) or public.expense_book_access(id));
create policy book_insert on public.expense_books for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy book_update on public.expense_books for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- a linked shopping list must be one the user can open
create policy exp_read on public.expenses for select to authenticated
  using (public.expense_book_access(book_id));
create policy exp_insert on public.expenses for insert to authenticated
  with check (created_by = (select auth.uid()) and public.expense_book_access(book_id)
    and (list_id is null or public.shopping_list_access(list_id)));
create policy exp_update on public.expenses for update to authenticated
  using (public.expense_book_access(book_id))
  with check (public.expense_book_access(book_id) and (list_id is null or public.shopping_list_access(list_id)));

create policy shares_read on public.expense_book_shares for select to authenticated
  using (public.expense_book_access(book_id));
create policy shares_insert on public.expense_book_shares for insert to authenticated
  with check (created_by = (select auth.uid()) and public.expense_book_owned(book_id) and email <> public.my_email());
create policy shares_remove on public.expense_book_shares for delete to authenticated
  using (public.expense_book_owned(book_id) or email = public.my_email());

revoke all on public.expense_books, public.expense_book_shares, public.expenses from anon, authenticated;
grant select, insert, update on public.expense_books, public.expenses to authenticated;
grant select, insert, delete on public.expense_book_shares to authenticated;

-- Receipt photos: private bucket, JPEG/WebP up to 1 MB (the app shrinks photos before upload). No delete policy:
-- a photo stays with its (soft-removed) expense.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg', 'image/webp']);

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.receipt_access(name));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.receipt_access(name));
