-- Trennt Vorab-Erinnerungen vom Versand am Jahrestag.
-- Nach migration-annual-email-log-context.sql und migration-annual-email-on-date.sql ausführen.

begin;

alter table public.annual_email_deliveries
  add column if not exists delivery_kind text,
  add column if not exists last_notified_at timestamptz;

-- Bestehende Protokolle nach Versandzeitpunkt klassifizieren. Ein Versuch am
-- jährlichen Ereignistag ist ein on_date-Versand; andere Alt-Einträge
-- bleiben Vorab-Erinnerungen. Das erhält bekannte Zustellungen und verhindert,
-- dass ein Vorabversand den separaten Jahrestag-Versand blockiert.
update public.annual_email_deliveries d
set delivery_kind = case
  when e.recurrence = 'annual'
   and coalesce(d.event_date, make_date(d.occurrence_year, e.event_month, e.event_day)) =
       (coalesce(d.sent_at, d.updated_at) at time zone 'Europe/Berlin')::date
    then 'on_date'
  else 'reminder'
end
from public.annual_email_events e
where d.event_id = e.id
  and d.delivery_kind is null;

alter table public.annual_email_deliveries
  alter column delivery_kind set default 'reminder',
  alter column delivery_kind set not null;

alter table public.annual_email_deliveries
  drop constraint if exists annual_email_deliveries_delivery_kind_check;
alter table public.annual_email_deliveries
  add constraint annual_email_deliveries_delivery_kind_check
  check (delivery_kind in ('reminder', 'on_date'));

alter table public.annual_email_deliveries
  drop constraint if exists annual_email_deliveries_event_id_occurrence_year_recipient_key;
alter table public.annual_email_deliveries
  drop constraint if exists annual_email_deliveries_event_occurrence_recipient_kind_key;
alter table public.annual_email_deliveries
  add constraint annual_email_deliveries_event_occurrence_recipient_kind_key
  unique (event_id, occurrence_year, recipient, delivery_kind);

notify pgrst, 'reload schema';
commit;
