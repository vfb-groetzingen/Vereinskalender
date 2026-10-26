// Ausführen mit: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../assets/js/logic.js';

const resources = [
  { id: 'r1', slug: 'trainingsplatz-a', name: 'Trainingsplatz A' },
  { id: 'r2', slug: 'jugendraum', name: 'Jugendraum' }
];
const categories = [{ id: 'c1', name: 'Training' }, { id: 'c2', name: 'Spiel' }];
const ctx = { resources, categories };

test('Datum: deutsches Format wird akzeptiert', () => {
  assert.deepEqual(L.parseDate('25.10.2026'), { value: '2026-10-25' });
  assert.deepEqual(L.parseDate('5.3.2027'), { value: '2027-03-05' });
});

test('Datum: ISO-Format wird akzeptiert', () => {
  assert.deepEqual(L.parseDate('2026-10-25'), { value: '2026-10-25' });
});

test('Datum: nicht existierender Tag wird abgelehnt', () => {
  assert.equal(L.parseDate('31.02.2026').error, 'Das Datum „31.02.2026“ existiert nicht.');
  assert.equal(L.parseDate('29.02.2027').error, 'Das Datum „29.02.2027“ existiert nicht.');
  assert.deepEqual(L.parseDate('29.02.2028'), { value: '2028-02-29' });
});

test('Datum: falsches Format wird mit Hinweis abgelehnt', () => {
  assert.match(L.parseDate('2026/10/25').error, /ungültiges Format/);
  assert.match(L.parseDate('').error, /fehlt/);
});

test('Datum: Excel-Seriennummer wird umgerechnet', () => {
  // 46000 entspricht 2025-12-09 im Excel-Datumssystem (1900)
  assert.deepEqual(L.parseDate(46000), { value: '2025-12-09' });
});

test('Uhrzeit: gültige und ungültige Werte', () => {
  assert.deepEqual(L.parseTime('9:05'), { value: '09:05' });
  assert.deepEqual(L.parseTime('18:30'), { value: '18:30' });
  assert.match(L.parseTime('25:00').error, /ungültig/);
  assert.match(L.parseTime('abc').error, /ungültig/);
  assert.deepEqual(L.parseTime(0.5), { value: '12:00' });
});

test('Konflikte: Überschneidung auf gleicher Ressource wird erkannt', () => {
  const existing = [{ id: 'b1', resource_id: 'r1', title: 'Training', starts_at: '2026-10-26T15:30:00Z', ends_at: '2026-10-26T17:00:00Z' }];
  const hit = L.findConflicts(existing, { resource_id: 'r1', starts_at: '2026-10-26T16:00:00Z', ends_at: '2026-10-26T18:00:00Z' });
  assert.equal(hit.length, 1);
});

test('Konflikte: Randberührung ist kein Konflikt (Ende = Start)', () => {
  const existing = [{ id: 'b1', resource_id: 'r1', starts_at: '2026-10-26T15:30:00Z', ends_at: '2026-10-26T17:00:00Z' }];
  const hit = L.findConflicts(existing, { resource_id: 'r1', starts_at: '2026-10-26T17:00:00Z', ends_at: '2026-10-26T18:00:00Z' });
  assert.equal(hit.length, 0);
});

test('Konflikte: andere Ressource ist kein Konflikt', () => {
  const existing = [{ id: 'b1', resource_id: 'r2', starts_at: '2026-10-26T15:30:00Z', ends_at: '2026-10-26T17:00:00Z' }];
  assert.equal(L.findConflicts(existing, { resource_id: 'r1', starts_at: '2026-10-26T16:00:00Z', ends_at: '2026-10-26T18:00:00Z' }).length, 0);
});

test('Konflikte: eigener Termin wird beim Bearbeiten ignoriert', () => {
  const existing = [{ id: 'b1', resource_id: 'r1', starts_at: '2026-10-26T15:30:00Z', ends_at: '2026-10-26T17:00:00Z' }];
  assert.equal(L.findConflicts(existing, { resource_id: 'r1', starts_at: '2026-10-26T16:00:00Z', ends_at: '2026-10-26T18:00:00Z' }, 'b1').length, 0);
});

test('Import: gültige Datei wird vollständig übernommen', () => {
  const table = [
    ['Titel', 'Ressource', 'Kategorie', 'Datum', 'Start', 'Ende', 'Notiz'],
    ['A-Junioren Training', 'Trainingsplatz A', 'Training', '27.10.2026', '17:30', '19:00', 'Bälle mitbringen'],
    ['B-Junioren Training', 'trainingsplatz-a', 'training', '2026-10-28', '18:00', '19:30', '']
  ];
  const r = L.validateTable(table, ctx);
  assert.equal(r.errors.length, 0);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.bookings.length, 2);
  assert.equal(r.bookings[0].notes, 'Bälle mitbringen');
  assert.equal(r.bookings[1].notes, null);
});

