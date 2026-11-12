// Datenschicht. Zwei Implementierungen mit identischer Schnittstelle:
// - DemoStore: Beispieldaten im Browser (localStorage). Keine echte Sicherheit!
// - SupabaseStore: spricht die Supabase-REST-API an. Die Rechte prüft ausschließlich die Datenbank (RLS).
import { CONFIG } from './config.js';
import { addDays, weekStart } from './logic.js';

export const ROOT = new URL(CONFIG.BASE_PATH, location.origin);

export async function loadSeed() {
  const res = await fetch(new URL('data/seed.json', ROOT));
  if (!res.ok) throw new Error('Stammdaten konnten nicht geladen werden.');
  return res.json();
}

// Fehler in einheitlicher Form: { code, message }
export function friendlyError(err) {
  const code = err?.code;
  if (code === '23P01') return 'Die alte Überschneidungssperre ist noch aktiv. Bitte supabase/migration-allow-booking-overlaps.sql im Supabase SQL Editor ausführen.';
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

function expandResourceBookings(rows) {
  return rows.flatMap((booking) => {
    const ids = Array.isArray(booking.resource_ids) && booking.resource_ids.length
      ? booking.resource_ids : [booking.resource_id];
    return [...new Set(ids)].map((resource_id) => ({ ...booking, resource_id }));
  });
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
  isAdmin() { return this.role === 'admin'; }
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
    return expandResourceBookings(this.bookings
      .filter((b) => new Date(b.ends_at) > from && new Date(b.starts_at) < to))
      .map((b) => { const copy = { ...b }; if (!this.isEditor()) delete copy.notes; return copy; })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  async getAllBookings(resourceId = null) {
    return expandResourceBookings(this.bookings)
      .filter((b) => !resourceId || b.resource_id === resourceId)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((b) => { const c = { ...b }; if (!this.isEditor()) delete c.notes; return c; });
  }
  async getSeriesBookings(seriesId) {
    this.requireEditor();
    return this.bookings
      .filter((b) => b.series_id === seriesId)
      .slice()
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  async getAllFuture(fromDate, limit = 300, resourceId = null) {
    return expandResourceBookings(this.bookings)
      .filter((b) => new Date(b.ends_at) >= fromDate && (!resourceId || b.resource_id === resourceId))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, limit)
      .map((b) => { const c = { ...b }; if (!this.isEditor()) delete c.notes; return c; });
  }
  async createBookings(rows) {
    this.requireEditor();
    const inserted = rows.map((r) => ({ id: uid(), series_id: null, ...r, resource_ids: r.resource_ids?.length ? [...r.resource_ids] : [r.resource_id] }));
    this.bookings.push(...inserted);
    this.persist();
    return inserted;
  }
  async updateBooking(id, patch) {
    this.requireEditor();
    const b = this.bookings.find((x) => x.id === id);
    if (!b) throw { code: 'P0002', message: 'Termin nicht gefunden.' };
    Object.assign(b, patch);
    if (patch.resource_ids) b.resource_ids = [...patch.resource_ids];
    else if (patch.resource_id) b.resource_ids = [patch.resource_id];
    this.persist();
  }
  async deleteBookings(ids) {
    this.requireEditor();
    this.bookings = this.bookings.filter((b) => !ids.includes(b.id));
    this.persist();
  }
  async deleteSeries(seriesId) {
    this.requireEditor();
    this.bookings = this.bookings.filter((b) => b.series_id !== seriesId);
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
    this.pendingAuthFlow = null;
    this.authError = null;
  }
  isEditor() { return this.role === 'bearbeiter' || this.role === 'admin'; }
  isAdmin() { return this.role === 'admin'; }
  redirectUrl() { return new URL(CONFIG.BASE_PATH, location.origin).href; }

  async _req(path, { method = 'GET', body, prefer, token } = {}) {
    const headers = { apikey: this.key };
	const bearer = token === this.key ? null : (token || this.session?.access_token);
	if (bearer) headers.Authorization = `Bearer ${bearer}`;
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

  // Übernimmt Supabase-Session und erkennt Einladungs-/Wiederherstellungslinks.
  async init() {
    const hash = new URLSearchParams(location.hash.slice(1));
    this.pendingAuthFlow = hash.get('type');
    if (hash.get('error_description')) this.authError = hash.get('error_description').replace(/\+/g, ' ');
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
    // Magic Link nur für bestehende/eingeladene Konten; Selbstregistrierung bleibt aus.
    await this._req(`/auth/v1/otp?redirect_to=${encodeURIComponent(this.redirectUrl())}`, {
      method: 'POST', body: { email, create_user: false }, token: this.key
    });
  }

  async signInWithPassword({ email, password }) {
    const data = await this._req('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password }, token: this.key
    });
    this._storeSession(data);
    await this.init();
  }

  async requestPasswordReset(email) {
    await this._req(`/auth/v1/recover?redirect_to=${encodeURIComponent(this.redirectUrl())}`, {
      method: 'POST', body: { email }, token: this.key
    });
  }

  async updatePassword(password) {
    await this._req('/auth/v1/user', { method: 'PUT', body: { password } });
    this.pendingAuthFlow = null;
  }

  async adminRequest(payload) {
    if (!this.session?.access_token) throw { status: 401, message: 'Bitte erneut anmelden.' };
    const res = await fetch(`${this.url}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { apikey: this.key, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw { status: res.status, code: data?.code, message: data?.error || data?.message || res.statusText };
    return data;
  }

  async listMembers() { return this.adminRequest({ action: 'list' }); }
  async inviteMember(email, role) { return this.adminRequest({ action: 'invite', email, role }); }
  async setMemberRole(userId, role) { return this.adminRequest({ action: 'set_role', userId, role }); }
  async removeMember(userId) { return this.adminRequest({ action: 'remove', userId }); }

  async signOut() {
    this.session = null;
    this.role = null;
    localStorage.removeItem(this.sessionKey);
  }

  async getResources() { return this._req('/rest/v1/resources?select=*&is_active=eq.true&order=sort_order.asc,name.asc'); }
  async getAllResources() { return this._req('/rest/v1/resources?select=*&order=sort_order.asc,name.asc'); }
  async getCategories() { return this._req('/rest/v1/categories?select=*&order=name'); }
  async createResource(resource) { return this._req('/rest/v1/resources', { method: 'POST', body: resource, prefer: 'return=representation' }); }
  async updateResource(id, patch) { return this._req(`/rest/v1/resources?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }); }
  async deleteResource(id) { return this._req('/rest/v1/rpc/admin_delete_resource', { method: 'POST', body: { p_resource_id: id }, prefer: 'return=minimal' }); }
  async getAuditLog() { return this._req('/rest/v1/booking_audit_log?select=*&order=occurred_at.desc&limit=200'); }

  async getBookings({ from, to }) {
    const table = this.isEditor() ? 'bookings' : 'public_bookings';
    const sel = this.isEditor() ? '*' : 'id,resource_id,category_id,title,starts_at,ends_at,series_id';
    const rows = await this._req(`/rest/v1/${table}?select=${sel}&starts_at=lt.${encodeURIComponent(to.toISOString())}&ends_at=gt.${encodeURIComponent(from.toISOString())}&order=starts_at`);
    return this.isEditor() ? expandResourceBookings(rows) : rows;
  }

  async getAllBookings(resourceId = null) {
    const table = this.isEditor() ? 'bookings' : 'public_bookings';
    const sel = this.isEditor() ? '*' : 'id,resource_id,category_id,title,starts_at,ends_at,series_id';
    const filter = !this.isEditor() && resourceId ? `&resource_id=eq.${encodeURIComponent(resourceId)}` : '';
    const all = [];
    const pageSize = 500;
    let offset = 0;
    while (true) {
      const page = await this._req(`/rest/v1/${table}?select=${sel}${filter}&order=starts_at.asc,id.asc&limit=${pageSize}&offset=${offset}`);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += page.length;
    }
    const expanded = this.isEditor() ? expandResourceBookings(all) : all;
    return resourceId ? expanded.filter((b) => b.resource_id === resourceId) : expanded;
  }
  async getSeriesBookings(seriesId) {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    return this._req(`/rest/v1/bookings?select=*&series_id=eq.${encodeURIComponent(seriesId)}&order=starts_at.asc,id.asc&limit=1000`);
  }

  async getAllFuture(fromDate, limit = 300, resourceId = null) {
    const table = this.isEditor() ? 'bookings' : 'public_bookings';
    const sel = this.isEditor() ? '*' : 'id,resource_id,category_id,title,starts_at,ends_at,series_id';
    const res = !this.isEditor() && resourceId ? `&resource_id=eq.${encodeURIComponent(resourceId)}` : '';
    const rows = await this._req(`/rest/v1/${table}?select=${sel}&ends_at=gte.${encodeURIComponent(fromDate.toISOString())}${res}&order=starts_at&limit=${limit}`);
    const expanded = this.isEditor() ? expandResourceBookings(rows) : rows;
    return resourceId ? expanded.filter((b) => b.resource_id === resourceId) : expanded;
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
  async deleteSeries(seriesId) {
    return this._req(`/rest/v1/bookings?series_id=eq.${encodeURIComponent(seriesId)}`, { method: 'DELETE', prefer: 'return=minimal' });
  }

  async getAnnualEvents() {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    return this._req('/rest/v1/annual_email_events?select=*&order=event_month.asc,event_day.asc,title.asc');
  }
  async saveAnnualEvent(event) {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    return this._req('/rest/v1/annual_email_events?on_conflict=id', {
      method: 'POST', body: event, prefer: 'resolution=merge-duplicates,return=representation'
    });
  }
  async deleteAnnualEvent(id) {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    return this._req(`/rest/v1/annual_email_events?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
  }
  async getAnnualDeliveryLog(id) {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    const [annual, tests] = await Promise.all([
      this._req(`/rest/v1/annual_email_deliveries?select=event_title,recurrence,event_date,occurrence_year,recipient,status,sent_at,error,updated_at&event_id=eq.${encodeURIComponent(id)}&order=updated_at.desc&limit=50`),
      this._req(`/rest/v1/annual_email_test_requests?select=event_title,recurrence,event_date,event_month,event_day,recipient,status,requested_at,processed_at,error,updated_at&event_id=eq.${encodeURIComponent(id)}&order=requested_at.desc&limit=50`)
    ]);
    return [
      ...annual.map((row) => ({ ...row, kind: 'annual', log_time: row.sent_at || row.updated_at })),
      ...tests.map((row) => ({ ...row, kind: 'test', log_time: row.processed_at || row.updated_at || row.requested_at }))
    ].sort((a, b) => new Date(b.log_time) - new Date(a.log_time)).slice(0, 50);
  }
  async createAnnualTestRequest(event, recipient) {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    return this._req('/rest/v1/annual_email_test_requests', {
      method: 'POST', body: {
        event_id: event.id, event_title: event.title, recurrence: event.recurrence || 'annual',
        event_date: event.event_date || null, event_month: event.event_month, event_day: event.event_day, recipient
      }, prefer: 'return=representation'
    });
  }
  async getAnnualTestRequest(id) {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    const rows = await this._req(`/rest/v1/annual_email_test_requests?select=id,status,error,processed_at,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] || null;
  }
  async getAnnualEmailErrors() {
    if (!this.isEditor()) throw { code: '42501', message: 'Keine Berechtigung.' };
    const [annual, tests] = await Promise.all([
      this._req('/rest/v1/annual_email_deliveries?select=event_id,event_title,recurrence,event_date,occurrence_year,recipient,status,error,updated_at&status=eq.failed&order=updated_at.desc&limit=50'),
      this._req('/rest/v1/annual_email_test_requests?select=event_id,event_title,recurrence,event_date,event_month,event_day,recipient,status,error,updated_at&status=eq.failed&order=updated_at.desc&limit=50')
    ]);
    return [
      ...annual.map((row) => ({ ...row, kind: 'annual' })),
      ...tests.map((row) => ({ ...row, kind: 'test' }))
    ].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 50);
  }
  async uploadAnnualAsset(eventId, file) {
    if (!this.isEditor() || !this.session?.access_token) throw { code: '42501', message: 'Bitte anmelden.' };
    const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || 'datei';
    const path = `${eventId}/${crypto.randomUUID()}-${safeName}`;
    const res = await fetch(`${this.url}/storage/v1/object/annual-event-files/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { apikey: this.key, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
      body: file
    });
    const text = await res.text();
    if (!res.ok) {
      let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
      throw { status: res.status, message: data?.message || data?.error || 'Datei konnte nicht hochgeladen werden.' };
    }
    return path;
  }
  async deleteAnnualAsset(path) {
    if (!this.isEditor() || !this.session?.access_token) throw { code: '42501', message: 'Bitte anmelden.' };
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${this.url}/storage/v1/object/annual-event-files/${encoded}`, {
      method: 'DELETE', headers: { apikey: this.key, Authorization: `Bearer ${this.session.access_token}` }
    });
    if (!res.ok) throw { status: res.status, message: 'Datei konnte nicht entfernt werden.' };
  }
}

export async function createStore(seed) {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) return new SupabaseStore();
  return new DemoStore(seed);
}
