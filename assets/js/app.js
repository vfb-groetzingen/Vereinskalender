import { CONFIG } from './config.js';
import * as L from './logic.js';
import * as LY from './layout.js';
import { ROOT, loadSeed, createStore, friendlyError } from './data.js';
import { createQrMatrix, qrMatrixToSvgDataUrl, qrMatrixToPngDataUrl } from './qr-generator.js';

const HOUR_PX = 48;          // Kalender: Pixel je Stunde
const TL_HOUR_PX = 40;       // Belegungsplan: Pixel je Stunde
const TL_ROW_LANE = 26;      // Belegungsplan: Höhe je Spur
const DS = CONFIG.DAY_START;
const DE = CONFIG.DAY_END;
const BASE = CONFIG.BASE_PATH.replace(/\/$/, '');
const HOME = BASE + '/';
const LOGO_URL = new URL('assets/images/vfb-groetzingen-logo.jpg', ROOT).href;
const $ = (s, r = document) => r.querySelector(s);
const esc = L.escapeHtml;
const app = $('#app');
const newUuid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const S = {
  store: null,
  seed: null,
  resources: [],
  allResources: [],
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
  if (p === '/admin') return { name: 'admin' };
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
document.addEventListener('click', (e) => {
  const exportButton = e.target.closest('[data-export-target]');
  if (exportButton) { e.preventDefault(); openExportDialog(exportButton.dataset.exportTarget || 'all'); return; }
  const bulkDeleteButton = e.target.closest('[data-bulk-delete]');
  if (bulkDeleteButton) { e.preventDefault(); openBulkDeleteDialog(); }
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
function roomAbsoluteUrl(slug) { return new URL(`raeume/${encodeURIComponent(slug)}`, ROOT).href; }

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
  const adminLink = s.mode === 'supabase' && s.isAdmin() ? `<a href="${BASE}/admin" data-link="/admin">Administration</a>` : '';
  const passwordBtn = s.mode === 'supabase' && s.session ? '<button type="button" class="btn btn-ghost" id="btn-password">Passwort</button>' : '';
  $('#header').innerHTML = `
    <div class="wrap topbar">
      <a class="brand" href="${HOME}" data-link="/" aria-label="Zur Startseite"><img class="brand-logo" src="${esc(LOGO_URL)}" alt="VfB 04 Grötzingen e. V. – Hier ist Sport daheim"></a>
      <nav class="nav" aria-label="Hauptnavigation">
        <a href="${HOME}" data-link="/">Start</a>
        <a href="${BASE}/belegungsplan" data-link="/belegungsplan">Belegungsplan</a>
        ${adminLink}
      </nav>
      <div class="auth">${demo}${who}${passwordBtn}${authBtn}</div>
    </div>`;
  const li = $('#btn-login'); if (li) li.addEventListener('click', openLogin);
  const pw = $('#btn-password'); if (pw) pw.addEventListener('click', () => openPasswordDialog({ title: 'Passwort ändern' }));
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
        <span class="qr-downloads" data-qr-downloads="${esc(r.slug)}"><a class="btn btn-small" data-qr-svg href="#" download="qr-${esc(r.slug)}.svg">QR SVG</a><a class="btn btn-small" data-qr-png href="#" download="qr-${esc(r.slug)}.png">QR PNG</a><span class="hint" data-qr-error role="status" hidden></span></span>
        <button type="button" class="btn btn-small btn-ghost" data-poster-slug="${esc(r.slug)}" disabled aria-label="QR-Plakat für ${esc(r.name)} drucken">Plakat drucken</button>
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
  bindQrDownloads();
  bindPosterButtons();
}

function bindCopy() {
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const url = new URL(b.getAttribute('data-copy'), location.origin).href;
    try { await navigator.clipboard.writeText(url); setNotice('ok', 'Link wurde kopiert.'); }
    catch { setNotice('error', 'Der Link konnte nicht kopiert werden: ' + url); }
  }));
}

function bindQrDownloads() {
  document.querySelectorAll('[data-qr-downloads]').forEach((container) => {
    const slug = container.dataset.qrDownloads;
    const svgLink = container.querySelector('[data-qr-svg]');
    const pngLink = container.querySelector('[data-qr-png]');
    const error = container.querySelector('[data-qr-error]');
    try {
      const matrix = createQrMatrix(roomAbsoluteUrl(slug));
      svgLink.href = qrMatrixToSvgDataUrl(matrix);
      pngLink.addEventListener('click', (event) => {
        if (pngLink.dataset.generated === 'true') return;
        event.preventDefault();
        try {
          pngLink.href = qrMatrixToPngDataUrl(matrix);
          pngLink.dataset.generated = 'true';
          pngLink.click();
        } catch (err) {
          pngLink.hidden = true;
          if (error) { error.hidden = false; error.textContent = `PNG konnte nicht erstellt werden: ${err.message}`; }
        }
      });
      document.querySelectorAll('[data-poster-slug]').forEach((button) => {
        if (button.dataset.posterSlug === slug) button.disabled = false;
      });
    } catch (err) {
      svgLink.hidden = true;
      pngLink.hidden = true;
      if (error) { error.hidden = false; error.textContent = `QR-Code konnte nicht erzeugt werden: ${err.message}`; }
      document.querySelectorAll('[data-poster-slug]').forEach((button) => {
        if (button.dataset.posterSlug === slug) button.disabled = true;
      });
    }
  });
}

function bindPosterButtons() {
  document.querySelectorAll('[data-poster-slug]').forEach((button) => {
    button.addEventListener('click', () => openQrPoster(button.dataset.posterSlug));
  });
}

