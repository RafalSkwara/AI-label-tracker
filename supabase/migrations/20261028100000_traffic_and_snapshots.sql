-- Phase 7 of side-hustle-assistant: traffic sources, search terms and hourly view counters.
-- Strictly additive: three new tables and one new view. Nothing existing is altered.
-- Owner can read; writes only through the service-role (secret) key used by the sync.

create table public.video_traffic (
  project_id uuid not null references public.projects (id) on delete cascade,
  yt_video_id text not null,
  period_end date not null,
  source_type text not null,
  views int not null default 0,
  watch_minutes numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (yt_video_id, period_end, source_type)
);
create index video_traffic_project_idx on public.video_traffic (project_id, period_end);

create table public.video_search_terms (
  project_id uuid not null references public.projects (id) on delete cascade,
  yt_video_id text not null,
  period_end date not null,
  term text not null,
  views int not null default 0,
  primary key (yt_video_id, period_end, term)
);
create index video_search_terms_project_idx on public.video_search_terms (project_id, period_end);

create table public.video_stats_hourly (
  project_id uuid not null references public.projects (id) on delete cascade,
  yt_video_id text not null,
  taken_at timestamptz not null,
  view_count bigint not null,
  like_count int null,
  comment_count int null,
  primary key (yt_video_id, taken_at)
);
create index video_stats_hourly_project_idx on public.video_stats_hourly (project_id, taken_at);

create trigger touch before insert or update on public.video_traffic for each row execute function public.touch_updated_at();

-- Views in the last 24 h per video: the latest snapshot minus the newest snapshot at least 24 h older;
-- while less than 24 h of history exist, the oldest snapshot is used (the app shows the real span).
create view public.v_views_24h with (security_invoker = true) as
select l.project_id, l.yt_video_id, l.taken_at, l.view_count,
       b.taken_at as base_taken_at, b.view_count as base_view_count
from (
  select distinct on (yt_video_id) project_id, yt_video_id, taken_at, view_count
  from public.video_stats_hourly
  order by yt_video_id, taken_at desc
) l
left join lateral (
  select h.taken_at, h.view_count
  from public.video_stats_hourly h
  where h.yt_video_id = l.yt_video_id and h.taken_at < l.taken_at
  order by (h.taken_at <= l.taken_at - interval '24 hours') desc,
           case when h.taken_at <= l.taken_at - interval '24 hours' then h.taken_at end desc nulls last,
           h.taken_at asc
  limit 1
) b on true;

alter table public.video_traffic enable row level security;
alter table public.video_search_terms enable row level security;
alter table public.video_stats_hourly enable row level security;
create policy owner_read on public.video_traffic for select to authenticated using ((select public.is_owner()));
create policy owner_read on public.video_search_terms for select to authenticated using ((select public.is_owner()));
create policy owner_read on public.video_stats_hourly for select to authenticated using ((select public.is_owner()));
revoke all on public.video_traffic, public.video_search_terms, public.video_stats_hourly, public.v_views_24h from anon, authenticated;
grant select on public.video_traffic, public.video_search_terms, public.video_stats_hourly, public.v_views_24h to authenticated;
