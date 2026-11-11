-- Speichert Ereignisname und betroffenes Datum direkt im Versandprotokoll.
-- Nach migration-annual-email-test-requests.sql ausführen.

begin;

alter table public.annual_email_deliveries
  add column if not exists event_title text,
  add column if not exists event_date date;

update public.annual_email_deliveries d
set event_title = coalesce(d.event_title, e.title),
    event_date = coalesce(d.event_date, make_date(d.occurrence_year, e.event_month, e.event_day))
from public.annual_email_events e
where d.event_id = e.id and (d.event_title is null or d.event_date is null);

alter table public.annual_email_test_requests
  add column if not exists event_title text,
  add column if not exists event_month smallint,
  add column if not exists event_day smallint;

update public.annual_email_test_requests r
set event_title = coalesce(r.event_title, e.title),
    event_month = coalesce(r.event_month, e.event_month),
    event_day = coalesce(r.event_day, e.event_day)
from public.annual_email_events e
where r.event_id = e.id and (r.event_title is null or r.event_month is null or r.event_day is null);

commit;
