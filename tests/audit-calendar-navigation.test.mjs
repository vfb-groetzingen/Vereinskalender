import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const protocol = readFileSync(new URL('../docs/TESTPROTOKOLL.md', import.meta.url), 'utf8');

test('Änderungsprotokoll zeigt Kalender und Termin separat und filtert alte/neue Ressource', () => {
  assert.match(app, /<th>Kalender<\/th><th>Termin<\/th><th>Eintrag<\/th>/);
  assert.match(app, /auditResourceIds\(before, after\)/);
  assert.match(app, /data-resources="\$\{esc\(ids\.join\(','\)\)\}"/);
  assert.match(app, /calendarLabel/);
  assert.match(app, /beforeDateLabel.*afterDateLabel/s);
});

test('Kalenderwochen-Link wird nur für Buchung mit eindeutigem Zielkalender und gültigem Datum erzeugt', () => {
  assert.match(app, /entry\.action === 'deleted' \? \(before \|\| after\) : \(after \|\| before\)/);
  assert.match(app, /destinationIds\.length === 1/);
  assert.match(app, /entry\.entity_type === 'booking' && destinationResource\?\.slug && dateKey/);
  assert.match(app, /\?date=\$\{dateKey\}&view=week/);
  assert.match(app, /Kalenderwoche öffnen/);
});

test('Kalender übernimmt den Datumsparameter einmalig und öffnet die Wochenansicht', () => {
  assert.match(app, /function applyRoomQueryState\(\)/);
  assert.match(app, /const rawDate = params\.get\('date'\)/);
  assert.match(app, /S\.roomAnchor = target/);
  assert.match(app, /S\.roomView = \['day', 'week', 'month'\]\.includes\(requestedView\) \? requestedView : 'week'/);
  assert.match(app, /params\.delete\('date'\)[\s\S]*params\.delete\('view'\)/);
  assert.match(app, /applyRoomQueryState\(\);\s*const range = roomRange\(\)/);
});

test('Sprung-Link ist sichtbar gestaltet und der manuelle Testablauf deckt eindeutige und mehrdeutige Einträge ab', () => {
  assert.match(css, /\.audit-calendar-jump/);
  assert.match(protocol, /Kalender und Terminzeit für Buchungen kontrollieren/);
  assert.match(protocol, /keinen mehrdeutigen Sprung-Link/);
});
