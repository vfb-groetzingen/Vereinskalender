# Einrichtung: Vereinskalender (Schritt für Schritt)

Diese Anleitung richtet die Webseite vollständig ein: Datenbank, Anmeldung, Administration, Buchungs-/Ereignis-E-Mails, Kalenderfeeds, Veröffentlichung, Sicherung und Keepalive. Sie benötigt etwa 1 bis 2 Stunden. Die Schritte bauen aufeinander auf.

Vorhandene Konten: GitHub, Supabase und das Strato-Postfach `vfb-app@vfb-groetzingen.de`.

---

## Schritt 1: Supabase-Projekt anlegen

1. Im Supabase-Dashboard auf **New project** klicken.
2. **Region: Central EU (Frankfurt)** wählen. Die Region kann später nicht einfach geändert werden.
3. Ein starkes Datenbankpasswort vergeben und **sicher aufbewahren** (Passwortmanager).
4. Warten, bis das Projekt bereit ist.

> Hinweis: Der Free-Tarif erlaubt zwei aktive Projekte. Ein bereits vorhandenes Projekt zählt mit.

## Schritt 2: Datenbank einrichten

1. Im Dashboard **SQL Editor** öffnen, **New query**.
2. Den Inhalt von `supabase/schema.sql` einfügen und **Run** ausführen.
3. Die Datei `supabase/migration-booking-retention-3-years.sql` im SQL Editor ausführen. Sie aktiviert Cron und plant die tägliche Löschung von Terminen ein, deren Start mehr als drei Jahre zurückliegt. Falls die Erweiterung `pg_cron` nicht verfügbar ist, zuerst im Supabase-Dashboard unter **Integrations > Cron** aktivieren und die Migration erneut ausführen.
4. Die Datei `supabase/migration-multi-resource-annual-events.sql` im SQL Editor ausführen. Sie aktiviert Mehrfachzuordnungen von Ressourcen, den Ereigniskalender, private Dateiablage und Versandprotokoll.
5. Danach `supabase/migration-annual-email-test-requests.sql` im SQL Editor ausführen. Sie richtet die geschützte Warteschlange für Testmails ein.
6. Danach `supabase/migration-annual-email-log-context.sql` ausführen. Damit speichert das Protokoll Ereignisname und betroffenes Datum direkt am Versandversuch.
7. Danach `supabase/migration-event-recurrence-retention-3-years.sql` ausführen. Sie ergänzt einmalige Ereignisse und richtet die automatische Bereinigung nach drei Jahren ein. Die Jahresregel bleibt bestehen; nur alte Durchläufe und Protokolle werden entfernt.
8. `supabase/migration-admin-configuration-communications.sql` ausführen. Sie ergänzt Admin-Konfiguration, Buchungskontakt und Erinnerungen, Dokumentablage, Auditlog, Mail-Outbox und die dafür nötigen RLS-Regeln.
9. Danach `supabase/migration-admin-config-audit-fix.sql` ausführen. Diese Korrektur behebt den allgemeinen Audit-Trigger und richtet das atomare Speichern einzelner Mailvorlagen ein. **Bestandsinstallationen müssen diese Migration nach der Kommunikationsmigration im SQL Editor ausführen**, damit der Fehler `record "new" has no field "title"` behoben wird. Sie kann auch bei Neuinstallationen ausgeführt werden.
10. Danach `supabase/migration-booking-email-controls.sql` ausführen. Sie unterdrückt Buchungs-E-Mails und Erinnerungen für die Kategorie „Veranstaltung“, aktiviert die steuerbare Vorlagenoption, entfernt nicht mehr zulässige ausstehende Nachrichten und ergänzt den Status `skipped`. Bestandsinstallationen müssen diese Migration ausführen; sie erhält nicht gesetzte Vorlagenoptionen als aktiviert.
11. Danach `supabase/migration-event-email-controls.sql` ausführen. Sie ergänzt die je Ereignis getrennten Versandregeln (alle standardmäßig aus), Erinnerungsfrist 1/2/7 Tage sowie eine gegen Ereignislöschungen beständige Lifecycle-Outbox mit Berechtigungen, Claim-Funktion und dreijähriger Aufbewahrung. Die Ereignisschalter sind unabhängig von den globalen Buchungsvorlagen.
12. Danach `supabase/migration-event-individual-messages.sql` ausführen. Sie erlaubt den ausdrücklich ausgelösten einmaligen Versand an alle gespeicherten Empfänger (eine separate Mail pro Adresse) über die bestehende Outbox. Das Ereignis muss aktiv sein; Betreff und Nachricht werden aus dem zuletzt gespeicherten Stand verwendet.
13. Anschließend `supabase/migration-continuous-booking-series.sql` ausführen. Sie legt die Regeln für fortlaufende Terminserien an, erzeugt konkrete Termine für die nächsten sechs Monate und plant deren tägliche Ergänzung über `pg_cron`. Falls die Erweiterung nicht verfügbar ist, sie im Supabase-Dashboard unter **Integrations > Cron** aktivieren und die Migration danach erneut ausführen. Wenn zuvor der ältere Wochenserien-Patch angewendet wurde, rüstet diese Migration dessen Tabelle auf und übernimmt die gespeicherten wöchentlichen bzw. zweiwöchentlichen Serien.
14. Danach den Inhalt von `supabase/seed.sql` einfügen und ausführen.
15. Unter **Table Editor** prüfen: Die Tabellen `resources`, `categories`, `bookings`, `memberships`, `annual_email_events`, `annual_email_test_requests`, `annual_event_mail_outbox`, `site_configuration`, `public_site_content`, `event_documents`, `booking_email_outbox`, `booking_series` und `booking_series_skips` sind vorhanden; unter **Integrations > Cron** auch den Job `vk-extend-booking-series` sowie die bestehenden Aufbewahrungsjobs einschließlich `vereinskalender-event-mail-outbox-retention-3-years` prüfen.

