-- Rollback of 20261111140000_push_subscriptions.sql. Every device has to enable notifications again.

drop table public.push_subscriptions;
