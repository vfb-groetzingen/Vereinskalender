import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// SupabaseStore builds ROOT from the current origin when its module is loaded.
globalThis.location ||= { origin: 'http://localhost' };
const { SupabaseStore } = await import('../assets/js/data.js');
const dataSource = readFileSync(new URL('../assets/js/data.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const adminFunction = readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migration-user-presence.sql', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../docs/EINRICHTUNG.md', import.meta.url), 'utf8');

test('Angemeldete Kalenderkonten aktualisieren ausschließlich ihren eigenen Heartbeat per RPC', async () => {
  const store = Object.create(SupabaseStore.prototype);
  store.session = { access_token: 'session-token' };
  store.userId = 'member-1';
  store.role = 'bearbeiter';
  let request;
  store._req = async (...args) => { request = args; return '2026-01-01T10:00:00Z'; };
  const result = await store.touchPresence();
  assert.equal(result, '2026-01-01T10:00:00Z');
  assert.deepEqual(request, ['/rest/v1/rpc/touch_user_presence', { method: 'POST', body: {} }]);

  store.role = null;
  store._req = async () => assert.fail('Ohne Kalenderrolle darf kein Heartbeat gesendet werden');
  assert.equal(await store.touchPresence(), null);
});

test('Presence-Action ist serverseitig Admin-only und liefert nur Zeitstempel', () => {
  const adminCheck = adminFunction.indexOf("membership?.role !== 'admin'");
  const actionCheck = adminFunction.indexOf("if (action === 'presence')");
  assert.ok(adminCheck >= 0 && actionCheck > adminCheck, 'Admin-Prüfung muss vor jeder Presence-Abfrage erfolgen');
  assert.match(adminFunction, /from\('user_presence'\)\.select\('user_id, last_seen_at'\)/);
  assert.match(adminFunction, /presence_available: false/);
  assert.match(adminFunction, /presence_available: !presenceResult\.error/);
});

test('Oberfläche startet den Heartbeat nur bei sichtbarer Anmeldung und aktualisiert Adminstatus', () => {
  assert.match(appSource, /PRESENCE_ONLINE_WINDOW_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
  assert.match(appSource, /document\.visibilityState !== 'visible'.*S\.store\?\.mode !== 'supabase'/s);
  assert.match(appSource, /setInterval\(\(\) => \{ void sendPresenceHeartbeat\(\); \}, 60_000\)/);
  assert.match(appSource, /setInterval\(\(\) => \{ void refreshAdminPresence\(\); \}, 30_000\)/);
  assert.match(appSource, /Gerade aktiv/);
  assert.match(appSource, /Zuletzt online:/);
  assert.match(appSource, /Noch nicht erfasst/);
  assert.match(appSource, /member-presence-note/);
  assert.match(appSource, /keine Klicks, Tastatureingaben oder Seiteninhalte/i);
  assert.match(appSource, /stopPresenceHeartbeat\(\); await s\.signOut\(\)/);
});

test('Migration beschränkt Datenzugriff, bindet den Zeitstempel an das Mitglied und löscht ihn beim Zugangsentzug', () => {
  assert.match(migration, /user_id uuid primary key references public\.memberships\(user_id\) on delete cascade/);
  assert.match(migration, /last_seen_at timestamptz not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.user_presence from anon, authenticated/);
  assert.match(migration, /security definer/);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.touch_user_presence\(\) to authenticated/);
  assert.match(migration, /datenschutz_text/);
  assert.match(setup, /migration-user-presence\.sql/);
  assert.match(setup, /admin-users.*erneut bereitgestellt/);
});