## Schritt 3: Anmeldung konfigurieren

1. **Authentication > Sign In / Providers > Email**: E-Mail-Anmeldung aktiviert lassen. Die Option **Allow new users to sign up** deaktivieren. Damit können sich nur eingeladene Personen anmelden.
2. **Authentication > URL Configuration**:
   - **Site URL**: `https://DEIN-GITHUB-NAME.github.io/Vereinskalender/`
   - **Redirect URLs**: dieselbe Adresse eintragen.
3. **Authentication > Emails > SMTP Settings**: **Enable Custom SMTP** ist für den Anmeldelink-Versand eingeschaltet. Laut derzeitiger Konfiguration:
   - Host: `smtp.strato.de`, Port: `465`
   - Benutzername/Absender: `vfb-app@vfb-groetzingen.de`
   - Passwort: das Kennwort des Strato-Postfachs (niemals in GitHub committen oder im Chat teilen)
   Hinweis: Die Oberfläche von Supabase ändert sich gelegentlich. Falls der Menüpunkt anders heißt, im Dashboard nach „SMTP“ suchen. Diese Supabase-Auth-SMTP-Einstellung ist getrennt von den GitHub-Actions-Secrets, die Buchungs- und Ereignis-E-Mails versenden.
4. Für Passwort-Wiederherstellung und Anmeldelinks muss die exakte Redirect-Adresse einschließlich Groß-/Kleinschreibung und abschließendem Schrägstrich in **Authentication > URL Configuration > Redirect URLs** zugelassen sein. Die App verwendet `CONFIG.BASE_PATH`; aktuell ergibt das `https://DEIN-GITHUB-NAME.github.io/Vereinskalender/`. Die neutrale Meldung nach „Passwort vergessen?“ bestätigt nicht, dass eine E-Mail tatsächlich zugestellt wurde. Bei fehlender Mail die **Auth-Logs** und den Supabase-SMTP-Fehler prüfen.
5. **Authentication > Emails > Magic Link** (Vorlage): Der Text sollte erklären, dass es sich um einen Anmeldelink für den Vereinskalender handelt.

## Schritt 4: Ersten Administrator anlegen

