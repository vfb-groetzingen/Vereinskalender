# Vereinskalender: Raum- und Platzbelegung

Webseite für den Verein zur Verwaltung von Räumen und Plätzen.

- **Besucher** sehen ohne Anmeldung alle Raumkalender (Tag, Woche, Monat), den Belegungsplan und QR-Codes.
- **Berechtigte Mitglieder** legen Termine an, bearbeiten und löschen sie, können sie einem anderen Platz/Raum zuordnen und importieren/exportieren Belegungen als CSV oder Excel.
- **Überschneidungen sind erlaubt**, auch auf derselben Ressource; die Kalenderansichten zeigen überlappende Termine in getrennten Spuren.
- **Serientermine** können ab einem ausgewählten Termin einzeln oder zusammen mit allen folgenden Vorkommen bearbeitet bzw. gelöscht werden.
- **Buchungsnachrichten:** optionale Kontaktadresse für Bestätigungen, Änderungen und Absagen; Erinnerungen sind mit 1, 2 oder 7 Tagen Vorlauf wählbar.
- **Administration:** Benutzer, Ressourcen, filterbares Änderungsprotokoll, Texte, Mailprofile, Dokumente und Navigation werden in Admin-Unterseiten gepflegt.
- **Kalender-Abo:** öffentliche, schreibgeschützte iCalendar-Feeds für alle Ressourcen oder einzelne Räume/Plätze.
- **Ereignisse und E-Mail-Erinnerungen:** Bearbeiter können einmalige oder jährlich wiederkehrende Ereignisse anlegen; jährliche Wiederholung ist der Standard.
- **Aufbewahrung:** Buchungen und einmalige Ereignisse werden nach drei Jahren gelöscht. Bei Jahresereignissen werden nur alte Durchläufe und Protokolle bereinigt; die Wiederholungsregel und Zukunft bleiben erhalten.
- **Administratoren** können Termine kalenderübergreifend und unabhängig vom sichtbaren Zeitraum mehrfach markieren und löschen.

## Technik

| Bereich | Lösung | Kosten |
|---|---|---|
| Webseite | HTML, CSS, JavaScript (ohne Build-Schritt) | 0 € |
| Hosting | GitHub Pages (öffentliches Repository) | 0 € |
| Datenbank, Anmeldung | Supabase (Free-Tarif, Region Frankfurt) | 0 € |
| E-Mail (Anmeldelinks, Buchungsnachrichten und Ereignis-E-Mails) | Strato-SMTP (authentifiziert als `vfb-app@vfb-groetzingen.de`) | bestehender Tarif |
| Automatisierung | GitHub Actions (QR-Codes, Keepalive, Sicherung, Buchungs- und Ereignis-E-Mails, Bereinigung) sowie Supabase Cron (Protokollaufbewahrung) | 0 € zusätzlich |

Die Architektur und die Begründungen stehen im Konzept (`Konzept_Vereinswebseite_Raumverwaltung.md`).

## Aufbau

