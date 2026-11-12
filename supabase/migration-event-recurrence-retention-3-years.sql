-- Add one-time events while preserving existing annual events as the default.
-- Run after migration-annual-email-log-context.sql. The scheduled GitHub cleanup uses the Storage API
-- to delete files before it removes expired one-time event rows.

begin;

alter table public.annual_email_events
  add column if not exists recurrence text not null default 'annual',
  add column if not exists event_date date;

alter table public.annual_email_events
  drop constraint if exists annual_email_events_recurrence_date_valid;
alter table public.annual_email_events
  add constraint annual_email_events_recurrence_date_valid check (
    (recurrence = 'annual' and event_date is null)
    or (
      recurrence = 'once'
      and event_date is not null
      and event_month = extract(month from event_date)::smallint
      and event_day = extract(day from event_date)::smallint
    )
  );

create index if not exists annual_email_events_one_time_date_idx
  on public.annual_email_events (event_date)
  where recurrence = 'once';

grant delete on public.annual_email_events to service_role;

alter table public.annual_email_deliveries
  add column if not exists recurrence text not null default 'annual';

update public.annual_email_deliveries d
set recurrence = coalesce(d.recurrence, e.recurrence),
    event_title = coalesce(d.event_title, e.title),
    event_date = coalesce(
      d.event_date,
      case when e.recurrence = 'once' then e.event_date
           else make_date(d.occurrence_year, e.event_month, e.event_day)
      end
    )
from public.annual_email_events e
where d.event_id = e.id;

alter table public.annual_email_test_requests
  add column if not exists recurrence text not null default 'annual',
  add column if not exists event_date date;

update public.annual_email_test_requests r
set recurrence = coalesce(r.recurrence, e.recurrence),
    event_title = coalesce(r.event_title, e.title),
    event_date = coalesce(r.event_date, e.event_date),
    event_month = coalesce(r.event_month, e.event_month),
    event_day = coalesce(r.event_day, e.event_day)
from public.annual_email_events e
where r.event_id = e.id;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'vereinskalender-annual-event-retention-3-years';

select cron.schedule(
  'vereinskalender-annual-event-retention-3-years',
  '0 4 * * *',
  $job$
    do $cleanup$
    begin
      -- Keep annual definitions and future sends; prune only old occurrence logs.
      delete from public.annual_email_deliveries
      where event_date is not null
        and event_date < current_date - interval '3 years';

      -- Test request history is independent of the annual event definition.
      delete from public.annual_email_test_requests
      where requested_at < now() - interval '3 years';
    end
    $cleanup$;
  $job$
);

commit;
