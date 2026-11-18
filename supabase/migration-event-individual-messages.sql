-- Explicit one-off individual event messages to all saved recipients.
-- Run after migration-event-email-controls.sql and before migration-continuous-booking-series.sql.

begin;

alter table public.annual_event_mail_outbox
  drop constraint if exists annual_event_mail_outbox_kind_check;
alter table public.annual_event_mail_outbox
  add constraint annual_event_mail_outbox_kind_check
  check (kind in ('confirmation', 'changed', 'cancelled', 'individual'));

create or replace function public.queue_annual_event_individual_message(p_event_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  e public.annual_email_events;
  v_recipient text;
  v_payload jsonb;
  v_queued integer := 0;
begin
  if not public.is_editor() then
    raise exception 'Keine Berechtigung zum Versenden von Ereignis-Nachrichten.' using errcode = '42501';
  end if;

  select * into e
    from public.annual_email_events
   where id = p_event_id
   for update;
  if not found then
    raise exception 'Das gespeicherte Ereignis wurde nicht gefunden.' using errcode = 'P0002';
  end if;
  if not e.active then
    raise exception 'Das Ereignis ist pausiert. Aktiviere und speichere es vor dem Versand.' using errcode = '22023';
  end if;
  if nullif(btrim(e.subject), '') is null or nullif(btrim(regexp_replace(e.body_html, '<[^>]*>', '', 'g')), '') is null then
    raise exception 'Betreff und Nachricht müssen vor dem Versand gespeichert sein.' using errcode = '22023';
  end if;
  if cardinality(e.recipients) < 1 then
    raise exception 'Für dieses Ereignis sind keine Empfänger gespeichert.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(e.recipients) as r(email)
     where btrim(r.email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Mindestens eine gespeicherte Empfängeradresse ist ungültig.' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'subject', e.subject,
    'body_html', e.body_html,
    'recurrence', e.recurrence,
    'event_date', e.event_date,
    'event_month', e.event_month,
    'event_day', e.event_day,
    'assets', e.assets,
    'document_ids', e.document_ids,
    'append_signature', e.append_signature,
    'sender_display_name', e.sender_display_name,
    'reply_to_email', e.reply_to_email,
    '_expected_updated_at', e.updated_at
  );

  for v_recipient in
    select distinct on (lower(btrim(r.email))) btrim(r.email)
      from unnest(e.recipients) with ordinality as r(email, position)
     order by lower(btrim(r.email)), r.position
  loop
    insert into public.annual_event_mail_outbox(
      event_id, event_title, kind, recipient, event_date, event_month, event_day, payload
    ) values (
      e.id, e.title, 'individual', v_recipient, e.event_date,
      e.event_month, e.event_day, v_payload
    );
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$$;

revoke all on function public.queue_annual_event_individual_message(uuid) from public, anon, authenticated;
grant execute on function public.queue_annual_event_individual_message(uuid) to authenticated;

commit;
