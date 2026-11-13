-- Configuration, event document library, filtered admin history and booking notifications.
-- Run after migration-event-recurrence-retention-3-years.sql.

begin;

alter table public.resources
  add column if not exists is_active boolean not null default true;

alter table public.bookings
  add column if not exists contact_email text,
  add column if not exists reminder_days smallint not null default 0,
  add column if not exists reminder_sent_at timestamptz;

alter table public.bookings drop constraint if exists bookings_reminder_days_valid;
alter table public.bookings add constraint bookings_reminder_days_valid
  check (reminder_days in (0, 1, 2, 7));
alter table public.bookings drop constraint if exists bookings_contact_email_valid;
alter table public.bookings add constraint bookings_contact_email_valid
  check (contact_email is null or char_length(contact_email) between 3 and 254);

alter table public.annual_email_events
  add column if not exists sender_profile_id text,
  add column if not exists sender_display_name text,
  add column if not exists reply_to_email text,
  add column if not exists document_ids uuid[] not null default '{}';

create table if not exists public.site_configuration (
  singleton boolean primary key default true check (singleton),
  mail_profiles jsonb not null default '[{"id":"default","label":"VfB Grötzingen","display_name":"VfB Grötzingen","reply_to":"vfb-app@vfb-groetzingen.de"}]'::jsonb,
  mail_templates jsonb not null default '{}'::jsonb,
  admin_navigation jsonb not null default '[]'::jsonb,
  configuration_navigation jsonb not null default '[]'::jsonb,
  event_signature_html text not null default '<p>Mit freundlichen Grüßen<br>VfB Grötzingen</p><p>Internet: <a href="http://www.vfb-groetzingen.de/">http://www.vfb-groetzingen.de/</a></p>',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (jsonb_typeof(mail_profiles) = 'array'),
  check (jsonb_typeof(mail_templates) = 'object'),
  check (jsonb_typeof(admin_navigation) = 'array'),
  check (jsonb_typeof(configuration_navigation) = 'array')
);

insert into public.site_configuration (singleton, mail_profiles, mail_templates, admin_navigation, configuration_navigation)
values (
  true,
  '[{"id":"default","label":"VfB Grötzingen","display_name":"VfB Grötzingen","reply_to":"vfb-app@vfb-groetzingen.de"}]'::jsonb,
  '{
    "booking_confirmation":{"subject":"Buchungsbestätigung: {{title}}","body":"Guten Tag,\n\nIhre Buchung wurde eingetragen.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}"},
    "booking_changed":{"subject":"Änderung Ihrer Buchung: {{title}}","body":"Guten Tag,\n\nIhre Buchung wurde geändert.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}"},
    "booking_cancelled":{"subject":"Absage Ihrer Buchung: {{title}}","body":"Guten Tag,\n\nIhre Buchung wurde abgesagt.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}"},
    "booking_reminder":{"subject":"Erinnerung: {{title}}","body":"Guten Tag,\n\nhiermit erinnern wir an Ihre bevorstehende Buchung.\n\nTermin: {{title}}\nDatum: {{date}}\nZeit: {{time_range}}\nOrt: {{resource_names}}\n\n{{signature}}"}
  }'::jsonb,
  '[{"id":"users","label":"Benutzer und Einladungen","enabled":true,"order":1},{"id":"resources","label":"Räume und Plätze","enabled":true,"order":2},{"id":"audit","label":"Termin-Änderungsprotokoll","enabled":true,"order":3},{"id":"config","label":"Konfiguration","enabled":true,"order":4}]'::jsonb,
  '[{"id":"general","label":"Allgemein","enabled":true,"order":1},{"id":"mail","label":"Mailprofile und Vorlagen","enabled":true,"order":2},{"id":"texts","label":"Besucherseiten","enabled":true,"order":3},{"id":"legal","label":"Impressum und Datenschutz","enabled":true,"order":4},{"id":"documents","label":"Dokumentenablage","enabled":true,"order":5},{"id":"navigation","label":"Navigation","enabled":true,"order":6},{"id":"calendar","label":"Kalender abonnieren","enabled":true,"order":7}]'::jsonb
)
on conflict (singleton) do nothing;

