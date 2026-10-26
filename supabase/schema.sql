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
  sort_order  int  not null default 0
);

create table if not exists public.categories (
  id     uuid primary key default gen_random_uuid(),
  name   text unique not null,
  color  text not null check (color ~ '^#[0-9a-fA-F]{6}$')
);

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.resources(id) on delete restrict,
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

-- ---------- Öffentliche Sicht (ohne Notizen und ohne Angaben zur Person) ----------

create or replace view public.public_bookings as
  select id, resource_id, category_id, title, starts_at, ends_at, series_id
  from public.bookings;

-- ---------- Row Level Security ----------

alter table public.resources   enable row level security;
alter table public.categories  enable row level security;
alter table public.bookings    enable row level security;
alter table public.memberships enable row level security;

-- Standardrechte von Supabase entziehen, danach nur das Nötige vergeben
revoke all on public.bookings    from anon;
revoke all on public.memberships from anon;
revoke all on public.resources   from anon;
revoke all on public.categories  from anon;

grant select on public.resources, public.categories, public.public_bookings to anon, authenticated;
grant select, insert, update, delete on public.bookings to authenticated;
grant select on public.memberships to authenticated;
grant insert, update, delete on public.resources, public.categories to authenticated;

-- Stammdaten: alle dürfen lesen, nur Administratoren ändern
drop policy if exists resources_read on public.resources;
create policy resources_read on public.resources for select using (true);
drop policy if exists resources_admin_write on public.resources;
create policy resources_admin_write on public.resources for all to authenticated
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

-- Die Ansicht public_bookings läuft mit den Rechten des Eigentümers und umgeht bewusst RLS
-- auf bookings. Sie liefert deshalb nur die unkritischen Spalten (siehe oben).
