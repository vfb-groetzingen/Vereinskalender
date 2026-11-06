# Testprotokoll: Vereinskalender

**Stand:** 26.10.2026

Dieses Protokoll trennt klar, was bereits geprüft wurde und was vor dem Live-Betrieb noch zu prüfen ist.

---

## 1. Automatisiert geprüft (in der Entwicklungsumgebung ausgeführt)

Befehl: `npm test` bzw. `node --test tests/logic.test.mjs tests/layout.test.mjs tests/store.test.mjs`

| Testdatei | Umfang | Ergebnis |
|---|---|---|
| `tests/logic.test.mjs` | Datums- und Uhrzeitprüfung, Doppelbelegung, CSV-Import, Spielplanimport (nur Start Date/Start Time/Subject, 90 Minuten), Zeilenfehler, Dubletten und Überschneidungen, Spurenlayout, Serien, Zeitumstellung | 21 von 21 bestanden |
| `tests/layout.test.mjs` | Positionen in Tages-/Wochenansicht und Zeitleiste, Termine über Mitternacht, überlappende Termine | 6 von 6 bestanden |
| `tests/store.test.mjs` | Demo-Speicher: Schreibrechte, Doppelbelegung (auch innerhalb einer Serie), Notizen für Besucher ausgeblendet, Bearbeiten ohne Selbstkonflikt, Löschen nur mit Berechtigung | 8 von 8 bestanden |

**Ergebnis: 35 von 35 automatisierten Tests bestanden.**

Zusätzlich geprüft:
- Alle JavaScript-Dateien sind syntaktisch gültig (`node --check`).
- Die GitHub-Workflows sind gültiges YAML.
- Die QR-Codes wurden für alle sieben Ressourcen als SVG erzeugt.

## 2. Nicht ausgeführt (noch offen)

Diese Punkte konnten in der Entwicklungsumgebung nicht getestet werden, da dort kein PostgreSQL und kein Browser zur Verfügung stehen. Sie müssen nach der Einrichtung durchgeführt werden.

| Bereich | Warum offen | Vorgehen |
|---|---|---|
| **SQL-Schema/Migration** (`supabase/schema.sql`, `supabase/migration-admin-audit.sql`) | Keine PostgreSQL-Instanz in der Entwicklungsumgebung | Für neue Projekte das Schema, für bestehende Projekte die Migration im Supabase SQL Editor ausführen. |
| **Edge Function** (`supabase/functions/admin-users/index.ts`) | Deno/Supabase-Projekt nicht verfügbar | Mit Supabase CLI deployen und Admin-Einladungen im Browser testen. |
| **Sicherheitstests gegen die echte Datenbank** | Benötigt ein laufendes Supabase-Projekt | Abschnitt 3 durchführen |
| **Benutzeroberfläche im Browser** | Kein Browser verfügbar | Checkliste in Abschnitt 4 durchführen |
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

**3.5 Doppelbelegung wird von der Datenbank abgelehnt (mit angemeldetem Bearbeiter)**

Zwei Termine mit gleicher Ressource und überlappender Zeit anlegen. Erwartet: Der zweite Aufruf schlägt mit dem Fehlercode `23P01` fehl. Gleichzeitiges Absenden beider Anfragen darf nur einen Termin speichern.

**3.6 Randberührung ist erlaubt**

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
- [ ] Besucher (ohne Anmeldung) sehen keine Schaltfläche zum Bearbeiten; öffentliche Selbstregistrierung ist deaktiviert
- [ ] Admin lädt Mitglied ein; Einladungslink bestätigt die E-Mail und ermöglicht eigene Passwortwahl
- [ ] Passwortlogin, Magic-Link und Passwort-Wiederherstellung funktionieren
- [ ] Anmeldelink wird per E-Mail zugestellt und öffnet die Seite angemeldet
- [ ] Termin anlegen, bearbeiten, löschen funktioniert
- [ ] Serie mit 4 Terminen wird angelegt
- [ ] Doppelbelegung wird mit verständlicher Meldung abgelehnt
- [ ] Spielimport nur aus dem geöffneten Raum-/Platzkalender starten; Zielressource prüfen
- [ ] CSV- und XLSX-Beispiel herunterladen; Import liest ausschließlich `Start Date`, `Start Time`, `Subject` und setzt 90 Minuten
- [ ] Import mit ungültigem Datum oder Überschneidung blockiert den gesamten Import und zeigt Zeilennummern
- [ ] XLSX-Formelbeispiel öffnet sich ohne Formelfehler; `Subject` wird korrekt gebildet
- [ ] Admin kann Ressourcen hinzufügen, umbenennen, Farbe ändern und archivieren/wiederherstellen (Buchungen bleiben erhalten)
- [ ] Admin kann Rollen ändern und den Zugang entziehen; der letzte Admin bleibt geschützt
- [ ] Admin-Protokoll zeigt Akteur, Zeitpunkt, Aktion sowie Vorher-/Nachher-Daten
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
- [ ] Mindestens zwei Administratoren eingetragen

---

## Abweichungen und Bekannte Grenzen

- **Demo-Modus:** Solange `SUPABASE_URL` leer ist, zeigt die Seite Beispieldaten und simuliert die Anmeldung. Das ist keine Sicherheit. Der echte Schutz gilt erst mit angebundener Datenbank.
- **Ressourcen werden aus Supabase geladen:** Archivierte Ressourcen bleiben mit bestehenden Buchungen erhalten; für neu angelegte Ressourcen müssen QR-Codes separat erzeugt werden.
- **Admin-Funktionen benötigen Deployment:** Einladungen und Rollenverwaltung funktionieren erst nach Bereitstellung der Edge Function und korrekter Supabase-Mail-/Redirect-Konfiguration.
- **Serienterminbearbeitung:** Ein einzelner Termin einer Serie wird bearbeitet, nicht die ganze Serie auf einmal.
