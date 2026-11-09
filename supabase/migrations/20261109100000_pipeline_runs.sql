-- Automation run log: one row per GitHub Actions run of the Slowfall pipeline (build, approve, check).
-- Strictly additive. Rows are written by the workflows with the service-role key; the owner reads them.

create table public.pipeline_runs (
  run_id bigint not null,
  run_attempt int not null default 1,
  project_id uuid not null references public.projects (id) on delete cascade,
  workflow text not null check (workflow in ('build', 'approve', 'check')),
  status text not null check (status in ('running', 'success', 'failure', 'cancelled', 'skipped')),
  slug text null,
  video_id text null,
  detail text null,
  run_url text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (run_id, run_attempt)
);
create index pipeline_runs_project_idx on public.pipeline_runs (project_id, started_at desc);

create trigger touch before insert or update on public.pipeline_runs for each row execute function public.touch_updated_at();

alter table public.pipeline_runs enable row level security;
create policy owner_read on public.pipeline_runs for select to authenticated using ((select public.is_owner()));
revoke all on public.pipeline_runs from anon, authenticated;
grant select on public.pipeline_runs to authenticated;
