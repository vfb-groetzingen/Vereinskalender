# Admin-, Protokoll- und Passwortfunktionen einrichten

Die Website ist statisch auf GitHub Pages. Für Einladungen und Rollenverwaltung ist deshalb zusätzlich eine geschützte Supabase Edge Function erforderlich.

## 1. Datenbankmigration

Im richtigen Supabase-Projekt den Inhalt von `supabase/migration-admin-audit.sql` im SQL Editor ausführen. Die Migration ergänzt:

- `resources.is_active` für Deaktivieren statt Datenverlust
- `resources.sort_order` für eine globale, dauerhaft gespeicherte Reihenfolge (Bestandsdaten erhalten eine stabile Anfangsreihenfolge)
- Admin-only-Leserechte für das append-only Termin-Audit-Log mit Akteur, Zeitpunkt, Aktion sowie Vorher-/Nachher-Daten
- eine sichere Admin-RPC zum endgültigen Löschen: nur wenn keine aktuellen oder zukünftigen Termine bestehen; vergangene Buchungen werden mitgelöscht, Audit-Einträge bleiben erhalten
- `resource_name`-Snapshots, damit Audit-Einträge auch nach Ressourcenlöschung lesbar bleiben

Das bestehende `supabase/schema.sql` enthält dieselben Änderungen für eine Neuinstallation.

## 2. Selbstregistrierung und E-Mail-Bestätigung

In Supabase **Authentication → Sign In / Providers → Email**:

- öffentliche Registrierung deaktivieren („Allow new users to sign up“ ausschalten)
- E-Mail-Bestätigung eingeschaltet lassen
- eine Mindestlänge von 10 Zeichen für Passwörter setzen

Die Website bietet keinen Registrierungsweg. Magic-Link-Anmeldungen senden `create_user: false`; Passwortanmeldung erzeugt ebenfalls keine Konten. Nur die Admin-Einladungsfunktion darf neue Benutzer anlegen.

## 3. Edge Function bereitstellen

Die Function liegt unter `supabase/functions/admin-users/index.ts`. Sie prüft serverseitig das Benutzer-JWT und die Admin-Rolle, bevor sie Benutzer einlädt, Rollen ändert oder den Kalenderzugang entzieht. Sie verhindert auch, dass der letzte Admin entfernt oder herabgestuft wird.

Mit der Supabase CLI aus dem Projektverzeichnis:

```sh
supabase functions deploy admin-users
supabase secrets set SITE_URL=https://vfb-groetzingen.github.io/Vereinskalender/ ALLOWED_ORIGIN=https://vfb-groetzingen.github.io
```

Die Projektumgebung stellt normalerweise `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` bereit. Falls ein Secret manuell gesetzt werden muss, ausschließlich in **Supabase → Edge Functions → Secrets** eintragen. Den `service_role`-Schlüssel niemals in `assets/js/config.js`, Browsercode, GitHub oder Chat einfügen.

## 4. Redirects und Mailvorlagen

In Supabase **Authentication → URL Configuration** müssen die Site URL und Redirect-URLs zur GitHub-Pages-Projektseite passen:

- `https://vfb-groetzingen.github.io/Vereinskalender/`
- `https://vfb-groetzingen.github.io/Vereinskalender/**`

Für Einladungs- und Passwort-Wiederherstellungs-E-Mails muss die Supabase-Bestätigungs-URL verwendet werden; die Website fängt Einladungs- und Recovery-Links ab und zeigt anschließend das Formular zum Festlegen des Passworts. SMTP muss für diese Nachrichten funktionieren.

## 5. Tests nach dem Deployment

- Als Admin anmelden: Administration erscheint; Bearbeiter und Besucher erhalten keinen Zugriff auf `/admin`.
- Raum/Platz anlegen, umbenennen, Farbe/Reihenfolge ändern, deaktivieren und aktivieren.
- Endgültiges Löschen ohne Zukunftstermine testen: vergangene Buchungen werden gelöscht, Audit-Protokoll bleibt. Mit einem Zukunftstermin muss das Löschen blockiert werden.
- Benutzer einladen, Bestätigungslink öffnen, Passwort festlegen; Passwort- und Magic-Link-Login testen.
- Passwort vergessen, Recovery-Link öffnen und neues Passwort setzen.
- Als Bearbeiter und als Admin Termine anlegen, ändern und löschen; im Admin-Protokoll müssen Akteur, Zeit, Aktion und Vorher-/Nachher-Daten stehen.
- Spielplan aus CSV und XLSX importieren. Es werden nur `Start Date`, `Start Time`, `Subject` verarbeitet; Ziel ist der geöffnete Raum/Platz, Dauer 90 Minuten. Vor dem Speichern müssen Konflikte und Dubletten angezeigt werden.
