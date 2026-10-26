-- Phase 3 of side-hustle-assistant: YouTube sync storage. Additive only: one new table, one new
-- function, and a replacement of the v_video_recent view with the same columns (42 days instead of 35,
-- so four complete weeks always fit). Safe to apply before the PR is merged.

create table public.integrations (
  project_id uuid not null references public.projects (id) on delete cascade,
  provider text not null check (provider in ('youtube')),
  yt_channel_id text null,
  refresh_token text not null,
  reporting_job_id text null,
  reports_cursor timestamptz null,
  last_sync_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, provider)
);
create trigger touch before insert or update on public.integrations for each row execute function public.touch_updated_at();

-- Tokens are reachable only with the secret (service-role) key: RLS on, no policies, no grants
alter table public.integrations enable row level security;
revoke all on public.integrations from anon, authenticated;

-- Everything except the token, for the owner's browser
create function public.integration_status()
returns table (project_id uuid, provider text, yt_channel_id text, reporting_job_id text, reports_cursor timestamptz,
               last_sync_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select i.project_id, i.provider, i.yt_channel_id, i.reporting_job_id, i.reports_cursor, i.last_sync_at, i.last_error
    from public.integrations i;
end $$;
revoke all on function public.integration_status() from public, anon;
grant execute on function public.integration_status() to authenticated;

-- v_video_recent: same shape as before, window widened from 35 to 42 days
create or replace view public.v_video_recent with (security_invoker = true) as
with d as (
  select project_id, yt_video_id, date, date_trunc('week', date)::date as week_start,
         coalesce(views, 0) as views, coalesce(watch_minutes, 0) as watch_minutes,
         coalesce(subs_net, 0) as subs_net, coalesce(impressions, 0) as impressions,
         coalesce(impressions, 0) * coalesce(ctr_pct, 0) / 100.0 as clicks
  from public.video_daily
  where date >= current_date - 42
), w as (
  select project_id, yt_video_id, week_start,
         sum(views) as views, sum(watch_minutes) as watch_minutes, sum(subs_net) as subs_net,
         sum(impressions) as impressions, sum(clicks) as clicks
  from d group by project_id, yt_video_id, week_start
)
select project_id, yt_video_id,
       sum(views)::int as views,
       sum(watch_minutes) as watch_minutes,
       sum(subs_net)::int as subs_net,
       sum(impressions)::int as impressions,
       sum(clicks) as clicks,
       jsonb_agg(jsonb_build_object(
         'week_start', week_start, 'views', views, 'watch_minutes', watch_minutes, 'subs_net', subs_net,
         'impressions', impressions, 'clicks', clicks) order by week_start) as weeks
from w group by project_id, yt_video_id;
