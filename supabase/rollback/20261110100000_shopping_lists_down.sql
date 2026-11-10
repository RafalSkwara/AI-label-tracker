-- Rollback of 20261110100000_shopping_lists.sql. All shopping-list data is lost.

drop table public.shopping_items;
drop table public.shopping_lists;
drop function public.shopping_touch();
