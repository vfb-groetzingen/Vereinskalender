import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/annual-events.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migration-annual-email-on-date.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../scripts/send_annual_event_emails.py', import.meta.url), 'utf8');
test('Ereignisse bieten eine eigene jährliche Erinnerung mit Kalenderanzeige und gespeicherten Maildaten', () => {
  assert.match(source, /id="annual-reminder-new">Erinnerung anlegen/);
  assert.match(source, /openEventForm\(app, store, setNotice, null, null, true\)/);
  assert.match(source, /email_on_date: reminderMode/);
  assert.match(source, /Jährliche Wiederholung/);
  assert.match(source, /resource_ids: resourceIds, category_id: categoryId/);
  assert.match(source, /event\.email_on_date \? `Erinnerung:/);
  assert.match(migration, /add column if not exists email_on_date boolean not null default false/);
  assert.match(worker, /event_email_on_date_due_on/);
});
