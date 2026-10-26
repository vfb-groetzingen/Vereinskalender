import test from 'node:test';
import assert from 'node:assert/strict';
import * as LY from '../assets/js/layout.js';

const day = (y, m, d) => new Date(y, m - 1, d);
const booking = (id, s, e) => ({ id, title: id, starts_at: s.toISOString(), ends_at: e.toISOString() });

test('Abschnitte: Termin über Mitternacht wird je Tag gekürzt', () => {
  const b = booking('x', new Date(2026, 9, 26, 22), new Date(2026, 9, 27, 10));
  const segs = LY.segmentsForDays(b, [day(2026, 10, 26), day(2026, 10, 27)], 7, 23);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start.getHours(), 22);
  assert.equal(segs[0].end.getHours(), 23);
  assert.equal(segs[1].start.getHours(), 7);
  assert.equal(segs[1].end.getHours(), 10);
});

test('Abschnitte: Termin außerhalb des Sichtfensters erzeugt kein Segment', () => {
  const b = booking('x', new Date(2026, 9, 26, 3), new Date(2026, 9, 26, 6));
  assert.equal(LY.segmentsForDays(b, [day(2026, 10, 26)], 7, 23).length, 0);
});

test('Tagesansicht: Position und Höhe in Pixeln (48 px je Stunde, Beginn 7 Uhr)', () => {
  const b = booking('x', new Date(2026, 9, 26, 17, 30), new Date(2026, 9, 26, 19));
  const segs = LY.segmentsForDays(b, [day(2026, 10, 26)], 7, 23);
  const [blk] = LY.timeGridBlocks(segs, 7, 48);
  assert.equal(blk.top, (17.5 - 7) * 48);
  assert.equal(blk.height, 1.5 * 48);
  assert.equal(blk.left, 0);
  assert.equal(blk.width, 100);
});

test('Tagesansicht: überlappende Termine teilen die Spalte', () => {
  const a = booking('a', new Date(2026, 9, 26, 17), new Date(2026, 9, 26, 19));
  const c = booking('c', new Date(2026, 9, 26, 18), new Date(2026, 9, 26, 20));
  const segs = [...LY.segmentsForDays(a, [day(2026, 10, 26)], 7, 23), ...LY.segmentsForDays(c, [day(2026, 10, 26)], 7, 23)];
  const blocks = LY.timeGridBlocks(segs, 7, 48);
  assert.equal(blocks.length, 2);
  blocks.forEach((b) => assert.equal(b.width, 50));
  assert.notEqual(blocks[0].left, blocks[1].left);
});

test('Zeitleiste: x-Position über mehrere Tage (Tag 2 beginnt nach 16 Stunden)', () => {
  const days = [day(2026, 10, 26), day(2026, 10, 27)];
  const b = booking('x', new Date(2026, 9, 27, 8), new Date(2026, 9, 27, 10));
  const segs = LY.segmentsForDays(b, days, 7, 23);
  const row = LY.timelineRow(segs, 2, 7, 23, 40);
  assert.equal(row.width, 2 * 16 * 40);
  assert.equal(row.bars[0].x, 16 * 40 + (8 - 7) * 40);
  assert.equal(row.bars[0].width, 2 * 40);
  assert.equal(row.lanes, 1);
});

test('Zeitleiste: Doppelbelegung über Spuren sichtbar, Zeilenhöhe berücksichtigt', () => {
  const days = [day(2026, 10, 26)];
  const a = booking('a', new Date(2026, 9, 26, 17), new Date(2026, 9, 26, 19));
  const c = booking('c', new Date(2026, 9, 26, 18), new Date(2026, 9, 26, 20));
  const segs = [...LY.segmentsForDays(a, days, 7, 23), ...LY.segmentsForDays(c, days, 7, 23)];
  const row = LY.timelineRow(segs, 1, 7, 23, 40);
  assert.equal(row.lanes, 2);
  assert.notEqual(row.bars[0].lane, row.bars[1].lane);
});