1. **Authentication > Users > Invite user**: E-Mail-Adresse der Person eintragen. Die Person erhält eine Einladung.
2. Im SQL Editor den Inhalt von `supabase/admin-setup.sql` öffnen. Die Zeile mit `HIER-E-MAIL-EINTRAGEN` durch die E-Mail-Adresse ersetzen und ausführen.
3. Weitere Bearbeiter auf dieselbe Weise anlegen (Einladung, dann SQL mit Rolle `bearbeiter`).

## Schritt 5: Zugangsdaten in die Webseite eintragen

Die Werte stehen unter **Project Settings > API**.

Datei `assets/js/config.js` anpassen:

- `BASE_PATH`: `'/Vereinskalender/'` (Name des GitHub-Repositorys, mit Schrägstrichen)
- `SUPABASE_URL`: die Project URL, z. B. `https://xyzxyz.supabase.co`
- `SUPABASE_ANON_KEY`: der Schlüssel mit der Bezeichnung **anon public**

> **Wichtig:** Niemals den Schlüssel **service_role** eintragen. Er umgeht alle Rechte und gehört nur in die Geheimnisse von GitHub (wird in diesem Projekt nicht benötigt).

Solange `SUPABASE_URL` leer ist, läuft die Seite im **Demo-Modus** mit Beispieldaten. Der Demo-Modus ist für Tests gedacht und bietet keinen echten Schutz.

Datei `data/seed.json` anpassen: Bei `settings.public_base_url` die eigene Adresse eintragen, z. B. `https://xyzxyz.github.io/Vereinskalender`. Die QR-Codes werden danach automatisch neu erzeugt (Schritt 6).

## Schritt 6: GitHub-Repository und Veröffentlichung

1. Auf GitHub ein **öffentliches** Repository mit dem Namen `Vereinskalender` anlegen.
   - Warum öffentlich: Der kostenlose Tarif von GitHub Pages erfordert ein öffentliches Repository. Es enthält keine Geheimnisse. Die Sicherheit liegt in der Datenbank.
2. Alle Dateien des Projekts hochladen (oder per Git übertragen). Dateien mit `.gitignore` werden ausgeschlossen.
3. **Settings > Pages**: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)**.
4. Nach ca. 1 bis 2 Minuten ist die Seite unter `https://DEIN-GITHUB-NAME.github.io/Vereinskalender/` erreichbar.
5. Den Ordner `.nojekyll` nicht löschen. Er ist für GitHub Pages notwendig.

Die Datei `404.html` leitet Direktaufrufe wie `/raeume/trainingsplatz-a` auf die Startseite um. Der Basispfad in `404.html` muss mit `BASE_PATH` übereinstimmen.

## Schritt 7: Geheimnisse für Automatisierung hinterlegen

**Settings > Secrets and variables > Actions > New repository secret**:

| Name | Inhalt |
|---|---|
| `SUPABASE_URL` | Project URL (wie in Schritt 5) |
| `SUPABASE_ANON_KEY` | Schlüssel anon public |
| `SUPABASE_DB_URL` | Verbindungs-URI für Datenbankzugriff (siehe unten) |
| `SUPABASE_SERVICE_ROLE_KEY` | Wert des Supabase-Secret-API-Keys (`sb_secret_…`); falls noch kein neuer Key existiert, Legacy-`service_role`-Key. Nur als GitHub Secret speichern. |
| `STRATO_SMTP_USER` | `vfb-app@vfb-groetzingen.de` |
| `STRATO_SMTP_PASSWORD` | Kennwort dieses Strato-Postfachs (nicht in Projektdateien oder Chat eintragen) |
| `BACKUP_PASSPHRASE` | Langes Zufallspasswort für verschlüsselte Sicherungen (mindestens 24 Zeichen) |

**Verbindungs-URI** (für `SUPABASE_DB_URL`): Im Dashboard auf **Connect** klicken. Die Variante **Session pooler** wählen (Port 5432). Das Datenbankpasswort aus Schritt 1 eintragen. Die direkte Verbindung funktioniert auf GitHub-Servern oft nicht, da sie IPv6 benötigt.

