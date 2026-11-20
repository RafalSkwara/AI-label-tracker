-- Video jobs: one row per video made from the app ("Wideo"): CMV lyric videos, Shorts, music videos and
-- Slowfall Scenes long videos / Shorts. The app creates and edits rows; GitHub Actions in Slowfall-pipeline
-- render and upload them and write status back with the service-role key. Slowfall rows (one per scene)
-- are created by the pipeline's sync, which also reads each video's real state on YouTube.
-- Strictly additive. Rollback: supabase/rollback/20261120100000_video_jobs_down.sql

create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid null references public.projects (id) on delete set null,
  brand text not null check (brand in ('cmv', 'slowfall')),
  kind text not null check (kind in ('lyric', 'short', 'music_video', 'sf_long', 'sf_shorts')),
  title text not null check (length(title) between 1 and 200),
  slug text null,                             -- Slowfall scene folder (scenes/<slug>)
  status text not null default 'draft' check (status in
    ('draft', 'queued', 'running', 'ready', 'uploading', 'private', 'scheduled', 'published', 'failed', 'cancelled')),
  stage text null,                            -- current step, human readable ("Render 4K")
  progress int null check (progress between 0 and 100),
  checks jsonb not null default '[]',         -- [{key, label, ok, hint}] what must be in place before a render
  params jsonb not null default '{}',         -- render input: instructions, style, segment, formats, artist...
  meta jsonb not null default '{}',           -- YouTube: title, description, tags, privacy, publish_at, cleanup
  assets jsonb not null default '[]',         -- [{key, name, size, role}] uploaded inputs in R2
  outputs jsonb not null default '[]',        -- [{key, label, size, width, height, video_id, yt_status, removed_at}]
  run_id bigint null,
  run_url text null,
  error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  unique (owner_id, brand, kind, slug)
);
create index video_jobs_owner_idx on public.video_jobs (owner_id, created_at desc) where archived_at is null;

create trigger touch before insert or update on public.video_jobs for each row execute function public.touch_updated_at();

alter table public.video_jobs enable row level security;
create policy owner_all on public.video_jobs for all to authenticated
  using ((select public.is_owner()) and owner_id = (select auth.uid()))
  with check ((select public.is_owner()) and owner_id = (select auth.uid()) and (project_id is null or public.owns_project(project_id)));
revoke all on public.video_jobs from anon, authenticated;
grant select, insert, update on public.video_jobs to authenticated;
