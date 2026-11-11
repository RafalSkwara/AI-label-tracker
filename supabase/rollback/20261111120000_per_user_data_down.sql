-- Rollback of 20261111120000_per_user_data.sql. Shares are lost; every row returns to role-based access.
-- Settings: only the first admin's row is kept as the single shared row.

-- Zapasy
drop policy shares_read on public.supply_tab_shares;
drop policy shares_insert on public.supply_tab_shares;
drop policy shares_remove on public.supply_tab_shares;
drop policy supply_rw on public.supply_items;
drop policy supply_read on public.supply_tabs;
drop policy supply_insert on public.supply_tabs;
drop policy supply_update on public.supply_tabs;
create policy supply_rw on public.supply_tabs for all to authenticated
  using ((select public.has_role('zapasy'))) with check ((select public.has_role('zapasy')));
create policy supply_rw on public.supply_items for all to authenticated
  using ((select public.has_role('zapasy'))) with check ((select public.has_role('zapasy')));
drop trigger supply_tabs_owner on public.supply_tabs;
drop function public.supply_owner_guard();
drop function public.supply_tab_access(uuid);
drop function public.supply_tab_owned(uuid);
drop table public.supply_tab_shares;
alter table public.supply_tabs drop column owner_id, drop column owner_email;

-- Zakupy
drop policy shares_read on public.shopping_list_shares;
drop policy shares_insert on public.shopping_list_shares;
drop policy shares_remove on public.shopping_list_shares;
drop policy shopping_read on public.shopping_items;
drop policy shopping_insert on public.shopping_items;
drop policy shopping_update on public.shopping_items;
drop policy shopping_read on public.shopping_lists;
drop policy shopping_insert on public.shopping_lists;
drop policy shopping_update on public.shopping_lists;
create policy shopping_own on public.shopping_lists for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy shopping_own on public.shopping_items for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.shopping_lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  );
create or replace function public.shopping_touch() returns trigger
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
drop function public.shopping_list_access(uuid);
drop function public.shopping_list_owned(uuid);
drop table public.shopping_list_shares;
alter table public.shopping_lists drop column owner_email;

-- Kanały
create or replace function public.integration_status()
returns table (project_id uuid, provider text, yt_channel_id text, reporting_job_id text, reports_cursor timestamptz,
               last_sync_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select i.project_id, i.provider, i.yt_channel_id, i.reporting_job_id, i.reports_cursor, i.last_sync_at, i.last_error
    from public.integrations i;
end $$;

drop policy owner_all on public.settings;
alter table public.settings drop constraint settings_pkey;
delete from public.settings
  where owner_id <> (select user_id from public.user_roles where role = 'admin' order by granted_at limit 1);
alter table public.settings drop column owner_id;
alter table public.settings add primary key (id), add constraint settings_id_check check (id);
create policy owner_all on public.settings for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

do $$
declare t text;
begin
  foreach t in array array['gates', 'video_daily', 'weekly_stats', 'royalties', 'projects', 'tasks', 'subscriptions', 'content_items'] loop
    execute format('drop policy owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);
  end loop;
  foreach t in array array['video_traffic', 'video_search_terms', 'video_stats_hourly', 'pipeline_runs'] loop
    execute format('drop policy owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select public.is_owner()))', t);
  end loop;
  foreach t in array array['tasks', 'subscriptions', 'content_items', 'projects'] loop
    execute format('alter table public.%I drop column owner_id', t);
  end loop;
end
$$;
drop function public.owns_project(uuid);
drop function public.my_email();
