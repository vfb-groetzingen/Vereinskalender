-- Assign annual/one-time email events to public calendar resources and categories.
-- Calendar visibility is returned only through a restricted RPC; recipients and message content stay private.
-- Run after migration-event-individual-messages.sql and before migration-continuous-booking-series.sql.

begin;

alter table public.annual_email_events
  add column if not exists resource_ids uuid[] not null default '{}'::uuid[],
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists annual_email_events_resource_ids_gin_idx
  on public.annual_email_events using gin (resource_ids)
  where active;

create or replace function public.get_annual_event_calendar_occurrences(
  p_from date,
  p_to date,
  p_resource_ids uuid[] default null
)
returns table (
  event_id uuid,
  title text,
  event_date date,
  resource_id uuid,
  category_id uuid,
  category_name text,
  category_color text
)
language sql stable security definer set search_path = pg_catalog, public as $$
  with years as (
    select generated_year::integer as occurrence_year
      from generate_series(
        extract(year from p_from)::integer,
        case
          when p_to > p_from and p_to <= p_from + 400
            then extract(year from (p_to - 1))::integer
          else extract(year from p_from)::integer - 1
        end
      ) as year_series(generated_year)
  ), occurrences as (
    select e.id as event_id, e.title, e.category_id, e.resource_ids,
           e.event_date as occurrence_date
      from public.annual_email_events e
     where e.active
       and cardinality(e.resource_ids) > 0
       and e.recurrence = 'once'
       and p_to > p_from
       and p_to <= p_from + 400
       and e.event_date >= p_from
       and e.event_date < p_to
    union all
    select e.id as event_id, e.title, e.category_id, e.resource_ids,
           case
             when e.event_month = 2 and e.event_day = 29
              and not (y.occurrence_year % 4 = 0 and (y.occurrence_year % 100 <> 0 or y.occurrence_year % 400 = 0))
               then null::date
             else make_date(y.occurrence_year, e.event_month, e.event_day)
           end as occurrence_date
      from public.annual_email_events e
      cross join years y
     where e.active
       and cardinality(e.resource_ids) > 0
       and e.recurrence = 'annual'
  )
  select o.event_id,
         o.title,
         o.occurrence_date as event_date,
         selected_resource.resource_id,
         o.category_id,
         c.name as category_name,
         c.color as category_color
    from occurrences o
    cross join lateral unnest(o.resource_ids) as selected_resource(resource_id)
    join public.resources r
      on r.id = selected_resource.resource_id
     and r.is_active
    left join public.categories c on c.id = o.category_id
   where o.occurrence_date is not null
     and (p_resource_ids is null or selected_resource.resource_id = any(p_resource_ids))
   order by o.occurrence_date, o.title, selected_resource.resource_id;
$$;

revoke all on function public.get_annual_event_calendar_occurrences(date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.get_annual_event_calendar_occurrences(date, date, uuid[]) to anon, authenticated;

commit;

-- Refresh PostgREST's schema cache so the new columns are immediately available.
notify pgrst, 'reload schema';
