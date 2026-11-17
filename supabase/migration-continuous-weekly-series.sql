-- Fortlaufende Wochenserien mit rollierendem 6-Monats-Horizont.
-- Einmalig im Supabase-Dashboard > SQL Editor ausführen.
-- Für automatische Verlängerung wird die Supabase-Erweiterung pg_cron verwendet.

create extension if not exists pg_cron;

create table if not exists public.booking_series (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  starts_on date not null,
  start_time time not null,
  end_time time not null,
  interval_weeks integer not null default 1 check (interval_weeks in (1, 2)),
  timezone text not null default 'Europe/Berlin',
  first_occurrence_index integer not null default 0 check (first_occurrence_index >= 0),
  end_date date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_series_end_after_start check (end_time > start_time)
);

alter table public.bookings
  add column if not exists series_occurrence integer;

create unique index if not exists bookings_series_occurrence_unique
  on public.bookings (series_id, series_occurrence)
  where series_id is not null and series_occurrence is not null;

create table if not exists public.booking_series_skips (
  series_id uuid not null references public.booking_series(id) on delete cascade,
  occurrence_index integer not null check (occurrence_index >= 0),
  skipped_at timestamptz not null default now(),
  primary key (series_id, occurrence_index)
);

-- Auch Löschungen über Sammelaktionen bleiben dauerhaft ausgelassen und werden
-- nicht beim nächsten Cronlauf versehentlich erneut angelegt.
create or replace function public.record_deleted_series_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.series_id is not null and old.series_occurrence is not null
     and exists (select 1 from public.booking_series s where s.id = old.series_id) then
    insert into public.booking_series_skips (series_id, occurrence_index)
    values (old.series_id, old.series_occurrence) on conflict do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists bookings_record_series_skip_trg on public.bookings;
create trigger bookings_record_series_skip_trg
  before delete on public.bookings
  for each row execute function public.record_deleted_series_occurrence();

alter table public.booking_series enable row level security;
alter table public.booking_series_skips enable row level security;
revoke all on public.booking_series from anon;
revoke all on public.booking_series_skips from anon, authenticated;
grant select on public.booking_series to authenticated;

drop policy if exists booking_series_editor_all on public.booking_series;
drop policy if exists booking_series_editor_read on public.booking_series;
create policy booking_series_editor_read on public.booking_series
  for select to authenticated using (public.is_editor());

