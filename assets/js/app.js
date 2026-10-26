import { CONFIG } from './config.js';
import * as L from './logic.js';
import * as LY from './layout.js';
import { ROOT, loadSeed, createStore, friendlyError } from './data.js';

const HOUR_PX = 48;          // Kalender: Pixel je Stunde
const TL_HOUR_PX = 40;       // Belegungsplan: Pixel je Stunde
const TL_ROW_LANE = 26;      // Belegungsplan: Höhe je Spur
const DS = CONFIG.DAY_START;
const DE = CONFIG.DAY_END;
const BASE = CONFIG.BASE_PATH.replace(/\/$/, '');
const HOME = BASE + '/';
const $ = (s, r = document) => r.querySelector(s);
const esc = L.escapeHtml;
const app = $('#app');

const S = {
  store: null,
  seed: null,
  resources: [],
  categories: [],
  bookings: [],
  futureList: [],
  roomView: 'week',
  roomAnchor: new Date(),
  planRange: 'week',
  planAnchor: new Date(),
  hiddenRes: new Set(),
  catFilter: '',
  notice: null
};

// ---------- Routing ----------
function relPath() {
  let p = location.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
  return p.replace(/\/+$/, '') || '/';
}

function parseRoute() {
  const p = relPath();
  if (p === '/') return { name: 'home' };
  if (p === '/belegungsplan') return { name: 'plan' };
  const m = p.match(/^\/raeume\/([a-z0-9-]+)$/);
  if (m) {
    const res = S.resources.find((r) => r.slug === m[1]);
    return res ? { name: 'room', res } : { name: '404' };
  }
  return { name: '404' };
}

function go(path, { replace = false } = {}) {
  const url = BASE + path;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  window.scrollTo(0, 0);
  render();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go(a.getAttribute('data-link'));
});
window.addEventListener('popstate', () => render());

// ---------- Hilfen ----------
function setNotice(type, text) {
  S.notice = { type, text };
  renderNotice();
}
function renderNotice() {
  const el = $('#notice');
  if (!el) return;
  if (!S.notice) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.className = 'notice notice-' + S.notice.type;
  el.textContent = S.notice.text;
  if (S.notice.type !== 'error') setTimeout(() => { if (S.notice && S.notice.text === el.textContent) { S.notice = null; renderNotice(); } }, 4000);
}

const isEditor = () => S.store.isEditor();
const resById = (id) => S.resources.find((r) => r.id === id);
const catById = (id) => S.categories.find((c) => c.id === id);
const catColor = (id) => catById(id)?.color || '#4a5568';
const dayName = (d) => d.toLocaleDateString('de-DE', { weekday: 'short' });
const dayLong = (d) => d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const monthLabel = (d) => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const hhmm = (d) => L.fmtTime(d);

function roomUrl(slug) { return BASE + '/raeume/' + slug; }
function qrUrl(slug) { return new URL('qr/' + slug + '.svg', ROOT).pathname; }

// ---------- Kopfbereich ----------
function renderHeader() {
  const s = S.store;
  const who = s.isEditor()
    ? `<span class="badge badge-role">${s.role === 'admin' ? 'Administrator' : 'Bearbeiter'}</span>`
    : '<span class="badge">Besucher</span>';
  const demo = s.mode === 'demo' ? '<span class="badge badge-demo" title="Beispieldaten im Browser. Keine echte Anmeldung und keine echte Sicherheit.">Demo-Modus</span>' : '';
  const authBtn = s.isEditor() || (s.mode === 'supabase' && s.session)
    ? '<button type="button" class="btn btn-ghost" id="btn-logout">Abmelden</button>'
    : '<button type="button" class="btn btn-ghost" id="btn-login">Anmelden</button>';
  $('#header').innerHTML = `
    <div class="wrap topbar">
      <a class="brand" href="${HOME}" data-link="/">${esc(S.seed.settings.vereins_name)}</a>
      <nav class="nav" aria-label="Hauptnavigation">
        <a href="${HOME}" data-link="/">Start</a>
        <a href="${BASE}/belegungsplan" data-link="/belegungsplan">Belegungsplan</a>
      </nav>
      <div class="auth">${demo}${who}${authBtn}</div>
    </div>`;
  const li = $('#btn-login'); if (li) li.addEventListener('click', openLogin);
  const lo = $('#btn-logout'); if (lo) lo.addEventListener('click', async () => { await s.signOut(); setNotice('ok', 'Sie sind abgemeldet.'); render(); });
}

