-- Fortlaufende Terminserien (wöchentlich, zweiwöchentlich, monatlich, jährlich)
-- Rollierender Horizont: sechs Monate. Einmal nach allen bisherigen Migrationen
-- im Supabase-Dashboard > SQL Editor ausführen.

create extension if not exists pg_cron;

create table if not exists public.booking_series (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete restrict,
  resource_ids uuid[] not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  contact_email text check (contact_email is null or char_length(contact_email) between 3 and 254),
  reminder_days smallint not null default 0 check (reminder_days in (0, 1, 2, 7)),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly')),
  starts_on date not null,
  start_time time not null,
  end_time time not null,
  timezone text not null default 'Europe/Berlin',
  date_offset_days integer not null default 0,
  anchor_occurrence_index integer not null default 0 check (anchor_occurrence_index >= 0),
  first_occurrence_index integer not null default 0 check (first_occurrence_index >= 0),
  end_date date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_series_end_after_start check (end_time > start_time),
  constraint booking_series_resources_valid check (cardinality(resource_ids) > 0 and resource_ids[1] = resource_id)
);


-- Upgrade the earlier weekly-only booking_series table if that patch was applied.
-- CREATE TABLE IF NOT EXISTS does not add columns to an existing relation.
alter table public.booking_series
  add column if not exists resource_ids uuid[],
  add column if not exists contact_email text,
  add column if not exists reminder_days smallint not null default 0,
  add column if not exists frequency text,
  add column if not exists date_offset_days integer not null default 0,
  add column if not exists anchor_occurrence_index integer not null default 0;

do $compat$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_series' and column_name = 'interval_weeks'
  ) then
    execute $sql$
      update public.booking_series
      set frequency = case when interval_weeks = 2 then 'biweekly' else 'weekly' end
      where frequency is null
    $sql$;
  else
    update public.booking_series set frequency = 'weekly' where frequency is null;
  end if;
end;
$compat$;

update public.booking_series
set resource_ids = array[resource_id]::uuid[]
where resource_ids is null;

alter table public.booking_series
  alter column resource_ids set not null,
  alter column frequency set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_series'::regclass and conname = 'booking_series_resources_valid'
  ) then
    alter table public.booking_series
      add constraint booking_series_resources_valid
      check (cardinality(resource_ids) > 0 and resource_ids[1] = resource_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_series'::regclass and conname = 'booking_series_frequency_check'
  ) then
    alter table public.booking_series
      add constraint booking_series_frequency_check
      check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_series'::regclass and conname = 'booking_series_contact_email_check'
  ) then
    alter table public.booking_series
      add constraint booking_series_contact_email_check
      check (contact_email is null or char_length(contact_email) between 3 and 254);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_series'::regclass and conname = 'booking_series_reminder_days_check'
  ) then
    alter table public.booking_series
      add constraint booking_series_reminder_days_check
      check (reminder_days in (0, 1, 2, 7));
  end if;
end;
$constraints$;

alter table public.bookings add column if not exists series_occurrence integer;
create unique index if not exists bookings_series_occurrence_unique
  on public.bookings (series_id, series_occurrence)
  where series_id is not null and series_occurrence is not null;
create index if not exists booking_series_active_idx
  on public.booking_series (is_active, starts_on);

create table if not exists public.booking_series_skips (
  series_id uuid not null references public.booking_series(id) on delete cascade,
  occurrence_index integer not null check (occurrence_index >= 0),
  skipped_at timestamptz not null default now(),
  primary key (series_id, occurrence_index)
);

alter table public.booking_series enable row level security;
alter table public.booking_series_skips enable row level security;
revoke all on public.booking_series from anon;
revoke all on public.booking_series_skips from anon, authenticated;
grant select on public.booking_series to authenticated;
drop policy if exists booking_series_editor_read on public.booking_series;
create policy booking_series_editor_read on public.booking_series
  for select to authenticated using (public.is_editor());

-- Keeps month-end and leap-day recurrence anchored to the original day when possible.
-- p_offset may be negative when a whole series is edited from a later occurrence.
create or replace function public.booking_series_occurrence_date(
  p_anchor_date date, p_frequency text, p_offset integer
)
returns date
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_month_start date;
  v_next_month date;
  v_last_day integer;
  v_day integer;
  v_year integer;
