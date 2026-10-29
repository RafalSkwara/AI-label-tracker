-- Manual rollback of 20261029100000_roles.sql; apply only on the orchestrator's instruction (one transaction via apply_migration).
-- ORDER: if 20261029110000_supplies.sql is applied, roll it back FIRST: its policies depend on has_role(),
-- so the plain `drop function has_role` below fails loudly instead of silently stripping them (no cascade on purpose).
-- Roles granted since the migration are lost. Users invited meanwhile keep their auth.users rows; the old allow-list ignores them.

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_owners o where o.email = lower(auth.jwt() ->> 'email')) $$;
comment on function public.is_owner() is null;

drop trigger user_roles_keep_admin on public.user_roles;
drop function public.user_roles_keep_admin();
drop table public.user_roles;
drop function public.has_role(public.app_role);
drop type public.app_role;
