// Testet den Demo-Speicher: überlappende Termine, Rechte und Notizen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Minimale Browser-Umgebung für das Modul
const store = new Map();
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/vereinskalender/', pathname: '/vereinskalender/', search: '', hash: '' };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf-8'));
const { DemoStore } = await import('../assets/js/data.js');

const fresh = () => { store.clear(); return new DemoStore(seed); };
const booking = (resource_id, s, e, extra = {}) => ({
  resource_id, category_id: 'cat-training', title: 'Test', starts_at: s, ends_at: e, notes: 'intern', ...extra
});
const res = 'res-trainingsplatz-a';

test('Besucher dürfen nicht schreiben', async () => {
  const s = fresh();
  await assert.rejects(() => s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]), (e) => e.code === '42501');
});

test('Bearbeiter dürfen auch überlappende Termine auf derselben Ressource anlegen', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await s.createBookings([booking(res, '2030-01-07T17:30:00Z', '2030-01-07T18:30:00Z')]);
  assert.equal(s.bookings.filter((b) => b.title === 'Test' && b.starts_at.startsWith('2030-01-07')).length, 2);
});

test('Überlappende Termine in derselben Import-Anfrage werden gespeichert', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  const inserted = await s.createBookings([
    booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z'),
    booking(res, '2030-01-07T17:30:00Z', '2030-01-07T18:30:00Z')
  ]);
  assert.equal(inserted.length, 2);
});

test('Gleiche Zeit auf anderem Platz ist erlaubt', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await s.createBookings([booking('res-kunstrasenplatz', '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
});

test('Ein gemeinsamer Termin erscheint in allen ausgewählten Ressourcenkalendern', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  const second = 'res-kunstrasenplatz';
  const [created] = await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z', { resource_ids: [res, second] })]);
  assert.deepEqual(created.resource_ids, [res, second]);
  const all = (await s.getAllBookings()).filter((item) => item.id === created.id);
  assert.deepEqual(new Set(all.map((item) => item.resource_id)), new Set([res, second]));
  assert.equal((await s.getAllBookings(second)).filter((item) => item.id === created.id).length, 1);
  await s.updateBooking(created.id, { resource_id: second, resource_ids: [second] });
  assert.deepEqual(s.bookings.find((item) => item.id === created.id).resource_ids, [second]);
});

test('getAllBookings lädt alle Zeiträume und kann nach Ressource filtern', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  const before = await s.getAllBookings();
  await s.createBookings([
    booking(res, '2000-01-07T17:00:00Z', '2000-01-07T18:00:00Z'),
    booking('res-kunstrasenplatz', '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')
  ]);
  const all = await s.getAllBookings();
  const filtered = await s.getAllBookings(res);
  assert.equal(all.length, before.length + 2);
  assert.equal(all.filter((b) => b.starts_at.startsWith('2000-01-07')).length, 1);
  assert.equal(filtered.filter((b) => b.starts_at.startsWith('2000-01-07')).length, 1);
});

test('getSeriesBookings lädt eine vollständige Serie chronologisch', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await s.createBookings([
    booking(res, '2030-01-14T17:00:00Z', '2030-01-14T18:00:00Z', { series_id: 'series-test' }),
    booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z', { series_id: 'series-test' }),
    booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z', { series_id: 'other-series' })
  ]);
  const result = await s.getSeriesBookings('series-test');
  assert.equal(result.length, 2);
  assert.ok(result[0].starts_at < result[1].starts_at);
});

test('Besucher sehen keine Notizen', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await s.signOut();
  const list = await s.getBookings({ from: new Date('2030-01-07T00:00:00Z'), to: new Date('2030-01-08T00:00:00Z') });
  assert.equal(list.length, 1);
  assert.equal('notes' in list[0], false);
});

test('Bearbeiten: ein Termin darf auf ein bereits belegtes Zeitfenster verschoben werden', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  const [a] = await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  const [b] = await s.createBookings([booking(res, '2030-01-07T18:00:00Z', '2030-01-07T19:00:00Z')]);
  await s.updateBooking(b.id, { starts_at: '2030-01-07T17:30:00Z' });
  assert.equal(s.bookings.filter((x) => x.resource_id === res && x.starts_at.startsWith('2030-01-07')).length, 2);
  assert.ok(a.id !== b.id);
});

test('Löschen erfordert Berechtigung', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  const [a] = await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await s.signOut();
  await assert.rejects(() => s.deleteBookings([a.id]), (e) => e.code === '42501');
});

test('Demo-Startdaten enthalten keine Doppelbelegungen', () => {
  const s = fresh();
  const byRes = new Map();
  for (const b of s.bookings) {
    if (!byRes.has(b.resource_id)) byRes.set(b.resource_id, []);
    byRes.get(b.resource_id).push(b);
  }
  for (const list of byRes.values()) {
    list.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].starts_at >= list[i - 1].ends_at, `Überschneidung: ${list[i].title}`);
    }
  }
});
