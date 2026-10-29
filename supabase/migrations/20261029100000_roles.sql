-- household-supplies, phase 1: user roles (admin, dashboard, zapasy) enforced in the database.
-- Additive and safe to apply before the merge: the owner gets admin + dashboard in this same transaction,
-- so is_owner() stays true for the live app. No policy is touched; is_owner() now means "may use the dashboard".
-- Rollback: supabase/rollback/20261029100000_roles_down.sql (roll back the supplies migration first).

create type public.app_role as enum ('admin', 'dashboard', 'zapasy');

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid null default auth.uid() references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- admin passes every role check. Runs as its owner (postgres, bypasses RLS), so the user_roles policies below do not recurse.
create function public.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and (ur.role = r or ur.role = 'admin')
  )
$$;
revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated, service_role;

alter table public.user_roles enable row level security;
create policy roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy roles_admin_insert on public.user_roles for insert to authenticated
  with check ((select public.has_role('admin')));
create policy roles_admin_remove on public.user_roles for delete to authenticated
  using ((select public.has_role('admin')));
revoke all on public.user_roles from anon, authenticated;
grant select, insert, delete on public.user_roles to authenticated;

-- The last admin cannot be removed, also by a direct query. AFTER ROW: sees the final state of a multi-row statement.
-- The advisory lock serialises two admins removing each other in parallel transactions.
create function public.user_roles_keep_admin() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('user_roles_keep_admin'));
  if old.role = 'admin' and not exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'last admin' using errcode = 'P0001', hint = 'keep_admin';
  end if;
  return null;
end
$$;
revoke execute on function public.user_roles_keep_admin() from public, anon, authenticated;
create trigger user_roles_keep_admin after delete or update on public.user_roles
  for each row execute function public.user_roles_keep_admin();

-- First admin: the existing owner (matched by e-mail through app_owners; no e-mail literal here)
insert into public.user_roles (user_id, role, granted_by)
select u.id, r.role, null
from auth.users u
join public.app_owners o on o.email = lower(u.email)
cross join (values ('admin'::public.app_role), ('dashboard'::public.app_role)) r(role)
on conflict do nothing;

do $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'no owner found: refusing to leave the app without an admin';
  end if;
end
$$;

-- Same signature and ACL as before, so all 12 dashboard policies, integration_status() and requireOwner follow roles
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.has_role('dashboard') $$;
comment on function public.is_owner() is 'May use the dashboard (dashboard or admin role). Name kept from the old e-mail allow-list.';