// ---------- Startseite ----------
function renderHome() {
  const rooms = S.resources.filter((r) => r.type === 'raum');
  const plaetze = S.resources.filter((r) => r.type === 'platz');
  const list = (arr) => arr.map((r) => `
    <li class="room-item">
      <span class="chip" style="background:${esc(r.color)}" aria-hidden="true"></span>
      <a class="room-name" href="${roomUrl(r.slug)}" data-link="/raeume/${esc(r.slug)}">${esc(r.name)}</a>
      <span class="room-actions">
        <a class="btn btn-small" href="${qrUrl(r.slug)}" download="qr-${esc(r.slug)}.svg">QR-Code</a>
        <button type="button" class="btn btn-small btn-ghost" data-copy="${esc(roomUrl(r.slug))}">Link kopieren</button>
      </span>
    </li>`).join('');
  app.innerHTML = `
    <section class="hero">
      <h1>Räume und Plätze auf einen Blick</h1>
      <p>Alle Termine sind ohne Anmeldung einsehbar. Änderungen sind nur für berechtigte Mitglieder möglich.</p>
    </section>
    <div class="cards">
      <a class="card" href="#raeume"><h2>Raumverwaltung</h2><p>Eigener Kalender für jeden Raum, mit Tages-, Wochen- und Monatsansicht.</p><span class="card-link">Zu den Raumkalendern</span></a>
      <a class="card" href="${BASE}/belegungsplan" data-link="/belegungsplan"><h2>Belegungsplan</h2><p>Plätze und Räume im Zeitstrahl. Mit Filter nach Datum, Platz und Kategorie.</p><span class="card-link">Zum Belegungsplan</span></a>
    </div>
    <section id="raeume" class="section">
      <h2>Raumkalender</h2>
      <p class="muted">Jeder Raum hat einen dauerhaften Link und einen QR-Code, der direkt zum Kalender führt.</p>
      <h3>Räume</h3>
      <ul class="room-list">${list(rooms)}</ul>
      <h3>Plätze</h3>
      <ul class="room-list">${list(plaetze)}</ul>
    </section>`;
  bindCopy();
}

function bindCopy() {
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const url = new URL(b.getAttribute('data-copy'), location.origin).href;
    try { await navigator.clipboard.writeText(url); setNotice('ok', 'Link wurde kopiert.'); }
    catch { setNotice('error', 'Der Link konnte nicht kopiert werden: ' + url); }
  }));
}

// ---------- Zeitfenster ----------
function roomRange() {
  const a = S.roomAnchor;
  if (S.roomView === 'day') { const f = new Date(a.getFullYear(), a.getMonth(), a.getDate()); return { from: f, to: L.addDays(f, 1), days: [f] }; }
  if (S.roomView === 'week') { const f = L.weekStart(a); return { from: f, to: L.addDays(f, 7), days: [...Array(7)].map((_, i) => L.addDays(f, i)) }; }
  const first = L.monthStart(a);
  const f = L.weekStart(first);
  return { from: f, to: L.addDays(f, 42), days: [...Array(42)].map((_, i) => L.addDays(f, i)), month: first.getMonth() };
}

function planRange() {
  const a = S.planAnchor;
  if (S.planRange === 'day') { const f = new Date(a.getFullYear(), a.getMonth(), a.getDate()); return { from: f, to: L.addDays(f, 1), days: [f] }; }
  const f = L.weekStart(a);
  return { from: f, to: L.addDays(f, 7), days: [...Array(7)].map((_, i) => L.addDays(f, i)) };
}

