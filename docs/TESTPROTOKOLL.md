# Testprotokoll: Vereinskalender

**Stand:** 26.10.2026

Dieses Protokoll trennt klar, was bereits geprüft wurde und was vor dem Live-Betrieb noch zu prüfen ist.

---

## 1. Automatisiert geprüft (in der Entwicklungsumgebung ausgeführt)

Befehl: `npm test` bzw. `node --test tests/logic.test.mjs tests/layout.test.mjs tests/store.test.mjs`

| Testdatei | Umfang | Ergebnis |
|---|---|---|
| `tests/logic.test.mjs` | Datums- und Uhrzeitprüfung, Import mit Zeilenfehlern, Kalenderzuordnung und Standardkalender-Fallback, erlaubte Überschneidungen, Serien und Layout | 22 von 22 bestanden |
| `tests/layout.test.mjs` | Positionen in Tages-/Wochenansicht und Zeitleiste, Termine über Mitternacht, überlappende Termine | 6 von 6 bestanden |
| `tests/store.test.mjs` | Demo-Speicher: Schreibrechte, erlaubte Überschneidungen, Mehrfachressourcen, vollständiges Laden aller Zeiträume und einer Serie, Notizen und Löschen | 11 von 11 bestanden |
| `tests/test_annual_event_mailer.py` | Einmalige und jährliche Fälligkeit, Schalttag, SMTP-Ablehnung, Aufbewahrungsgrenze und sichere Dateipfade | 7 von 7 bestanden |

**Ergebnis: 39 JavaScript- und 7 Python-Tests bestanden.**

Zusätzlich geprüft:
- Die JavaScript-Dateien sind syntaktisch gültig (`node --check`); die CSS-Datei wurde geparst.
- CSV- und Excel-Beispielvorlagen wurden über die Importlogik geprüft; Exceldatei lädt korrekt und die fehlende Endzeit ergibt 90 Minuten.
- Die sechs GitHub-Workflows sind gültiges YAML.
- Mailer und Bereinigungsskript wurden mit synthetischen Daten geprüft; es fand kein echter SMTP-Versand und kein echter Storage-/Datenbankzugriff statt.
- Die QR-Codes wurden für alle sieben Ressourcen als SVG erzeugt.

## 2. Nicht ausgeführt (noch offen)

Diese Punkte konnten in der Entwicklungsumgebung nicht getestet werden, da dort kein PostgreSQL und kein Browser zur Verfügung stehen. Sie müssen nach der Einrichtung durchgeführt werden.

| Bereich | Warum offen | Vorgehen |
|---|---|---|
| **SQL-Schema/Migrationen** (`supabase/schema.sql`, `supabase/migration-allow-booking-overlaps.sql`, `supabase/migration-booking-retention-3-years.sql`) | Keine PostgreSQL-Instanz in der Entwicklungsumgebung | Schema und die jeweils erforderlichen Migrationen im SQL Editor ausführen; für diese Erweiterung zusätzlich `supabase/migration-multi-resource-annual-events.sql`, `supabase/migration-annual-email-test-requests.sql`, `supabase/migration-annual-email-log-context.sql` und `supabase/migration-event-recurrence-retention-3-years.sql`. |
| **Sicherheitstests gegen die echte Datenbank** | Benötigt ein laufendes Supabase-Projekt | Abschnitt 3 durchführen |
| **Benutzeroberfläche im Browser** | Kein Browser verfügbar | Checkliste in Abschnitt 4 durchführen |
| **Supabase Cron / Aufbewahrung** (`supabase/migration-booking-retention-3-years.sql`, `supabase/migration-event-recurrence-retention-3-years.sql`) | Benötigt ein laufendes Supabase-Projekt und Cron-Erweiterung | Migrationen ausführen; Cron-Jobs und Ausführungshistorie im Dashboard prüfen. In einer Testumgebung sicherstellen, dass nur Buchungen und Ereignis-Daten vor der jeweiligen 3-Jahres-Grenze gelöscht werden und künftige Jahreswiederholungen erhalten bleiben. |
| **Mehrfachressourcen und Ereignis-E-Mails** (`supabase/migration-multi-resource-annual-events.sql`, `supabase/migration-annual-email-test-requests.sql`, `supabase/migration-annual-email-log-context.sql`, `supabase/migration-event-recurrence-retention-3-years.sql`) | Benötigt Supabase, Storage-Bucket und GitHub Actions Secrets | Alle erforderlichen Migrationen ausführen. Mehrere Ressourcen buchen und prüfen, dass der Termin in jedem Kalender erscheint. Bei Ereignissen prüfen, dass „Jährliche Wiederholung“ vorausgewählt ist und ein einmaliges Datum nur im gewählten Jahr erscheint. Den Workflow „Ereignisdaten nach drei Jahren bereinigen“ manuell starten und kontrollieren, dass alte Einmalereignisse samt Dateien verschwinden, während jährliche Regeln erhalten bleiben. Testmail an eine kontrollierte Adresse anfordern; Workflow manuell starten und Status, Fehlerprotokoll sowie Empfänger-Mail prüfen. Zusätzlich eine nicht existente Testadresse verwenden und prüfen, dass die SMTP-Ablehnung im Fehlerprotokoll erscheint. Für die Aufbewahrung in einer Testumgebung je ein einmaliges Ereignis sowie Jahres-Durchläufe vor und nach der 3-Jahres-Grenze anlegen; den Cron-Job manuell ausführen und bestätigen, dass nur alte Daten verschwinden und die Jahresregel bestehen bleibt. |
| **Keepalive** | Benötigt echtes Projekt und mehrere Wochen Beobachtung | Abschnitt 5 |
| **Sicherung und Wiederherstellung** | Benötigt Projekt und Secrets | Abschnitt 5 |

