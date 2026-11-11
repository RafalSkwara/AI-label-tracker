-- per-user data: every account sees only its own data; shopping lists and supply tabs can be shared by e-mail.
-- Roles stay as module switches (admin, dashboard, zapasy); they no longer grant access to other people's rows.
-- Existing data goes to the first admin. Existing supply tabs stay shared with every current "zapasy" user.
-- Backward compatible with the live app (settings keeps its id column), so it can be applied before the merge.
-- Rollback: supabase/rollback/20261111120000_per_user_data_down.sql

-- The caller's e-mail, normalised; shares match on it, so a share also works for an account created later
create function public.my_email() returns text
language sql stable set search_path = ''
as $$ select lower(trim(auth.jwt() ->> 'email')) $$;
revoke execute on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated, service_role;

do $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'no admin found: nobody to own the existing data';
  end if;
end
$$;

-- ---------------------------------------------------------------- Kanały (dashboard)

alter table public.projects add column owner_id uuid null references auth.users (id) on delete cascade;
update public.projects set owner_id = (select user_id from public.user_roles where role = 'admin' order by granted_at limit 1);
alter table public.projects alter column owner_id set not null, alter column owner_id set default auth.uid();
create index projects_owner_idx on public.projects (owner_id);

-- Runs as its owner (bypasses RLS), so policies on child tables do not recurse into projects
create function public.owns_project(p uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.projects where id = p and owner_id = auth.uid()) $$;
revoke execute on function public.owns_project(uuid) from public, anon;
grant execute on function public.owns_project(uuid) to authenticated, service_role;

-- Tables whose project is optional get their own owner
do $$
declare t text;
begin
  foreach t in array array['tasks', 'subscriptions', 'content_items'] loop
    execute format('alter table public.%I add column owner_id uuid null references auth.users (id) on delete cascade', t);
    execute format('update public.%I set owner_id = (select user_id from public.user_roles where role = %L order by granted_at limit 1)', t, 'admin');
    execute format('alter table public.%I alter column owner_id set not null, alter column owner_id set default auth.uid()', t);
    execute format('create index %I on public.%I (owner_id)', t || '_owner_idx', t);
    execute format('drop policy owner_all on public.%I', t);
    execute format($p$create policy owner_all on public.%I for all to authenticated
      using ((select public.is_owner()) and owner_id = (select auth.uid()))
      with check ((select public.is_owner()) and owner_id = (select auth.uid()) and (project_id is null or public.owns_project(project_id)))$p$, t);
  end loop;
end
$$;

drop policy owner_all on public.projects;
create policy owner_all on public.projects for all to authenticated
  using ((select public.is_owner()) and owner_id = (select auth.uid()))
  with check ((select public.is_owner()) and owner_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['gates', 'video_daily', 'weekly_stats', 'royalties'] loop
    execute format('drop policy owner_all on public.%I', t);
    execute format($p$create policy owner_all on public.%I for all to authenticated
      using ((select public.is_owner()) and public.owns_project(project_id))
      with check ((select public.is_owner()) and public.owns_project(project_id))$p$, t);
  end loop;
  foreach t in array array['video_traffic', 'video_search_terms', 'video_stats_hourly', 'pipeline_runs'] loop
    execute format('drop policy owner_read on public.%I', t);
    execute format($p$create policy owner_read on public.%I for select to authenticated
      using ((select public.is_owner()) and public.owns_project(project_id))$p$, t);
  end loop;
end
$$;

-- settings: one row per user. id stays (no longer a key) so the old client's .eq('id', true) keeps working.
alter table public.settings add column owner_id uuid null references auth.users (id) on delete cascade;
update public.settings set owner_id = (select user_id from public.user_roles where role = 'admin' order by granted_at limit 1);
alter table public.settings drop constraint settings_pkey, drop constraint settings_id_check;
alter table public.settings alter column owner_id set not null, alter column owner_id set default auth.uid();
alter table public.settings add primary key (owner_id);
drop policy owner_all on public.settings;
create policy owner_all on public.settings for all to authenticated
  using ((select public.is_owner()) and owner_id = (select auth.uid()))
  with check ((select public.is_owner()) and owner_id = (select auth.uid()));

-- YouTube connections: only the caller's projects
create or replace function public.integration_status()
returns table (project_id uuid, provider text, yt_channel_id text, reporting_job_id text, reports_cursor timestamptz,
               last_sync_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select i.project_id, i.provider, i.yt_channel_id, i.reporting_job_id, i.reports_cursor, i.last_sync_at, i.last_error
    from public.integrations i
    where public.owns_project(i.project_id);
end $$;

-- ---------------------------------------------------------------- Zakupy (shopping lists)

alter table public.shopping_lists add column owner_email text null;
update public.shopping_lists l set owner_email = lower(u.email) from auth.users u where u.id = l.owner_id;

create table public.shopping_list_shares (
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, email)
);
create index shopping_list_shares_email_idx on public.shopping_list_shares (email);

create function public.shopping_list_access(l uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.shopping_lists where id = l and owner_id = auth.uid())
      or exists (select 1 from public.shopping_list_shares where list_id = l and email = public.my_email())
$$;
create function public.shopping_list_owned(l uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.shopping_lists where id = l and owner_id = auth.uid()) $$;
revoke execute on function public.shopping_list_access(uuid), public.shopping_list_owned(uuid) from public, anon;
grant execute on function public.shopping_list_access(uuid), public.shopping_list_owned(uuid) to authenticated;

-- owner_email is stamped on insert and cannot be rewritten
create or replace function public.shopping_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  end if;
  if tg_table_name = 'shopping_lists' then
    new.owner_email := case when tg_op = 'UPDATE' then old.owner_email else public.my_email() end;
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

-- Lists: everyone with access reads; only the owner creates, renames and archives
drop policy shopping_own on public.shopping_lists;
create policy shopping_read on public.shopping_lists for select to authenticated
  using (owner_id = (select auth.uid()) or public.shopping_list_access(id));
create policy shopping_insert on public.shopping_lists for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy shopping_update on public.shopping_lists for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Items: everyone with access to the list reads and edits; owner_id is whoever added the item
drop policy shopping_own on public.shopping_items;
create policy shopping_read on public.shopping_items for select to authenticated
  using (public.shopping_list_access(list_id));
create policy shopping_insert on public.shopping_items for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.shopping_list_access(list_id));
create policy shopping_update on public.shopping_items for update to authenticated
  using (public.shopping_list_access(list_id)) with check (public.shopping_list_access(list_id));