// ---------- Raumseite ----------
async function renderRoom(res) {
  const range = roomRange();
  const all = await S.store.getBookings({ from: range.from, to: range.to });
  S.bookings = all;
  const mine = all.filter((b) => b.resource_id === res.id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  S.futureList = await S.store.getAllFuture(today, 300, res.id);

  const label = S.roomView === 'day' ? dayLong(range.days[0])
    : S.roomView === 'week' ? `${range.days[0].toLocaleDateString('de-DE')} – ${range.days[6].toLocaleDateString('de-DE')}`
    : monthLabel(S.roomAnchor);

  app.innerHTML = `
    <nav class="crumbs" aria-label="Pfad"><a href="${HOME}" data-link="/">Start</a> / <span>${esc(res.name)}</span></nav>
    <header class="page-head">
      <div>
        <h1><span class="chip chip-lg" style="background:${esc(res.color)}" aria-hidden="true"></span>${esc(res.name)}</h1>
        <p class="muted">${res.type === 'raum' ? 'Raum' : 'Platz'} · Direktlink: <a href="${roomUrl(res.slug)}" data-link="/raeume/${esc(res.slug)}">${esc(roomUrl(res.slug))}</a></p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="${qrUrl(res.slug)}" download="qr-${esc(res.slug)}.svg">QR-Code laden</a>
        <button type="button" class="btn btn-ghost" data-copy="${esc(roomUrl(res.slug))}">Link kopieren</button>
        ${isEditor() ? `<button type="button" class="btn btn-primary" id="btn-new" data-res="${esc(res.id)}">Neuer Termin</button>` : ''}
      </div>
    </header>
    <div class="toolbar" role="toolbar" aria-label="Kalender steuern">
      <div class="btn-group">
        <button type="button" class="btn" id="prev" aria-label="Zurück">‹</button>
        <button type="button" class="btn" id="today">Heute</button>
        <button type="button" class="btn" id="next" aria-label="Weiter">›</button>
      </div>
      <p class="range-label" aria-live="polite">${esc(label)}</p>
      <div class="btn-group" role="group" aria-label="Ansicht">
        ${['day', 'week', 'month'].map((v) => `<button type="button" class="btn ${S.roomView === v ? 'btn-active' : ''}" data-view="${v}" aria-pressed="${S.roomView === v}">${{ day: 'Tag', week: 'Woche', month: 'Monat' }[v]}</button>`).join('')}
      </div>
    </div>
    <div class="cal-wrap">
      ${S.roomView === 'month' ? monthGrid(range, mine) : timeGrid(range, mine)}
    </div>
    <section class="section">
      <h2>Aktuelle und kommende Termine</h2>
      ${futureTable(S.futureList)}
    </section>`;
  bindCopy();
  bindRoomControls(res);
}

function timeGrid(range, bookings) {
  const hours = [...Array(DE - DS + 1)].map((_, i) => DS + i);
  const height = (DE - DS) * HOUR_PX;
  const colW = S.roomView === 'day' ? 1 : 7;
  const cols = range.days.map((d, idx) => {
    const segs = bookings.flatMap((b) => LY.segmentsForDays(b, [d], DS, DE).map((s) => ({ ...s, dayIndex: idx })));
    const blocks = LY.timeGridBlocks(segs, DS, HOUR_PX);
    const isToday = d.toDateString() === new Date().toDateString();
    const evs = blocks.map((bl) => {
      const b = bl.booking;
      const note = isEditor() && b.notes ? ` – ${esc(b.notes)}` : '';
      return `<button type="button" class="event" data-id="${esc(b.id)}"
        style="top:${bl.top}px;height:${bl.height}px;left:${bl.left}%;width:calc(${bl.width}% - 4px);background:${catColor(b.category_id)}"
        aria-label="${esc(b.title)}, ${hhmm(new Date(b.starts_at))} bis ${hhmm(new Date(b.ends_at))}${note}">
        <span class="ev-time">${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))}</span>
        <span class="ev-title">${esc(b.title)}</span></button>`;
    }).join('');
    return `<div class="tg-col ${isToday ? 'is-today' : ''}" role="group" aria-label="${esc(dayLong(d))}">
      <div class="tg-head"><span class="tg-dow">${esc(dayName(d))}</span><span class="tg-date">${d.getDate()}.${d.getMonth() + 1}.</span></div>
      <div class="tg-body" style="height:${height}px">${hours.map((h) => `<div class="tg-hour" style="height:${HOUR_PX}px"></div>`).join('')}${evs}</div>
    </div>`;
  }).join('');
  return `<div class="tg" style="--cols:${colW}">
    <div class="tg-axis" aria-hidden="true"><div class="tg-head"></div><div class="tg-body" style="height:${height}px">${hours.map((h) => `<div class="tg-label" style="height:${HOUR_PX}px">${String(h).padStart(2, '0')}:00</div>`).join('')}</div></div>
    <div class="tg-cols">${cols}</div>
  </div>`;
}

function monthGrid(range, bookings) {
  const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((n) => `<div class="mg-dow">${n}</div>`).join('');
  const cells = range.days.map((d) => {
    const inMonth = d.getMonth() === range.month;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd = L.addDays(dayStart, 1);
    const list = bookings.filter((b) => new Date(b.ends_at) > dayStart && new Date(b.starts_at) < dayEnd)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const shown = list.slice(0, 3).map((b) => `<button type="button" class="chip-ev" data-id="${esc(b.id)}" style="background:${catColor(b.category_id)}" aria-label="${esc(b.title)} um ${hhmm(new Date(b.starts_at))}">${hhmm(new Date(b.starts_at))} ${esc(b.title)}</button>`).join('');
    const more = list.length > 3 ? `<button type="button" class="link-btn" data-goto="${L.ymd(d)}">+${list.length - 3} weitere</button>` : '';
    const isToday = d.toDateString() === new Date().toDateString();
    return `<div class="mg-cell ${inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''}">
      <button type="button" class="mg-date" data-goto="${L.ymd(d)}" aria-label="${esc(dayLong(d))} in Tagesansicht öffnen">${d.getDate()}</button>
      ${shown}${more}</div>`;
  }).join('');
  return `<div class="mg"><div class="mg-head">${names}</div><div class="mg-grid">${cells}</div></div>`;
}

function futureTable(list) {
  if (!list.length) return '<p class="empty">Keine kommenden Termine eingetragen.</p>';
  const rows = list.map((b) => `<tr>
      <td>${esc(new Date(b.starts_at).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }))}</td>
      <td>${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))}</td>
      <td><span class="chip" style="background:${catColor(b.category_id)}" aria-hidden="true"></span>${esc(b.title)}</td>
      <td>${esc(catById(b.category_id)?.name || '')}</td>
      ${isEditor() ? `<td>${esc(b.notes || '')}</td>` : ''}
      ${isEditor() ? `<td><button type="button" class="btn btn-small btn-ghost" data-id="${esc(b.id)}">Bearbeiten</button></td>` : ''}
    </tr>`).join('');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Datum</th><th scope="col">Zeit</th><th scope="col">Titel</th><th scope="col">Kategorie</th>${isEditor() ? '<th scope="col">Notiz</th><th scope="col"><span class="sr-only">Aktion</span></th>' : ''}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function bindRoomControls(res) {
  const shift = (n) => {
    const a = S.roomAnchor;
    if (S.roomView === 'day') S.roomAnchor = L.addDays(a, n);
    else if (S.roomView === 'week') S.roomAnchor = L.addDays(a, 7 * n);
    else S.roomAnchor = new Date(a.getFullYear(), a.getMonth() + n, 1);
    render();
  };
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  $('#today').onclick = () => { S.roomAnchor = new Date(); render(); };
  document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { S.roomView = b.dataset.view; render(); });
  document.querySelectorAll('[data-goto]').forEach((b) => b.onclick = () => {
    const [y, m, d] = b.dataset.goto.split('-').map(Number);
    S.roomAnchor = new Date(y, m - 1, d); S.roomView = 'day'; render();
  });
  document.querySelectorAll('.event, .chip-ev').forEach((b) => b.onclick = () => openDetail(b.dataset.id));
  document.querySelectorAll('.table button[data-id]').forEach((b) => b.onclick = () => openDetail(b.dataset.id, true));
  const nb = $('#btn-new'); if (nb) nb.onclick = () => openBookingForm({ resource_id: res.id, date: S.roomAnchor });
}

// ---------- Belegungsplan ----------
async function renderPlan() {
  const range = planRange();
  S.bookings = await S.store.getBookings({ from: range.from, to: range.to });
  const visible = S.resources.filter((r) => !S.hiddenRes.has(r.id));
  const groups = [['Räume', visible.filter((r) => r.type === 'raum')], ['Plätze', visible.filter((r) => r.type === 'platz')]];
  const cats = S.categories;
  const label = S.planRange === 'day' ? dayLong(range.days[0])
    : `${range.days[0].toLocaleDateString('de-DE')} – ${range.days[6].toLocaleDateString('de-DE')}`;
  const dayW = (DE - DS) * TL_HOUR_PX;

  const rowsHtml = groups.map(([title, list]) => {
    if (!list.length) return '';
    const rows = list.map((r) => {
      let segs = S.bookings.filter((b) => b.resource_id === r.id && (!S.catFilter || b.category_id === S.catFilter))
        .flatMap((b) => LY.segmentsForDays(b, range.days, DS, DE));
      const tl = LY.timelineRow(segs, range.days.length, DS, DE, TL_HOUR_PX);
      const h = Math.max(tl.lanes, 1) * TL_ROW_LANE + 10;
      const bars = tl.bars.map((bar) => {
        const b = bar.booking;
        const cat = catById(b.category_id)?.name || '';
        return `<button type="button" class="bar" data-id="${esc(b.id)}"
          style="left:${bar.x}px;width:${bar.width}px;top:${bar.lane * TL_ROW_LANE + 5}px;background:${esc(r.color)};border-left-color:${catColor(b.category_id)}"
          title="${esc(b.title)} · ${esc(cat)} · ${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))}"
          aria-label="${esc(r.name)}: ${esc(b.title)}, ${esc(cat)}, ${L.fmtDateDE(new Date(b.starts_at))} ${hhmm(new Date(b.starts_at))} bis ${hhmm(new Date(b.ends_at))}">
          <span class="bar-text">${hhmm(new Date(b.starts_at))} ${esc(b.title)}</span></button>`;
      }).join('');
      const grid = range.days.map((_, i) => `<span class="tl-daysep" style="left:${i * dayW}px"></span>`).join('');
      return `<div class="tl-row" role="row">
        <div class="tl-label" role="rowheader"><span class="chip" style="background:${esc(r.color)}" aria-hidden="true"></span><span>${esc(r.name)}</span></div>
        <div class="tl-track" style="width:${tl.width}px;height:${h}px" role="cell">${grid}${bars}${tl.bars.length ? '' : '<span class="tl-empty">Keine Belegung</span>'}</div>
      </div>`;
    }).join('');
    return `<div class="tl-group" role="rowgroup"><div class="tl-group-title">${title}</div>${rows}</div>`;
  }).join('');

  const heads = range.days.map((d) => `<div class="tl-day" style="width:${dayW}px"><span>${esc(dayName(d))} ${d.getDate()}.${d.getMonth() + 1}.</span>
     <span class="tl-hours" aria-hidden="true">${[...Array(DE - DS)].map((_, i) => `<i style="left:${i * TL_HOUR_PX}px">${String(DS + i).padStart(2, '0')}</i>`).join('')}</span></div>`).join('');

  const rubriken = S.resources.map((r) => `
    <li><label class="check">
      <input type="checkbox" data-res-toggle="${esc(r.id)}" ${S.hiddenRes.has(r.id) ? '' : 'checked'}>
      <span class="chip" style="background:${esc(r.color)}" aria-hidden="true"></span>
      <span>${esc(r.name)}</span></label></li>`).join('');

  app.innerHTML = `
    <header class="page-head">
      <div><h1>Belegungsplan</h1><p class="muted">Plätze und Räume nach Datum und Uhrzeit. Farbe = Rubrik, linker Rand = Kategorie.</p></div>
      <div class="page-actions">
        ${isEditor() ? '<button type="button" class="btn" id="btn-import">Import (CSV/Excel)</button><button type="button" class="btn btn-primary" id="btn-new-plan">Neuer Termin</button>' : ''}
      </div>
    </header>
    <div class="plan-layout">
      <aside class="sidebar" aria-label="Filter">
        <section class="filter-box">
          <h2>Rubriken</h2>
          <div class="filter-actions"><button type="button" class="link-btn" id="show-all">Alle einblenden</button><button type="button" class="link-btn" id="hide-all">Alle ausblenden</button></div>
          <ul class="check-list">${rubriken}</ul>
        </section>
        <section class="filter-box">
          <h2><label for="cat-filter">Kategorie</label></h2>
          <select id="cat-filter" class="input">
            <option value="">Alle Kategorien</option>
            ${cats.map((c) => `<option value="${esc(c.id)}" ${S.catFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <ul class="legend">${cats.map((c) => `<li><span class="chip" style="background:${esc(c.color)}" aria-hidden="true"></span>${esc(c.name)}</li>`).join('')}</ul>
        </section>
      </aside>
      <section class="plan-main">
        <div class="toolbar" role="toolbar" aria-label="Zeitraum steuern">
          <div class="btn-group">
            <button type="button" class="btn" id="p-prev" aria-label="Zurück">‹</button>
            <button type="button" class="btn" id="p-today">Heute</button>
            <button type="button" class="btn" id="p-next" aria-label="Weiter">›</button>
          </div>
          <label class="date-pick"><span class="sr-only">Datum wählen</span><input type="date" id="p-date" class="input" value="${L.ymd(S.planAnchor)}"></label>
          <p class="range-label" aria-live="polite">${esc(label)}</p>
          <div class="btn-group" role="group" aria-label="Zeitraum">
            ${['day', 'week'].map((v) => `<button type="button" class="btn ${S.planRange === v ? 'btn-active' : ''}" data-prange="${v}" aria-pressed="${S.planRange === v}">${v === 'day' ? 'Tag' : 'Woche'}</button>`).join('')}
          </div>
        </div>
        <div class="timeline" tabindex="0" aria-label="Zeitleiste, mit Pfeiltasten scrollbar">
          <div class="tl-head" role="row">
            <div class="tl-corner" role="columnheader">Platz / Raum</div>
            <div class="tl-days" style="width:${range.days.length * dayW}px">${heads}</div>
          </div>
          ${rowsHtml || '<p class="empty">Alle Rubriken sind ausgeblendet. Bitte links mindestens eine Rubrik einblenden.</p>'}
        </div>
      </section>
    </div>`;
  bindPlan();
}

function bindPlan() {
  const shift = (n) => { S.planAnchor = L.addDays(S.planAnchor, (S.planRange === 'day' ? 1 : 7) * n); render(); };
  $('#p-prev').onclick = () => shift(-1);
  $('#p-next').onclick = () => shift(1);
  $('#p-today').onclick = () => { S.planAnchor = new Date(); render(); };
  $('#p-date').onchange = (e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); S.planAnchor = new Date(y, m - 1, d); render(); } };
  document.querySelectorAll('[data-prange]').forEach((b) => b.onclick = () => { S.planRange = b.dataset.prange; render(); });
  document.querySelectorAll('[data-res-toggle]').forEach((c) => c.onchange = () => {
    const id = c.dataset.resToggle;
    if (c.checked) S.hiddenRes.delete(id); else S.hiddenRes.add(id);
    render();
  });
  $('#show-all').onclick = () => { S.hiddenRes.clear(); render(); };
  $('#hide-all').onclick = () => { S.resources.forEach((r) => S.hiddenRes.add(r.id)); render(); };
  $('#cat-filter').onchange = (e) => { S.catFilter = e.target.value; render(); };
  document.querySelectorAll('.bar').forEach((b) => b.onclick = () => openDetail(b.dataset.id));
  const nb = $('#btn-new-plan'); if (nb) nb.onclick = () => openBookingForm({ resource_id: S.resources[0]?.id, date: S.planAnchor });
  const ib = $('#btn-import'); if (ib) ib.onclick = openImport;
}

// ---------- Dialoge ----------
function makeDialog(title, bodyHtml, cls = '') {
  const old = $('#dlg'); if (old) old.remove();
  const d = document.createElement('dialog');
  d.id = 'dlg';
  d.className = 'dialog ' + cls;
  d.setAttribute('aria-labelledby', 'dlg-title');
  d.innerHTML = `<div class="dialog-inner">
      <header class="dialog-head"><h2 id="dlg-title">${esc(title)}</h2>
      <button type="button" class="btn btn-ghost" data-close aria-label="Schließen">×</button></header>
      <div class="dialog-body">${bodyHtml}</div></div>`;
  document.body.appendChild(d);
  d.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => d.close());
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

function openDetail(id, editFirst = false) {
  const b = S.bookings.find((x) => x.id === id) || S.futureList.find((x) => x.id === id);
  if (!b) return;
  const res = resById(b.resource_id);
  const cat = catById(b.category_id);
  const start = new Date(b.starts_at), end = new Date(b.ends_at);
  const d = makeDialog(b.title, `
    <dl class="details">
      <dt>Ressource</dt><dd>${esc(res?.name || '')}</dd>
      <dt>Kategorie</dt><dd><span class="chip" style="background:${catColor(b.category_id)}"></span>${esc(cat?.name || '')}</dd>
      <dt>Datum</dt><dd>${esc(dayLong(start))}</dd>
      <dt>Zeit</dt><dd>${hhmm(start)} – ${hhmm(end)} Uhr</dd>
      ${isEditor() && b.notes ? `<dt>Notiz</dt><dd>${esc(b.notes)}</dd>` : ''}
      ${b.series_id ? '<dt>Serie</dt><dd>Teil einer Terminserie</dd>' : ''}
    </dl>
    ${isEditor() ? `<div class="dialog-actions">
      <button type="button" class="btn btn-danger" id="d-del">Löschen</button>
      ${b.series_id ? '<button type="button" class="btn btn-danger" id="d-del-series">Ganze Serie löschen</button>' : ''}
      <button type="button" class="btn btn-primary" id="d-edit">Bearbeiten</button></div>` : '<p class="muted">Änderungen sind nur mit einem berechtigten Konto möglich.</p>'}
    <p class="msg" id="d-msg" role="alert"></p>`, 'dialog-narrow');
  if (!isEditor()) return;
  const msg = (t) => { $('#d-msg', d).textContent = t; };
  $('#d-edit', d).onclick = () => { d.close(); openBookingForm({ booking: b }); };
  $('#d-del', d).onclick = async () => {
    if (!confirm('Diesen Termin wirklich löschen?')) return;
    try { await S.store.deleteBookings([b.id]); d.close(); setNotice('ok', 'Termin wurde gelöscht.'); render(); }
    catch (e) { msg(friendlyError(e)); }
  };
  const ds = $('#d-del-series', d);
  if (ds) ds.onclick = async () => {
    const ids = S.bookings.filter((x) => x.series_id === b.series_id).map((x) => x.id);
    if (!confirm(`Alle ${ids.length} geladenen Termine dieser Serie löschen?`)) return;
    try { await S.store.deleteBookings(ids); d.close(); setNotice('ok', 'Serie wurde gelöscht.'); render(); }
    catch (e) { msg(friendlyError(e)); }
  };
}

function resOptions(selected) {
  return S.resources.map((r) => `<option value="${esc(r.id)}" ${r.id === selected ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
}
function catOptions(selected) {
  return S.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function openBookingForm({ booking = null, resource_id = null, date = new Date() } = {}) {
  const isEdit = !!booking;
  const start = booking ? new Date(booking.starts_at) : null;
  const end = booking ? new Date(booking.ends_at) : null;
  const dateVal = booking ? L.ymd(start) : L.ymd(date);
  const d = makeDialog(isEdit ? 'Termin bearbeiten' : 'Neuer Termin', `
    <form id="bf" class="form" novalidate>
      <div class="field"><label for="bf-title">Titel <span class="req">*</span></label>
        <input id="bf-title" class="input" required maxlength="120" value="${esc(booking?.title || '')}" autocomplete="off">
        <p class="hint">Öffentlich sichtbar. Bitte allgemein formulieren.</p></div>
      <div class="field-row">
        <div class="field"><label for="bf-res">Ressource <span class="req">*</span></label>
          <select id="bf-res" class="input">${resOptions(booking?.resource_id || resource_id)}</select></div>
        <div class="field"><label for="bf-cat">Kategorie <span class="req">*</span></label>
          <select id="bf-cat" class="input">${catOptions(booking?.category_id)}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="bf-date">Datum <span class="req">*</span></label>
          <input id="bf-date" type="date" class="input" value="${dateVal}" required></div>
        <div class="field"><label for="bf-start">Startzeit <span class="req">*</span></label>
          <input id="bf-start" type="time" class="input" value="${start ? hhmm(start) : '17:00'}" required></div>
        <div class="field"><label for="bf-end">Endzeit <span class="req">*</span></label>
          <input id="bf-end" type="time" class="input" value="${end ? hhmm(end) : '18:00'}" required></div>
      </div>
      ${isEdit ? '' : `<div class="field-row">
        <div class="field"><label class="check"><input type="checkbox" id="bf-series"> Wöchentliche Serie anlegen</label></div>
        <div class="field"><label for="bf-count">Anzahl Termine</label>
          <input id="bf-count" type="number" class="input" min="2" max="52" value="4" disabled></div></div>`}
      <div class="field"><label for="bf-note">Notiz (nur für Mitglieder sichtbar)</label>
        <textarea id="bf-note" class="input" rows="3" maxlength="1000">${esc(booking?.notes || '')}</textarea></div>
      <p class="msg" id="bf-msg" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Termin anlegen'}</button>
      </div>
    </form>`, 'dialog-wide');

  const form = $('#bf', d);
  const msg = (t) => { $('#bf-msg', d).textContent = t; };
  const series = $('#bf-series', d);
  if (series) series.onchange = () => { $('#bf-count', d).disabled = !series.checked; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    msg('');
    const title = $('#bf-title', d).value.trim();
    const resId = $('#bf-res', d).value;
    const catId = $('#bf-cat', d).value;
    const dateStr = $('#bf-date', d).value;
    const s = $('#bf-start', d).value;
    const en = $('#bf-end', d).value;
    const notes = $('#bf-note', d).value.trim() || null;
    if (!title) return msg('Bitte einen Titel eingeben.');
    if (!dateStr || !s || !en) return msg('Bitte Datum, Start- und Endzeit eingeben.');
    const parsedS = L.combine(dateStr, s), parsedE = L.combine(dateStr, en);
    if (parsedE <= parsedS) return msg('Die Endzeit muss nach der Startzeit liegen.');
    const count = series && series.checked ? Math.min(52, Math.max(2, Number($('#bf-count', d).value) || 2)) : 1;
    const dates = count > 1 ? L.seriesDates(dateStr, count) : [dateStr];
    const rows = dates.map((ds) => ({
      resource_id: resId,
      category_id: catId,
      title,
      starts_at: L.combine(ds, s).toISOString(),
      ends_at: L.combine(ds, en).toISOString(),
      notes,
      series_id: count > 1 ? (crypto.randomUUID ? crypto.randomUUID() : null) : null
    }));
    // Vorprüfung gegen geladene Termine (die Datenbank prüft immer vollständig)
    for (const r of rows) {
      const clash = L.findConflicts(S.bookings, r, booking?.id || null);
      if (clash.length) return msg(`Überschneidung am ${L.fmtDateDE(new Date(r.starts_at))}: „${clash[0].title}“ belegt den Platz bereits.`);
    }
    try {
      if (isEdit) {
        await S.store.updateBooking(booking.id, { title, resource_id: resId, category_id: catId, starts_at: rows[0].starts_at, ends_at: rows[0].ends_at, notes });
      } else {
        await S.store.createBookings(rows.map(({ series_id, ...r }) => (count > 1 ? { ...r, series_id } : r)));
      }
      d.close();
      setNotice('ok', isEdit ? 'Termin wurde gespeichert.' : (count > 1 ? `${count} Termine wurden angelegt.` : 'Termin wurde angelegt.'));
      render();
    } catch (err) { msg(friendlyError(err)); }
  };
  $('#bf-title', d).focus();
}

// ---------- Import ----------
function openImport() {
  const d = makeDialog('Import von Belegungen', `
    <p>Unterstützt werden CSV-Dateien (Trennzeichen „;“ oder „,“) und Excel-Dateien (.xlsx). Die erste Zeile muss die Spaltenüberschriften enthalten.</p>
    <p><button type="button" class="btn btn-small" id="imp-tpl">Vorlage herunterladen (CSV)</button></p>
    <p class="hint">Pflichtspalten: Titel, Ressource, Kategorie, Datum, Start, Ende. Optional: Notiz. Datum als TT.MM.JJJJ oder JJJJ-MM-TT, Uhrzeit als HH:MM.</p>
    <div class="field"><label for="imp-file">Datei auswählen</label>
      <input id="imp-file" type="file" accept=".csv,.xlsx,.xls,text/csv" class="input"></div>
    <div id="imp-result" aria-live="polite"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-close>Schließen</button>
      <button type="button" class="btn btn-primary" id="imp-go" disabled>Importieren</button></div>`, 'dialog-wide');

  $('#imp-tpl', d).onclick = () => {
    const csv = 'Titel;Ressource;Kategorie;Datum;Start;Ende;Notiz\nA-Junioren Training;Trainingsplatz A;Training;27.10.2026;17:30;19:00;\n';
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'vorlage-belegungen.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  let prepared = null;
  $('#imp-file', d).onchange = async (e) => {
    const file = e.target.files[0];
    const out = $('#imp-result', d);
    const go = $('#imp-go', d);
    go.disabled = true; prepared = null;
    if (!file) return;
    try {
      let table;
      if (/\.csv$/i.test(file.name)) {
        table = L.parseCSV(await file.text());
      } else if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import('../vendor/xlsx.mjs');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: '' });
      } else {
        out.innerHTML = '<p class="notice notice-error">Dateiformat nicht unterstützt. Bitte CSV oder Excel (.xlsx) verwenden.</p>';
        return;
      }
      let result = L.validateTable(table, { resources: S.resources, categories: S.categories, existing: [] });
      if (result.bookings.length) {
        const starts = result.bookings.map((b) => b.starts_at).sort();
        const ends = result.bookings.map((b) => b.ends_at).sort();
        const existing = await S.store.getBookings({ from: new Date(starts[0]), to: new Date(ends[ends.length - 1]) });
        result = L.validateTable(table, { resources: S.resources, categories: S.categories, existing });
      }
      prepared = result;
      out.innerHTML = renderImportResult(result);
      go.disabled = !(result.errors.length === 0 && result.conflicts.length === 0 && result.bookings.length > 0);
      if (!go.disabled) out.insertAdjacentHTML('afterbegin', `<p class="notice notice-ok">${result.bookings.length} Termine sind gültig und können importiert werden.</p>`);
    } catch (err) {
      out.innerHTML = `<p class="notice notice-error">Die Datei konnte nicht gelesen werden: ${esc(err.message || err)}</p>`;
    }
  };

  $('#imp-go', d).onclick = async () => {
    if (!prepared) return;
    const rows = prepared.bookings.map(({ _line, _resource, ...r }) => r);
    try {
      await S.store.createBookings(rows);
      d.close();
      setNotice('ok', `${rows.length} Termine wurden importiert.`);
      render();
    } catch (err) {
      $('#imp-result', d).innerHTML = `<p class="notice notice-error">${esc(friendlyError(err))} Es wurde nichts importiert.</p>`;
    }
  };
}

function renderImportResult(r) {
  let html = '';
  if (r.errors.length) {
    html += `<div class="notice notice-error"><p><strong>${r.errors.length} Fehler gefunden.</strong> Es wird nichts importiert, bis alle Fehler behoben sind.</p><ul>${r.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul></div>`;
  }
  if (r.conflicts.length) {
    html += `<div class="notice notice-error"><p><strong>${r.conflicts.length} Überschneidung(en).</strong></p><ul>${r.conflicts.map((c) => `<li>${esc(c.message)}</li>`).join('')}</ul></div>`;
  }
  if (r.bookings.length) {
    const preview = r.bookings.slice(0, 20).map((b) => {
      const s = new Date(b.starts_at), e = new Date(b.ends_at);
      return `<tr><td>${L.fmtDateDE(s)}</td><td>${hhmm(s)}–${hhmm(e)}</td><td>${esc(b._resource)}</td><td>${esc(b.title)}</td></tr>`;
    }).join('');
    html += `<p>Vorschau (erste 20 von ${r.bookings.length}):</p>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Datum</th><th scope="col">Zeit</th><th scope="col">Ressource</th><th scope="col">Titel</th></tr></thead><tbody>${preview}</tbody></table></div>`;
  }
  return html;
}

// ---------- Anmeldung ----------
function openLogin() {
  const s = S.store;
  if (s.mode === 'demo') {
    const d = makeDialog('Anmelden (Demo-Modus)', `
      <p class="notice notice-warn">Demo-Modus: Hier wird nur die Ansicht simuliert. Die echte Berechtigungsprüfung findet in der Datenbank statt, sobald Supabase angebunden ist.</p>
      <form id="lf" class="form">
        <fieldset class="field"><legend>Rolle wählen</legend>
          <label class="check"><input type="radio" name="role" value="bearbeiter" checked> Bearbeiter (Termine pflegen)</label>
          <label class="check"><input type="radio" name="role" value="admin"> Administrator (zusätzlich Stammdaten)</label>
        </fieldset>
        <div class="dialog-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary">Demo-Anmeldung</button></div>
      </form>`, 'dialog-narrow');
    $('#lf', d).onsubmit = async (e) => {
      e.preventDefault();
      await s.signIn({ role: d.querySelector('input[name=role]:checked').value });
      d.close(); setNotice('ok', 'Demo-Anmeldung erfolgreich.'); render();
    };
    return;
  }
  const d = makeDialog('Anmelden', `
    <form id="lf" class="form">
      <p>Nur eingeladene Mitglieder können sich anmelden. Sie erhalten einen Anmeldelink per E-Mail (ohne Passwort).</p>
      <div class="field"><label for="lf-mail">E-Mail-Adresse</label>
        <input id="lf-mail" type="email" class="input" required autocomplete="email"></div>
      <p class="msg" id="lf-msg" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary">Anmeldelink senden</button></div>
    </form>`, 'dialog-narrow');
  $('#lf', d).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await s.signIn({ email: $('#lf-mail', d).value.trim() });
      d.close();
      setNotice('ok', 'Wenn die Adresse eingeladen ist, wurde ein Anmeldelink gesendet. Bitte E-Mail prüfen.');
    } catch (err) { $('#lf-msg', d).textContent = friendlyError(err); }
  };
}

