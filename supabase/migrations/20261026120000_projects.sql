-- Phase 1 of side-hustle-assistant, EXPAND step: apply BEFORE merging the PR.
-- channels -> projects in place (PK, FKs, unique constraints, touch trigger, owner_all policy and
-- v_xp_events survive), plus gates, video_daily and v_video_recent.
-- Zero downtime: the live code keeps working through the compat view `channels` and the old
-- `channel_id` columns, which stay in place next to the new `project_id` ones and are kept in
-- sync by triggers. Both disappear in 20261026130000_projects_cleanup.sql (apply after the deploy
-- is verified on the phone).
-- Order: JSON backup of all tables -> apply_migration (single transaction, never piecewise) ->
-- counts (projects = 3, gates = 2) -> old app still works -> merge -> Workers build -> phone check ->
-- cleanup migration -> phone check.

-- 1. channels -> projects ---------------------------------------------------
alter table public.channels rename to projects;
alter index public.channels_pkey rename to projects_pkey;
alter index public.channels_slug_key rename to projects_slug_key;
alter index public.channels_yt_channel_id_key rename to projects_yt_channel_id_key;

alter table public.projects
  add column kind text not null default 'yt_channel' check (kind in ('yt_channel', 'artist', 'both')),
  add column status text not null default 'aktywny' check (status in ('aktywny', 'utrzymanie', 'planowany', 'zamknięty')),
  add column distrokid_artist text null,
  add column note text null,
  add column archived_at timestamptz null;

-- Compat view: the old name and exact old columns, auto-updatable (single table, no expressions)
create view public.channels with (security_invoker = true) as
  select id, slug, name, niche, yt_channel_id, created_at, updated_at from public.projects;
revoke all on public.channels from anon;
grant select, insert, update, delete on public.channels to authenticated;

-- 2. project_id next to channel_id --------------------------------------------
alter table public.content_items add column project_id uuid null references public.projects (id) on delete set null;
alter table public.weekly_stats add column project_id uuid null references public.projects (id) on delete cascade;
update public.content_items set project_id = channel_id;
update public.weekly_stats set project_id = channel_id;
create index content_items_project_id_idx on public.content_items (project_id);
create unique index weekly_stats_project_week_key on public.weekly_stats (project_id, week_start);

-- Keeps channel_id and project_id equal: a null side takes the other; on update the changed side wins
-- (project_id when both changed); on insert with both set, project_id wins.
create function public.sync_project_channel() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.project_id is not null then new.channel_id := new.project_id;
    else new.project_id := new.channel_id; end if;
  elsif new.project_id is distinct from old.project_id then new.channel_id := new.project_id;
  elsif new.channel_id is distinct from old.channel_id then new.project_id := new.channel_id;
  end if;
  return new;
end $$;
create trigger sync_project_channel before insert or update on public.content_items
  for each row execute function public.sync_project_channel();
create trigger sync_project_channel before insert or update on public.weekly_stats
  for each row execute function public.sync_project_channel();

alter table public.weekly_stats add column impressions int null;

alter table public.tasks add column project_id uuid null references public.projects (id) on delete set null;
alter table public.subscriptions add column project_id uuid null references public.projects (id) on delete set null;
create index tasks_project_id_idx on public.tasks (project_id);
create index subscriptions_project_id_idx on public.subscriptions (project_id);

-- 3. gates ------------------------------------------------------------------
create table public.gates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  due date not null,
  rules jsonb not null check (jsonb_typeof(rules) = 'array'),
  note text null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gates_project_id_idx on public.gates (project_id);
create trigger touch before insert or update on public.gates for each row execute function public.touch_updated_at();

-- 4. video_daily ------------------------------------------------------------
create table public.video_daily (
  yt_video_id text not null,
  date date not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  views int null,
  watch_minutes numeric null,
  subs_net int null,
  avd_sec numeric null,
  impressions int null,
  ctr_pct numeric null,
  updated_at timestamptz not null default now(),
  primary key (yt_video_id, date)
);
create index video_daily_project_date_idx on public.video_daily (project_id, date);
create trigger touch before insert or update on public.video_daily for each row execute function public.touch_updated_at();

-- 5. v_video_recent: one row per video, 35-day sums plus per-week totals ------
create view public.v_video_recent with (security_invoker = true) as
with d as (
  select project_id, yt_video_id, date, date_trunc('week', date)::date as week_start,
         coalesce(views, 0) as views, coalesce(watch_minutes, 0) as watch_minutes,
         coalesce(subs_net, 0) as subs_net, coalesce(impressions, 0) as impressions,
         coalesce(impressions, 0) * coalesce(ctr_pct, 0) / 100.0 as clicks
  from public.video_daily
  where date >= current_date - 35
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

-- 6. RLS --------------------------------------------------------------------
alter table public.gates enable row level security;
alter table public.video_daily enable row level security;
create policy owner_all on public.gates for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy owner_all on public.video_daily for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.gates, public.video_daily, public.v_video_recent from anon;
grant select, insert, update, delete on public.gates, public.video_daily to authenticated;
grant select on public.v_video_recent to authenticated;

-- 7. Data -------------------------------------------------------------------
update public.projects
set slug = 'slowfall-scenes', name = 'Slowfall Scenes', kind = 'yt_channel', status = 'aktywny',
    yt_channel_id = 'UCrAjgi48bJBW351SaIqi6Yw'
where slug = 'sceny-sezonowe';

insert into public.projects (slug, name, kind, distrokid_artist, status) values
  ('contents-may-vary', 'Contents May Vary', 'both', 'Contents May Vary', 'utrzymanie'),
  ('elektronika', 'Elektronika', 'artist', null, 'planowany');

update public.content_items set yt_video_id = 'Y1zTI-zy9HA' where legacy_id = 'i03';
update public.content_items set yt_video_id = 'yL4czbAFQ54' where legacy_id = 'i01';

insert into public.gates (project_id, title, due, rules)
select p.id, g.title, g.due::date, g.rules::jsonb
from public.projects p
join (values
  ('Bramka 1', '2026-12-05',
   '[{"rule":"ctr_last3_weighted","min_pct":3},{"rule":"impressions_wow_rising"}]'),
  ('Bramka F1', '2027-01-16',
   '[{"rule":"watch_hours_month_vs","month":"2027-01","vs":"2026-11"}]')
) as g (title, due, rules) on true
where p.slug = 'slowfall-scenes';

update public.tasks set project_id = (select id from public.projects where slug = 'elektronika')
where legacy_id in ('t07', 't25', 't26');

-- Slowfall channel work; account/tooling/legal tasks (t01, t02, t04-t06, t13, t14, t17) stay shared (null)
update public.tasks set project_id = (select id from public.projects where slug = 'slowfall-scenes')
where legacy_id in ('t03', 't08', 't09', 't10', 't11', 't15', 't16', 't18', 't19', 't20', 't21', 't22', 't23', 't24');