begin
  if p_frequency = 'weekly' then return p_anchor_date + (p_offset * 7); end if;
  if p_frequency = 'biweekly' then return p_anchor_date + (p_offset * 14); end if;

  v_day := extract(day from p_anchor_date)::integer;
  if p_frequency = 'monthly' then
    v_month_start := (date_trunc('month', p_anchor_date::timestamp) + make_interval(months => p_offset))::date;
  elsif p_frequency = 'yearly' then
    v_year := extract(year from p_anchor_date)::integer + p_offset;
    v_month_start := make_date(v_year, extract(month from p_anchor_date)::integer, 1);
  else
    raise exception 'Unbekanntes Wiederholungsintervall.' using errcode = '22023';
  end if;
  v_next_month := (v_month_start + interval '1 month')::date;
  v_last_day := extract(day from (v_next_month - 1))::integer;
  return v_month_start + least(v_day, v_last_day) - 1;
end;
$$;

-- Record a deleted occurrence so a manual or bulk delete is never recreated by cron.
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

-- Idempotently creates concrete booking rows only through six months ahead.
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
  v_days integer;
  v_periods integer;
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
    v_days := v_horizon - s.starts_on - s.date_offset_days;
    if s.frequency = 'weekly' then
      v_periods := floor(v_days::numeric / 7)::integer;
    elsif s.frequency = 'biweekly' then
      v_periods := floor(v_days::numeric / 14)::integer;
    elsif s.frequency = 'monthly' then
      v_periods := (extract(year from v_horizon)::integer - extract(year from s.starts_on)::integer) * 12
        + extract(month from v_horizon)::integer - extract(month from s.starts_on)::integer;
      if s.date_offset_days < 0 then
        v_periods := v_periods + ceil((-s.date_offset_days)::numeric / 28)::integer;
      end if;
    else
      v_periods := extract(year from v_horizon)::integer - extract(year from s.starts_on)::integer;
      if s.date_offset_days < 0 then
        v_periods := v_periods + ceil((-s.date_offset_days)::numeric / 365)::integer;
      end if;
    end if;
    v_max_index := s.anchor_occurrence_index + v_periods;
    if v_max_index < s.first_occurrence_index then continue; end if;

    for v_index in s.first_occurrence_index..v_max_index loop
      v_date := public.booking_series_occurrence_date(
        s.starts_on, s.frequency, v_index - s.anchor_occurrence_index
      ) + s.date_offset_days;
      if v_date < v_today or v_date > v_horizon or (s.end_date is not null and v_date > s.end_date) then continue; end if;
      if exists (
        select 1 from public.booking_series_skips x
        where x.series_id = s.id and x.occurrence_index = v_index
      ) then continue; end if;

      insert into public.bookings (
        resource_id, resource_ids, category_id, title, starts_at, ends_at, notes,
        contact_email, reminder_days, series_id, series_occurrence
      ) values (
        s.resource_id, s.resource_ids, s.category_id, s.title,
        ((v_date + s.start_time) at time zone s.timezone),
        ((v_date + s.end_time) at time zone s.timezone),
        s.notes, s.contact_email, s.reminder_days, s.id, v_index
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
  p_resource_ids uuid[],
  p_category_id uuid,
  p_title text,
  p_notes text,
  p_contact_email text,
  p_reminder_days smallint,
  p_starts_on date,
  p_start_time time,
  p_end_time time,
  p_frequency text,
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
  if p_frequency not in ('weekly', 'biweekly', 'monthly', 'yearly') then
    raise exception 'Unbekanntes Wiederholungsintervall.' using errcode = '22023';
  end if;
  if p_end_time <= p_start_time then
    raise exception 'Die Endzeit muss nach der Startzeit liegen.' using errcode = '23514';
  end if;
  if p_resource_ids is null or cardinality(p_resource_ids) = 0 or p_resource_ids[1] is distinct from p_resource_id
     or array_position(p_resource_ids, null) is not null
     or cardinality(p_resource_ids) <> (select count(distinct x) from unnest(p_resource_ids) as r(x))
     or exists (select 1 from unnest(p_resource_ids) as selected(id) left join public.resources r on r.id = selected.id where r.id is null) then
    raise exception 'Die Ressourcenauswahl ist ungültig.' using errcode = '23514';
  end if;
  if p_reminder_days not in (0, 1, 2, 7) or (p_reminder_days > 0 and p_contact_email is null) then
    raise exception 'Erinnerung oder Kontakt-E-Mail ist ungültig.' using errcode = '23514';
  end if;
  if p_contact_email is not null and char_length(p_contact_email) not between 3 and 254 then
    raise exception 'Die Kontakt-E-Mail ist ungültig.' using errcode = '23514';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Die Zeitzone ist ungültig.' using errcode = '22023';
  end if;

  insert into public.booking_series (
    resource_id, resource_ids, category_id, title, notes, contact_email, reminder_days,
    frequency, starts_on, start_time, end_time, timezone, created_by
  ) values (
    p_resource_id, p_resource_ids, p_category_id, p_title, p_notes, p_contact_email, p_reminder_days,
    p_frequency, p_starts_on, p_start_time, p_end_time, p_timezone, auth.uid()
  ) returning id into v_id;
  perform public.extend_booking_series(v_id);
  return v_id;
end;
$$;

-- Updates all future rows or the complete rule. In all-scope mode the date shift
-- is applied to the original anchor, preserving the recurrence's month-end/leap-day pattern.
create or replace function public.update_booking_series(
  p_series_id uuid,
  p_occurrence_index integer,
  p_scope text,
  p_starts_on date,
  p_start_time time,
  p_end_time time,
  p_title text,
  p_resource_id uuid,
  p_resource_ids uuid[],
  p_category_id uuid,
  p_notes text,
  p_contact_email text,
  p_reminder_days smallint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.booking_series%rowtype;
  v_anchor_date date;
  v_anchor_index integer;
  v_first_index integer;
  v_offset_days integer;
  v_selected_date date;
  v_updated integer;
begin
  if not public.is_editor() then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if p_scope not in ('following', 'all') or p_occurrence_index < 0 or p_end_time <= p_start_time then
    raise exception 'Die Serienangaben sind ungültig.' using errcode = '22023';
  end if;
  if p_resource_ids is null or cardinality(p_resource_ids) = 0 or p_resource_ids[1] is distinct from p_resource_id
     or array_position(p_resource_ids, null) is not null
     or cardinality(p_resource_ids) <> (select count(distinct x) from unnest(p_resource_ids) as r(x))
     or exists (select 1 from unnest(p_resource_ids) as selected(id) left join public.resources r on r.id = selected.id where r.id is null) then
    raise exception 'Die Ressourcenauswahl ist ungültig.' using errcode = '23514';
  end if;
  if p_reminder_days not in (0, 1, 2, 7) or (p_reminder_days > 0 and p_contact_email is null) then
    raise exception 'Erinnerung oder Kontakt-E-Mail ist ungültig.' using errcode = '23514';
  end if;
  if p_contact_email is not null and char_length(p_contact_email) not between 3 and 254 then
    raise exception 'Die Kontakt-E-Mail ist ungültig.' using errcode = '23514';
  end if;

  select * into s from public.booking_series where id = p_series_id for update;
  if not found then raise exception 'Serie nicht gefunden.' using errcode = 'P0002'; end if;
  if not s.is_active then raise exception 'Diese Serie wurde bereits beendet.' using errcode = '22023'; end if;
  select (b.starts_at at time zone s.timezone)::date into v_selected_date
    from public.bookings b
    where b.series_id = p_series_id and b.series_occurrence = p_occurrence_index
    limit 1;
  if v_selected_date is null then
    v_selected_date := public.booking_series_occurrence_date(
      s.starts_on, s.frequency, p_occurrence_index - s.anchor_occurrence_index
    ) + s.date_offset_days;
  end if;

  if p_scope = 'following' then
    v_anchor_date := p_starts_on;
    v_anchor_index := p_occurrence_index;
    v_first_index := p_occurrence_index;
    v_offset_days := 0;
  else
    v_anchor_date := s.starts_on;
    v_anchor_index := s.anchor_occurrence_index;
    v_first_index := 0;
    v_offset_days := s.date_offset_days + (p_starts_on - v_selected_date);
  end if;

  update public.booking_series set
    resource_id = p_resource_id, resource_ids = p_resource_ids, category_id = p_category_id,
    title = p_title, notes = p_notes, contact_email = p_contact_email, reminder_days = p_reminder_days,
    starts_on = v_anchor_date, start_time = p_start_time, end_time = p_end_time,
    anchor_occurrence_index = v_anchor_index, first_occurrence_index = v_first_index,
    date_offset_days = v_offset_days, updated_at = now()
  where id = p_series_id;

  update public.bookings b set
    resource_id = p_resource_id, resource_ids = p_resource_ids, category_id = p_category_id,
    title = p_title, notes = p_notes, contact_email = p_contact_email, reminder_days = p_reminder_days,
    starts_at = ((public.booking_series_occurrence_date(v_anchor_date, s.frequency, b.series_occurrence - v_anchor_index) + v_offset_days + p_start_time) at time zone s.timezone),
    ends_at = ((public.booking_series_occurrence_date(v_anchor_date, s.frequency, b.series_occurrence - v_anchor_index) + v_offset_days + p_end_time) at time zone s.timezone)
  where b.series_id = p_series_id and (p_scope = 'all' or b.series_occurrence >= p_occurrence_index);
  get diagnostics v_updated = row_count;

  perform public.extend_booking_series(p_series_id);
  return v_updated;
end;
$$;

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
  if not public.is_editor() then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if p_from_occurrence < 0 then raise exception 'Ungültiges Vorkommen.' using errcode = '22023'; end if;
  select * into s from public.booking_series where id = p_series_id for update;
  if not found then raise exception 'Serie nicht gefunden.' using errcode = 'P0002'; end if;
  if p_from_occurrence > 0 then
    v_end_date := public.booking_series_occurrence_date(
      s.starts_on, s.frequency, p_from_occurrence - 1 - s.anchor_occurrence_index
    ) + s.date_offset_days;
  end if;
  update public.booking_series set is_active = false, end_date = v_end_date, updated_at = now() where id = p_series_id;
  delete from public.bookings where series_id = p_series_id and series_occurrence >= p_from_occurrence;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.skip_booking_series_occurrence(
  p_series_id uuid, p_occurrence_index integer, p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_editor() then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if p_occurrence_index < 0 then raise exception 'Ungültiges Vorkommen.' using errcode = '22023'; end if;
  insert into public.booking_series_skips (series_id, occurrence_index)
  values (p_series_id, p_occurrence_index) on conflict do nothing;
  delete from public.bookings where id = p_booking_id and series_id = p_series_id and series_occurrence = p_occurrence_index;
end;
$$;

revoke all on function public.booking_series_occurrence_date(date, text, integer) from public;
revoke all on function public.record_deleted_series_occurrence() from public;
revoke all on function public.extend_booking_series(uuid) from public;
revoke all on function public.create_booking_series(uuid, uuid[], uuid, text, text, text, smallint, date, time, time, text, text) from public;
revoke all on function public.update_booking_series(uuid, integer, text, date, time, time, text, uuid, uuid[], uuid, text, text, smallint) from public;
revoke all on function public.end_booking_series(uuid, integer) from public;
revoke all on function public.skip_booking_series_occurrence(uuid, integer, uuid) from public;
grant execute on function public.extend_booking_series(uuid) to authenticated;
grant execute on function public.create_booking_series(uuid, uuid[], uuid, text, text, text, smallint, date, time, time, text, text) to authenticated;
grant execute on function public.update_booking_series(uuid, integer, text, date, time, time, text, uuid, uuid[], uuid, text, text, smallint) to authenticated;
grant execute on function public.end_booking_series(uuid, integer) to authenticated;
grant execute on function public.skip_booking_series_occurrence(uuid, integer, uuid) to authenticated;

-- Supabase database cron replenishes active series once daily.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'vk-extend-booking-series' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('vk-extend-booking-series', '17 3 * * *', 'select public.extend_booking_series(null);');
end;
$$;
