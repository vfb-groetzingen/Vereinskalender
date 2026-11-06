-- Vereinskalender: Admin-Bereich, Archivierung und Termin-Audit-Log
-- Im bestehenden Supabase-Projekt einmalig im SQL Editor ausführen.

alter table public.resources
  add column if not exists is_active boolean not null default true;

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

-- Ressourcen werden im Admin-Bereich archiviert statt hart gelöscht.
revoke delete on public.resources from authenticated;
drop policy if exists resources_admin_write on public.resources;
drop policy if exists resources_admin_insert on public.resources;
drop policy if exists resources_admin_update on public.resources;
create policy resources_admin_insert on public.resources for insert to authenticated
  with check (public.is_admin());
create policy resources_admin_update on public.resources for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