Das Passwort für `BACKUP_PASSPHRASE` ist notwendig, um Sicherungen zu entschlüsseln. **Ohne dieses Passwort sind die Sicherungen unbrauchbar.** Es muss an mindestens zwei Stellen gespeichert werden (z. B. im Vereins-Passwortmanager).

## Schritt 8: Supabase Edge Functions bereitstellen

Nach der Datenbankmigration die Supabase CLI für das Projekt anmelden und im Projektordner verknüpfen (`supabase login`, `supabase link --project-ref DEINE_PROJECT_REF`).

Zuerst die geschützte Admin-Funktion bereitstellen:

```sh
supabase functions deploy admin-users
```

Für `admin-users` **kein** `--no-verify-jwt` verwenden: Die Funktion erwartet ein gültiges Bearer-Token und prüft zusätzlich die Admin-Rolle. Sie benötigt die Supabase-Laufzeitwerte `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY`. Der Service-Role-Schlüssel darf nur als serverseitiges Supabase-Secret verwendet werden, niemals in Webseiten-Dateien oder im Git-Repository. Falls die Webseite unter einer anderen Adresse betrieben wird, die optionalen Edge-Function-Secrets `SITE_URL` und `ALLOWED_ORIGIN` an die eigene Website anpassen.

Danach den öffentlichen iCalendar-Feed bereitstellen. Er liest Buchungen nur aus `public_bookings`; Notizen, Kontakt-E-Mail-Adressen und andere interne Felder werden nicht ausgegeben:

```sh
supabase functions deploy calendar-feed --no-verify-jwt
```

`--no-verify-jwt` ist nur für den Kalenderfeed erforderlich, damit Kalenderprogramme ihn ohne Anmeldung abrufen können. Die Funktion verwendet den öffentlichen anon-Schlüssel und die Datenbankrechte der öffentlichen Views. Anschließend auf der öffentlichen Seite **Kalender abonnieren** den Link kopieren und mit einem Kalenderprogramm testen.

## Schritt 9: Automatisierung prüfen

Unter **Actions** die Workflows prüfen:

1. **QR-Codes aktualisieren**: Läuft automatisch nach Änderungen an `data/seed.json`. Manuell mit **Run workflow** starten. Ergebnis: Im Ordner `qr/` liegen die SVG-Dateien mit der richtigen Adresse.
2. **Supabase Keepalive**: Mit **Run workflow** starten. Erwartet: `Antwort HTTP 200`.
3. **Datenbank-Sicherung**: Mit **Run workflow** starten. Erwartet: Ein Artefakt `vereinskalender-backup-…` mit der Datei `backup.sql.gpg`.
4. **Jährliche Ereignis-E-Mails (Erinnerungen)**: Der Workflow prüft täglich ab 06:00 Uhr Europe/Berlin einmalige und jährliche Ereignisse. Er versendet nur, wenn das Ereignis aktiv und die Erinnerung eingeschaltet ist, genau 1, 2 oder 7 Tage vor dem Ereignisdatum.
5. **Buchungsnachrichten und Ereignis-Lifecycle-Mails**: Der Workflow läuft etwa alle fünf Minuten. Er verarbeitet Buchungsnachrichten und zusätzlich Ereignis-Bestätigungen, Änderungsmitteilungen und Absagen aus der separaten Outbox. Der Ereignis-Worker prüft den aktuellen Ereignisstatus und den jeweiligen Schalter vor dem Versand. Der authentifizierte Strato-Absender ist immer `vfb-app@vfb-groetzingen.de`; die konfigurierten Profile bestimmen Anzeigename und `Reply-To`.
6. **Testmails für Ereignisse**: Ein weiterer Workflow prüft etwa alle fünf Minuten die Testmail-Warteschlange. In der Ereignisbearbeitung kann eine Testadresse eingegeben werden; der Status erscheint im Versandprotokoll und im Fehlerbereich unten auf der Seite.
7. **Ereignisdaten nach drei Jahren bereinigen**: Ein täglicher Workflow löscht abgelaufene einmalige Ereignisse einschließlich ihrer Dateien über die Supabase-Storage-API. Jährliche Wiederholungsregeln bleiben bestehen; alte Durchläufe und Protokolle werden über Supabase Cron entfernt.

