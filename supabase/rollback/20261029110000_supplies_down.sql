-- Rollback of 20261029110000_supplies.sql. Run this BEFORE 20261029100000_roles_down.sql (supply_rw depends on has_role).
-- All supplies data is lost.

alter publication supabase_realtime drop table public.supply_tabs, public.supply_items;
drop table public.supply_items;
drop table public.supply_tabs;
drop function public.supply_touch();
