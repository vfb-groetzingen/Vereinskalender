// Testet den Demo-Speicher (gleiche Regeln wie die Datenbank: Doppelbelegung, Rechte, Notizen).
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

test('Bearbeiter dürfen schreiben, Doppelbelegung wird abgelehnt (SQLSTATE 23P01)', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await assert.rejects(
    () => s.createBookings([booking(res, '2030-01-07T17:30:00Z', '2030-01-07T18:30:00Z')]),
    (e) => e.code === '23P01'
  );
});

test('Doppelbelegung innerhalb derselben Anfrage (Serie) wird abgelehnt', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await assert.rejects(() => s.createBookings([
    booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z'),
    booking(res, '2030-01-07T17:30:00Z', '2030-01-07T18:30:00Z')
  ]), (e) => e.code === '23P01');
  assert.equal(s.bookings.filter((b) => b.title === 'Test' && b.starts_at.startsWith('2030-01-07')).length, 0);
});

test('Gleiche Zeit auf anderem Platz ist erlaubt', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await s.createBookings([booking('res-kunstrasenplatz', '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
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

test('Bearbeiten: eigener Termin wird nicht als Konflikt gewertet, fremder schon', async () => {
  const s = fresh();
  await s.signIn({ role: 'bearbeiter' });
  const [a] = await s.createBookings([booking(res, '2030-01-07T17:00:00Z', '2030-01-07T18:00:00Z')]);
  await s.updateBooking(a.id, { title: 'Neu' });
  await s.createBookings([booking(res, '2030-01-07T18:00:00Z', '2030-01-07T19:00:00Z')]); // Randberührung ok
  await assert.rejects(() => s.updateBooking(a.id, { ends_at: '2030-01-07T18:30:00Z' }), (e) => e.code === '23P01');
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