## 3. Sicherheitstests gegen die Datenbank

Vorbereitung: Projekt-URL und anon-Schlüssel bereithalten. Die Tests verwenden **nur** den öffentlichen Schlüssel, so wie ihn Besucher auch haben.

**3.1 Besucher darf nicht schreiben (erwartet: Fehler 401 oder 403)**

```
curl -i -X POST "$SUPABASE_URL/rest/v1/bookings" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"resource_id":"<ID>","category_id":"<ID>","title":"Test","starts_at":"2031-01-07T17:00:00Z","ends_at":"2031-01-07T18:00:00Z"}'
```

**3.2 Besucher darf keine Notizen lesen (erwartet: leere Liste oder Fehler, kein Feld „notes“)**

```
curl -s "$SUPABASE_URL/rest/v1/bookings?select=id,notes" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

**3.3 Besucher darf Termine lesen (erwartet: Liste ohne Notizen)**

```
curl -s "$SUPABASE_URL/rest/v1/public_bookings?select=*&limit=5" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

**3.4 Besucher darf nicht löschen (erwartet: keine Zeile gelöscht)**

```
curl -i -X DELETE "$SUPABASE_URL/rest/v1/bookings?id=not.is.null" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

**3.5 Überschneidungen sind auch auf derselben Ressource erlaubt (mit angemeldetem Bearbeiter)**

Zwei Termine mit gleicher Ressource und überlappender Zeit anlegen. Erwartet: Beide werden gespeichert. Auch zwei gleichzeitig abgesendete Anfragen werden nicht durch eine Überschneidungssperre abgewiesen.

**3.6 Randberührung ist ebenfalls erlaubt**

Termin 17:00 bis 18:00 und danach Termin 18:00 bis 19:00 auf derselben Ressource. Erwartet: Beide werden gespeichert.

**3.7 Konto ohne Rolle darf nicht schreiben**

Mit einem angemeldeten Konto ohne Eintrag in `memberships` schreiben. Erwartet: Fehler 403 bzw. Code `42501`.

**3.8 Bearbeiter darf keine Stammdaten ändern**

Mit Rolle `bearbeiter` eine Zeile in `resources` ändern. Erwartet: Fehler, keine Änderung. Mit Rolle `admin` erfolgreich.

**3.9 Audit-Felder können nicht gefälscht werden**

Mit Bearbeiter-Konto `created_by` oder `updated_by` im Request setzen. Erwartet: Der Wert wird durch den Datenbank-Trigger mit der eigenen Benutzer-ID überschrieben.

**3.10 Der geheime Schlüssel ist nicht im Repository**

```
grep -r "service_role" . --exclude-dir=.git
```

Erwartet: Kein Treffer außer in dieser Testanleitung.

## 4. Checkliste Benutzeroberfläche (Browser)

Auf Computer (Chrome oder Firefox), Tablet und Smartphone prüfen.

- [ ] Startseite zeigt beide Bereiche und alle sieben Ressourcen
- [ ] Direktlink `/raeume/trainingsplatz-a` öffnet direkt den Kalender (Weiterleitung über 404.html funktioniert)
- [ ] Tagesansicht, Wochenansicht und Monatsansicht wechseln korrekt, „Heute“ und Pfeile funktionieren
- [ ] Belegungsplan: Rubriken lassen sich einzeln ein- und ausblenden, „Alle ausblenden“ zeigt Hinweis
- [ ] Filter nach Kategorie reduziert die Anzeige
- [ ] Datum im Belegungsplan wählbar, Tag und Woche umschaltbar
- [ ] Besucher (ohne Anmeldung) sehen keine Schaltfläche zum Bearbeiten
- [ ] Anmeldelink wird per E-Mail zugestellt und öffnet die Seite angemeldet
- [ ] Termin anlegen, bearbeiten, löschen funktioniert
- [ ] Serie bearbeiten: nur diesen oder diesen und alle folgenden Termine wählen; frühere Termine bleiben unverändert
- [ ] Serie löschen: nur diesen oder diesen und alle folgenden Termine wählen
- [ ] Serie mit 4 Terminen wird angelegt
- [ ] Zwei überlappende Termine auf demselben Platz werden gespeichert und in getrennten Spuren angezeigt
- [ ] Bearbeiten kann einen bestehenden Termin einem anderen Platz/Raum zuordnen
- [ ] Import: Importbutton ist im Belegungsplan und in einzelnen Kalendern vorhanden
- [ ] Import: bei fehlender Kalenderangabe im Belegungsplan muss ein Zielkalender ausgewählt werden; Calendar Name in der Datei ordnet pro Zeile zu
- [ ] Import: CSV-Beispiel herunterladen und importieren
- [ ] Import: End Date/End Time werden übernommen; fehlende Endangaben ergeben 90 Minuten
- [ ] Import: Kalendername und Slug ordnen den Zielkalender zu; fehlender/unbekannter Name fällt auf den aktuellen Kalender zurück
- [ ] Import: ungültiges Datum zeigt Zeilennummer und Meldung, nichts wird importiert
- [ ] Import: Excel-Datei (.xlsx) wird gelesen
- [ ] Export: einzelner Kalender sowie alle aktiven Kalender als CSV und XLSX herunterladen
- [ ] Administrator: Termine aus verschiedenen Zeiträumen markieren und mehrfach löschen
- [ ] QR-Code wird als SVG geladen und führt auf die richtige Adresse (mit Telefon-Kamera prüfen)
- [ ] „Link kopieren“ funktioniert
- [ ] Zeitumstellung 25.10.2026: Ein Termin am 25.10. um 18:00 Uhr erscheint um 18:00 Uhr
- [ ] Texte sind gut lesbar, Tastatur-Navigation mit Tab funktioniert
- [ ] Impressum und Datenschutz sind vollständig ausgefüllt

## 5. Betrieb

- [ ] Keepalive: Nach 3 Wochen läuft das Supabase-Projekt noch (kein Hinweis auf Pausierung)
- [ ] Sicherung: Artefakt vorhanden und mit `BACKUP_PASSPHRASE` entschlüsselbar
- [ ] Wiederherstellung: Sicherung auf einem Testprojekt eingespielt, Termine vorhanden
- [ ] QR-Codes zeigen nach Änderung der Adresse auf die neue Adresse
- [ ] Cron: täglicher Aufbewahrungsjob ist aktiv; alte Termine werden entfernt, Termine innerhalb der letzten drei Jahre bleiben erhalten
- [ ] Mindestens zwei Administratoren eingetragen

---

## Abweichungen und Bekannte Grenzen

- **Demo-Modus:** Solange `SUPABASE_URL` leer ist, zeigt die Seite Beispieldaten und simuliert die Anmeldung. Das ist keine Sicherheit. Der echte Schutz gilt erst mit angebundener Datenbank.
- **Keine automatische Aktualisierung der Stammdaten im Browser:** Neue Räume müssen in der Datenbank angelegt und in `data/seed.json` ergänzt werden, damit der QR-Code erzeugt wird.
- **Serienterminbearbeitung:** Ein einzelner Termin einer Serie wird bearbeitet, nicht die ganze Serie auf einmal.
