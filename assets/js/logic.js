// Reine Logik ohne DOM-Zugriff. Dadurch automatisiert testbar (siehe tests/).

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

// Montag als Wochenbeginn
export function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const wd = (d.getDay() + 6) % 7;
  return addDays(d, -wd);
}

export function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Kombiniert Datum (YYYY-MM-DD) und Uhrzeit (HH:MM) zu einem lokalen Date
export function combine(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

// Datum aus Eingabe: "TT.MM.JJJJ", "JJJJ-MM-TT", Excel-Seriennummer oder Date.
// Gibt { value: 'YYYY-MM-DD' } oder { error: 'Meldung' } zurück.
export function parseDate(input) {
  if (input instanceof Date && !isNaN(input)) return { value: ymd(input) };
  if (typeof input === 'number' && isFinite(input)) {
    // Excel-Seriennummer (Tage seit 1899-12-30)
    if (input < 1 || input > 2958465) return { error: `Die Zahl „${input}“ ist kein gültiges Datum.` };
    const dt = new Date(Math.round((input - 25569) * 86400000));
    return { value: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` };
  }
  const s = String(input ?? '').trim();
  if (s === '') return { error: 'Das Datum fehlt.' };
  let y, m, d;
  let r = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (r) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else return { error: `Das Datum „${s}“ hat ein ungültiges Format. Erwartet: TT.MM.JJJJ (z. B. 25.10.2026).` };
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return { error: `Das Datum „${s}“ existiert nicht.` };
  }
  return { value: `${y}-${pad(m)}-${pad(d)}` };
}

// Uhrzeit aus Eingabe: "HH:MM", "H:MM", Excel-Bruchteil eines Tages oder Date.
export function parseTime(input) {
  if (input instanceof Date && !isNaN(input)) return { value: `${pad(input.getHours())}:${pad(input.getMinutes())}` };
  if (typeof input === 'number' && isFinite(input)) {
    if (input < 0 || input >= 1) return { error: `Die Zahl „${input}“ ist keine gültige Uhrzeit.` };
    const minutes = Math.round(input * 1440);
    return { value: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
  }
  const s = String(input ?? '').trim();
  if (s === '') return { error: 'Die Uhrzeit fehlt.' };
  const r = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!r || +r[1] > 23 || +r[2] > 59) return { error: `Die Uhrzeit „${s}“ ist ungültig. Erwartet: HH:MM (z. B. 18:30).` };
  return { value: `${pad(+r[1])}:${r[2]}` };
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Liefert alle Termine, die sich mit dem Kandidaten auf derselben Ressource überschneiden.
export function findConflicts(bookings, candidate, ignoreId = null) {
  const s = new Date(candidate.starts_at);
  const e = new Date(candidate.ends_at);
  return bookings.filter((b) =>
    b.id !== ignoreId &&
    b.resource_id === candidate.resource_id &&
    overlaps(s, e, new Date(b.starts_at), new Date(b.ends_at))
  );
}

// Weist Termine innerhalb eines Zeitfensters Spuren (Lanes) zu, damit sich überlappende
// Termine nebeneinander darstellen lassen. Eingabe: Array mit {start: Date, end: Date}.
export function layoutLanes(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  let cluster = [];
  let clusterEnd = null;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    const placed = cluster.map((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); }
      else laneEnds[lane] = it.end;
      return { item: it, lane };
    });
    const count = laneEnds.length;
    placed.forEach((p) => result.push({ item: p.item, lane: p.lane, lanes: count }));
    cluster = [];
    clusterEnd = null;
  };

  for (const it of sorted) {
    if (clusterEnd !== null && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = clusterEnd === null || it.end > clusterEnd ? it.end : clusterEnd;
  }
  flush();
  return result;
}

// Erzeugt Wochenserien: Startdatum plus n weitere Wochen (Gesamtzahl inkl. Start).
export function seriesDates(dateStr, count) {
  const dates = [];
  const base = parseISODate(dateStr);
  for (let i = 0; i < count; i++) dates.push(ymd(addDays(base, i * 7)));
  return dates;
}

// CSV-Parser mit Erkennung des Trennzeichens (; oder ,) und Anführungszeichen.
export function parseCSV(text) {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

const HEADER_ALIASES = {
  titel: ['titel', 'title', 'bezeichnung', 'termin', 'name'],
  ressource: ['ressource', 'platz', 'raum', 'ort', 'resource'],
  kategorie: ['kategorie', 'art', 'category'],
  datum: ['datum', 'date', 'tag'],
  start: ['start', 'startzeit', 'beginn', 'von'],
  ende: ['ende', 'endzeit', 'bis', 'end'],
  notiz: ['notiz', 'notizen', 'bemerkung', 'info', 'zusatzinfo']
};
const REQUIRED = ['titel', 'ressource', 'kategorie', 'datum', 'start', 'ende'];
const FIELD_LABEL = { titel: 'Titel', ressource: 'Ressource', kategorie: 'Kategorie', datum: 'Datum', start: 'Startzeit', ende: 'Endzeit', notiz: 'Notiz' };

// Prüft eine Tabelle (erste Zeile = Kopfzeile) vollständig.
// Rückgabe: { bookings, errors, conflicts } ohne Schreibvorgang.
// Import erfolgt nur, wenn errors und conflicts leer sind ("alles oder nichts").
export function validateTable(table, { resources, categories, existing = [] }) {
  const errors = [];
  const conflicts = [];
  const bookings = [];
  if (!table || table.length < 2) {
    errors.push({ line: 1, message: 'Die Datei enthält keine Termine. Erwartet: Kopfzeile plus mindestens eine Datenzeile.' });
    return { bookings, errors, conflicts };
  }
  const headers = table[0].map((h) => String(h ?? '').trim().toLowerCase());
  const col = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx !== -1) col[field] = idx;
  }
  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length) {
    errors.push({ line: 1, message: `Pflichtspalte(n) fehlen: ${missing.map((f) => FIELD_LABEL[f]).join(', ')}.` });
    return { bookings, errors, conflicts };
  }

  const resByKey = new Map();
  resources.forEach((r) => { resByKey.set(r.slug.toLowerCase(), r); resByKey.set(r.name.toLowerCase(), r); });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const allowedCats = categories.map((c) => c.name).join(', ');

  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const row = table[i];
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const get = (f) => (col[f] === undefined ? '' : row[col[f]]);
    const rowErrors = [];
    const title = String(get('titel') ?? '').trim();
    if (!title) rowErrors.push('Der Titel fehlt.');
    else if (title.length > 120) rowErrors.push('Der Titel ist länger als 120 Zeichen.');

    const resKey = String(get('ressource') ?? '').trim().toLowerCase();
    const res = resByKey.get(resKey);
    if (!resKey) rowErrors.push('Die Ressource fehlt.');
    else if (!res) rowErrors.push(`Die Ressource „${String(get('ressource')).trim()}“ ist unbekannt.`);

    const catKey = String(get('kategorie') ?? '').trim().toLowerCase();
    const cat = catByName.get(catKey);
    if (!catKey) rowErrors.push('Die Kategorie fehlt.');
    else if (!cat) rowErrors.push(`Die Kategorie „${String(get('kategorie')).trim()}“ ist unbekannt. Erlaubt: ${allowedCats}.`);

    const d = parseDate(get('datum'));
    const s = parseTime(get('start'));
    const e = parseTime(get('ende'));
    if (d.error) rowErrors.push(d.error);
    if (s.error) rowErrors.push(s.error);
    if (e.error) rowErrors.push(e.error);

    let startsAt = null, endsAt = null;
    if (!d.error && !s.error && !e.error) {
      startsAt = combine(d.value, s.value);
      endsAt = combine(d.value, e.value);
      if (endsAt <= startsAt) rowErrors.push(`Die Endzeit (${e.value}) liegt nicht nach der Startzeit (${s.value}).`);
    }

    if (rowErrors.length) {
      rowErrors.forEach((message) => errors.push({ line, message: `Zeile ${line}: ${message}` }));
      continue;
    }

    const candidate = {
      resource_id: res.id,
      category_id: cat.id,
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      notes: String(get('notiz') ?? '').trim() || null,
      _line: line,
      _resource: res.name
    };

    const clash = findConflicts([...existing, ...bookings], candidate);
    if (clash.length) {
      const other = clash[0];
      const src = other._line ? `Zeile ${other._line}` : `„${other.title}“`;
      conflicts.push({ line, message: `Zeile ${line}: Überschneidung auf „${res.name}“ mit ${src}.` });
    }
    bookings.push(candidate);
  }
  if (!bookings.length && !errors.length) {
    errors.push({ line: 1, message: 'Die Datei enthält keine auswertbaren Termine.' });
  }
  return { bookings, errors, conflicts };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateDE(d) {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