create table if not exists public.public_site_content (
  singleton boolean primary key default true check (singleton),
  home_title text not null default 'Räume und Plätze auf einen Blick',
  home_intro text not null default 'Alle Termine sind ohne Anmeldung einsehbar. Änderungen sind nur für berechtigte Mitglieder möglich.',
  rooms_title text not null default 'Raumkalender',
  rooms_intro text not null default 'Jeder Raum hat einen dauerhaften Link und einen QR-Code, der direkt zum Kalender führt.',
  plan_title text not null default 'Belegungsplan',
  plan_intro text not null default 'Plätze und Räume nach Datum und Uhrzeit. Farbe = Rubrik, linker Rand = Kategorie.',
  calendar_help text not null default 'Kopiere den schreibgeschützten iCalendar-Link und füge ihn in deinem Kalenderprogramm unter „Kalender abonnieren“ oder „Kalender aus URL“ ein. Änderungen werden dort regelmäßig automatisch aktualisiert.',
  impressum_text text not null default $impressum$Vorlage: Die Angaben nach § 5 DDG müssen vor der Veröffentlichung vollständig ergänzt werden.

Angaben gemäß § 5 DDG
[Vollständiger Vereinsname]
[Straße und Hausnummer]
[PLZ und Ort]

Vertreten durch: [Vorstand, Name]

Kontakt: E-Mail [Adresse], Telefon [Nummer]

Verantwortlich für den Inhalt: [Name und Anschrift]

Die Angaben in eckigen Klammern bitte vervollständigen.$impressum$,
  datenschutz_text text not null default $datenschutz$Vorlage: Vor der Veröffentlichung durch Verein oder Vorstand prüfen und vervollständigen.

Verantwortlicher: [Name des Vereins], [Anschrift], [E-Mail-Adresse]

Verarbeitet werden technische Zugriffsdaten, Anmeldedaten und die im Kalender eingetragenen Termine. Titel, Zeit, Ressource und Kategorie sind öffentlich; interne Notizen und Kontaktangaben sind nur berechtigten Mitgliedern zugänglich.

Dienstleister: GitHub Pages, Supabase und Strato SMTP. Auftragsverarbeitungsverträge und Speicherfristen bitte prüfen und ergänzen.

Betroffenenrechte: Auskunft, Berichtigung, Löschung, Einschränkung und Widerspruch. Kontakt: [Kontaktadresse].

Bitte die Datenschutzerklärung rechtlich prüfen lassen.$datenschutz$,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.public_site_content (singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.event_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  file_name text not null check (char_length(file_name) between 1 and 200),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size integer not null check (file_size between 1 and 5242880),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create or replace function public.prevent_removing_used_event_document()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.annual_email_events e where old.id = any(e.document_ids)) then
    raise exception 'Dieses Dokument ist noch einem Ereignis zugeordnet. Entferne es zuerst aus dem Ereignis.' using errcode = '23503';
  end if;
  return old;
end;
$$;
drop trigger if exists event_documents_prevent_used_delete_trg on public.event_documents;
create trigger event_documents_prevent_used_delete_trg before delete on public.event_documents
for each row execute function public.prevent_removing_used_event_document();

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb
);
create index if not exists admin_audit_log_occurred_idx on public.admin_audit_log (occurred_at desc);
create index if not exists admin_audit_log_entity_idx on public.admin_audit_log (entity_type, action, occurred_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon;
grant select on public.admin_audit_log to authenticated, service_role;
drop policy if exists admin_audit_admin_read on public.admin_audit_log;
create policy admin_audit_admin_read on public.admin_audit_log for select to authenticated using (public.is_admin());

alter table public.site_configuration enable row level security;
revoke all on public.site_configuration from anon;
grant select, update on public.site_configuration to authenticated;
grant select, update on public.site_configuration to service_role;
drop policy if exists site_configuration_editor_read on public.site_configuration;
create policy site_configuration_editor_read on public.site_configuration for select to authenticated using (public.is_editor());
drop policy if exists site_configuration_admin_update on public.site_configuration;
create policy site_configuration_admin_update on public.site_configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.public_site_content enable row level security;
revoke all on public.public_site_content from anon, authenticated;
grant select (singleton, home_title, home_intro, rooms_title, rooms_intro, plan_title, plan_intro, calendar_help, impressum_text, datenschutz_text)
  on public.public_site_content to anon, authenticated;
grant update (home_title, home_intro, rooms_title, rooms_intro, plan_title, plan_intro, calendar_help, impressum_text, datenschutz_text)
  on public.public_site_content to authenticated;
drop policy if exists public_site_content_public_read on public.public_site_content;
create policy public_site_content_public_read on public.public_site_content for select using (true);
drop policy if exists public_site_content_admin_update on public.public_site_content;
create policy public_site_content_admin_update on public.public_site_content for update to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.event_documents enable row level security;
revoke all on public.event_documents from anon;
grant select on public.event_documents to authenticated;
grant insert, update, delete on public.event_documents to authenticated;
grant select, insert, update, delete on public.event_documents to service_role;
drop policy if exists event_documents_editor_read on public.event_documents;
create policy event_documents_editor_read on public.event_documents for select to authenticated using (public.is_editor());
drop policy if exists event_documents_admin_write on public.event_documents;
create policy event_documents_admin_write on public.event_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-documents', 'event-documents', false, 5242880, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists event_documents_storage_editor_read on storage.objects;
create policy event_documents_storage_editor_read on storage.objects for select to authenticated using (bucket_id = 'event-documents' and public.is_editor());
drop policy if exists event_documents_storage_admin_insert on storage.objects;
create policy event_documents_storage_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'event-documents' and public.is_admin());
drop policy if exists event_documents_storage_admin_update on storage.objects;
create policy event_documents_storage_admin_update on storage.objects for update to authenticated using (bucket_id = 'event-documents' and public.is_admin()) with check (bucket_id = 'event-documents' and public.is_admin());
drop policy if exists event_documents_storage_admin_delete on storage.objects;
create policy event_documents_storage_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'event-documents' and public.is_admin());

