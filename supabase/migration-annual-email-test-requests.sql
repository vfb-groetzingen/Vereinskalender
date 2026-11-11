-- Testmails aus der Ereignisverwaltung sicher in die serverseitige Warteschlange stellen.
-- Diese Migration nach migration-multi-resource-annual-events.sql ausführen.

begin;

create table if not exists public.annual_email_test_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.annual_email_events(id) on delete cascade,
  recipient text not null check (char_length(recipient) between 3 and 254),
  requested_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  error text
);

create index if not exists annual_email_test_queue_idx
  on public.annual_email_test_requests (requested_at) where status = 'pending';
create unique index if not exists annual_email_test_no_duplicate_queue
  on public.annual_email_test_requests (event_id, lower(recipient))
  where status in ('pending', 'sending');

alter table public.annual_email_test_requests enable row level security;
revoke all on public.annual_email_test_requests from anon;
grant select, insert on public.annual_email_test_requests to authenticated;
grant select, insert, update on public.annual_email_test_requests to service_role;

drop policy if exists annual_email_test_editor_read on public.annual_email_test_requests;
create policy annual_email_test_editor_read on public.annual_email_test_requests for select to authenticated
  using (public.is_editor());
drop policy if exists annual_email_test_editor_insert on public.annual_email_test_requests;
create policy annual_email_test_editor_insert on public.annual_email_test_requests for insert to authenticated
  with check (public.is_editor() and requested_by = auth.uid());

create or replace function public.claim_annual_email_test_request()
returns setof public.annual_email_test_requests
language plpgsql security definer set search_path = public as $$
declare
  request_row public.annual_email_test_requests;
begin
  select * into request_row
  from public.annual_email_test_requests
  where status = 'pending'
  order by requested_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.annual_email_test_requests
  set status = 'sending', error = null, updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return next request_row;
end;
$$;

revoke all on function public.claim_annual_email_test_request() from public, anon, authenticated;
grant execute on function public.claim_annual_email_test_request() to service_role;

commit;
