-- Rollback of 20261111160000_calendar.sql. All calendar data is lost.

drop table public.calendar_reminders_sent;
drop table public.calendar_events;
drop table public.calendar_shares;
drop table public.calendars;
drop function public.calendar_touch();
drop function public.calendar_access(uuid);
drop function public.calendar_owned(uuid);
drop function public.calendar_recipients(uuid);
