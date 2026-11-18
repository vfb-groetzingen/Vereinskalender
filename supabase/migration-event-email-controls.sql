-- Per-event lifecycle email controls and durable outbox.
-- Run after migration-booking-email-controls.sql and before migration-continuous-booking-series.sql.

begin;

alter table public.annual_email_events
  add column if not exists confirmation_enabled boolean not null default false,
  add column if not exists changed_enabled boolean not null default false,
  add column if not exists cancelled_enabled boolean not null default false,
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_days smallint not null default 1,
  add column if not exists append_signature boolean not null default false;

alter table public.annual_email_events
  drop constraint if exists annual_email_events_reminder_days_valid;
alter table public.annual_email_events
  add constraint annual_email_events_reminder_days_valid check (reminder_days in (1, 2, 7));

create table if not exists public.annual_event_mail_outbox (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  event_title text not null,
  kind text not null check (kind in ('confirmation', 'changed', 'cancelled')),
  recipient text not null,
  event_date date,
  event_month smallint,
  event_day smallint,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now()
);

create index if not exists annual_event_mail_outbox_pending_idx
  on public.annual_event_mail_outbox (next_attempt_at, created_at)
  where status = 'pending';
create index if not exists annual_event_mail_outbox_event_log_idx
  on public.annual_event_mail_outbox (event_id, updated_at desc);

alter table public.annual_event_mail_outbox enable row level security;
revoke all on public.annual_event_mail_outbox from anon;
revoke all on public.annual_event_mail_outbox from authenticated;
grant select on public.annual_event_mail_outbox to authenticated;
grant select, insert, update on public.annual_event_mail_outbox to service_role;
grant usage, select on sequence public.annual_event_mail_outbox_id_seq to service_role;

drop policy if exists annual_event_mail_outbox_editor_read on public.annual_event_mail_outbox;
create policy annual_event_mail_outbox_editor_read on public.annual_event_mail_outbox
  for select to authenticated using (public.is_editor());