Geplante GitHub-Läufe können verzögert sein; bei öffentlichen Repositories können Zeitpläne nach längerer Inaktivität deaktiviert werden. Unter **Actions** regelmäßig prüfen, dass der Buchungsversand-, Jahresversand-, Testmail- und Bereinigungs-Workflow aktiv sind und erfolgreich laufen.

**Keepalive und Pausierung:** Der Free-Tarif von Supabase pausiert Projekte nach 7 Tagen ohne Aktivität. Der Keepalive verhindert das nach bisherigem Kenntnisstand, ist aber nicht zugesichert. Deshalb unbedingt prüfen, ob das Projekt nach 2 bis 3 Wochen noch läuft. Wenn nicht, auf Supabase Pro umstellen (ca. 25 US-Dollar im Monat).

**Hinweis GitHub:** Geplante Workflows werden in öffentlichen Repositories nach 60 Tagen ohne Aktivität automatisch deaktiviert. Ein Commit oder ein manueller Start reaktiviert sie.

## Schritt 10: Sicherung wiederherstellen (Probe durchführen)

Die Wiederherstellung sollte einmal auf einem Testprojekt geübt werden, bevor sie im Ernstfall nötig ist.

1. Artefakt aus dem Lauf der Datenbank-Sicherung herunterladen.
2. Entschlüsseln: `gpg --batch --passphrase "PASSPHRASE" -o backup.sql -d backup.sql.gpg`
3. Einspielen in ein Testprojekt mit `psql` (Verbindungs-URI wie oben) oder über den SQL Editor.

## Schritt 11: Rechtliche Seiten vervollständigen

Die Dateien `impressum.html` und `datenschutz.html` sind Vorlagen. Alle Angaben in eckigen Klammern müssen ergänzt werden. Für Supabase, GitHub und Strato müssen die jeweils erforderlichen Datenschutz- und Auftragsverarbeitungsvereinbarungen geprüft werden. Diese Verträge stellen die Anbieter bereit (Stand der Verfügbarkeit bitte prüfen).

## Schritt 12: Eigene Domain (optional)

Eine eigene Domain wird in den GitHub-Pages-Einstellungen unter **Custom domain** eingetragen. Danach die Site URL in Supabase (Schritt 3) und `public_base_url` in `data/seed.json` (Schritt 5) anpassen. Die QR-Codes werden danach automatisch neu erzeugt.

---

## Checkliste vor dem Start

- [ ] Schema und alle Migrationen in der dokumentierten Reihenfolge eingespielt
- [ ] Öffentliche Registrierung in Supabase deaktiviert
- [ ] Site URL und Redirect URL korrekt
- [ ] Strato-SMTP funktioniert (Testanmeldung über Supabase Auth)
- [ ] Administrator eingeladen und in `memberships` eingetragen
- [ ] `config.js` mit URL und anon-Schlüssel gefüllt
- [ ] `public_base_url` gesetzt, QR-Codes neu erzeugt
- [ ] GitHub Actions Secrets für Datenbank, Strato-Versand und Sicherung hinterlegt
- [ ] `calendar-feed` mit `--no-verify-jwt` bereitgestellt und öffentlichen iCalendar-Link getestet
- [ ] Buchungsnachrichten- und Ereignis-Lifecycle-Workflow manuell gestartet und Strato-Versand mit kontrollierter Adresse geprüft
- [ ] Ereignis-Mailtypen einzeln aktiviert/deaktiviert, Masterfreigabe, bearbeitbare Standardsignatur im Nachrichtentext, Erinnerungsfrist und bestätigungspflichtigen Einzelversand geprüft
- [ ] Jahreserinnerung mit 1-, 2- und 7-Tage-Vorlauf in Testdaten geprüft; globale Buchungsvorlagen dürfen Ereignisschalter nicht umgehen
- [ ] Keepalive, Sicherung, Wiederherstellung sowie Buchungs- und Ereignis-E-Mail-Workflows geprüft
- [ ] Impressum und Datenschutzerklärung vervollständigt
- [ ] Testprotokoll (`docs/TESTPROTOKOLL.md`) durchgeführt
