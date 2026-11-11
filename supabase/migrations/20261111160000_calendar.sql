-- calendar: personal calendars shareable by e-mail (same model as shopping lists), events with simple recurrence
-- and optional push reminders (sent by the hourly cron; calendar_reminders_sent prevents duplicates).
-- Additive and safe to apply before the merge.
-- Rollback: supabase/rollback/20261111160000_calendar_down.sql

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text null,
  name text not null check (length(trim(name)) between 1 and 60),
  color smallint not null default 0 check (color between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
create index calendars_owner_idx on public.calendars (owner_id) where archived_at is null;

create table public.calendar_shares (
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (calendar_id, email)
);
create index calendar_shares_email_idx on public.calendar_shares (email);

-- Times are local (Europe/Warsaw). start_time null = all-day event.
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  starts_on date not null,
  start_time time null,
  end_time time null check (end_time is null or (start_time is not null and end_time >= start_time)),
  repeat text not null default 'none' check (repeat in ('none', 'weekly', 'monthly', 'yearly')),
  repeat_until date null check (repeat_until is null or repeat_until >= starts_on),
  remind_minutes int null check (remind_minutes is null or remind_minutes between 0 and 20160),
  note text null check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null
);
create index calendar_events_cal_idx on public.calendar_events (calendar_id, starts_on) where archived_at is null;

-- One row per sent reminder (event + occurrence day); written only by the Worker
create table public.calendar_reminders_sent (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  occurs_on date not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occurs_on)
);

create function public.calendar_access(c uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.calendars where id = c and owner_id = auth.uid())
      or exists (select 1 from public.calendar_shares where calendar_id = c and email = public.my_email())
$$;
create function public.calendar_owned(c uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.calendars where id = c and owner_id = auth.uid()) $$;
revoke execute on function public.calendar_access(uuid), public.calendar_owned(uuid) from public, anon;
grant execute on function public.calendar_access(uuid), public.calendar_owned(uuid) to authenticated;

-- Worker only: user ids of the owner and of every account a calendar is shared with
create function public.calendar_recipients(c uuid) returns table (user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select owner_id from public.calendars where id = c
  union
  select u.id from public.calendar_shares s join auth.users u on lower(u.email) = s.email where s.calendar_id = c
$$;
revoke execute on function public.calendar_recipients(uuid) from public, anon, authenticated;
grant execute on function public.calendar_recipients(uuid) to service_role;

-- updated_at; owner, owner_email, creator and created_at cannot be rewritten
create function public.calendar_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_table_name = 'calendars' then
    if tg_op = 'UPDATE' then
      new.owner_id := old.owner_id;
      new.owner_email := old.owner_email;
      new.created_at := old.created_at;
    else
      new.owner_email := public.my_email();
    end if;
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;
revoke execute on function public.calendar_touch() from public, anon, authenticated;
create trigger calendars_touch before insert or update on public.calendars
  for each row execute function public.calendar_touch();
create trigger calendar_events_touch before insert or update on public.calendar_events
  for each row execute function public.calendar_touch();

alter table public.calendars enable row level security;
alter table public.calendar_shares enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_reminders_sent enable row level security;

create policy cal_read on public.calendars for select to authenticated
  using (owner_id = (select auth.uid()) or public.calendar_access(id));
create policy cal_insert on public.calendars for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy cal_update on public.calendars for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy ev_read on public.calendar_events for select to authenticated
  using (public.calendar_access(calendar_id));
create policy ev_insert on public.calendar_events for insert to authenticated
  with check (created_by = (select auth.uid()) and public.calendar_access(calendar_id));
create policy ev_update on public.calendar_events for update to authenticated
  using (public.calendar_access(calendar_id)) with check (public.calendar_access(calendar_id));

create policy shares_read on public.calendar_shares for select to authenticated
  using (public.calendar_access(calendar_id));
create policy shares_insert on public.calendar_shares for insert to authenticated
  with check (created_by = (select auth.uid()) and public.calendar_owned(calendar_id) and email <> public.my_email());
create policy shares_remove on public.calendar_shares for delete to authenticated
  using (public.calendar_owned(calendar_id) or email = public.my_email());

revoke all on public.calendars, public.calendar_shares, public.calendar_events, public.calendar_reminders_sent from anon, authenticated;
grant select, insert, update on public.calendars, public.calendar_events to authenticated;
grant select, insert, delete on public.calendar_shares to authenticated;
