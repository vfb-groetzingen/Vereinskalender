-- Apply once to existing Supabase installations in the SQL Editor.
-- Overlapping bookings are intentionally allowed, including on the same resource.
begin;
alter table public.bookings drop constraint if exists no_double_booking;
commit;
