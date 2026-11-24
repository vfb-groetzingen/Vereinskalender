-- Protokolliert jeden Statuswechsel des Ereignis-Mailversands im Termin-Aenderungsprotokoll.
-- Nach den Migrationen fuer admin_audit_log und annual_email_deliveries ausfuehren.

begin;

grant insert on public.admin_audit_log to service_role;
grant usage, select on sequence public.admin_audit_log_id_seq to service_role;

create or replace function public.audit_annual_email_delivery_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.error is not distinct from old.error
     and new.sent_at is not distinct from old.sent_at then
    return new;
  end if;

  insert into public.admin_audit_log (
    actor_email, action, entity_type, entity_id, after_data
  ) values (
    'System',
    case new.status
      when 'sending' then 'mail_sending'
      when 'sent' then 'mail_sent'
      when 'failed' then 'mail_failed'
      else 'mail_status'
    end,
    'annual_event_email',
    new.event_id::text,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists annual_email_deliveries_admin_audit_trg on public.annual_email_deliveries;
create trigger annual_email_deliveries_admin_audit_trg
after insert or update on public.annual_email_deliveries
for each row execute function public.audit_annual_email_delivery_status();

commit;
notify pgrst, 'reload schema';
