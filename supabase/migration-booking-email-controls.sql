-- Booking email controls and event-category suppression.
-- Run after migration-admin-config-audit-fix.sql and before migration-continuous-booking-series.sql.

begin;

create or replace function public.booking_is_event_category(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.categories c
     where c.id = p_category_id
       and lower(btrim(c.name)) = 'veranstaltung'
  );
$$;

create or replace function public.booking_mail_template_enabled(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'confirmation' then coalesce((select sc.mail_templates->'booking_confirmation'->>'enabled' from public.site_configuration sc where sc.singleton = true), 'true') <> 'false'
    when 'changed' then coalesce((select sc.mail_templates->'booking_changed'->>'enabled' from public.site_configuration sc where sc.singleton = true), 'true') <> 'false'
    when 'cancelled' then coalesce((select sc.mail_templates->'booking_cancelled'->>'enabled' from public.site_configuration sc where sc.singleton = true), 'true') <> 'false'
    when 'reminder' then coalesce((select sc.mail_templates->'booking_reminder'->>'enabled' from public.site_configuration sc where sc.singleton = true), 'true') <> 'false'
    else false
  end;
$$;
revoke all on function public.booking_is_event_category(uuid) from public, anon, authenticated;
revoke all on function public.booking_mail_template_enabled(text) from public, anon, authenticated;

-- Legacy templates without an enabled property remain active.
update public.site_configuration
   set mail_templates = coalesce(mail_templates, '{}'::jsonb)
     || jsonb_build_object(
          'booking_confirmation', coalesce(mail_templates->'booking_confirmation', '{}'::jsonb)
            || jsonb_build_object('enabled', coalesce(mail_templates->'booking_confirmation'->'enabled', 'true'::jsonb)),
          'booking_changed', coalesce(mail_templates->'booking_changed', '{}'::jsonb)
            || jsonb_build_object('enabled', coalesce(mail_templates->'booking_changed'->'enabled', 'true'::jsonb)),
          'booking_cancelled', coalesce(mail_templates->'booking_cancelled', '{}'::jsonb)
            || jsonb_build_object('enabled', coalesce(mail_templates->'booking_cancelled'->'enabled', 'true'::jsonb)),
          'booking_reminder', coalesce(mail_templates->'booking_reminder', '{}'::jsonb)
            || jsonb_build_object('enabled', coalesce(mail_templates->'booking_reminder'->'enabled', 'true'::jsonb))
        )
 where singleton = true;

create or replace function public.booking_change_log_and_notify()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_actor uuid := auth.uid();
  v_email text;
  v_recipient text;
  v_kind text;
  v_booking_id uuid;
  v_booking jsonb;
begin
  v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    insert into public.admin_audit_log(actor_id, actor_email, action, entity_type, entity_id, after_data)
    values (v_actor, v_email, 'created', 'booking', new.id::text, v_after);
    if not public.booking_is_event_category(new.category_id) then
      v_recipient := new.contact_email;
      v_kind := 'confirmation';
      v_booking_id := new.id;
      v_booking := v_after;
    end if;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if (v_after - 'updated_at' - 'updated_by' - 'reminder_sent_at') is distinct from
       (v_before - 'updated_at' - 'updated_by' - 'reminder_sent_at') then
      insert into public.admin_audit_log(actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
      values (v_actor, v_email, 'updated', 'booking', new.id::text, v_before, v_after);
    end if;
    if (new.title, new.resource_ids, new.category_id, new.starts_at, new.ends_at, new.contact_email, new.reminder_days)
       is distinct from (old.title, old.resource_ids, old.category_id, old.starts_at, old.ends_at, old.contact_email, old.reminder_days) then
      delete from public.booking_email_outbox where booking_id = old.id and status = 'pending';
    end if;
    if (new.title, new.resource_ids, new.category_id, new.starts_at, new.ends_at, new.contact_email)
       is distinct from (old.title, old.resource_ids, old.category_id, old.starts_at, old.ends_at, old.contact_email)
       and new.contact_email is not null
       and not public.booking_is_event_category(new.category_id) then
      v_recipient := new.contact_email;
      v_kind := 'changed';
      v_booking_id := new.id;
      v_booking := v_after || jsonb_build_object('previous', v_before);
    end if;
  else
    v_before := to_jsonb(old);
    delete from public.booking_email_outbox where booking_id = old.id and status = 'pending';
    insert into public.admin_audit_log(actor_id, actor_email, action, entity_type, entity_id, before_data)
    values (v_actor, v_email, 'deleted', 'booking', old.id::text, v_before);
    if not public.booking_is_event_category(old.category_id) then
      v_recipient := old.contact_email;
      v_kind := 'cancelled';
      v_booking_id := old.id;
      v_booking := v_before;
    end if;
  end if;

  if v_recipient is not null and v_recipient <> '' and public.booking_mail_template_enabled(v_kind) then
    insert into public.booking_email_outbox(booking_id, kind, recipient, payload)
    values (v_booking_id, v_kind, v_recipient, v_booking);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enqueue_due_booking_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  queued integer := 0;
begin
  for b in
    select bk.* from public.bookings bk
    where bk.reminder_days > 0
      and bk.contact_email is not null
      and bk.reminder_sent_at is null
      and bk.starts_at > now()
      and bk.starts_at <= now() + make_interval(days => bk.reminder_days)
      and not public.booking_is_event_category(bk.category_id)
      and public.booking_mail_template_enabled('reminder')
    order by bk.starts_at
    limit 100
    for update skip locked
  loop
    insert into public.booking_email_outbox(booking_id, kind, recipient, payload)
    values (b.id, 'reminder', b.contact_email, to_jsonb(b));
    update public.bookings set reminder_sent_at = now() where id = b.id;
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

create or replace function public.admin_update_mail_template(p_template_key text, p_template jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_enabled boolean;
begin
  if not public.is_admin() then
    raise exception 'Nur Administratoren koennen Mailvorlagen aendern.' using errcode = '42501';
  end if;
  if p_template_key is null or p_template_key not in ('booking_confirmation', 'booking_changed', 'booking_cancelled', 'booking_reminder') then
    raise exception 'Unbekannte Buchungs-E-Mail-Vorlage.' using errcode = '22023';
  end if;
  if p_template is null or jsonb_typeof(p_template) is distinct from 'object'
     or jsonb_typeof(p_template->'subject') is distinct from 'string'
     or jsonb_typeof(p_template->'body') is distinct from 'string' then
    raise exception 'Die Vorlage muss Betreff und Nachrichtentext enthalten.' using errcode = '22023';
  end if;
  if p_template ? 'enabled' and jsonb_typeof(p_template->'enabled') is distinct from 'boolean' then
    raise exception 'enabled muss ein boolescher Wert sein.' using errcode = '22023';
  end if;
  v_enabled := coalesce((p_template->>'enabled')::boolean, true);
  update public.site_configuration
     set mail_templates = jsonb_set(coalesce(mail_templates, '{}'::jsonb), array[p_template_key],
       jsonb_build_object('subject', p_template->'subject', 'body', p_template->'body', 'enabled', to_jsonb(v_enabled)), true)
   where singleton = true;
  if not found then
    raise exception 'Die Mailkonfiguration wurde nicht gefunden.' using errcode = 'P0002';
  end if;

  if not v_enabled then
    v_kind := case p_template_key
      when 'booking_confirmation' then 'confirmation'
      when 'booking_changed' then 'changed'
      when 'booking_cancelled' then 'cancelled'
      when 'booking_reminder' then 'reminder'
    end;
    delete from public.booking_email_outbox where kind = v_kind and status = 'pending';
  end if;
end;
$$;
revoke all on function public.admin_update_mail_template(text, jsonb) from public, anon;
grant execute on function public.admin_update_mail_template(text, jsonb) to authenticated;

alter table public.booking_email_outbox
  drop constraint if exists booking_email_outbox_status_check;
alter table public.booking_email_outbox
  add constraint booking_email_outbox_status_check check (status in ('pending','sending','sent','failed','skipped'));

-- Remove queued mail that is no longer eligible under the new rules.
delete from public.booking_email_outbox o
 using public.bookings b
 where o.booking_id = b.id
   and o.status = 'pending'
   and public.booking_is_event_category(b.category_id);

delete from public.booking_email_outbox o
 where o.status = 'pending'
   and not public.booking_mail_template_enabled(o.kind);

commit;
