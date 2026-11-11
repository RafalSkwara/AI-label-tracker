-- push notifications (subscription renewals): one row per browser/device push subscription.
-- Written and read only by the Worker (service role) after it checks the caller's token: RLS on, no policies, no grants.
-- Additive and safe to apply before the merge.
-- Rollback: supabase/rollback/20261111140000_push_subscriptions_down.sql

create table public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz null,
  failed_count int not null default 0,
  archived_at timestamptz null
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where archived_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