function openQrPoster(slug) {
  const resource = S.resources.find((r) => r.slug === slug);
  if (!resource) return;
  const target = roomAbsoluteUrl(resource.slug);
  let qr;
  try {
    qr = qrMatrixToSvgDataUrl(createQrMatrix(target));
  } catch (err) {
    setNotice('error', `QR-Code konnte nicht erstellt werden. Das Plakat wird nicht gedruckt. ${err.message}`);
    return;
  }
  const poster = window.open('', '_blank');
  if (!poster) { setNotice('error', 'Das Plakatfenster wurde blockiert. Bitte Pop-ups für diese Website erlauben.'); return; }
  const logo = LOGO_URL;
  poster.document.open();
  poster.document.write(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QR-Plakat – ${esc(resource.name)}</title>
<style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;font-family:Inter,"Open Sans",Arial,sans-serif;color:#20242a}
body{background:#f3f3f3}
.screen-actions{display:flex;justify-content:center;gap:10px;padding:14px}
.screen-actions button{font:600 16px Inter,"Open Sans",Arial,sans-serif;padding:10px 20px;border:0;border-radius:4px;background:#c8102e;color:#fff;cursor:pointer}
.screen-actions button:hover{background:#a90d27}
.screen-actions button:focus-visible{outline:3px solid #20242a;outline-offset:3px}
.screen-actions button:disabled{opacity:.58;cursor:wait}
.screen-actions button.secondary{background:#fff;color:#a90d27;border:1px solid #c8102e}
.poster{position:relative;width:210mm;height:297mm;margin:0 auto;overflow:hidden;background:#fff;box-shadow:0 8px 32px #0002}
.poster:before{content:"";position:absolute;inset:7mm;border:.6mm solid #c8102e;pointer-events:none}
.poster-content{position:relative;z-index:1;height:100%;display:flex;flex-direction:column;align-items:center;text-align:center;padding:11mm 14mm 10mm}
.club-logo{display:block;width:auto;height:auto;max-width:169mm;max-height:37.5mm;object-fit:contain;margin:0 auto 5mm}
.poster-rule{width:36mm;height:1.5mm;background:#c8102e;margin:6mm auto 0}
.qr-zone{display:grid;place-items:center;width:136mm;height:136mm;padding:10mm;background:#fff;border:.45mm solid #ead5d9}
.qr-image{display:block;width:100%;height:100%;object-fit:contain;filter:none;transform:none;image-rendering:auto}
.qr-status{margin:2mm auto;color:#a90d27;font-weight:700;font-size:10pt}
.qr-error{display:none;margin:3mm auto 0;color:#a90d27;font-weight:700;font-size:11pt}
.motto{max-width:174mm;margin:8mm 0 3mm;color:#b10f2d;font-weight:800;font-size:25pt;line-height:1.12;letter-spacing:.005em}
.resource-label{margin:0 0 1.5mm;color:#656b73;font-size:9.5pt;font-weight:700;letter-spacing:.15em;text-transform:uppercase}
.resource-name{margin:0;color:#20242a;font-size:19pt;font-weight:800;line-height:1.15}
.scan-copy{margin:3mm 0 0;color:#41464d;font-size:12pt;font-weight:600}
.poster-link{margin:3mm 0 0;color:#6b7077;font-size:9pt;overflow-wrap:anywhere}
.poster-footer{margin-top:auto;padding-top:5mm;color:#a90d27;font-size:10pt;font-weight:700;letter-spacing:.08em}
.poster-footer:before{content:"";display:block;width:28mm;height:1mm;margin:0 auto 3mm;background:#c8102e}
@media screen{
  .poster{width:min(210mm,calc(100vw - 24px));height:auto;aspect-ratio:210/297}
  .poster-content{min-height:100%;padding:5.3% 6.7% 4.5%}
  .club-logo{max-width:84%;max-height:13%;margin-bottom:2.2%}
  .poster-rule{width:18%;height:3px;margin-top:2.2%}
  .qr-zone{width:min(136mm,66vw);height:auto;aspect-ratio:1;padding:4.8%;border-width:1px}
  .motto{font-size:clamp(20px,3.8vw,34px);margin:3.8% 0 1.5%}
  .resource-label{font-size:clamp(8px,1.3vw,12px)}
  .resource-name{font-size:clamp(18px,2.6vw,26px)}
  .scan-copy{font-size:clamp(11px,1.7vw,16px);margin-top:1.6%}
  .poster-link{font-size:clamp(8px,1.15vw,11px);margin-top:1.5%}
  .poster-footer{font-size:clamp(9px,1.35vw,12px);padding-top:2.5%}
  .poster-footer:before{height:2px;margin-bottom:1.5%}
}
@media print{
  html,body{width:210mm;height:297mm;background:#fff}
  .screen-actions{display:none!important}
  body:not(.qr-ready) .poster{display:none!important}
  body:not(.qr-ready):after{content:"QR-Code nicht geladen – Druck abgebrochen.";display:block;margin:35mm auto;text-align:center;color:#a90d27;font-size:18pt;font-weight:700}
  .poster{width:210mm;height:297mm;margin:0;box-shadow:none}
  .poster-content{padding:11mm 14mm 10mm}
  .club-logo{max-width:169mm;max-height:37.5mm;margin-bottom:5mm}
  .poster-rule{width:36mm;height:1.5mm;margin-top:6mm}
  .qr-zone{width:136mm;height:136mm;padding:10mm}
  .motto{font-size:25pt;margin:8mm 0 3mm}
  .resource-label{font-size:9.5pt}
  .resource-name{font-size:19pt}
  .scan-copy{font-size:12pt;margin-top:3mm}
  .poster-link{font-size:9pt;margin-top:3mm}
  .poster-footer{font-size:10pt;padding-top:5mm}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body>
<div class="screen-actions"><button id="print-poster" type="button" disabled>QR-Code wird geprüft …</button><button class="secondary" type="button" onclick="window.close()">Schließen</button></div>
<main class="poster"><div class="poster-content">
<img class="club-logo" src="${esc(logo)}" alt="VfB 04 Grötzingen e. V. – Hier ist Sport daheim">
<div class="qr-zone"><img id="poster-qr" class="qr-image" src="${esc(qr)}" alt="Original-QR-Code für ${esc(resource.name)}"></div>
<p id="qr-status" class="qr-status" role="status" aria-live="polite">QR-Code wird geprüft …</p>
<div class="poster-rule" aria-hidden="true"></div>
<h1 class="motto">Schaue dir die aktuelle Belegung an</h1>
<p class="resource-label">Belegungskalender</p><h2 class="resource-name">${esc(resource.name)}</h2>
<p class="scan-copy">Mit der Smartphone-Kamera scannen</p><p class="poster-link">${esc(target)}</p>
<p class="poster-footer">VfB 04 Grötzingen e. V.</p></div></main></body></html>`);
  poster.document.close();
  const printButton = poster.document.getElementById('print-poster');
  const qrImage = poster.document.getElementById('poster-qr');
  const qrStatus = poster.document.getElementById('qr-status');
  const markQrReady = () => {
    if (!qrImage.naturalWidth || !qrImage.naturalHeight) return markQrFailed();
    poster.document.body.classList.add('qr-ready');
    qrStatus.style.display = 'none';
    printButton.disabled = false;
    printButton.textContent = 'Drucken';
  };
  const markQrFailed = () => {
    qrStatus.textContent = 'QR-Code konnte nicht angezeigt werden. Drucken ist gesperrt.';
    qrStatus.style.display = 'block';
    printButton.disabled = true;
    printButton.textContent = 'QR-Code fehlt';
  };
  qrImage.addEventListener('load', markQrReady);
  qrImage.addEventListener('error', markQrFailed);
  if (qrImage.complete) {
    if (qrImage.naturalWidth && qrImage.naturalHeight) markQrReady();
    else markQrFailed();
  }
  printButton.addEventListener('click', () => {
    if (poster.document.body.classList.contains('qr-ready')) poster.print();
  });
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
  if (S.planRange === 'month') {
    const first = L.monthStart(a);
    const from = L.weekStart(first);
    return { from, to: L.addDays(from, 42), days: [...Array(42)].map((_, i) => L.addDays(from, i)), month: first.getMonth() };
  }
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
        <button type="button" class="btn btn-ghost" data-poster-slug="${esc(res.slug)}" disabled aria-label="QR-Plakat für ${esc(res.name)} drucken">QR-Plakat drucken</button>
        <span class="qr-downloads" data-qr-downloads="${esc(res.slug)}"><a class="btn btn-ghost" data-qr-svg href="#" download="qr-${esc(res.slug)}.svg">QR SVG laden</a><a class="btn btn-ghost" data-qr-png href="#" download="qr-${esc(res.slug)}.png">QR PNG laden</a><span class="hint" data-qr-error role="status" hidden></span></span>
        <button type="button" class="btn btn-ghost" data-copy="${esc(roomUrl(res.slug))}">Link kopieren</button>
        ${isEditor() ? `<button type="button" class="btn" id="btn-import-room" data-res="${esc(res.id)}">Spiele importieren</button>` : ''}
        <button type="button" class="btn btn-ghost" data-export-target="${esc(res.id)}">Exportieren</button>
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
  bindQrDownloads();
  bindPosterButtons();
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
  const ib = $('#btn-import-room'); if (ib) ib.onclick = () => openImport(res);
}

function planMonthGrid(range, bookings) {
  const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((name) => `<div class="mg-dow">${name}</div>`).join('');
  const cells = range.days.map((day) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = L.addDays(start, 1);
    const rows = bookings.filter((b) => !S.hiddenRes.has(b.resource_id) && (!S.catFilter || b.category_id === S.catFilter)
      && new Date(b.ends_at) > start && new Date(b.starts_at) < end)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const shown = rows.slice(0, 4).map((b) => {
      const resource = resById(b.resource_id);
      return `<button type="button" class="plan-month-event" data-id="${esc(b.id)}" style="--resource-color:${esc(resource?.color || '#4a5568')}" title="${esc(resource?.name || '')}: ${esc(b.title)}">${hhmm(new Date(b.starts_at))} · ${esc(resource?.name || '')}: ${esc(b.title)}</button>`;
    }).join('');
    const more = rows.length > 4 ? `<span class="plan-month-more">+${rows.length - 4} weitere</span>` : '';
    const out = day.getMonth() !== range.month;
    const today = day.toDateString() === new Date().toDateString();
    return `<div class="mg-cell ${out ? 'is-out' : ''} ${today ? 'is-today' : ''}">
      <button type="button" class="mg-date" data-plan-goto="${L.ymd(day)}" aria-label="${esc(dayLong(day))} in Tagesansicht öffnen">${day.getDate()}</button>${shown}${more}</div>`;
  }).join('');
  return `<div class="mg plan-month-grid"><div class="mg-head">${weekdays}</div><div class="mg-grid">${cells}</div></div>`;
}

// Wochenübersicht: sieben feste Tages-Spalten, damit Montag bis Sonntag
// gemeinsam sichtbar sind, statt eine breite horizontale Stundentimeline.
function planWeekBoard(range, groups) {
  const headers = range.days.map((day) => `
    <div class="week-day-head" role="columnheader">
      <span>${esc(dayName(day))}</span>
      <time datetime="${L.ymd(day)}">${day.getDate()}.${day.getMonth() + 1}.</time>
    </div>`).join('');
  const groupRows = groups.map(([title, list]) => {
    if (!list.length) return '';
    const rows = list.map((resource) => {
      const segments = S.bookings
        .filter((booking) => booking.resource_id === resource.id && (!S.catFilter || booking.category_id === S.catFilter))
        .flatMap((booking) => LY.segmentsForDays(booking, range.days, DS, DE));
      const cells = range.days.map((day, dayIndex) => {
        const daySegments = segments.filter((segment) => segment.dayIndex === dayIndex)
          .sort((a, b) => a.start - b.start);
        const events = daySegments.map((segment) => {
          const booking = segment.booking;
          const category = catById(booking.category_id)?.name || 'Sonstige';
          const time = `${hhmm(segment.start)}–${hhmm(segment.end)}`;
          return `<button type="button" class="week-booking" data-id="${esc(booking.id)}"
            style="border-left-color:${esc(catColor(booking.category_id))}"
            title="${esc(booking.title)} · ${esc(category)} · ${esc(time)}"
            aria-label="${esc(resource.name)}, ${esc(dayLong(day))}: ${esc(booking.title)}, ${esc(category)}, ${esc(time)}">
            <span class="week-booking-time">${time}</span>
            <span class="week-booking-title">${esc(booking.title)}</span>
          </button>`;
        }).join('');
        return `<div class="week-day-cell" role="cell" aria-label="${esc(dayLong(day))}: ${daySegments.length ? `${daySegments.length} Belegung(en)` : 'frei'}">${events || '<span class="week-free">Frei</span>'}</div>`;
      }).join('');
      return `<div class="week-resource-row" role="row">
        <div class="week-resource-label" role="rowheader"><span class="chip" style="background:${esc(resource.color)}" aria-hidden="true"></span><span>${esc(resource.name)}</span></div>
        ${cells}
      </div>`;
    }).join('');
    return `<div class="week-group-title" role="rowheader">${title}</div>${rows}`;
  }).join('');
  return `<div class="week-board" role="table" aria-label="Belegungsplan von Montag bis Sonntag">
    <div class="week-grid-header" role="row">
      <div class="week-resource-head" role="columnheader">Platz / Raum</div>${headers}
    </div>${groupRows || '<p class="empty">Keine Räume oder Plätze vorhanden.</p>'}
  </div>`;
}

// ---------- Belegungsplan ----------
async function renderPlan() {
  const range = planRange();
  S.bookings = await S.store.getBookings({ from: range.from, to: range.to });
  if (S.planRange === 'month') {
    const visible = S.resources.filter((r) => !S.hiddenRes.has(r.id));
    const rubriken = S.resources.map((r) => `<li><label class="check"><input type="checkbox" data-res-toggle="${esc(r.id)}" ${S.hiddenRes.has(r.id) ? '' : 'checked'}><span class="chip" style="background:${esc(r.color)}" aria-hidden="true"></span><span>${esc(r.name)}</span></label></li>`).join('');
    app.innerHTML = `
      <header class="page-head"><div><h1>Belegungsplan</h1><p class="muted">Monatsübersicht aller Räume und Plätze.</p></div>
        <div class="page-actions">
          <button type="button" class="btn btn-ghost" data-export-target="all">Kalender exportieren</button>
          ${S.store.isAdmin() ? '<button type="button" class="btn btn-danger" data-bulk-delete>Mehrere löschen</button>' : ''}
          ${isEditor() ? '<button type="button" class="btn btn-primary" id="btn-new-plan">Neuer Termin</button>' : ''}
        </div>
      </header>
      <div class="plan-layout"><aside class="sidebar" aria-label="Filter">
        <section class="filter-box"><h2>Räume und Plätze</h2><div class="filter-actions"><button type="button" class="link-btn" id="show-all">Alle einblenden</button><button type="button" class="link-btn" id="hide-all">Alle ausblenden</button></div><ul class="check-list">${rubriken}</ul></section>
        <section class="filter-box"><h2><label for="cat-filter">Kategorie</label></h2><select id="cat-filter" class="input"><option value="">Alle Kategorien</option>${S.categories.map((c) => `<option value="${esc(c.id)}" ${S.catFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></section>
      </aside><section class="plan-main">
        <div class="toolbar" role="toolbar" aria-label="Zeitraum steuern"><div class="btn-group"><button type="button" class="btn" id="p-prev" aria-label="Zurück">‹</button><button type="button" class="btn" id="p-today">Heute</button><button type="button" class="btn" id="p-next" aria-label="Weiter">›</button></div><label class="date-pick"><span class="sr-only">Datum wählen</span><input type="date" id="p-date" class="input" value="${L.ymd(S.planAnchor)}"></label><p class="range-label" aria-live="polite">${esc(monthLabel(S.planAnchor))}</p><div class="btn-group" role="group" aria-label="Zeitraum">${['day','week','month'].map((v) => `<button type="button" class="btn ${S.planRange === v ? 'btn-active' : ''}" data-prange="${v}" aria-pressed="${S.planRange === v}">${{day:'Tag',week:'Woche',month:'Monat'}[v]}</button>`).join('')}</div></div>
        ${planMonthGrid(range, S.bookings)}</section></div>`;
    bindPlan();
    return;
  }
  if (S.planRange === 'week') {
    const visible = S.resources.filter((r) => !S.hiddenRes.has(r.id));
    const groups = [['Räume', visible.filter((r) => r.type === 'raum')], ['Plätze', visible.filter((r) => r.type === 'platz')]];
    const label = `${range.days[0].toLocaleDateString('de-DE')} – ${range.days[6].toLocaleDateString('de-DE')}`;
    const rubriken = S.resources.map((r) => `
      <li><label class="check">
        <input type="checkbox" data-res-toggle="${esc(r.id)}" ${S.hiddenRes.has(r.id) ? '' : 'checked'}>
        <span class="chip" style="background:${esc(r.color)}" aria-hidden="true"></span>
        <span>${esc(r.name)}</span></label></li>`).join('');
    app.innerHTML = `
      <header class="page-head">
        <div><h1>Belegungsplan</h1><p class="muted">Wochenübersicht von Montag bis Sonntag. Farbe am Eintrag = Kategorie.</p></div>
        <div class="page-actions">
          <button type="button" class="btn btn-ghost" data-export-target="all">Kalender exportieren</button>
          ${S.store.isAdmin() ? '<button type="button" class="btn btn-danger" data-bulk-delete>Mehrere löschen</button>' : ''}
          ${isEditor() ? '<button type="button" class="btn btn-primary" id="btn-new-plan">Neuer Termin</button>' : ''}
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
            <select id="cat-filter" class="input"><option value="">Alle Kategorien</option>${S.categories.map((c) => `<option value="${esc(c.id)}" ${S.catFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            <ul class="legend">${S.categories.map((c) => `<li><span class="chip" style="background:${esc(c.color)}" aria-hidden="true"></span>${esc(c.name)}</li>`).join('')}</ul>
          </section>
        </aside>
        <section class="plan-main">
          <div class="toolbar" role="toolbar" aria-label="Zeitraum steuern">
            <div class="btn-group"><button type="button" class="btn" id="p-prev" aria-label="Vorherige Woche">‹</button><button type="button" class="btn" id="p-today">Heute</button><button type="button" class="btn" id="p-next" aria-label="Nächste Woche">›</button></div>
            <label class="date-pick"><span class="sr-only">Datum wählen</span><input type="date" id="p-date" class="input" value="${L.ymd(S.planAnchor)}"></label>
            <p class="range-label" aria-live="polite">${esc(label)}</p>
            <div class="btn-group" role="group" aria-label="Zeitraum">${['day','week','month'].map((v) => `<button type="button" class="btn ${S.planRange === v ? 'btn-active' : ''}" data-prange="${v}" aria-pressed="${S.planRange === v}">${{day:'Tag',week:'Woche',month:'Monat'}[v]}</button>`).join('')}</div>
          </div>
          ${planWeekBoard(range, groups)}
        </section>
      </div>`;
    bindPlan();
    return;
  }

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
        <button type="button" class="btn btn-ghost" data-export-target="all">Kalender exportieren</button>
        ${S.store.isAdmin() ? '<button type="button" class="btn btn-danger" data-bulk-delete>Mehrere löschen</button>' : ''}
        ${isEditor() ? '<button type="button" class="btn btn-primary" id="btn-new-plan">Neuer Termin</button>' : ''}
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
            ${['day', 'week', 'month'].map((v) => `<button type="button" class="btn ${S.planRange === v ? 'btn-active' : ''}" data-prange="${v}" aria-pressed="${S.planRange === v}">${{day:'Tag',week:'Woche',month:'Monat'}[v]}</button>`).join('')}
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
  const shift = (n) => {
    if (S.planRange === 'month') S.planAnchor = new Date(S.planAnchor.getFullYear(), S.planAnchor.getMonth() + n, 1);
    else S.planAnchor = L.addDays(S.planAnchor, (S.planRange === 'day' ? 1 : 7) * n);
    render();
  };
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
  document.querySelectorAll('.bar, .plan-month-event, .week-booking').forEach((b) => b.onclick = () => openDetail(b.dataset.id));
  document.querySelectorAll('[data-plan-goto]').forEach((b) => b.onclick = () => { const [y, m, d] = b.dataset.planGoto.split('-').map(Number); S.planAnchor = new Date(y, m - 1, d); S.planRange = 'day'; render(); });
  const nb = $('#btn-new-plan'); if (nb) nb.onclick = () => openBookingForm({ resource_id: S.resources[0]?.id, date: S.planAnchor });
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
      <button type="button" class="btn btn-primary" id="d-edit">Bearbeiten</button></div>` : '<p class="muted">Änderungen sind nur mit einem berechtigten Konto möglich.</p>'}
    <p class="msg" id="d-msg" role="alert"></p>`, 'dialog-narrow');
  if (!isEditor()) return;
  const msg = (t) => { $('#d-msg', d).textContent = t; };
  $('#d-edit', d).onclick = () => {
    if (b.series_id) {
      d.addEventListener('close', () => openSeriesScopeDialog(b, 'edit'), { once: true });
      d.close();
    } else {
      d.close();
      openBookingForm({ booking: b });
    }
  };
  $('#d-del', d).onclick = async () => {
    if (b.series_id) {
      d.addEventListener('close', () => openSeriesScopeDialog(b, 'delete'), { once: true });
      d.close();
      return;
    }
    if (!confirm('Diesen Termin wirklich löschen?')) return;
    try { await S.store.deleteBookings([b.id]); d.close(); setNotice('ok', 'Termin wurde gelöscht.'); render(); }
    catch (e) { msg(friendlyError(e)); }
  };
}

function openSeriesScopeDialog(booking, action) {
  const isEdit = action === 'edit';
  const dateLabel = L.fmtDateDE(new Date(booking.starts_at));
  const d = makeDialog(
    isEdit ? 'Wiederholung bearbeiten' : 'Wiederholung löschen',
    `
      <p>Dieser Termin gehört zu einer Terminserie. Ausgewählter Termin: <strong>${esc(dateLabel)}</strong>.</p>
      <p>${isEdit ? 'Welche Termine sollen geändert werden?' : 'Welche Termine sollen endgültig gelöscht werden?'}</p>
      <div class="dialog-actions series-scope-actions">
        <button type="button" class="btn ${isEdit ? '' : 'btn-danger'}" id="series-only">Nur diesen Termin ${isEdit ? 'bearbeiten' : 'löschen'}</button>
        <button type="button" class="btn ${isEdit ? 'btn-primary' : 'btn-danger'}" id="series-following">Diesen und alle folgenden ${isEdit ? 'bearbeiten' : 'löschen'}</button>
        <button type="button" class="btn" data-close>Abbrechen</button>
      </div>
      <p class="msg" id="series-scope-msg" role="alert"></p>`, 'dialog-narrow'
  );
  const msg = (text) => { $('#series-scope-msg', d).textContent = text; };
  const buttons = [$('#series-only', d), $('#series-following', d)];
  const editScope = (scope) => {
    d.addEventListener('close', () => openBookingForm({ booking, seriesScope: scope }), { once: true });
    d.close();
  };
  const deleteScope = async (scope) => {
    buttons.forEach((button) => { button.disabled = true; });
    msg(scope === 'following' ? 'Folgende Termine werden ermittelt …' : 'Termin wird gelöscht …');
    try {
      let targets = [booking];
      if (scope === 'following') {
        const series = await S.store.getSeriesBookings(booking.series_id);
        targets = L.followingSeriesBookings(series, booking);
      }
      if (!targets.length) {
        msg('Für diesen Termin wurden keine zugehörigen Wiederholungen gefunden.');
        buttons.forEach((button) => { button.disabled = false; });
        return;
      }
      msg(targets.length === 1 ? 'Termin wird gelöscht …' : `${targets.length} Termine werden gelöscht …`);
      await S.store.deleteBookings(targets.map((item) => item.id));
      d.close();
      setNotice('ok', targets.length === 1 ? 'Termin wurde gelöscht.' : `${targets.length} Termine ab diesem Datum wurden gelöscht.`);
      render();
    } catch (err) {
      msg(friendlyError(err));
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
  if (isEdit) {
    $('#series-only', d).onclick = () => editScope('single');
    $('#series-following', d).onclick = () => editScope('following');
  } else {
    $('#series-only', d).onclick = () => deleteScope('single');
    $('#series-following', d).onclick = () => deleteScope('following');
  }
}

function resOptions(selected) {
  return S.resources.map((r) => `<option value="${esc(r.id)}" ${r.id === selected ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
}
function catOptions(selected) {
  return S.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function openBookingForm({ booking = null, resource_id = null, date = new Date(), seriesScope = 'single' } = {}) {
  const isEdit = !!booking;
  const start = booking ? new Date(booking.starts_at) : null;
  const end = booking ? new Date(booking.ends_at) : null;
  const dateVal = booking ? L.ymd(start) : L.ymd(date);
  const d = makeDialog(isEdit ? 'Termin bearbeiten' : 'Neuer Termin', `
    <form id="bf" class="form" novalidate>
      ${isEdit && booking.series_id && seriesScope === 'following' ? '<p class="notice notice-warn">Die Änderungen gelten für diesen Termin und alle folgenden Termine der Serie.</p>' : ''}
      <div class="field"><label for="bf-title">Titel <span class="req">*</span></label>
        <input id="bf-title" class="input" required maxlength="120" value="${esc(booking?.title || '')}" autocomplete="off">
        <p class="hint">Öffentlich sichtbar. Bitte allgemein formulieren.</p></div>
      <div class="field-row">
        <div class="field"><label for="bf-res">Kalender / Platz / Raum <span class="req">*</span></label>
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
      ${isEdit ? '' : `<div class="field-row recurrence-row">
        <div class="field"><label for="bf-repeat">Wiederholung</label>
          <select id="bf-repeat" class="input"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="biweekly">Alle 2 Wochen</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select></div>
        <div class="field"><label for="bf-count">Anzahl Termine insgesamt</label>
          <input id="bf-count" type="number" class="input" min="2" max="52" value="4" disabled><p class="hint">Der erste Termin zählt mit; höchstens 52 Termine.</p></div></div>`}
      <div class="field"><label for="bf-note">Notiz (nur für Mitglieder sichtbar)</label>
        <textarea id="bf-note" class="input" rows="3" maxlength="1000">${esc(booking?.notes || '')}</textarea></div>
      <p class="msg" id="bf-msg" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Termin anlegen'}</button>
      </div>
    </form>`, 'dialog-wide');

  const form = $('#bf', d);
  const saveButton = form.querySelector('button[type="submit"]');
  const msg = (t) => { $('#bf-msg', d).textContent = t; };
  const repeat = $('#bf-repeat', d);
  if (repeat) repeat.onchange = () => { $('#bf-count', d).disabled = repeat.value === 'none'; };

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
    const frequency = repeat?.value || 'none';
    const countInput = Number($('#bf-count', d)?.value);
    if (frequency !== 'none' && (!Number.isInteger(countInput) || countInput < 2 || countInput > 52)) return msg('Für eine Wiederholung bitte 2 bis 52 Termine angeben.');
    const count = frequency === 'none' ? 1 : countInput;
    const dates = count > 1 ? L.seriesDates(dateStr, count, frequency) : [dateStr];
    const seriesId = count > 1 ? newUuid() : null;
    const rows = dates.map((ds) => ({
      resource_id: resId,
      category_id: catId,
      title,
      starts_at: L.combine(ds, s).toISOString(),
      ends_at: L.combine(ds, en).toISOString(),
      notes,
      series_id: seriesId
    }));
    saveButton.disabled = true;
    try {
      let successMessage;
      if (isEdit && booking.series_id && seriesScope === 'following') {
        const series = await S.store.getSeriesBookings(booking.series_id);
        const updates = L.buildFollowingSeriesUpdates(series, booking, {
          dateStr,
          startTime: s,
          endTime: en,
          fields: { title, resource_id: resId, category_id: catId, notes }
        });
        if (!updates.length) { saveButton.disabled = false; return msg('Ab diesem Termin wurden keine weiteren Serien-Termine gefunden.'); }
        const results = await Promise.allSettled(updates.map((update) => S.store.updateBooking(update.id, update.patch)));
        const savedCount = results.filter((result) => result.status === 'fulfilled').length;
        if (savedCount !== updates.length) throw new Error(`${savedCount} von ${updates.length} Terminen wurden gespeichert. Bitte die Seite neu laden und den Serienstand prüfen.`);
        successMessage = `${updates.length} Termine ab diesem Datum wurden angepasst.`;
      } else if (isEdit) {
        await S.store.updateBooking(booking.id, { title, resource_id: resId, category_id: catId, starts_at: rows[0].starts_at, ends_at: rows[0].ends_at, notes });
        successMessage = 'Termin wurde gespeichert.';
      } else {
        await S.store.createBookings(rows);
        successMessage = count > 1 ? `${count} Termine wurden angelegt.` : 'Termin wurde angelegt.';
      }
      d.close();
      setNotice('ok', successMessage);
      render();
    } catch (err) {
      msg(friendlyError(err));
      saveButton.disabled = false;
    }
  };
  $('#bf-title', d).focus();
}

// ---------- Import ----------
function openImport(selectedResource) {
  if (!selectedResource) { setNotice('error', 'Bitte zuerst den Raum- oder Platzkalender öffnen.'); return; }
  const defaultCategory = S.categories.find((c) => c.name.toLowerCase() === 'spiel') || S.categories[0];
  const categoryOptions = S.categories.map((c) => `<option value="${esc(c.id)}" ${defaultCategory?.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const resourceField = `<p class="notice notice-ok">Standardkalender: <strong>${esc(selectedResource.name)}</strong>. Eine gefüllte Spalte „Calendar Name“ kann den Zielkalender pro Zeile ändern.</p>`;
  const d = makeDialog('Spielplan importieren', `
    <p>Pflichtspalten: <strong>Start Date</strong>, <strong>Start Time</strong> und <strong>Subject</strong>. Optional: <strong>End Date</strong>, <strong>End Time</strong> und <strong>Calendar Name</strong>.</p>
    <p class="hint">Wenn End Date oder End Time fehlt, werden 90 Minuten ab Startzeit angenommen. Calendar Name kann ein Kalendername oder Slug sein; bei fehlendem oder unbekanntem Wert gilt der aktuelle Kalender. Überschneidungen sind erlaubt. Unterstützt: Excel (.xlsx) und CSV.</p>
    <div class="page-actions">
      <a class="btn btn-small" href="${new URL('assets/templates/vorlage-spielplan.xlsx', ROOT).href}" download>Beispiel herunterladen (.xlsx)</a>
      <a class="btn btn-small" href="${new URL('assets/templates/vorlage-spielplan.csv', ROOT).href}" download>Beispiel herunterladen (.csv)</a>
    </div>
    ${resourceField}
    <div class="field"><label for="imp-category">Kategorie</label><select id="imp-category" class="input">${categoryOptions}</select></div>
    <div class="field"><label for="imp-file">Spielplandatei auswählen</label><input id="imp-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="input"></div>
    <div id="imp-result" aria-live="polite"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="button" class="btn btn-primary" id="imp-go" disabled>Importieren</button></div>`, 'dialog-wide');

  let sourceTable = null;
  let prepared = null;
  const out = $('#imp-result', d);
  const go = $('#imp-go', d);
  const getSelection = () => ({
    resource: selectedResource,
    resources: S.resources,
    category: S.categories.find((c) => c.id === $('#imp-category', d)?.value)
  });
  const validate = async () => {
    go.disabled = true;
    prepared = null;
    if (!sourceTable) return;
    const { resource, resources, category } = getSelection();
    const result = L.validateMatchTable(sourceTable, { resource, resources, category, durationMinutes: 90 });
    prepared = result;
    out.innerHTML = renderImportResult(result);
    go.disabled = !!(result.errors.length || !result.bookings.length);
    if (!go.disabled) out.insertAdjacentHTML('afterbegin', `<p class="notice notice-ok">${result.bookings.length} Termine sind gültig. Fehlende Endangaben erhalten 90 Minuten Dauer; Überschneidungen sind erlaubt.</p>`);
  };
  $('#imp-category', d).addEventListener('change', validate);
  $('#imp-file', d).onchange = async (e) => {
    const file = e.target.files[0];
    sourceTable = null;
    prepared = null;
    go.disabled = true;
    if (!file) return;
    try {
      if (/\.csv$/i.test(file.name)) {
        sourceTable = L.parseCSV(await file.text());
      } else if (/\.xlsx$/i.test(file.name)) {
        const XLSX = await import('../vendor/xlsx.mjs');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        sourceTable = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: '' });
      } else {
        out.innerHTML = '<p class="notice notice-error">Bitte eine CSV- oder XLSX-Datei auswählen.</p>';
        return;
      }
      await validate();
    } catch (err) {
      out.innerHTML = `<p class="notice notice-error">Die Datei konnte nicht gelesen werden: ${esc(err.message || err)}</p>`;
    }
  };
  go.onclick = async () => {
    if (!prepared || go.disabled) return;
    const rows = prepared.bookings.map(({ _line, _resource, ...booking }) => booking);
    go.disabled = true;
    try {
      await S.store.createBookings(rows);
      d.close();
      setNotice('ok', `${rows.length} Termine wurden importiert.`);
      render();
    } catch (err) {
      out.innerHTML = `<p class="notice notice-error">${esc(friendlyError(err))} Es wurde nichts importiert.</p>`;
      go.disabled = false;
    }
  };
}

function renderImportResult(r) {
  let html = '';
  if (r.warnings?.length) {
    html += `<div class="notice notice-warn"><p><strong>Hinweise zur Kalenderzuordnung/Dauer:</strong></p><ul>${r.warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul></div>`;
  }
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

function downloadBlob(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function openExportDialog(defaultResourceId = 'all') {
  const resources = S.resources;
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const selected = resourceMap.has(defaultResourceId) ? defaultResourceId : 'all';
  const options = `<option value="all" ${selected === 'all' ? 'selected' : ''}>Alle Plätze und Räume</option>` +
    resources.map((r) => `<option value="${esc(r.id)}" ${selected === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const d = makeDialog('Kalender exportieren', `
    <p>Exportiert alle Termine des ausgewählten Kalenders – unabhängig vom aktuell sichtbaren Zeitraum. Notizen werden nicht exportiert.</p>
    <div class="field"><label for="export-calendar">Kalender auswählen</label><select id="export-calendar" class="input">${options}</select></div>
    <div class="dialog-actions export-actions"><button type="button" class="btn" id="export-csv">CSV herunterladen</button><button type="button" class="btn btn-primary" id="export-xlsx">Excel herunterladen</button></div>
    <p id="export-status" class="msg" role="status" aria-live="polite"></p>`, 'dialog-narrow');
  const status = $('#export-status', d);
  const csvButton = $('#export-csv', d);
  const xlsxButton = $('#export-xlsx', d);
  const makeExport = async (format) => {
    csvButton.disabled = xlsxButton.disabled = true;
    status.className = 'msg muted';
    status.textContent = 'Termine werden geladen …';
    try {
      const targetId = $('#export-calendar', d).value;
      const targetResource = resourceMap.get(targetId);
      const bookings = await S.store.getAllBookings(targetId === 'all' ? null : targetId);
      const activeIds = new Set(resources.map((r) => r.id));
      const selectedBookings = bookings.filter((b) => activeIds.has(b.resource_id));
      if (!selectedBookings.length) {
        status.className = 'msg';
        status.textContent = 'Für diese Auswahl gibt es keine Termine zum Exportieren.';
        return;
      }
      const allResources = new Map([...(S.allResources || []), ...resources].map((r) => [r.id, r]));
      const rows = [
        ['Start Date', 'Start Time', 'End Date', 'End Time', 'Subject', 'Calendar Name'],
        ...selectedBookings.map((b) => {
          const start = new Date(b.starts_at), end = new Date(b.ends_at);
          const resource = allResources.get(b.resource_id);
          return [L.ymd(start), hhmm(start), L.ymd(end), hhmm(end), b.title, resource?.name || 'Unbekannter Kalender'];
        })
      ];
      const prefix = targetId === 'all' ? 'alle-kalender' : (targetResource?.slug || 'kalender');
      const baseName = `vfb-kalender-${prefix}-${L.ymd(new Date())}`;
      if (format === 'csv') {
        const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
        downloadBlob(`\uFEFF${csv}`, 'text/csv;charset=utf-8', `${baseName}.csv`);
      } else {
        const XLSX = await import('../vendor/xlsx.mjs');
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        sheet['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 36 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(workbook, sheet, 'Termine');
        await XLSX.writeFile(workbook, `${baseName}.xlsx`);
      }
      status.className = 'msg';
      status.textContent = `${selectedBookings.length} Termine exportiert.`;
    } catch (err) {
      status.className = 'msg';
      status.textContent = `Export fehlgeschlagen: ${friendlyError(err)}`;
    } finally {
      csvButton.disabled = xlsxButton.disabled = false;
    }
  };
  csvButton.onclick = () => makeExport('csv');
  xlsxButton.onclick = () => makeExport('xlsx');
}

async function openBulkDeleteDialog() {
  if (!S.store.isAdmin()) { setNotice('error', 'Mehrfachlöschen ist Administratoren vorbehalten.'); return; }
  const d = makeDialog('Termine mehrfach löschen', `
    <p>Wähle Termine aus allen Kalendern aus. Die Liste umfasst alle geladenen Termine, nicht nur den sichtbaren Zeitraum.</p>
    <p id="bulk-status" class="muted" role="status" aria-live="polite">Alle Termine werden geladen …</p>
    <div id="bulk-list"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-close>Schließen</button><button type="button" class="btn btn-danger" id="bulk-delete-confirm" disabled>Ausgewählte löschen</button></div>`, 'dialog-wide');
  const status = $('#bulk-status', d);
  const list = $('#bulk-list', d);
  const deleteButton = $('#bulk-delete-confirm', d);
  try {
    const bookings = await S.store.getAllBookings();
    const resourceMap = new Map([...(S.allResources || []), ...S.resources].map((r) => [r.id, r]));
    const ordered = bookings.slice().sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    if (!ordered.length) { status.textContent = 'Es sind keine Termine vorhanden.'; return; }
    status.textContent = `${ordered.length} Termine geladen.`;
    list.innerHTML = `
      <div class="bulk-select-all"><label class="check"><input type="checkbox" id="bulk-select-all"><span>Alle auswählen</span></label><span id="bulk-selected-count" class="muted">0 ausgewählt</span></div>
      <div class="table-wrap bulk-table-wrap"><table class="table"><thead><tr><th scope="col">Markieren</th><th scope="col">Datum</th><th scope="col">Zeit</th><th scope="col">Kalender</th><th scope="col">Titel</th></tr></thead><tbody>
      ${ordered.map((b) => {
        const start = new Date(b.starts_at), end = new Date(b.ends_at);
        const resource = resourceMap.get(b.resource_id)?.name || 'Archivierter/Unbekannter Kalender';
        return `<tr><td><input class="bulk-booking-check" type="checkbox" value="${esc(b.id)}" aria-label="Termin ${esc(b.title)} markieren"></td><td>${esc(L.fmtDateDE(start))}</td><td>${hhmm(start)}–${hhmm(end)}</td><td>${esc(resource)}</td><td>${esc(b.title)}</td></tr>`;
      }).join('')}
      </tbody></table></div>`;
    const checks = [...d.querySelectorAll('.bulk-booking-check')];
    const all = $('#bulk-select-all', d);
    const count = $('#bulk-selected-count', d);
    const updateCount = () => {
      const selectedCount = checks.filter((c) => c.checked).length;
      count.textContent = `${selectedCount} ausgewählt`;
      deleteButton.disabled = selectedCount === 0;
      all.checked = selectedCount > 0 && selectedCount === checks.length;
      all.indeterminate = selectedCount > 0 && selectedCount < checks.length;
    };
    checks.forEach((c) => c.addEventListener('change', updateCount));
    all.addEventListener('change', () => { checks.forEach((c) => { c.checked = all.checked; }); updateCount(); });
    deleteButton.onclick = async () => {
      const ids = checks.filter((c) => c.checked).map((c) => c.value);
      if (!ids.length || !S.store.isAdmin()) return;
      if (!window.confirm(`${ids.length} ausgewählte Termine unwiderruflich löschen?`)) return;
      deleteButton.disabled = true;
      status.textContent = 'Ausgewählte Termine werden gelöscht …';
      let deleted = 0;
      try {
        for (let i = 0; i < ids.length; i += 100) {
          await S.store.deleteBookings(ids.slice(i, i + 100));
          deleted += Math.min(100, ids.length - i);
        }
        d.close();
        setNotice('ok', `${deleted} Termine wurden gelöscht.`);
        render();
      } catch (err) {
        status.className = 'notice notice-error';
        status.textContent = `${deleted} von ${ids.length} Terminen gelöscht. Fehler: ${friendlyError(err)}`;
        deleteButton.disabled = false;
      }
    };
  } catch (err) {
    status.className = 'notice notice-error';
    status.textContent = `Termine konnten nicht geladen werden: ${friendlyError(err)}`;
  }
}

// ---------- Anmeldung ----------
function openPasswordDialog({ title = 'Passwort festlegen' } = {}) {
  if (!S.store.session) {
    setNotice('error', 'Der Passwort-Link ist abgelaufen oder die Sitzung fehlt. Bitte einen neuen Link anfordern.');
    return;
  }
  const d = makeDialog(title, `
    <form id="password-form" class="form" novalidate>
      <p class="muted">Verwende mindestens 10 Zeichen.</p>
      <div class="field"><label for="pw-new">Neues Passwort</label><input id="pw-new" class="input" type="password" autocomplete="new-password" minlength="10" required></div>
      <div class="field"><label for="pw-confirm">Passwort wiederholen</label><input id="pw-confirm" class="input" type="password" autocomplete="new-password" minlength="10" required></div>
      <p class="msg" id="pw-msg" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary">Passwort speichern</button></div>
    </form>`, 'dialog-narrow');
  $('#password-form', d).onsubmit = async (e) => {
    e.preventDefault();
    const password = $('#pw-new', d).value;
    const confirmPassword = $('#pw-confirm', d).value;
    if (password.length < 10) return $('#pw-msg', d).textContent = 'Das Passwort muss mindestens 10 Zeichen lang sein.';
    if (password !== confirmPassword) return $('#pw-msg', d).textContent = 'Die Passwörter stimmen nicht überein.';
    try {
      await S.store.updatePassword(password);
      d.close();
      setNotice('ok', 'Das Passwort wurde gespeichert.');
      render();
    } catch (err) { $('#pw-msg', d).textContent = friendlyError(err); }
  };
  $('#pw-new', d).focus();
}

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
      await s.signIn({ role: d.querySelector('input[name="role"]:checked').value });
      d.close(); setNotice('ok', 'Demo-Anmeldung erfolgreich.'); render();
    };
    return;
  }
  const d = makeDialog('Anmelden', `
    <form id="lf" class="form">
      <p>Nur von einem Administrator eingeladene Konten können sich anmelden.</p>
      <div class="field"><label for="lf-mail">E-Mail-Adresse</label><input id="lf-mail" type="email" class="input" required autocomplete="email"></div>
      <fieldset class="field"><legend>Anmeldeart</legend>
        <label class="check"><input type="radio" name="login-mode" value="password" checked> E-Mail und Passwort</label>
        <label class="check"><input type="radio" name="login-mode" value="magic"> Magic-Link per E-Mail</label>
      </fieldset>
      <div class="field" id="lf-password-wrap"><label for="lf-password">Passwort</label><input id="lf-password" type="password" class="input" autocomplete="current-password"></div>
      <button type="button" class="link-btn" id="lf-forgot">Passwort vergessen?</button>
      <p class="msg" id="lf-msg" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="submit" class="btn btn-primary" id="lf-submit">Anmelden</button></div>
    </form>`, 'dialog-narrow');
  const modeInputs = [...d.querySelectorAll('input[name="login-mode"]')];
  const syncMode = () => {
    const mode = d.querySelector('input[name="login-mode"]:checked').value;
    $('#lf-password-wrap', d).hidden = mode !== 'password';
    $('#lf-forgot', d).hidden = mode !== 'password';
    $('#lf-submit', d).textContent = mode === 'password' ? 'Anmelden' : 'Magic-Link senden';
  };
  modeInputs.forEach((input) => input.addEventListener('change', syncMode));
  syncMode();
  $('#lf', d).onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#lf-mail', d).value.trim();
    const mode = d.querySelector('input[name="login-mode"]:checked').value;
    try {
      if (mode === 'magic') {
        await s.signIn({ email });
        d.close();
        setNotice('ok', 'Falls das Konto eingeladen ist, wurde ein Magic-Link gesendet.');
      } else {
        await s.signInWithPassword({ email, password: $('#lf-password', d).value });
        d.close(); setNotice('ok', 'Sie sind angemeldet.'); render();
      }
    } catch { $('#lf-msg', d).textContent = 'Anmeldung nicht möglich. Prüfe E-Mail und Passwort oder fordere einen neuen Link an.'; }
  };
  $('#lf-forgot', d).onclick = async () => {
    const email = $('#lf-mail', d).value.trim();
    if (!email) { $('#lf-msg', d).textContent = 'Bitte zuerst die E-Mail-Adresse eingeben.'; return; }
    try {
      await s.requestPasswordReset(email);
      $('#lf-msg', d).textContent = 'Falls für diese Adresse ein Konto besteht, wurde ein Wiederherstellungslink gesendet.';
    } catch { $('#lf-msg', d).textContent = 'Der Wiederherstellungslink konnte gerade nicht gesendet werden.'; }
  };
}

function openAdmin() {
  if (S.store.mode !== 'supabase' || !S.store.isAdmin()) {
    setNotice('error', 'Der Admin-Bereich ist nur für Administratoren verfügbar.');
    return;
  }
  renderAdmin();
}

async function renderAdmin() {
  if (S.store.mode !== 'supabase' || !S.store.isAdmin()) {
    app.innerHTML = '<section class="hero"><h1>Kein Zugriff</h1><p>Der Admin-Bereich ist nur für Administratoren verfügbar.</p></section>';
    return;
  }
  app.innerHTML = '<p class="notice">Admin-Daten werden geladen …</p>';
  let resources = [], users = [], audit = [], failures = [];
  const results = await Promise.allSettled([S.store.getAllResources(), S.store.listMembers(), S.store.getAuditLog()]);
  if (results[0].status === 'fulfilled') resources = results[0].value; else failures.push('Räume/Plätze: ' + friendlyError(results[0].reason));
  if (results[1].status === 'fulfilled') users = results[1].value.users || []; else failures.push('Benutzerverwaltung: ' + friendlyError(results[1].reason));
  if (results[2].status === 'fulfilled') audit = results[2].value || []; else failures.push('Änderungsprotokoll: ' + friendlyError(results[2].reason));
  S.allResources = resources;
  S.resources = resources.filter((r) => r.is_active !== false);
  const resourceRows = resources.map((r) => `<tr>
    <td><input class="input" data-resource-name="${esc(r.id)}" value="${esc(r.name)}" aria-label="Name von ${esc(r.name)}"></td>
    <td><input class="input slug-input" data-resource-slug="${esc(r.id)}" value="${esc(r.slug)}" maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-label="Dauerhafter Slug von ${esc(r.name)}" title="Nur Kleinbuchstaben, Ziffern und Bindestriche; ohne Bindestrich am Anfang oder Ende."></td>
    <td>${r.type === 'raum' ? 'Raum' : 'Platz'}</td>
    <td><label class="order-field"><span class="sr-only">Reihenfolge für ${esc(r.name)}</span><input type="number" min="1" step="1" class="input order-input" data-resource-order="${esc(r.id)}" value="${Number(r.sort_order) || 1}"></label></td>
    <td><input type="color" class="input color-input" data-resource-color="${esc(r.id)}" value="${esc(r.color)}" aria-label="Farbe von ${esc(r.name)}"></td>
    <td>${r.is_active === false ? '<span class="badge">Inaktiv</span>' : '<span class="badge badge-role">Aktiv</span>'}</td>
    <td class="admin-actions"><button type="button" class="btn btn-small" data-resource-save="${esc(r.id)}">Speichern</button>${r.is_active === false ? `<button type="button" class="btn btn-small" data-resource-restore="${esc(r.id)}">Aktivieren</button>` : `<button type="button" class="btn btn-small btn-danger" data-resource-archive="${esc(r.id)}">Deaktivieren</button>`}<button type="button" class="btn btn-small btn-danger" data-resource-delete="${esc(r.id)}" data-resource-name-label="${esc(r.name)}">Endgültig löschen</button></td>
  </tr>`).join('');
  const userRows = users.map((u) => `<tr>
    <td>${esc(u.email || '—')}</td><td>${u.email_confirmed_at ? 'Bestätigt' : 'Einladung ausstehend'}</td>
    <td><select class="input" data-member-role="${esc(u.id)}"><option value="bearbeiter" ${u.role === 'bearbeiter' ? 'selected' : ''}>Bearbeiter</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option></select></td>
    <td class="admin-actions"><button type="button" class="btn btn-small" data-member-save="${esc(u.id)}">Rolle speichern</button><button type="button" class="btn btn-small btn-danger" data-member-remove="${esc(u.id)}">Zugang entziehen</button></td>
  </tr>`).join('');
  const logRows = audit.map((entry) => {
    const snapshot = entry.after_data || entry.before_data || {};
    const resource = S.allResources.find((r) => r.id === snapshot.resource_id)?.name || snapshot.resource_name || snapshot.resource_id || '—';
    const action = ({ created: 'Eingetragen', updated: 'Geändert', deleted: 'Gelöscht' })[entry.action] || entry.action;
    const detail = JSON.stringify({ vorher: entry.before_data, nachher: entry.after_data }, null, 2);
    return `<tr><td>${esc(new Date(entry.occurred_at).toLocaleString('de-DE'))}</td><td>${esc(entry.actor_email || 'Unbekannter Benutzer')}</td><td>${esc(action)}</td><td>${esc(snapshot.title || '—')}<br><span class="muted">${esc(resource)}</span></td><td><details><summary>Details</summary><pre class="audit-json">${esc(detail)}</pre></details></td></tr>`;
  }).join('');
  app.innerHTML = `
    <header class="page-head"><div><h1>Administration</h1><p class="muted">Ressourcen, Benutzer und Terminänderungen verwalten.</p></div></header>
    ${failures.length ? `<div class="notice notice-warn"><strong>Einrichtung noch nicht vollständig:</strong><ul>${failures.map((m) => `<li>${esc(m)}</li>`).join('')}</ul><p>Bitte die Datenbankmigration und die Supabase-Funktion gemäß der mitgelieferten Einrichtungsanleitung bereitstellen.</p></div>` : ''}
    <section class="section admin-section"><h2>Räume und Plätze</h2><form id="resource-form" class="form admin-resource-form">
      <div class="field"><label for="resource-name">Name</label><input id="resource-name" class="input" required maxlength="80"></div>
      <div class="field"><label for="resource-type">Typ</label><select id="resource-type" class="input"><option value="raum">Raum</option><option value="platz">Platz</option></select></div>
      <div class="field"><label for="resource-color">Farbe</label><input id="resource-color" type="color" class="input color-input" value="#1f5fa8"></div>
      <button type="submit" class="btn btn-primary">Hinzufügen</button><p class="msg" id="resource-msg" role="alert"></p></form>
      <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Dauerhafter Slug (Link)</th><th>Typ</th><th>Reihenfolge</th><th>Farbe</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>${resourceRows || '<tr><td colspan="7">Keine Ressourcen vorhanden.</td></tr>'}</tbody></table></div>
      <p class="hint">Eine kleinere Reihenfolgenzahl erscheint weiter oben; die gespeicherte Reihenfolge gilt für alle. Deaktivierte Ressourcen verschwinden aus den Kalendern, ihre Buchungen bleiben erhalten. Endgültiges Löschen ist nur ohne aktuelle oder zukünftige Termine möglich; dabei werden alle vergangenen Buchungen gelöscht, Audit-Einträge bleiben erhalten.</p>
      <p class="hint">Der Name kann ohne Änderung des Links angepasst werden. Administratoren können auch den Slug bearbeiten. Vor dem Speichern erscheint eine Warnung: Eine Slug-Änderung ändert den Kalenderlink; bereits verteilte Links, Lesezeichen und gedruckte QR-Codes führen dann nicht mehr zum Raum. Ein neuer QR-Code wird automatisch aus dem aktuellen Link erzeugt.</p>
    </section>
    <section class="section admin-section"><h2>Benutzer und Einladungen</h2><form id="invite-form" class="form admin-invite-form">
      <div class="field"><label for="invite-email">E-Mail-Adresse</label><input id="invite-email" type="email" class="input" required autocomplete="email"></div>
      <div class="field"><label for="invite-role">Rolle</label><select id="invite-role" class="input"><option value="bearbeiter">Bearbeiter</option><option value="admin">Administrator</option></select></div>
      <button type="submit" class="btn btn-primary">Einladung senden</button><p class="msg" id="invite-msg" role="alert"></p></form>
      <div class="table-wrap"><table class="table"><thead><tr><th>E-Mail</th><th>Status</th><th>Rolle</th><th>Aktionen</th></tr></thead><tbody>${userRows || '<tr><td colspan="4">Noch keine Mitglieder geladen.</td></tr>'}</tbody></table></div>
    </section>
    <section class="section admin-section"><h2>Termin-Änderungsprotokoll</h2><p class="hint">Letzte 200 Einträge. Protokolleinträge sind unveränderlich.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Aktion</th><th>Termin/Ressource</th><th>Änderungen</th></tr></thead><tbody>${logRows || '<tr><td colspan="5">Noch keine Protokolleinträge oder die Migration fehlt.</td></tr>'}</tbody></table></div>
    </section>`;
  bindAdmin(resources);
}

function slugifyResource(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function bindAdmin(resources) {
  const resourceForm = $('#resource-form');
  if (resourceForm) resourceForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#resource-name').value.trim();
    if (!name) { $('#resource-msg').textContent = 'Bitte einen Namen eingeben.'; return; }
    const slugBase = slugifyResource(name) || 'ressource';
    const slug = `${slugBase}-${newUuid().slice(0, 6)}`;
    try {
      const nextOrder = Math.max(0, ...resources.map((r) => Number(r.sort_order) || 0)) + 1;
      await S.store.createResource({ name, slug, type: $('#resource-type').value, color: $('#resource-color').value, sort_order: nextOrder, is_active: true });
      await renderAdmin();
      setNotice('ok', `Ressource hinzugefügt. QR-Code und Plakat sind sofort verfügbar. Dauerhafter Slug: ${slug}.`);
    } catch (err) { $('#resource-msg').textContent = friendlyError(err); }
  };
  document.querySelectorAll('[data-resource-save]').forEach((button) => button.onclick = async () => {
    const id = button.dataset.resourceSave;
    try {
      const name = $(`[data-resource-name="${id}"]`).value.trim();
      const slug = $(`[data-resource-slug="${id}"]`).value.trim();
      const sort_order = Number($(`[data-resource-order="${id}"]`).value);
      const original = S.allResources.find((resource) => resource.id === id);
      if (!name) { setNotice('error', 'Der Ressourcenname darf nicht leer sein.'); return; }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
        setNotice('error', 'Der Slug darf nur Kleinbuchstaben, Ziffern und einzelne Bindestriche enthalten; er darf nicht mit einem Bindestrich beginnen oder enden.');
        return;
      }
      if (!Number.isInteger(sort_order) || sort_order < 1) { setNotice('error', 'Die Reihenfolge muss eine positive ganze Zahl sein.'); return; }
      if (original && slug !== original.slug) {
        const oldLink = roomAbsoluteUrl(original.slug);
        const newLink = roomAbsoluteUrl(slug);
        const confirmed = window.confirm(`Slug wirklich ändern?\n\nBisheriger Link:\n${oldLink}\n\nNeuer Link:\n${newLink}\n\nBereits verteilte Links, Lesezeichen und gedruckte QR-Codes mit dem bisherigen Slug führen danach nicht mehr zu dieser Ressource. Ein neuer QR-Code wird automatisch erstellt. Fortfahren?`);
        if (!confirmed) return;
      }
      await S.store.updateResource(id, { name, slug, color: $(`[data-resource-color="${id}"]`).value, sort_order });
      await renderAdmin(); setNotice('ok', slug !== original?.slug ? 'Slug geändert. Verwende ab jetzt den neuen Link und erstelle neue QR-Plakate.' : 'Ressource wurde gespeichert.');
    } catch (err) {
      setNotice('error', err?.code === '23505' ? 'Dieser Slug ist bereits vergeben. Bitte einen anderen Slug wählen.' : friendlyError(err));
    }
  });
  document.querySelectorAll('[data-resource-archive]').forEach((button) => button.onclick = async () => {
    if (!confirm('Ressource deaktivieren? Bestehende Termine und Protokolle bleiben erhalten.')) return;
    try { await S.store.updateResource(button.dataset.resourceArchive, { is_active: false }); await renderAdmin(); setNotice('ok', 'Ressource wurde deaktiviert.'); }
    catch (err) { setNotice('error', friendlyError(err)); }
  });
  document.querySelectorAll('[data-resource-restore]').forEach((button) => button.onclick = async () => {
    try { await S.store.updateResource(button.dataset.resourceRestore, { is_active: true }); await renderAdmin(); setNotice('ok', 'Ressource wurde aktiviert.'); }
    catch (err) { setNotice('error', friendlyError(err)); }
  });
  document.querySelectorAll('[data-resource-delete]').forEach((button) => button.onclick = async () => {
    const name = button.dataset.resourceNameLabel || 'Diese Ressource';
    const warning = `${name} endgültig löschen? Das ist nur möglich, wenn keine aktuellen oder zukünftigen Termine mehr bestehen. Alle vergangenen Buchungen werden gelöscht; die Audit-Protokolle bleiben erhalten. Diese Aktion kann nicht rückgängig gemacht werden.`;
    if (!confirm(warning)) return;
    try { await S.store.deleteResource(button.dataset.resourceDelete); await renderAdmin(); setNotice('ok', 'Ressource und vergangene Buchungen wurden endgültig gelöscht.'); }
    catch (err) { setNotice('error', friendlyError(err)); }
  });
  const inviteForm = $('#invite-form');
  if (inviteForm) inviteForm.onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('#invite-msg'); msg.textContent = '';
    try {
      await S.store.inviteMember($('#invite-email').value.trim(), $('#invite-role').value);
      await renderAdmin(); setNotice('ok', 'Einladung wurde versendet.');
    } catch (err) { msg.textContent = friendlyError(err); }
  };
  document.querySelectorAll('[data-member-save]').forEach((button) => button.onclick = async () => {
    const role = $(`[data-member-role="${button.dataset.memberSave}"]`).value;
    try { await S.store.setMemberRole(button.dataset.memberSave, role); await renderAdmin(); setNotice('ok', 'Rolle wurde gespeichert.'); }
    catch (err) { setNotice('error', friendlyError(err)); }
  });
  document.querySelectorAll('[data-member-remove]').forEach((button) => button.onclick = async () => {
    if (!confirm('Zugang entziehen? Der Benutzer verliert die Kalender-Berechtigung.')) return;
    try { await S.store.removeMember(button.dataset.memberRemove); await renderAdmin(); setNotice('ok', 'Zugang wurde entzogen.'); }
    catch (err) { setNotice('error', friendlyError(err)); }
  });
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
    else if (route.name === 'admin') await renderAdmin();
    else renderNotFound();
  } catch (err) {
    app.innerHTML = `<p class="notice notice-error">Die Daten konnten nicht geladen werden: ${esc(friendlyError(err))}</p>`;
  }
  renderNotice();
  document.title = (route.name === 'room' ? route.res.name + ' · ' : route.name === 'plan' ? 'Belegungsplan · ' : route.name === 'admin' ? 'Administration · ' : '') + S.seed.settings.vereins_name;
}

async function boot() {
  try {
    S.seed = await loadSeed();
    S.store = await createStore(S.seed);
    await S.store.init();
    if (S.store.mode === 'supabase') {
      S.resources = await S.store.getResources();
      S.allResources = S.resources;
      S.categories = await S.store.getCategories();
    } else {
      S.resources = S.store.resources;
      S.allResources = S.resources;
      S.categories = S.store.categories;
    }
    // Weiterleitung von 404.html (GitHub Pages) übernehmen
    const p = new URLSearchParams(location.search).get('p');
    if (p) history.replaceState(null, '', BASE + p);
    await render();
    if (S.store.authError) setNotice('error', S.store.authError);
    if (S.store.mode === 'supabase' && ['invite', 'recovery', 'signup'].includes(S.store.pendingAuthFlow) && S.store.session) {
      openPasswordDialog({ title: S.store.pendingAuthFlow === 'recovery' ? 'Neues Passwort festlegen' : 'Eigenes Passwort festlegen' });
    }
  } catch (err) {
    app.innerHTML = `<p class="notice notice-error">Die Anwendung konnte nicht gestartet werden: ${esc(err.message || err)}</p>`;
  }
}

boot();
