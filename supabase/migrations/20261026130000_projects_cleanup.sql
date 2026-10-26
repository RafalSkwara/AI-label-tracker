-- Phase 1 of side-hustle-assistant, CONTRACT step: apply AFTER the PR is merged, the Workers build
-- is deployed and the app is verified on the phone (the expand migration 20261026120000_projects.sql
-- must already be applied). Removes the compat layer: no data is lost, `projects` is kept.
-- Apply with apply_migration (single transaction), then check the app on the phone again.

-- Guard: refuse to drop channel_id while the two columns disagree anywhere
do $$
begin
  if exists (select 1 from public.content_items where channel_id is distinct from project_id)
     or exists (select 1 from public.weekly_stats where channel_id is distinct from project_id) then
    raise exception 'channel_id and project_id differ; reload all clients and resolve before applying cleanup';
  end if;
end $$;

-- Compat view and sync triggers
drop view public.channels;
drop trigger sync_project_channel on public.content_items;
drop trigger sync_project_channel on public.weekly_stats;
drop function public.sync_project_channel();

-- v_xp_events moves to project_id (same output columns, security_invoker kept)
create or replace view public.v_xp_events with (security_invoker = true) as
  select 'task'::text as kind, tasks.id::text as ref, tasks.title,
         coalesce(tasks.done_at, tasks.updated_at) as at, 10 as xp
    from public.tasks where tasks.done and tasks.archived_at is null
  union all
  select 'publish:' || content_items.kind as kind, content_items.id::text as ref, content_items.title,
         coalesce(content_items.live_at, content_items.publish_date::timestamptz, content_items.updated_at) as at,
         case content_items.kind when 'film' then 50 when 'EP' then 40 else 15 end as xp
    from public.content_items where content_items.status = 'live' and content_items.archived_at is null
  union all
  select 'week'::text as kind, weekly_stats.project_id::text || ':' || weekly_stats.week_start as ref,
         'Tydzień ' || to_char(weekly_stats.week_start::timestamptz, 'DD.MM') as title,
         weekly_stats.created_at as at, 5 as xp
    from public.weekly_stats where weekly_stats.archived_at is null;

-- weekly_stats: the primary key moves to (project_id, week_start)
alter table public.weekly_stats alter column project_id set not null;
alter table public.weekly_stats drop constraint weekly_stats_pkey;
alter table public.weekly_stats add constraint weekly_stats_pkey primary key using index weekly_stats_project_week_key;
alter table public.weekly_stats drop column channel_id;

-- content_items: drops channel_id together with its foreign key and index
alter table public.content_items drop column channel_id;
