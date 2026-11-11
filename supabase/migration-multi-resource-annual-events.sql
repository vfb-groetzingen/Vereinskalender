-- Erweiterung: Buchungen mit mehreren Ressourcen sowie jährliche Ereignis-E-Mails.
-- Einmal im Supabase SQL Editor ausführen.

begin;

-- Mehrfachauswahl an Ressourcen je Buchung. resource_id bleibt als erstes/primäres
-- Element für Kompatibilität mit älteren Clients und Importen erhalten.
alter table public.bookings add column if not exists resource_ids uuid[] not null default '{}';
update public.bookings set resource_ids = array[resource_id] where cardinality(resource_ids) = 0;

create or replace function public.normalize_booking_resources()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.resource_id is distinct from old.resource_id
     and new.resource_ids is not distinct from old.resource_ids then
    new.resource_ids := array[new.resource_id];
  elsif new.resource_ids is null or cardinality(new.resource_ids) = 0 then
    new.resource_ids := array[new.resource_id];
  end if;
  if cardinality(new.resource_ids) <> (select count(distinct resource_id) from unnest(new.resource_ids) as resources(resource_id))
     or array_position(new.resource_ids, null) is not null then
    raise exception 'Ressourcen dürfen nicht doppelt oder leer sein' using errcode = '23514';
  end if;
  new.resource_id := new.resource_ids[1];
  if exists (
    select 1 from unnest(new.resource_ids) as selected(resource_id)
    left join public.resources r on r.id = selected.resource_id where r.id is null
  ) then
    raise exception 'Eine ausgewählte Ressource existiert nicht' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_resources_normalize on public.bookings;
create trigger bookings_resources_normalize
before insert or update of resource_id, resource_ids on public.bookings
for each row execute function public.normalize_booking_resources();

alter table public.bookings drop constraint if exists bookings_resource_ids_valid;
alter table public.bookings add constraint bookings_resource_ids_valid
  check (cardinality(resource_ids) > 0 and resource_ids[1] = resource_id);

create or replace view public.public_bookings as
  select b.id, x.resource_id, b.category_id, b.title, b.starts_at, b.ends_at, b.series_id
  from public.bookings b cross join lateral unnest(b.resource_ids) as x(resource_id);

grant select on public.public_bookings to anon, authenticated;

-- Jährliche E-Mail-Ereignisse (Bearbeiter und Administratoren).
create table if not exists public.annual_email_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  event_month smallint not null check (event_month between 1 and 12),
  event_day smallint not null check (
    event_day between 1 and extract(day from (date_trunc('month', make_date(2000, event_month, 1)) + interval '1 month - 1 day'))::int
  ),
  recipients text[] not null check (cardinality(recipients) between 1 and 10),
  subject text not null check (char_length(subject) between 1 and 200),
  body_html text not null check (char_length(body_html) <= 50000),
  assets jsonb not null default '[]'::jsonb check (jsonb_typeof(assets) = 'array'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.annual_email_deliveries (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.annual_email_events(id) on delete cascade,
  occurrence_year integer not null,
  recipient text not null,
  status text not null check (status in ('sending', 'sent', 'failed')),
  sent_at timestamptz,
  error text,
  updated_at timestamptz not null default now(),
  unique (event_id, occurrence_year, recipient)
);

create index if not exists annual_email_events_date_idx
  on public.annual_email_events (event_month, event_day) where active;

alter table public.annual_email_events enable row level security;
alter table public.annual_email_deliveries enable row level security;
revoke all on public.annual_email_events from anon;
revoke all on public.annual_email_deliveries from anon;
grant select, insert, update, delete on public.annual_email_events to authenticated;
grant select on public.annual_email_deliveries to authenticated;
grant select on public.annual_email_events to service_role;
grant select, insert, update, delete on public.annual_email_deliveries to service_role;
grant usage, select on sequence public.annual_email_deliveries_id_seq to service_role;

drop policy if exists annual_email_events_editor_all on public.annual_email_events;
create policy annual_email_events_editor_all on public.annual_email_events for all to authenticated
  using (public.is_editor()) with check (public.is_editor());
drop policy if exists annual_email_deliveries_editor_read on public.annual_email_deliveries;
create policy annual_email_deliveries_editor_read on public.annual_email_deliveries for select to authenticated
  using (public.is_editor());

-- Private Storage-Bucket für eingebettete Bilder und Anhänge.
insert into storage.buckets (id, name, public, file_size_limit)
values ('annual-event-files', 'annual-event-files', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

drop policy if exists annual_event_files_editor_read on storage.objects;
create policy annual_event_files_editor_read on storage.objects for select to authenticated
  using (bucket_id = 'annual-event-files' and public.is_editor());
drop policy if exists annual_event_files_editor_insert on storage.objects;
create policy annual_event_files_editor_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'annual-event-files' and public.is_editor());
drop policy if exists annual_event_files_editor_update on storage.objects;
create policy annual_event_files_editor_update on storage.objects for update to authenticated
  using (bucket_id = 'annual-event-files' and public.is_editor())
  with check (bucket_id = 'annual-event-files' and public.is_editor());
drop policy if exists annual_event_files_editor_delete on storage.objects;
create policy annual_event_files_editor_delete on storage.objects for delete to authenticated
  using (bucket_id = 'annual-event-files' and public.is_editor());

commit;
