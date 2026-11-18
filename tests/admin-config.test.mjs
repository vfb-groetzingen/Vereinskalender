import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseMenu } from '../assets/js/admin-config.js';

globalThis.location ||= { origin: 'http://localhost' };
const { SupabaseStore } = await import('../assets/js/data.js');

test('Navigationspflege bleibt unabhängig von gespeicherten Sichtbarkeitseinstellungen erreichbar', () => {
  const defaults = [
    { id: 'config', label: 'Konfiguration', enabled: true, order: 1 },
    { id: 'navigation', label: 'Navigation', enabled: true, order: 2 },
    { id: 'mail', label: 'Mail', enabled: true, order: 3 },
  ];
  const menu = normaliseMenu([
    { id: 'config', label: 'Einstellungen', enabled: false, order: 3 },
    { id: 'navigation', label: 'Menüpflege', enabled: false, order: 2 },
    { id: 'mail', label: 'Mailtexte', enabled: false, order: 1 },
  ], defaults);
  assert.deepEqual(menu.map(({ id, enabled }) => [id, enabled]), [
    ['mail', false], ['navigation', true], ['config', true],
  ]);
  assert.equal(menu.find((item) => item.id === 'navigation').label, 'Menüpflege');
});


test('Mailabschnitte haben getrennte Speicheraktionen ohne Voll-Refresh', () => {
  const source = readFileSync(new URL('../assets/js/admin-config.js', import.meta.url), 'utf-8');
  const start = source.indexOf("if (subpage === 'mail') {");
  const end = source.indexOf("if (subpage === 'texts' || subpage === 'calendar')", start);
  const mail = source.slice(start, end);
  assert.match(mail, /mail-profile-save/);
  assert.match(mail, /data-save-template/);
  assert.match(mail, /mail-signature-save/);
  assert.match(mail, /saveSiteConfiguration\(\{ mail_profiles: values \}\)/);
  assert.match(mail, /saveSiteConfiguration\(\{ event_signature_html: signature \}\)/);
  assert.match(mail, /saveMailTemplate\(key, template\)/);
  assert.doesNotMatch(mail, /refresh\(/);
});

test('Mailvorlagen werden atomar ueber den einzelnen Vorlagen-RPC gespeichert', async () => {
  const store = Object.create(SupabaseStore.prototype);
  store.role = 'admin';
  let request;
  store._req = async (path, options) => { request = { path, options }; return null; };
  const template = { subject: 'Neuer Betreff', body: 'Nur dieser Nachrichtentext', enabled: true };
  await store.saveMailTemplate('booking_changed', template);
  assert.equal(request.path, '/rest/v1/rpc/admin_update_mail_template');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.options.body, { p_template_key: 'booking_changed', p_template: template });
});

test('Generische Auditfunktion greift nicht auf Buchungsspalten zu', () => {
  const sql = readFileSync(new URL('../supabase/migration-admin-configuration-communications.sql', import.meta.url), 'utf-8');
  const start = sql.indexOf('create or replace function public.record_admin_change()');
  const end = sql.indexOf('create or replace function public.booking_change_log_and_notify()', start);
  const audit = sql.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(audit, /new\.title|old\.title|new\.resource_ids/);
  assert.match(sql.slice(end), /delete from public\.booking_email_outbox where booking_id = old\.id and status = 'pending'/);
  assert.match(sql, /create or replace function public.admin_update_mail_template/);
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.match(sql, /p_template_key not in \('booking_confirmation', 'booking_changed', 'booking_cancelled', 'booking_reminder'\)/);
});


test('Zugangsentzug laesst Auth-Konto bestehen und Einladung reaktiviert es', () => {
  const source = readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf-8');
  assert.match(source, /auth\.admin\.inviteUserByEmail/);
  assert.match(source, /findAuthUserByEmail\(email\)/);
  assert.match(source, /restored = true/);
  assert.match(source, /from\('memberships'\)\.upsert/);
  const removeStart = source.indexOf("if (action === 'remove') {");
  const removeEnd = source.indexOf("return json({ error: 'Unbekannte Aktion.'", removeStart);
  const removeBlock = source.slice(removeStart, removeEnd);
  assert.ok(removeStart >= 0 && removeEnd > removeStart);
  assert.match(removeBlock, /from\('memberships'\)\.delete/);
  assert.doesNotMatch(removeBlock, /auth\.admin\.deleteUser/);
});