test('Import: Fehler werden mit Zeilennummer gemeldet', () => {
  const table = [
    ['Titel', 'Ressource', 'Kategorie', 'Datum', 'Start', 'Ende'],
    ['Test', 'Trainingsplatz A', 'Training', '31.02.2026', '17:00', '18:00'],
    ['Test', 'Platz 9', 'Training', '01.11.2026', '17:00', '18:00'],
    ['Test', 'Trainingsplatz A', 'Training', '01.11.2026', '18:00', '17:00'],
    ['', 'Jugendraum', 'Unbekannt', '01.11.2026', '17:00', '18:00']
  ];
  const r = L.validateTable(table, ctx);
  assert.equal(r.bookings.length, 0);
  const msgs = r.errors.map((e) => e.message);
  assert.ok(msgs.includes('Zeile 2: Das Datum „31.02.2026“ existiert nicht.'));
  assert.ok(msgs.includes('Zeile 3: Die Ressource „Platz 9“ ist unbekannt.'));
  assert.ok(msgs.some((m) => m.startsWith('Zeile 4: Die Endzeit (17:00) liegt nicht nach der Startzeit')));
  assert.ok(msgs.includes('Zeile 5: Der Titel fehlt.'));
  assert.ok(msgs.some((m) => m.startsWith('Zeile 5: Die Kategorie „Unbekannt“ ist unbekannt.')));
});

test('Import: Überschneidung innerhalb der Datei und mit Bestand', () => {
  const existing = [{ id: 'b9', resource_id: 'r1', title: 'Bestand', starts_at: new Date(2026, 9, 27, 17, 0).toISOString(), ends_at: new Date(2026, 9, 27, 18, 0).toISOString() }];
  const table = [
    ['Titel', 'Ressource', 'Kategorie', 'Datum', 'Start', 'Ende'],
    ['Neu A', 'Trainingsplatz A', 'Training', '27.10.2026', '17:30', '18:30'],
    ['Neu B', 'Trainingsplatz A', 'Training', '28.10.2026', '10:00', '11:00'],
    ['Neu C', 'Trainingsplatz A', 'Training', '28.10.2026', '10:30', '11:30']
  ];
  const r = L.validateTable(table, { ...ctx, existing });
  assert.equal(r.errors.length, 0);
  assert.equal(r.conflicts.length, 2);
  assert.match(r.conflicts[0].message, /mit „Bestand“/);
  assert.match(r.conflicts[1].message, /Zeile 4: Überschneidung .* mit Zeile 3/);
});

test('Import: fehlende Pflichtspalte wird benannt', () => {
  const r = L.validateTable([['Titel', 'Ressource', 'Datum', 'Start', 'Ende'], ['X', 'Jugendraum', '01.11.2026', '10:00', '11:00']], ctx);
  assert.match(r.errors[0].message, /Kategorie/);
});

test('CSV: Semikolon, Anführungszeichen und Zeilenumbrüche', () => {
  const csv = '\uFEFFTitel;Ressource;Notiz\r\n"Spiel; Heim";Jugendraum;"Zeile 1\nZeile 2"\r\n';
  const rows = L.parseCSV(csv);
  assert.deepEqual(rows[0], ['Titel', 'Ressource', 'Notiz']);
  assert.equal(rows[1][0], 'Spiel; Heim');
  assert.equal(rows[1][2], 'Zeile 1\nZeile 2');
});

test('CSV: Komma als Trennzeichen', () => {
  assert.deepEqual(L.parseCSV('a,b,c\n1,2,3')[1], ['1', '2', '3']);
});

test('Lanes: überlappende Termine erhalten getrennte Spuren', () => {
  const t = (h1, h2) => ({ start: new Date(2026, 9, 26, h1), end: new Date(2026, 9, 26, h2) });
  const res = L.layoutLanes([t(17, 19), t(18, 20), t(21, 22)]);
  const lanes = Object.fromEntries(res.map((r) => [r.item.start.getHours(), r]));
  assert.equal(lanes[17].lane, 0);
  assert.equal(lanes[18].lane, 1);
  assert.equal(lanes[18].lanes, 2);
  assert.equal(lanes[21].lanes, 1);
});

test('Serien: wöchentliche Termine', () => {
  assert.deepEqual(L.seriesDates('2026-10-26', 3), ['2026-10-26', '2026-11-02', '2026-11-09']);
});

test('Zeitumstellung am 25.10.2026: Uhrzeit bleibt lokal korrekt', () => {
  const d = L.combine('2026-10-25', '18:00');
  assert.equal(d.getHours(), 18);
  assert.equal(d.getMinutes(), 0);
});
