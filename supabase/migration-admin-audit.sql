begin;

-- Vereinskalender: Admin-Bereich, Archivierung und Termin-Audit-Log
-- Im bestehenden Supabase-Projekt einmalig im SQL Editor ausführen.

alter table public.resources
  add column if not exists is_active boolean not null default true;
alter table public.resources
  add column if not exists sort_order integer not null default 0;

-- Give existing rows a stable initial position; administrators can change it in the UI.
with ranked_resources as (
  select id, row_number() over (partition by type order by name, id)::integer as initial_order
  from public.resources
)
update public.resources r
set sort_order = ranked_resources.initial_order
from ranked_resources
where r.id = ranked_resources.id and r.sort_order = 0;

create table if not exists public.booking_audit_log (
  id           bigint generated always as identity primary key,
  booking_id   uuid not null,
  action       text not null check (action in ('created', 'updated', 'deleted')),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  occurred_at  timestamptz not null default now(),
  before_data  jsonb,
  after_data   jsonb
);
create index if not exists booking_audit_log_time_idx on public.booking_audit_log (occurred_at desc);
create index if not exists booking_audit_log_booking_idx on public.booking_audit_log (booking_id, occurred_at desc);

create or replace function public.record_booking_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_audit_log (booking_id, action, actor_id, actor_email, after_data)
    values (new.id, 'created', auth.uid(), auth.jwt() ->> 'email', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      insert into public.booking_audit_log (booking_id, action, actor_id, actor_email, before_data, after_data)
      values (new.id, 'updated', auth.uid(), auth.jwt() ->> 'email', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into public.booking_audit_log (booking_id, action, actor_id, actor_email, before_data)
    values (old.id, 'deleted', auth.uid(), auth.jwt() ->> 'email', to_jsonb(old));
    return old;
  end if;
end;
$$;

drop trigger if exists booking_audit_log_trg on public.bookings;
create trigger booking_audit_log_trg
  after insert or update or delete on public.bookings
  for each row execute function public.record_booking_audit();

alter table public.booking_audit_log enable row level security;
revoke all on public.booking_audit_log from anon, authenticated;
grant select on public.booking_audit_log to authenticated;
drop policy if exists booking_audit_admin_read on public.booking_audit_log;
create policy booking_audit_admin_read on public.booking_audit_log for select to authenticated
  using (public.is_admin());

-- Rollen können nicht aus dem Browser geändert werden; dies läuft über die geprüfte Admin-Function.
revoke insert, update, delete on public.memberships from authenticated;
grant select on public.memberships to authenticated;

-- Ressourcen können deaktiviert oder über die sichere Admin-RPC endgültig gelöscht werden.
revoke delete on public.resources from public, anon, authenticated;
drop policy if exists resources_admin_write on public.resources;
drop policy if exists resources_admin_insert on public.resources;
drop policy if exists resources_admin_update on public.resources;
create policy resources_admin_insert on public.resources for insert to authenticated
  with check (public.is_admin());
create policy resources_admin_update on public.resources for update to authenticated
  using (public.is_admin()) with check (public.is_admin());




-- Resource name snapshot remains available in booking audit records after resource deletion.
-- Temporarily disable row triggers so the backfill does not alter timestamps or create fake audit entries.
drop trigger if exists bookings_audit_trg on public.bookings;
drop trigger if exists booking_audit_log_trg on public.bookings;
alter table public.bookings add column if not exists resource_name text;
update public.bookings b
set resource_name = r.name
from public.resources r
where r.id = b.resource_id and b.resource_name is null;
alter table public.bookings alter column resource_name set not null;

create or replace function public.bookings_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  select r.name into new.resource_name from public.resources r where r.id = new.resource_id;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger bookings_audit_trg
  before insert or update on public.bookings
  for each row execute function public.bookings_audit();

drop trigger if exists booking_audit_log_trg on public.bookings;
create trigger booking_audit_log_trg
  after insert or update or delete on public.bookings
  for each row execute function public.record_booking_audit();

-- Ressourcen können endgültig gelöscht werden, sobald keine laufenden oder zukünftigen Termine existieren.
-- Vergangene Buchungen werden atomar per Kaskade entfernt; ihr Audit-Protokoll bleibt erhalten.
alter table public.bookings drop constraint if exists bookings_resource_id_fkey;
alter table public.bookings
  add constraint bookings_resource_id_fkey
  foreign key (resource_id) references public.resources(id) on delete cascade;

-- Endgültiges Löschen: nur Admin, keine laufenden oder zukünftigen Termine.
-- Vergangene Buchungen werden per FK-Kaskade gelöscht; deren Audit-Einträge bleiben erhalten.
create or replace function public.admin_delete_resource(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur Administratoren dürfen Ressourcen endgültig löschen.' using errcode = '42501';
  end if;

  perform 1
  from public.resources r
  where r.id = p_resource_id
  for update;
  if not found then
    raise exception 'Ressource nicht gefunden.' using errcode = 'P0002';
  end if;

  -- Lock existing bookings and prevent concurrent time edits while checking.
  perform 1
  from public.bookings b
  where b.resource_id = p_resource_id
  for update;

  if exists (
    select 1 from public.bookings b
    where b.resource_id = p_resource_id and b.ends_at > now()
  ) then
    raise exception 'Es bestehen noch aktuelle oder zukünftige Termine. Bitte diese zuerst löschen oder die Ressource deaktivieren.'
      using errcode = 'P0001';
  end if;

  delete from public.resources where id = p_resource_id;
end;
$$;

revoke all on function public.admin_delete_resource(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_resource(uuid) to authenticated;

commit;