test('Gesamtplan oeffnet Buchungen ueber denselben Detailpfad und Veranstaltungskategorie unterdrueckt Buchungsmails', () => {
  const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf-8');
  const fallback = readFileSync(new URL('../404.html', import.meta.url), 'utf-8');
  const config = readFileSync(new URL('../assets/js/config.js', import.meta.url), 'utf-8');
  const migration = readFileSync(new URL('../supabase/migration-booking-email-controls.sql', import.meta.url), 'utf-8');
  assert.match(app, /data-link="\/belegungsplan\/gesamt" aria-label="Gesamtbelegungsplan">Gesamtbelegungsplan/);
  assert.match(fallback, /var base = '\/Vereinskalender\//);
  assert.match(config, /BASE_PATH: '\/Vereinskalender\//);
  assert.match(app, /if \(p === '\/belegungsplan\/gesamt'\) return \{ name: 'combinedPlan' \}/);
  assert.match(app, /querySelectorAll\('\.combined-event'\).*openDetail\(button\.dataset\.id\)/s);
  assert.match(app, /\.trim\(\)\.toLowerCase\(\) === 'veranstaltung'/);
  assert.match(app, /contactEmail = eventCategory \? null/);
  assert.match(app, /reminderDays = eventCategory \? 0/);
  assert.match(migration, /lower\(btrim\(c\.name\)\) = 'veranstaltung'/);
  assert.match(migration, /not public\.booking_is_event_category\(new\.category_id\)/);
  assert.match(migration, /not public\.booking_is_event_category\(bk\.category_id\)/);
  assert.match(migration, /booking_mail_template_enabled\(v_kind\)/);
  assert.match(migration, /jsonb_typeof\(p_template->'enabled'\).*boolean/);
  assert.match(migration, /kind = v_kind and status = 'pending'/);
  assert.match(migration, /'skipped'/);
});

test('Ereignisformular speichert getrennte automatische Versandregeln mit sicheren Defaults', () => {
  const annual = readFileSync(new URL('../assets/js/annual-events.js', import.meta.url), 'utf-8');
  const migration = readFileSync(new URL('../supabase/migration-event-email-controls.sql', import.meta.url), 'utf-8');
  const worker = readFileSync(new URL('../scripts/send_annual_event_lifecycle_emails.py', import.meta.url), 'utf-8');
  assert.match(annual, /id="ae-confirmation-enabled" type="checkbox"/);
  assert.match(annual, /id="ae-changed-enabled" type="checkbox"/);
  assert.match(annual, /id="ae-cancelled-enabled" type="checkbox"/);
  assert.match(annual, /id="ae-reminder-enabled" type="checkbox"/);
  assert.doesNotMatch(annual, /id="ae-append-signature" type="checkbox"/);
  assert.match(annual, /const initialBody = event[\s\S]*: defaultSignature/);
  assert.match(annual, /append_signature: false/);
  assert.match(annual, /<option value="1"/);
  assert.match(annual, /<option value="2"/);
  assert.match(annual, /<option value="7"/);
  assert.match(annual, /confirmation_enabled: q\('#ae-confirmation-enabled'\)\.checked/);
  assert.match(annual, /reminder_days: Number\(q\('#ae-reminder-days'\)\.value\)/);
  assert.match(migration, /confirmation_enabled boolean not null default false/);
  assert.match(migration, /reminder_enabled boolean not null default false/);
  assert.match(migration, /check \(reminder_days in \(1, 2, 7\)\)/);
  assert.match(migration, /annual_event_lifecycle_mail_trigger/);
  assert.match(migration, /claim_annual_event_mail_outbox/);
  assert.match(migration, /delete from public\.annual_event_mail_outbox[\s\S]*status = 'pending'/);
  assert.match(worker, /template_is_enabled_for_event/);
  assert.match(worker, /_expected_updated_at/);
  assert.doesNotMatch(worker, /mail_templates.*enabled/);
  assert.doesNotMatch(annual, /data-event-template/);
});


test('Einmaliger Ereignisversand nutzt gespeicherte Empfänger, Outbox und aktive Versionsprüfung', () => {
  const annual = readFileSync(new URL('../assets/js/annual-events.js', import.meta.url), 'utf-8');
  const data = readFileSync(new URL('../assets/js/data.js', import.meta.url), 'utf-8');
  const migration = readFileSync(new URL('../supabase/migration-event-individual-messages.sql', import.meta.url), 'utf-8');
  const worker = readFileSync(new URL('../scripts/send_annual_event_lifecycle_emails.py', import.meta.url), 'utf-8');
  assert.match(annual, /id="ae-send-individual"/);
  assert.match(annual, /id="ae-send-after-save" type="checkbox"/);
  assert.match(annual, /const sendAfterSave = q\('#ae-send-after-save'\)\.checked/);
  assert.match(annual, /sendAnnualEventIndividualMessage\(id\)/);
  assert.match(annual, /zuletzt gespeicherte Betreff und Nachricht/);
  assert.match(annual, /confirm\(`Die zuletzt gespeicherte Nachricht/);
  assert.match(data, /queue_annual_event_individual_message/);
  assert.match(migration, /'individual'/);
  assert.match(migration, /if not e\.active then/);
  assert.match(migration, /distinct on \(lower\(btrim\(r\.email\)\)\)/);
  assert.match(migration, /grant execute on function public\.queue_annual_event_individual_message\(uuid\) to authenticated/);
  assert.match(worker, /if kind == "individual":/);
  assert.match(worker, /_expected_updated_at/);
  assert.match(worker, /get\("active"\) is not True/);
});

test('Passwort-Reset nutzt den konfigurierten Redirect und protokolliert Fehler ohne E-Mail-Adresse', () => {
  const data = readFileSync(new URL('../assets/js/data.js', import.meta.url), 'utf-8');
  const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf-8');
  const config = readFileSync(new URL('../assets/js/config.js', import.meta.url), 'utf-8');
  const setup = readFileSync(new URL('../docs/EINRICHTUNG.md', import.meta.url), 'utf-8');
  assert.match(data, /auth\/v1\/recover\?redirect_to=/);
  assert.match(data, /new URL\(CONFIG\.BASE_PATH, location\.origin\)\.href/);
  assert.match(config, /BASE_PATH: '\/Vereinskalender\/'/);
  assert.match(setup, /Redirect URLs[\s\S]*?\/Vereinskalender\//);
  assert.doesNotMatch(setup, /\/vereinskalender\//);
  assert.match(app, /console\.error\('Passwort-Wiederherstellung fehlgeschlagen:'/);
});
