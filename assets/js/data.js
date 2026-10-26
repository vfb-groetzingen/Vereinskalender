// Datenschicht. Zwei Implementierungen mit identischer Schnittstelle:
// - DemoStore: Beispieldaten im Browser (localStorage). Keine echte Sicherheit!
// - SupabaseStore: spricht die Supabase-REST-API an. Die Rechte prüft ausschließlich die Datenbank (RLS).
import { CONFIG } from './config.js';
import { findConflicts, addDays, weekStart } from './logic.js';

export const ROOT = new URL(CONFIG.BASE_PATH, location.origin);

export async function loadSeed() {
  const res = await fetch(new URL('data/seed.json', ROOT));
  if (!res.ok) throw new Error('Stammdaten konnten nicht geladen werden.');
  return res.json();
}

// Fehler in einheitlicher Form: { code, message }
export function friendlyError(err) {
  const code = err?.code;
  if (code === '23P01') return 'Doppelbelegung: Der Platz ist in diesem Zeitraum bereits belegt.';
  if (code === '42501' || err?.status === 401 || err?.status === 403) return 'Keine Berechtigung für diese Aktion. Bitte mit einem berechtigten Konto anmelden.';
  if (code === '23514') return 'Die Eingabe ist ungültig (z. B. Endzeit liegt vor der Startzeit).';
  return err?.message || 'Unbekannter Fehler.';
}

// ---------- Demo-Speicher ----------
const DEMO_KEY = 'vk-demo-bookings-v1';
const DEMO_SESSION = 'vk-demo-session-v1';

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}

function demoSeedBookings(seed) {
  const res = Object.fromEntries(seed.resources.map((r) => [r.slug, 'res-' + r.slug]));
  const catId = (name) => 'cat-' + name.toLowerCase();
  const out = [];
  const start = weekStart(new Date());
  const add = (dayOffset, slug, from, to, title, category, notes = null) => {
    const day = addDays(start, dayOffset);
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    out.push({
      id: uid(),
      resource_id: res[slug],
      category_id: catId(category),
      title,
      starts_at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), fh, fm).toISOString(),
      ends_at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), th, tm).toISOString(),
      notes,
      series_id: null
    });
  };
  for (let w = -1; w <= 3; w++) {
    const o = w * 7;
    add(o + 0, 'jugendraum', '17:00', '19:00', 'Jugendtreff', 'Veranstaltung');
    add(o + 0, 'trainingsplatz-a', '17:30', '19:00', 'A-Junioren Training', 'Training');
    add(o + 1, 'kunstrasenplatz', '19:00', '20:30', 'Senioren Training', 'Training');
    add(o + 1, 'trainingsplatz-b', '17:30', '19:00', 'E-Junioren Training', 'Training');
    add(o + 2, 'trainingsplatz-a', '17:30', '19:00', 'D-Junioren Training', 'Training');
    add(o + 2, 'trainingsplatz-b', '19:00', '20:00', 'Bambini Training', 'Training');
    add(o + 3, 'kunstrasenplatz', '19:00', '21:00', 'Spielbetrieb Vorbereitung', 'Training');
    add(o + 3, 'besprechungszimmer', '19:30', '21:00', 'Vorstandssitzung', 'Sitzung', 'Tagesordnung im Vereinsordner');
    add(o + 4, 'jugendraum', '18:00', '20:00', 'Jugendausschuss', 'Sitzung');
    add(o + 5, 'platz-1-hauptplatz', '14:30', '16:00', 'C-Junioren Ligaspiel', 'Spiel');
    add(o + 6, 'platz-1-hauptplatz', '10:00', '12:00', 'B-Junioren Ligaspiel', 'Spiel');
    add(o + 6, 'parkplatz', '08:00', '15:00', 'Flohmarkt', 'Veranstaltung', 'Aufbau ab 7:00 Uhr');
  }
  // Vermietung als Beispiel für eine Fremdnutzung
  add(9, 'besprechungszimmer', '09:00', '13:00', 'Vermietung Familienfeier', 'Vermietung', 'Ansprechpartner: Vorstand');
  return out;
}

