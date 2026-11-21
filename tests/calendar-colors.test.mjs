import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarColorsForResources, calendarColorStyles, normalizeCalendarColor } from '../assets/js/calendar-colors.js';

test('Kalenderfarben werden ausschließlich als sichere Hexfarben übernommen', () => {
  assert.equal(normalizeCalendarColor('#ffcc00'), '#ffcc00');
  assert.equal(normalizeCalendarColor('red'), null);
  assert.equal(normalizeCalendarColor('url(javascript:alert(1))', '#4a5568'), '#4a5568');
});

test('Ressourcenfarben werden anhand der Kalenderzuordnung geholt und dedupliziert', () => {
  const resources = [
    { id: 'room-a', color: '#ffcc00' },
    { id: 'room-b', color: '#d66ac3' },
  ];
  assert.deepEqual(calendarColorsForResources(['room-a', 'room-a', 'missing', 'room-b'], resources), ['#ffcc00', '#d66ac3']);
});

test('Ereignismarker übernimmt eine Einzelkalenderfarbe und zeigt Mehrfachzuordnungen mehrfarbig', () => {
  assert.deepEqual(calendarColorStyles(['#ffcc00']), { border: '#ffcc00', background: '#fff5cc' });
  const multi = calendarColorStyles(['#ffcc00', '#d66ac3']);
  assert.equal(multi.border, '#ffcc00');
  assert.match(multi.background, /^linear-gradient\(90deg,/);
  assert.match(multi.background, /#fff5cc/);
  assert.match(multi.background, /#f7e1f3/);
});
