// Berechnung der Positionen für Kalender (Tag/Woche) und Belegungsplan (Zeitleiste).
// Reine Funktionen ohne DOM, dadurch testbar.
import { layoutLanes } from './logic.js';

const HOUR = 3600000;

// Zerlegt einen Termin in Abschnitte je Tag, begrenzt auf das Sichtfenster (dayStartH..dayEndH).
export function segmentsForDays(booking, days, dayStartH, dayEndH) {
  const s0 = new Date(booking.starts_at);
  const e0 = new Date(booking.ends_at);
  const out = [];
  days.forEach((day, idx) => {
    const ws = new Date(day.getFullYear(), day.getMonth(), day.getDate(), dayStartH);
    const we = new Date(day.getFullYear(), day.getMonth(), day.getDate(), dayEndH);
    const s = s0 > ws ? s0 : ws;
    const e = e0 < we ? e0 : we;
    if (e > s) out.push({ booking, dayIndex: idx, start: s, end: e });
  });
  return out;
}

// Spalten für die Tages- bzw. Wochenansicht eines Raumkalenders.
// Liefert je Abschnitt top/height in Pixel sowie left/width in Prozent (bei Überlappung nebeneinander).
export function timeGridBlocks(segments, dayStartH, hourPx) {
  const byDay = new Map();
  segments.forEach((seg) => {
    if (!byDay.has(seg.dayIndex)) byDay.set(seg.dayIndex, []);
    byDay.get(seg.dayIndex).push(seg);
  });
  const blocks = [];
  for (const [dayIndex, segs] of byDay) {
    const placed = layoutLanes(segs.map((s) => ({ start: s.start, end: s.end, seg: s })));
    placed.forEach(({ item, lane, lanes }) => {
      const s = item.seg;
      const base = new Date(s.start.getFullYear(), s.start.getMonth(), s.start.getDate(), dayStartH);
      blocks.push({
        booking: s.booking,
        dayIndex,
        top: (s.start - base) / HOUR * hourPx,
        height: Math.max((s.end - s.start) / HOUR * hourPx, 22),
        left: (lane / lanes) * 100,
        width: (1 / lanes) * 100,
        startDate: s.start,
        endDate: s.end
      });
    });
  }
  return blocks;
}

// Zeitleiste: Balken in Pixel-Koordinaten über mehrere Tage. Überlappende Termine einer Zeile
// werden in Spuren (Lanes) untereinander dargestellt.
export function timelineRow(segments, dayCount, dayStartH, dayEndH, hourPx) {
  const dayW = (dayEndH - dayStartH) * hourPx;
  const items = segments.map((seg) => {
    const base = new Date(seg.start.getFullYear(), seg.start.getMonth(), seg.start.getDate(), dayStartH);
    const x = seg.dayIndex * dayW + (seg.start - base) / HOUR * hourPx;
    const w = Math.max((seg.end - seg.start) / HOUR * hourPx, 6);
    return { seg, x, w };
  });
  const placed = layoutLanes(items.map((it) => ({ start: it.x, end: it.x + it.w, it })));
  const bars = placed.map(({ item, lane, lanes }) => ({
    booking: item.it.seg.booking,
    dayIndex: item.it.seg.dayIndex,
    x: item.it.x,
    width: item.it.w,
    lane,
    startDate: item.it.seg.start,
    endDate: item.it.seg.end
  }));
  const lanesUsed = bars.length ? Math.max(...placed.map((p) => p.lanes)) : 1;
  return { bars, lanes: lanesUsed, width: dayCount * dayW };
}

// Tag-Index und Tagesbeginn für Zeitleisten-Achse
export function dayBoundaries(days) {
  return days.map((d) => ({ label: d, index: days.indexOf(d) }));
}