export class DemoStore {
  constructor(seed) {
    this.mode = 'demo';
    this.seed = seed;
    this.resources = seed.resources.map((r) => ({ ...r, id: 'res-' + r.slug }));
    this.categories = seed.categories.map((c) => ({ ...c, id: 'cat-' + c.name.toLowerCase() }));
    const saved = localStorage.getItem(DEMO_KEY);
    this.bookings = saved ? JSON.parse(saved) : demoSeedBookings(seed);
    this.session = JSON.parse(localStorage.getItem(DEMO_SESSION) || 'null');
  }
  persist() { localStorage.setItem(DEMO_KEY, JSON.stringify(this.bookings)); }
  get role() { return this.session?.role || null; }
  isEditor() { return this.role === 'bearbeiter' || this.role === 'admin'; }
  requireEditor() {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung' };
  }
  async init() { return this.session; }
  async signIn({ role, email }) {
    this.session = { role, email: email || 'demo@verein.example' };
    localStorage.setItem(DEMO_SESSION, JSON.stringify(this.session));
  }
  async signOut() {
    this.session = null;
    localStorage.removeItem(DEMO_SESSION);
  }
  async getBookings({ from, to }) {
    return this.bookings
      .filter((b) => new Date(b.ends_at) > from && new Date(b.starts_at) < to)
      .map((b) => {
        const copy = { ...b };
        if (!this.isEditor()) delete copy.notes; // gleiche Regel wie in der Datenbank
        return copy;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  async getAllFuture(fromDate, limit = 300, resourceId = null) {
    return this.bookings
      .filter((b) => new Date(b.ends_at) >= fromDate && (!resourceId || b.resource_id === resourceId))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, limit)
      .map((b) => { const c = { ...b }; if (!this.isEditor()) delete c.notes; return c; });
  }
  async createBookings(rows) {
    this.requireEditor();
    for (const r of rows) {
      const clash = findConflicts(this.bookings, r);
      if (clash.length) throw { code: '23P01', message: 'Doppelbelegung' };
    }
    const inserted = rows.map((r) => ({ id: uid(), series_id: null, ...r }));
    // Auch innerhalb der neuen Zeilen prüfen
    for (let i = 0; i < inserted.length; i++) {
      if (findConflicts(inserted.slice(0, i), inserted[i]).length) throw { code: '23P01', message: 'Doppelbelegung' };
    }
    this.bookings.push(...inserted);
    this.persist();
    return inserted;
  }
  async updateBooking(id, patch) {
    this.requireEditor();
    const b = this.bookings.find((x) => x.id === id);
    if (!b) throw { code: 'P0002', message: 'Termin nicht gefunden.' };
    const next = { ...b, ...patch };
    if (findConflicts(this.bookings, next, id).length) throw { code: '23P01', message: 'Doppelbelegung' };
    Object.assign(b, patch);
    this.persist();
  }
  async deleteBookings(ids) {
    this.requireEditor();
    this.bookings = this.bookings.filter((b) => !ids.includes(b.id));
    this.persist();
  }
}

// ---------- Supabase-Speicher ----------
export class SupabaseStore {
  constructor() {
    this.mode = 'supabase';
    this.url = CONFIG.SUPABASE_URL.replace(/\/$/, '');
    this.key = CONFIG.SUPABASE_ANON_KEY;
    this.sessionKey = 'vk-supabase-session';
    this.session = JSON.parse(localStorage.getItem(this.sessionKey) || 'null');
    this.role = null;
  }
  isEditor() { return this.role === 'bearbeiter' || this.role === 'admin'; }

  async _req(path, { method = 'GET', body, prefer, token } = {}) {
    const headers = { apikey: this.key, Authorization: 'Bearer ' + (token || this.session?.access_token || this.key) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(this.url + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (res.status === 401 && this.session?.refresh_token && !token) {
      await this._refresh();
      return this._req(path, { method, body, prefer });
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw { status: res.status, code: data?.code, message: data?.message || res.statusText };
    return data;
  }

  async _refresh() {
    try {
      const data = await this._req('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: this.session.refresh_token }, token: this.key
      });
      this._storeSession(data);
    } catch { this.session = null; localStorage.removeItem(this.sessionKey); }
  }

  _storeSession(data) {
    this.session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
    localStorage.setItem(this.sessionKey, JSON.stringify(this.session));
  }

  // Login-Link aus der URL-Adresse übernehmen (nach Klick auf den E-Mail-Link)
  async init() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get('access_token')) {
      this._storeSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: Number(hash.get('expires_in') || 3600) });
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (this.session) {
      const uidClaim = JSON.parse(atob(this.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.sub;
      this.userId = uidClaim;
      try {
        const rows = await this._req(`/rest/v1/memberships?select=role&user_id=eq.${uidClaim}`);
        this.role = rows?.[0]?.role || null;
      } catch { this.role = null; }
    }
    return this.session;
  }

  async signIn({ email }) {
    // Versendet einen Anmelde-Link. Benutzer müssen vorher eingeladen oder angelegt sein.
    await this._req('/auth/v1/otp', { method: 'POST', body: { email, create_user: false }, token: this.key });
  }

  async signOut() {
    this.session = null;
    this.role = null;
    localStorage.removeItem(this.sessionKey);
  }

  async getResources() { return this._req('/rest/v1/resources?select=*&order=sort_order'); }
  async getCategories() { return this._req('/rest/v1/categories?select=*&order=name'); }

  async getBookings({ from, to }) {
    const table = this.isEditor() ? 'bookings' : 'public_bookings';
    const sel = this.isEditor() ? '*' : 'id,resource_id,category_id,title,starts_at,ends_at,series_id';
    return this._req(`/rest/v1/${table}?select=${sel}&starts_at=lt.${encodeURIComponent(to.toISOString())}&ends_at=gt.${encodeURIComponent(from.toISOString())}&order=starts_at`);
  }

  async getAllFuture(fromDate, limit = 300, resourceId = null) {
    const table = this.isEditor() ? 'bookings' : 'public_bookings';
    const sel = this.isEditor() ? '*' : 'id,resource_id,category_id,title,starts_at,ends_at,series_id';
    const res = resourceId ? `&resource_id=eq.${encodeURIComponent(resourceId)}` : '';
    return this._req(`/rest/v1/${table}?select=${sel}&ends_at=gte.${encodeURIComponent(fromDate.toISOString())}${res}&order=starts_at&limit=${limit}`);
  }

  async createBookings(rows) {
    return this._req('/rest/v1/bookings', { method: 'POST', body: rows, prefer: 'return=representation' });
  }
  async updateBooking(id, patch) {
    return this._req(`/rest/v1/bookings?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  }
  async deleteBookings(ids) {
    return this._req(`/rest/v1/bookings?id=in.(${ids.join(',')})`, { method: 'DELETE', prefer: 'return=minimal' });
  }
}

export async function createStore(seed) {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) return new SupabaseStore();
  return new DemoStore(seed);
}
