-- Manual rollback for EXPAND only (20261026120000_projects.sql); apply only on the orchestrator's
-- instruction, never auto-applied (this folder is outside supabase/migrations).
-- Not valid after the CONTRACT migration (20261026130000_projects_cleanup.sql) has been applied.
-- Data entered in the new tables, columns and projects since EXPAND is lost; take a JSON backup first.
-- Run as one transaction (apply_migration).

-- Data section
update public.content_items set yt_video_id = null where legacy_id = 'i03';  -- i01 already had its id before EXPAND
delete from public.projects where slug in ('contents-may-vary', 'elektronika');
update public.projects set slug = 'sceny-sezonowe', name = 'Sceny sezonowe', yt_channel_id = null where slug = 'slowfall-scenes';

-- Compat layer (the view must go before the table can take the name back)
drop view public.channels;
drop trigger sync_project_channel on public.content_items;
drop trigger sync_project_channel on public.weekly_stats;
drop function public.sync_project_channel();
drop index public.weekly_stats_project_week_key;
drop index public.content_items_project_id_idx;
alter table public.content_items drop column project_id;
alter table public.weekly_stats drop column project_id;
alter table public.weekly_stats drop column impressions;

-- New tables and columns
drop view public.v_video_recent;
drop table public.video_daily;
drop table public.gates;
drop index public.tasks_project_id_idx;
drop index public.subscriptions_project_id_idx;
alter table public.tasks drop column project_id;
alter table public.subscriptions drop column project_id;
alter table public.projects
  drop column kind, drop column status, drop column distrokid_artist, drop column note, drop column archived_at;

-- projects -> channels
alter table public.projects rename to channels;
alter index public.projects_pkey rename to channels_pkey;
alter index public.projects_slug_key rename to channels_slug_key;
alter index public.projects_yt_channel_id_key rename to channels_yt_channel_id_key;
