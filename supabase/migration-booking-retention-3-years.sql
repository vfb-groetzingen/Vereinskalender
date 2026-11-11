-- One-time Supabase SQL Editor migration.
-- Runs daily at 03:00 UTC and permanently deletes bookings whose start is older than 3 years.
-- It does not delete younger bookings to recover space.
-- Re-running this file replaces the jobs with the same names.

begin;

create extension if not exists pg_cron;

select cron.schedule(
  'vereinskalender-booking-retention-3-years',
  '0 3 * * *',
  $job$
    delete from public.bookings
    where starts_at < now() - interval '3 years';
  $job$
);

-- Keep the scheduler's own run-history table small as well.
select cron.schedule(
  'vereinskalender-cron-history-cleanup',
  '15 3 * * *',
  $job$
    delete from cron.job_run_details
    where end_time < now() - interval '7 days';
  $job$
);

commit;
