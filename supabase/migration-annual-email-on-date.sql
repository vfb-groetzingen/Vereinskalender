-- Enable dedicated annual reminder emails on the configured calendar date.
-- Existing events keep their current pre-event reminder behavior (default false).

begin;

alter table public.annual_email_events
  add column if not exists email_on_date boolean not null default false;

create index if not exists annual_email_events_on_date_idx
  on public.annual_email_events (event_month, event_day)
  where active and email_on_date and recurrence = 'annual';

comment on column public.annual_email_events.email_on_date is
  'Send the saved annual reminder email on its configured annual date.';

commit;