-- Füllt fehlende Vorkommen vom lokalen heutigen Tag bis sechs Monate im Voraus.
-- Idempotent: bereits vorhandene oder einzeln ausgelassene Vorkommen bleiben unberührt.
create or replace function public.extend_booking_series(p_series_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.booking_series%rowtype;
  v_today date;
  v_horizon date;
  v_max_index integer;
  v_index integer;
  v_date date;
  v_created integer := 0;
  v_count integer;
begin
  if auth.uid() is not null and not public.is_editor() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;

  for s in
    select * from public.booking_series
    where is_active and (p_series_id is null or id = p_series_id)
    order by id
    for update
  loop
    v_today := (now() at time zone s.timezone)::date;
    v_horizon := v_today + 183;
    v_max_index := floor((v_horizon - s.starts_on)::numeric / (s.interval_weeks * 7))::integer;
    if v_max_index < s.first_occurrence_index then continue; end if;

    for v_index in s.first_occurrence_index..v_max_index loop
      v_date := s.starts_on + (v_index * s.interval_weeks * 7);
      if v_date < v_today or (s.end_date is not null and v_date > s.end_date) then continue; end if;
      if exists (
        select 1 from public.booking_series_skips x
        where x.series_id = s.id and x.occurrence_index = v_index
      ) then continue; end if;

      insert into public.bookings (
        resource_id, category_id, title, starts_at, ends_at, notes, series_id, series_occurrence
      ) values (
        s.resource_id,
        s.category_id,
        s.title,
        ((v_date + s.start_time) at time zone s.timezone),
        ((v_date + s.end_time) at time zone s.timezone),
        s.notes,
        s.id,
        v_index
      ) on conflict do nothing;
      get diagnostics v_count = row_count;
      v_created := v_created + v_count;
    end loop;
  end loop;

  return v_created;
end;
$$;

create or replace function public.create_booking_series(
  p_resource_id uuid,
  p_category_id uuid,
  p_title text,
  p_notes text,
  p_starts_on date,
  p_start_time time,
  p_end_time time,
  p_interval_weeks integer default 1,
  p_timezone text default 'Europe/Berlin'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_editor() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_interval_weeks not in (1, 2) then
    raise exception 'Das Wiederholungsintervall muss 1 oder 2 Wochen betragen.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Die Zeitzone ist ungültig.' using errcode = '22023';
  end if;

  insert into public.booking_series (
    resource_id, category_id, title, notes, starts_on, start_time, end_time, interval_weeks, timezone, created_by
  ) values (
    p_resource_id, p_category_id, p_title, p_notes, p_starts_on, p_start_time, p_end_time,
    p_interval_weeks, p_timezone, auth.uid()
  ) returning id into v_id;

  perform public.extend_booking_series(v_id);
  return v_id;
end;
$$;

-- Ändert ab occurrence_index (oder ab Index 0 für die ganze Serie) die Regel
-- und aktualisiert alle bereits vorgemerkten Vorkommen ab diesem Index.
create or replace function public.update_booking_series(
  p_series_id uuid,
  p_occurrence_index integer,
  p_starts_on date,
  p_start_time time,
  p_end_time time,
  p_title text,
  p_resource_id uuid,
  p_category_id uuid,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.booking_series%rowtype;
  v_anchor date;
  v_updated integer;
begin
  if not public.is_editor() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_occurrence_index < 0 or p_end_time <= p_start_time then
    raise exception 'Die Serienangaben sind ungültig.' using errcode = '22023';
  end if;

  select * into s from public.booking_series where id = p_series_id for update;
  if not found then raise exception 'Serie nicht gefunden.' using errcode = 'P0002'; end if;
  if not s.is_active then raise exception 'Diese Serie wurde bereits beendet.' using errcode = '22023'; end if;

  v_anchor := p_starts_on - (p_occurrence_index * s.interval_weeks * 7);
  update public.booking_series set
    title = p_title,
    resource_id = p_resource_id,
    category_id = p_category_id,
    notes = p_notes,
    starts_on = v_anchor,
    start_time = p_start_time,
    end_time = p_end_time,
    first_occurrence_index = p_occurrence_index,
    updated_at = now()
  where id = p_series_id;

  update public.bookings b set
    title = p_title,
    resource_id = p_resource_id,
    category_id = p_category_id,
    notes = p_notes,
    starts_at = ((v_anchor + (b.series_occurrence * s.interval_weeks * 7) + p_start_time) at time zone s.timezone),
    ends_at = ((v_anchor + (b.series_occurrence * s.interval_weeks * 7) + p_end_time) at time zone s.timezone)
  where b.series_id = p_series_id and b.series_occurrence >= p_occurrence_index;
  get diagnostics v_updated = row_count;

  perform public.extend_booking_series(p_series_id);
  return v_updated;
end;
$$;

-- Beendet die Serie ab einem Vorkommen; frühere Termine bleiben erhalten.
create or replace function public.end_booking_series(p_series_id uuid, p_from_occurrence integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.booking_series%rowtype;
  v_deleted integer;
  v_end_date date;
begin
  if not public.is_editor() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_from_occurrence < 0 then raise exception 'Ungültiges Vorkommen.' using errcode = '22023'; end if;

  select * into s from public.booking_series where id = p_series_id for update;
  if not found then raise exception 'Serie nicht gefunden.' using errcode = 'P0002'; end if;
  v_end_date := s.starts_on + ((p_from_occurrence - 1) * s.interval_weeks * 7);
  update public.booking_series set is_active = false, end_date = v_end_date, updated_at = now()
  where id = p_series_id;
  delete from public.bookings where series_id = p_series_id and series_occurrence >= p_from_occurrence;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Löscht ein einzelnes Vorkommen dauerhaft, ohne dass der Cronjob es neu anlegt.
create or replace function public.skip_booking_series_occurrence(
  p_series_id uuid,
  p_occurrence_index integer,
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_editor() then
    raise exception 'Keine Berechtigung.' using errcode = '42501';
  end if;
  if p_occurrence_index < 0 then raise exception 'Ungültiges Vorkommen.' using errcode = '22023'; end if;

  insert into public.booking_series_skips (series_id, occurrence_index)
  values (p_series_id, p_occurrence_index) on conflict do nothing;
  delete from public.bookings
  where id = p_booking_id and series_id = p_series_id and series_occurrence = p_occurrence_index;
end;
$$;

revoke all on function public.record_deleted_series_occurrence() from public;
revoke all on function public.extend_booking_series(uuid) from public;
revoke all on function public.create_booking_series(uuid, uuid, text, text, date, time, time, integer, text) from public;
revoke all on function public.update_booking_series(uuid, integer, date, time, time, text, uuid, uuid, text) from public;
revoke all on function public.end_booking_series(uuid, integer) from public;
revoke all on function public.skip_booking_series_occurrence(uuid, integer, uuid) from public;
grant execute on function public.extend_booking_series(uuid) to authenticated;
grant execute on function public.create_booking_series(uuid, uuid, text, text, date, time, time, integer, text) to authenticated;
grant execute on function public.update_booking_series(uuid, integer, date, time, time, text, uuid, uuid, text) to authenticated;
grant execute on function public.end_booking_series(uuid, integer) to authenticated;
grant execute on function public.skip_booking_series_occurrence(uuid, integer, uuid) to authenticated;

-- Einmal täglich verlängern. Die Funktion ist idempotent und fügt nur fehlende
-- Vorkommen bis sechs Monate voraus hinzu.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'vk-extend-weekly-series' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'vk-extend-weekly-series',
    '17 3 * * *',
    'select public.extend_booking_series(null);'
  );
end;
$$;
