// Zentrale Konfiguration. Hier stehen NUR öffentliche Werte.
// Den geheimen Schlüssel (service_role) niemals in dieses Repository eintragen.
export const CONFIG = {
  // Pfad der Webseite. Bei GitHub-Pages-Projektseite: '/REPO-NAME/' (z. B. '/vereinskalender/')
  BASE_PATH: '/vereinskalender/',
  // Supabase-Projekt. Leer lassen = Demo-Modus mit Beispieldaten im Browser.
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  TIMEZONE: 'Europe/Berlin',
  DAY_START: 7,   // erste Stunde im Kalender
  DAY_END: 23     // letzte Stunde im Kalender
};
