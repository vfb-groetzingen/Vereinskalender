import { CONFIG } from './config.js';

const page = document.documentElement.dataset.publicPage;
const target = document.querySelector('[data-public-content]');
if (target && page && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
  fetch(`${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/public_site_content?select=${page}_text&singleton=eq.true&limit=1`, {
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY }
  }).then((response) => {
    if (!response.ok) throw new Error('Öffentliche Inhalte nicht verfügbar');
    return response.json();
  }).then((rows) => {
    const value = rows?.[0]?.[`${page}_text`];
    if (typeof value === 'string' && value.trim()) target.textContent = value;
  }).catch(() => {});
}