-- Shares: the owner adds and removes; a recipient can remove only their own share (leave the list)
alter table public.shopping_list_shares enable row level security;
create policy shares_read on public.shopping_list_shares for select to authenticated
  using (public.shopping_list_access(list_id));
create policy shares_insert on public.shopping_list_shares for insert to authenticated
  with check (created_by = (select auth.uid()) and public.shopping_list_owned(list_id) and email <> public.my_email());
create policy shares_remove on public.shopping_list_shares for delete to authenticated
  using (public.shopping_list_owned(list_id) or email = public.my_email());
revoke all on public.shopping_list_shares from anon, authenticated;
grant select, insert, delete on public.shopping_list_shares to authenticated;

-- ---------------------------------------------------------------- Zapasy (supplies)

alter table public.supply_tabs add column owner_id uuid null references auth.users (id) on delete cascade;
alter table public.supply_tabs add column owner_email text null;
update public.supply_tabs set owner_id = (select user_id from public.user_roles where role = 'admin' order by granted_at limit 1);
update public.supply_tabs t set owner_email = lower(u.email) from auth.users u where u.id = t.owner_id;
alter table public.supply_tabs alter column owner_id set not null, alter column owner_id set default auth.uid();

create table public.supply_tab_shares (
  tab_id uuid not null references public.supply_tabs (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tab_id, email)
);
create index supply_tab_shares_email_idx on public.supply_tab_shares (email);

-- Keep today's household list working: existing tabs stay shared with every other current "zapasy" user
insert into public.supply_tab_shares (tab_id, email, created_by)
select t.id, lower(u.email), t.owner_id
from public.supply_tabs t
cross join public.user_roles r
join auth.users u on u.id = r.user_id
where r.role = 'zapasy' and r.user_id <> t.owner_id and u.email is not null
on conflict do nothing;

create function public.supply_tab_access(t uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.supply_tabs where id = t and owner_id = auth.uid())
      or exists (select 1 from public.supply_tab_shares where tab_id = t and email = public.my_email())
$$;
create function public.supply_tab_owned(t uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.supply_tabs where id = t and owner_id = auth.uid()) $$;
revoke execute on function public.supply_tab_access(uuid), public.supply_tab_owned(uuid) from public, anon;
grant execute on function public.supply_tab_access(uuid), public.supply_tab_owned(uuid) to authenticated;

-- owner and owner_email cannot be rewritten
create or replace function public.supply_owner_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    new.owner_email := old.owner_email;
  else
    new.owner_email := public.my_email();
  end if;
  return new;
end
$$;
revoke execute on function public.supply_owner_guard() from public, anon, authenticated;
create trigger supply_tabs_owner before insert or update on public.supply_tabs
  for each row execute function public.supply_owner_guard();

drop policy supply_rw on public.supply_tabs;
create policy supply_read on public.supply_tabs for select to authenticated
  using ((select public.has_role('zapasy')) and (owner_id = (select auth.uid()) or public.supply_tab_access(id)));
create policy supply_insert on public.supply_tabs for insert to authenticated
  with check ((select public.has_role('zapasy')) and owner_id = (select auth.uid()));
create policy supply_update on public.supply_tabs for update to authenticated
  using ((select public.has_role('zapasy')) and owner_id = (select auth.uid()))
  with check ((select public.has_role('zapasy')) and owner_id = (select auth.uid()));

drop policy supply_rw on public.supply_items;
create policy supply_rw on public.supply_items for all to authenticated
  using ((select public.has_role('zapasy')) and public.supply_tab_access(tab_id))
  with check ((select public.has_role('zapasy')) and public.supply_tab_access(tab_id));

alter table public.supply_tab_shares enable row level security;
create policy shares_read on public.supply_tab_shares for select to authenticated
  using (public.supply_tab_access(tab_id));
create policy shares_insert on public.supply_tab_shares for insert to authenticated
  with check (created_by = (select auth.uid()) and public.supply_tab_owned(tab_id) and email <> public.my_email());
create policy shares_remove on public.supply_tab_shares for delete to authenticated
  using (public.supply_tab_owned(tab_id) or email = public.my_email());
revoke all on public.supply_tab_shares from anon, authenticated;
grant select, insert, delete on public.supply_tab_shares to authenticated;