create or replace function public.enqueue_annual_event_lifecycle_email(p_event jsonb, p_kind text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_recipient text;
  v_inserted integer := 0;
  v_payload jsonb;
begin
  if p_kind not in ('confirmation', 'changed', 'cancelled') then
    raise exception 'Unbekannter Ereignis-Mailtyp.' using errcode = '22023';
  end if;
  if p_event is null or nullif(p_event->>'id', '') is null then
    raise exception 'Ereignis-Snapshot fehlt.' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object(
    'title', p_event->>'title',
    'recurrence', p_event->>'recurrence',
    'event_date', p_event->>'event_date',
    'event_month', p_event->>'event_month',
    'event_day', p_event->>'event_day',
    'body_html', p_event->>'body_html',
    'append_signature', coalesce((p_event->>'append_signature')::boolean, false),
    'sender_display_name', p_event->>'sender_display_name',
    'reply_to_email', p_event->>'reply_to_email',
    'previous', case when p_event ? 'previous' then jsonb_build_object(
      'title', p_event->'previous'->>'title',
      'recurrence', p_event->'previous'->>'recurrence',
      'event_date', p_event->'previous'->>'event_date',
      'event_month', p_event->'previous'->>'event_month',
      'event_day', p_event->'previous'->>'event_day'
    ) else null end,
    '_expected_updated_at', coalesce(p_event->>'_expected_updated_at', p_event->>'updated_at')
  );
  for v_recipient in
    select distinct btrim(value)
      from jsonb_array_elements_text(coalesce(p_event->'recipients', '[]'::jsonb)) as recipients(value)
     where btrim(value) <> ''
       and btrim(value) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  loop
    insert into public.annual_event_mail_outbox(event_id, event_title, kind, recipient, event_date, event_month, event_day, payload)
    values (
      (p_event->>'id')::uuid,
      left(coalesce(p_event->>'title', 'Ereignis'), 160),
      p_kind,
      v_recipient,
      nullif(p_event->>'event_date', '')::date,
      nullif(p_event->>'event_month', '')::smallint,
      nullif(p_event->>'event_day', '')::smallint,
      v_payload
    );
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$$;

create or replace function public.touch_annual_event_mail_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists annual_email_events_touch_updated_at on public.annual_email_events;
create trigger annual_email_events_touch_updated_at
before update on public.annual_email_events
for each row execute function public.touch_annual_event_mail_updated_at();

create or replace function public.annual_event_lifecycle_mail_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_content_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.active and new.confirmation_enabled then
      perform public.enqueue_annual_event_lifecycle_email(to_jsonb(new), 'confirmation');
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_content_changed :=
      (new.title, new.recurrence, new.event_date, new.event_month, new.event_day,
       new.recipients, new.subject, new.body_html, new.assets, new.document_ids,
       new.sender_profile_id, new.sender_display_name, new.reply_to_email)
      is distinct from
      (old.title, old.recurrence, old.event_date, old.event_month, old.event_day,
       old.recipients, old.subject, old.body_html, old.assets, old.document_ids,
       old.sender_profile_id, old.sender_display_name, old.reply_to_email);

    -- A pending message based on an earlier event state must not be sent later.
    delete from public.annual_event_mail_outbox
     where event_id = old.id and status = 'pending'
       and (not new.active
         or (kind = 'confirmation' and not new.confirmation_enabled)
         or (kind = 'changed' and not new.changed_enabled)
         or (kind = 'cancelled' and not new.cancelled_enabled));

    if old.active and not new.active then
      delete from public.annual_event_mail_outbox
       where event_id = old.id and status = 'pending';
      if new.cancelled_enabled then
        perform public.enqueue_annual_event_lifecycle_email(
          v_old || jsonb_build_object('_expected_updated_at', new.updated_at), 'cancelled'
        );
      end if;
    elsif not old.active and new.active then
      if new.confirmation_enabled then
        perform public.enqueue_annual_event_lifecycle_email(v_new, 'confirmation');
      end if;
    elsif new.active and v_content_changed then
      delete from public.annual_event_mail_outbox
       where event_id = old.id and status = 'pending';
      if new.changed_enabled then
        perform public.enqueue_annual_event_lifecycle_email(v_new || jsonb_build_object('previous', v_old), 'changed');
      end if;
    end if;
    return new;
  else
    v_old := to_jsonb(old);
    delete from public.annual_event_mail_outbox
     where event_id = old.id and status = 'pending';
    if old.active and old.cancelled_enabled then
      perform public.enqueue_annual_event_lifecycle_email(v_old, 'cancelled');
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists annual_email_events_lifecycle_mail_trg on public.annual_email_events;
create trigger annual_email_events_lifecycle_mail_trg
after insert or update or delete on public.annual_email_events
for each row execute function public.annual_event_lifecycle_mail_trigger();

create or replace function public.claim_annual_event_mail_outbox(p_limit integer default 25)
returns setof public.annual_event_mail_outbox language plpgsql security definer set search_path = public as $$
declare
  item public.annual_event_mail_outbox;
begin
  for item in
    select * from public.annual_event_mail_outbox
     where status = 'pending' and next_attempt_at <= now()
     order by created_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  loop
    update public.annual_event_mail_outbox
       set status = 'sending', error = null, updated_at = now(), attempt_count = attempt_count + 1
     where id = item.id
     returning * into item;
    return next item;
  end loop;
  return;
end;
$$;

revoke all on function public.enqueue_annual_event_lifecycle_email(jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_annual_event_mail_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_annual_event_mail_outbox(integer) to service_role;

-- Keep event lifecycle mail payloads and their personal data for at most three years.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'vereinskalender-event-mail-outbox-retention-3-years';
select cron.schedule(
  'vereinskalender-event-mail-outbox-retention-3-years',
  '30 5 * * *',
  $job$delete from public.annual_event_mail_outbox where created_at < now() - interval '3 years';$job$
);

commit;