// ---------- Hauptablauf ----------
function renderNotFound() {
  app.innerHTML = `<section class="hero"><h1>Seite nicht gefunden</h1><p>Der Raum oder die Seite existiert nicht.</p><p><a class="btn btn-primary" href="${HOME}" data-link="/">Zur Startseite</a></p></section>`;
}

async function render() {
  renderHeader();
  const route = parseRoute();
  try {
    if (route.name === 'home') renderHome();
    else if (route.name === 'room') await renderRoom(route.res);
    else if (route.name === 'plan') await renderPlan();
    else renderNotFound();
  } catch (err) {
    app.innerHTML = `<p class="notice notice-error">Die Daten konnten nicht geladen werden: ${esc(friendlyError(err))}</p>`;
  }
  renderNotice();
  document.title = (route.name === 'room' ? route.res.name + ' · ' : route.name === 'plan' ? 'Belegungsplan · ' : '') + S.seed.settings.vereins_name;
}

async function boot() {
  try {
    S.seed = await loadSeed();
    S.store = await createStore(S.seed);
    await S.store.init();
    if (S.store.mode === 'supabase') {
      S.resources = await S.store.getResources();
      S.categories = await S.store.getCategories();
    } else {
      S.resources = S.store.resources;
      S.categories = S.store.categories;
    }
    // Weiterleitung von 404.html (GitHub Pages) übernehmen
    const p = new URLSearchParams(location.search).get('p');
    if (p) history.replaceState(null, '', BASE + p);
    render();
  } catch (err) {
    app.innerHTML = `<p class="notice notice-error">Die Anwendung konnte nicht gestartet werden: ${esc(err.message || err)}</p>`;
  }
}

boot();