create table if not exists public.booking_email_outbox (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid,
  kind text not null check (kind in ('confirmation','changed','cancelled','reminder')),
  recipient text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now()
);
alter table public.booking_email_outbox
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now();
create index if not exists booking_email_outbox_pending_idx on public.booking_email_outbox (created_at) where status = 'pending';
alter table public.booking_email_outbox enable row level security;
revoke all on public.booking_email_outbox from anon, authenticated;
grant select, insert, update on public.booking_email_outbox to service_role;

create or replace function public.set_booking_audit_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_audit_trg on public.bookings;
create trigger bookings_audit_trg before insert or update on public.bookings
for each row execute function public.set_booking_audit_fields();

create or replace function public.reset_booking_reminder()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.starts_at, new.ends_at, new.contact_email, new.reminder_days)
     is distinct from (old.starts_at, old.ends_at, old.contact_email, old.reminder_days) then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_reset_reminder_trg on public.bookings;
create trigger bookings_reset_reminder_trg before update on public.bookings
for each row execute function public.reset_booking_reminder();

create or replace function public.record_admin_change()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_id text;
  v_actor uuid := auth.uid();
  v_email text;
  v_entity text := tg_table_name;
  v_action text;
begin
  v_email := coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'), null);
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_id := coalesce(v_after->>'id', v_after->>'singleton', 'true');
    v_action := 'created';
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if (new.title, new.resource_ids, new.category_id, new.starts_at, new.ends_at, new.contact_email, new.reminder_days)
       is distinct from (old.title, old.resource_ids, old.category_id, old.starts_at, old.ends_at, old.contact_email, old.reminder_days) then
      delete from public.booking_email_outbox where booking_id = old.id and status = 'pending';
    end if;
    v_id := coalesce(v_after->>'id', v_after->>'singleton', 'true');
    v_action := 'updated';
  else
    v_before := to_jsonb(old);
    v_id := coalesce(v_before->>'id', v_before->>'singleton', 'true');
    v_action := 'deleted';
  end if;
  insert into public.admin_audit_log(actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
  values (v_actor, v_email, v_action, v_entity, v_id, v_before, v_after);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
    v_recipient := new.contact_email;
    v_kind := 'confirmation';
    v_booking_id := new.id;
    v_booking := v_after;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if (v_after - 'updated_at' - 'updated_by' - 'reminder_sent_at') is distinct from
       (v_before - 'updated_at' - 'updated_by' - 'reminder_sent_at') then
      insert into public.admin_audit_log(actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
      values (v_actor, v_email, 'updated', 'booking', new.id::text, v_before, v_after);
    end if;
    if (new.title, new.resource_ids, new.category_id, new.starts_at, new.ends_at, new.contact_email)
       is distinct from (old.title, old.resource_ids, old.category_id, old.starts_at, old.ends_at, old.contact_email)
       and new.contact_email is not null then
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
    v_recipient := old.contact_email;
    v_kind := 'cancelled';
    v_booking_id := old.id;
    v_booking := v_before;
  end if;

  if v_recipient is not null and v_recipient <> '' then
    insert into public.booking_email_outbox(booking_id, kind, recipient, payload)
    values (v_booking_id, v_kind, v_recipient, v_booking);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists bookings_change_log_notify_trg on public.bookings;
create trigger bookings_change_log_notify_trg after insert or update or delete on public.bookings
for each row execute function public.booking_change_log_and_notify();

create or replace function public.touch_configuration_updated_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists site_configuration_touch_trg on public.site_configuration;
create trigger site_configuration_touch_trg before update on public.site_configuration
for each row execute function public.touch_configuration_updated_fields();
drop trigger if exists public_site_content_touch_trg on public.public_site_content;
create trigger public_site_content_touch_trg before update on public.public_site_content
for each row execute function public.touch_configuration_updated_fields();

drop trigger if exists site_configuration_audit_trg on public.site_configuration;
create trigger site_configuration_audit_trg after update on public.site_configuration
for each row execute function public.record_admin_change();
drop trigger if exists public_site_content_audit_trg on public.public_site_content;
create trigger public_site_content_audit_trg after update on public.public_site_content
for each row execute function public.record_admin_change();
drop trigger if exists event_documents_audit_trg on public.event_documents;
create trigger event_documents_audit_trg after insert or update or delete on public.event_documents
for each row execute function public.record_admin_change();

create or replace function public.admin_delete_event_document(p_document_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'Nur Administratoren können Dokumente löschen.' using errcode = '42501';
  end if;
  delete from public.event_documents where id = p_document_id returning storage_path into v_path;
  if v_path is null then raise exception 'Dokument nicht gefunden.' using errcode = 'P0002'; end if;
  return v_path;
end;
$$;
revoke all on function public.admin_delete_event_document(uuid) from public, anon;
grant execute on function public.admin_delete_event_document(uuid) to authenticated;

create or replace function public.enqueue_due_booking_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  queued integer := 0;
begin
  for b in
    select * from public.bookings
    where reminder_days > 0
      and contact_email is not null
      and reminder_sent_at is null
      and starts_at > now()
      and starts_at <= now() + make_interval(days => reminder_days)
    order by starts_at
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

create or replace function public.claim_booking_email_outbox(p_limit integer default 25)
returns setof public.booking_email_outbox language plpgsql security definer set search_path = public as $$
declare
  item public.booking_email_outbox;
begin
  for item in
    select * from public.booking_email_outbox
    where status = 'pending' and next_attempt_at <= now()
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  loop
    update public.booking_email_outbox
    set status = 'sending', error = null, updated_at = now(), attempt_count = attempt_count + 1
    where id = item.id returning * into item;
    return next item;
  end loop;
  return;
end;
$$;

revoke all on function public.enqueue_due_booking_reminders() from public, anon, authenticated;
revoke all on function public.claim_booking_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.enqueue_due_booking_reminders() to service_role;
grant execute on function public.claim_booking_email_outbox(integer) to service_role;

commit;