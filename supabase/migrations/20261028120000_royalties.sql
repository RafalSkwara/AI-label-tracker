-- Phase 6 of side-hustle-assistant: DistroKid royalties import.
-- Strictly additive: one new table and one new view. Nothing existing is altered.
-- Re-importing a file adds nothing: import_hash is unique and the app inserts with ON CONFLICT DO NOTHING.

create table public.royalties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sale_month date not null,
  store text null,
  title text null,
  isrc text null,
  country text null,
  quantity int not null default 0,
  earnings_usd numeric not null default 0,
  import_hash text not null unique,
  imported_at timestamptz not null default now()
);
create index royalties_project_month_idx on public.royalties (project_id, sale_month);

-- Monthly totals per project and track, so the app never has to page through every store/country row
create view public.v_royalties_month with (security_invoker = true) as
select project_id, sale_month, coalesce(title, '') as title,
       sum(quantity)::bigint as quantity, sum(earnings_usd) as earnings_usd
from public.royalties
group by project_id, sale_month, coalesce(title, '');

alter table public.royalties enable row level security;
create policy owner_all on public.royalties for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.royalties, public.v_royalties_month from anon;
revoke all on public.royalties, public.v_royalties_month from authenticated;
grant select, insert, update, delete on public.royalties to authenticated;
grant select on public.v_royalties_month to authenticated;