```
index.html              Startseite (Raumverwaltung, Belegungsplan)
404.html                Weiterleitung für Direktlinks wie /raeume/trainingsplatz-a
datenschutz.html        konfigurierbarer Klartext, muss geprüft und ergänzt werden
impressum.html          konfigurierbarer Klartext, muss geprüft und ergänzt werden
assets/css/style.css    Gestaltung
assets/js/app.js        Oberfläche
assets/js/annual-events.js  Ereigniskalender und Ereignis-E-Mail-Formular
assets/js/data.js       Datenzugriff (Demo-Modus und Supabase)
assets/js/logic.js      Prüfregeln: Datum, Uhrzeit, Import und Kalenderzuordnung
assets/js/layout.js     Positionen im Kalender und Zeitstrahl
assets/js/config.js     Einstellungen (öffentliche Werte)
assets/vendor/          SheetJS (Apache-2.0) für Excel-Import/-Export
assets/templates/       CSV- und Excel-Beispiele für den Import
data/seed.json          Räume, Plätze, Kategorien, Basisadresse für QR-Codes
qr/                     Automatisch erzeugte QR-Codes (SVG)
supabase/schema.sql     Tabellen und Rechte (RLS), ohne Überschneidungssperre
supabase/migration-allow-booking-overlaps.sql  Überschneidungen aktivieren
supabase/migration-booking-retention-3-years.sql  Automatische 3-Jahres-Aufbewahrung
supabase/migration-multi-resource-annual-events.sql  Mehrfachressourcen und jährliche Ereignis-E-Mails
supabase/migration-annual-email-test-requests.sql  Testmail-Warteschlange und Fehlerstatus
supabase/migration-annual-email-log-context.sql  Ereignisdatum und Empfänger im Protokoll
supabase/migration-event-recurrence-retention-3-years.sql  Einmalige Ereignisse und 3-Jahres-Aufbewahrung
supabase/migration-admin-configuration-communications.sql  Admin-Konfiguration, Buchungsnachrichten und Dokumentablage
supabase/functions/calendar-feed/index.ts  Schreibgeschützter iCalendar-Feed
supabase/seed.sql       Startdaten für die Datenbank
supabase/admin-setup.sql  Ersten Administrator eintragen
scripts/build_qr.py     Erzeugt die QR-Codes
scripts/send_annual_event_emails.py  Versendet Ereignis-E-Mails über Strato
scripts/send_booking_notifications.py  Versendet Buchungsnachrichten und Erinnerungen über Strato
scripts/cleanup_annual_event_data.py  Löscht abgelaufene Einmalereignisse und Dateien
tests/                  Automatisierte Tests (npm test)
.github/workflows/      QR-Codes, Keepalive, Sicherung, Buchungs-/Ereignismails und Bereinigung
assets/js/admin-config.js  Mailprofile, Vorlagen, Texte, Dokumente und Navigation
assets/js/public-pages.js  Öffentliche Klartexte für Impressum/Datenschutz
docs/                   Einrichtung, Pflegeanleitung, Testprotokoll
```

## Schnellstart

1. Einrichtung in dieser Reihenfolge: `docs/EINRICHTUNG.md`
2. Bei einer bestehenden Supabase-Installation `supabase/migration-allow-booking-overlaps.sql` einmal im SQL Editor ausführen, damit die bisherige Überschneidungssperre entfernt wird.
3. Für bestehende und neue Supabase-Projekte die erforderlichen Migrationen in der Reihenfolge aus `docs/EINRICHTUNG.md` ausführen; `supabase/migration-admin-configuration-communications.sql` kommt zuletzt, nach der Ereignis-Rekurrenzmigration.
4. Pflege durch Vereinsmitglieder: `docs/PFLEGE.md`
5. Prüfung vor dem Live-Betrieb: `docs/TESTPROTOKOLL.md`

**Ohne Supabase ausprobieren (Demo-Modus):** Solange `SUPABASE_URL` in `assets/js/config.js` leer ist, zeigt die Seite Beispieldaten. Lokal starten mit `python3 -m http.server 8000` im Projektordner und `BASE_PATH: '/'` setzen, dann `http://localhost:8000/` öffnen. Der Demo-Modus bietet keinen echten Schutz.

## Tests

```
npm test
```

Die Tests prüfen Datumsangaben, erlaubte Überschneidungen, Import mit optionalen Endangaben und Kalenderzuordnung, Kalenderpositionen, Datenspeicher sowie Mailer- und Antwortadresslogik. Die SQL-Dateien und die Oberfläche im Browser müssen nach der Einrichtung zusätzlich nach `docs/TESTPROTOKOLL.md` geprüft werden.

## Sicherheit in Kürze

- Schreibrechte werden in der Datenbank geprüft (Row Level Security), nicht im Browser.
- Der Schlüssel `service_role` gehört nie in dieses Repository.
- Besucher sehen Termintitel, aber keine Notizen und keine Angaben zu Ersteller oder Bearbeiter.
- Die Sicherung wird vor dem Speichern verschlüsselt.
- Das Repository ist öffentlich. Der Schutz beruht auf der Datenbank, nicht auf verborgenem Quellcode.

## Lizenzen

- SheetJS (Community Edition): Apache-2.0, Datei `assets/vendor/SHEETJS-LICENSE.txt`.
- Python-Bibliothek `qrcode` (nur für die Erzeugung der QR-Codes): MIT.
