-- =====================================================================
-- Ersten Administrator anlegen (einmalig, nach dem Einladen der Person).
-- 1. Im Dashboard unter Authentication > Users die Person einladen ("Invite user").
-- 2. E-Mail-Adresse unten eintragen und im SQL Editor ausführen.
-- =====================================================================
insert into public.memberships (user_id, role)
select id, 'admin' from auth.users where email = 'HIER-E-MAIL-EINTRAGEN'
on conflict (user_id) do update set role = excluded.role;

-- Weitere Bearbeiter (Rolle "bearbeiter") auf dieselbe Weise, z. B.:
-- insert into public.memberships (user_id, role)
-- select id, 'bearbeiter' from auth.users where email = 'name@beispiel.de'
-- on conflict (user_id) do update set role = excluded.role;

-- Zugang sperren (Rolle entziehen):
-- delete from public.memberships where user_id = (select id from auth.users where email = 'name@beispiel.de');
