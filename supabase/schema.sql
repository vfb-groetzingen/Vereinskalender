-- =====================================================================
-- Vereinskalender: Datenbankschema, Rechte und Doppelbelegungssperre
-- Ausführen im Supabase-Dashboard unter "SQL Editor" (einmalig, neues Projekt).
-- Sicherheit: Die Rechte werden ausschließlich hier in der Datenbank geprüft
-- (Row Level Security). Die Webseite im Browser prüft nur zur Bedienbarkeit.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------- Tabellen ----------

create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  type        text not null check (type in ('raum', 'platz')),
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

alter table public.resources add column if not exists is_active boolean not null default true;

create table if not exists public.categories (
  id     uuid primary key default gen_random_uuid(),
  name   text unique not null,
  color  text not null check (color ~ '^#[0-9a-fA-F]{6}$')
);

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.resources(id) on delete cascade,
  resource_name text not null,
  category_id  uuid not null references public.categories(id) on delete restrict,
  title        text not null check (char_length(title) between 1 and 120),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  notes        text check (notes is null or char_length(notes) <= 1000),
  series_id    uuid,
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint ends_after_starts check (ends_at > starts_at),
  -- Doppelbelegungssperre: Auf derselben Ressource dürfen sich Zeiträume nicht überschneiden.
  -- Gilt auch bei gleichzeitigen Eingaben. Randberührung (Ende = Start) ist erlaubt.
  constraint no_double_booking exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index if not exists bookings_series_idx on public.bookings (series_id);

create table if not exists public.memberships (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null check (role in ('bearbeiter', 'admin')),
  created_at timestamptz not null default now()
);

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

-- ---------- Hilfsfunktionen für Rechte ----------

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.role in ('bearbeiter', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

-- Schreibt Ersteller und Bearbeiter automatisch (nicht vom Browser manipulierbar)
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

drop trigger if exists bookings_audit_trg on public.bookings;
create trigger bookings_audit_trg
  before insert or update on public.bookings
  for each row execute function public.bookings_audit();

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

-- ---------- Öffentliche Sicht (ohne Notizen und ohne Angaben zur Person) ----------

create or replace view public.public_bookings as
  select id, resource_id, category_id, title, starts_at, ends_at, series_id
  from public.bookings;

-- ---------- Row Level Security ----------

alter table public.resources   enable row level security;
alter table public.categories  enable row level security;
alter table public.bookings    enable row level security;
alter table public.memberships enable row level security;
alter table public.booking_audit_log enable row level security;

-- Rechte auf das notwendige Minimum setzen und anschließend gezielt vergeben.
revoke all on public.bookings from anon, authenticated;
revoke all on public.memberships from anon, authenticated;
revoke all on public.booking_audit_log from anon, authenticated;
revoke all on public.resources from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.public_bookings from anon, authenticated;

grant select on public.resources, public.categories, public.public_bookings to anon, authenticated;
grant select, insert, update, delete on public.bookings to authenticated;
grant select on public.memberships to authenticated;
grant select on public.booking_audit_log to authenticated;
grant insert, update on public.resources to authenticated;
grant insert, update, delete on public.categories to authenticated;
revoke delete on public.resources from authenticated;

-- Stammdaten: alle dürfen lesen, nur Administratoren ändern
drop policy if exists resources_read on public.resources;
create policy resources_read on public.resources for select using (true);
drop policy if exists resources_admin_write on public.resources;
drop policy if exists resources_admin_insert on public.resources;
drop policy if exists resources_admin_update on public.resources;
create policy resources_admin_insert on public.resources for insert to authenticated
  with check (public.is_admin());
create policy resources_admin_update on public.resources for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (true);
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Termine: Vollansicht (inkl. Notizen) nur für Mitglieder mit Rolle.
-- Besucher lesen ausschließlich über die Ansicht public_bookings.
drop policy if exists bookings_editor_read on public.bookings;
create policy bookings_editor_read on public.bookings for select to authenticated
  using (public.is_editor());
drop policy if exists bookings_editor_insert on public.bookings;
create policy bookings_editor_insert on public.bookings for insert to authenticated
  with check (public.is_editor());
drop policy if exists bookings_editor_update on public.bookings;
create policy bookings_editor_update on public.bookings for update to authenticated
  using (public.is_editor()) with check (public.is_editor());
drop policy if exists bookings_editor_delete on public.bookings;
create policy bookings_editor_delete on public.bookings for delete to authenticated
  using (public.is_editor());

-- Mitglieder sehen nur die eigene Rolle. Vergabe erfolgt über den Administrator (SQL oder Dashboard).
drop policy if exists memberships_self_read on public.memberships;
create policy memberships_self_read on public.memberships for select to authenticated
  using (user_id = auth.uid());

drop policy if exists booking_audit_admin_read on public.booking_audit_log;
create policy booking_audit_admin_read on public.booking_audit_log for select to authenticated
  using (public.is_admin());

-- Die Ansicht public_bookings läuft mit den Rechten des Eigentümers und umgeht bewusst RLS
-- auf bookings. Sie liefert deshalb nur die unkritischen Spalten (siehe oben).
