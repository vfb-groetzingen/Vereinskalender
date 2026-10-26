# Vereinskalender: Raum- und Platzbelegung

Webseite für den Verein zur Verwaltung von Räumen und Plätzen.

- **Besucher** sehen ohne Anmeldung alle Raumkalender (Tag, Woche, Monat), den Belegungsplan und QR-Codes.
- **Berechtigte Mitglieder** legen Termine an, bearbeiten und löschen. Sie importieren Belegungen aus CSV- oder Excel-Dateien.
- **Doppelbelegungen** verhindert die Datenbank selbst, auch bei gleichzeitigen Eingaben.

## Technik

| Bereich | Lösung | Kosten |
|---|---|---|
| Webseite | HTML, CSS, JavaScript (ohne Build-Schritt) | 0 € |
| Hosting | GitHub Pages (öffentliches Repository) | 0 € |
| Datenbank, Anmeldung | Supabase (Free-Tarif, Region Frankfurt) | 0 € |
| E-Mail (Anmeldelinks) | Brevo (Free-Tarif) | 0 € |
| Automatisierung | GitHub Actions (QR-Codes, Keepalive, Sicherung) | 0 € |

Die Architektur und die Begründungen stehen im Konzept (`Konzept_Vereinswebseite_Raumverwaltung.md`).

## Aufbau

```
index.html              Startseite (Raumverwaltung, Belegungsplan)
404.html                Weiterleitung für Direktlinks wie /raeume/trainingsplatz-a
datenschutz.html        Vorlage, muss ergänzt werden
impressum.html          Vorlage, muss ergänzt werden
assets/css/style.css    Gestaltung
assets/js/app.js        Oberfläche
assets/js/data.js       Datenzugriff (Demo-Modus und Supabase)
assets/js/logic.js      Prüfregeln: Datum, Uhrzeit, Doppelbelegung, Import
assets/js/layout.js     Positionen im Kalender und Zeitstrahl
assets/js/config.js     Einstellungen (öffentliche Werte)
assets/vendor/          SheetJS (Apache-2.0) für Excel-Import
data/seed.json          Räume, Plätze, Kategorien, Basisadresse für QR-Codes
qr/                     Automatisch erzeugte QR-Codes (SVG)
supabase/schema.sql     Tabellen, Doppelbelegungssperre, Rechte (RLS)
supabase/seed.sql       Startdaten für die Datenbank
supabase/admin-setup.sql  Ersten Administrator eintragen
scripts/build_qr.py     Erzeugt die QR-Codes
tests/                  Automatisierte Tests (npm test)
.github/workflows/      QR-Codes, Keepalive, verschlüsselte Sicherung
docs/                   Einrichtung, Pflegeanleitung, Testprotokoll
```

## Schnellstart

1. Einrichtung in dieser Reihenfolge: `docs/EINRICHTUNG.md`
2. Pflege durch Vereinsmitglieder: `docs/PFLEGE.md`
3. Prüfung vor dem Live-Betrieb: `docs/TESTPROTOKOLL.md`

**Ohne Supabase ausprobieren (Demo-Modus):** Solange `SUPABASE_URL` in `assets/js/config.js` leer ist, zeigt die Seite Beispieldaten. Lokal starten mit `python3 -m http.server 8000` im Projektordner und `BASE_PATH: '/'` setzen, dann `http://localhost:8000/` öffnen. Der Demo-Modus bietet keinen echten Schutz.

## Tests

```
npm test
```

Die Tests prüfen Datumsangaben, Doppelbelegung, Import, Kalenderpositionen und die Regeln des Datenspeichers. Die SQL-Dateien und die Oberfläche im Browser müssen nach der Einrichtung zusätzlich nach `docs/TESTPROTOKOLL.md` geprüft werden.

## Sicherheit in Kürze

- Schreibrechte werden in der Datenbank geprüft (Row Level Security), nicht im Browser.
- Der Schlüssel `service_role` gehört nie in dieses Repository.
- Besucher sehen Termintitel, aber keine Notizen und keine Angaben zu Ersteller oder Bearbeiter.
- Die Sicherung wird vor dem Speichern verschlüsselt.
- Das Repository ist öffentlich. Der Schutz beruht auf der Datenbank, nicht auf verborgenem Quellcode.

## Lizenzen

- SheetJS (Community Edition): Apache-2.0, Datei `assets/vendor/SHEETJS-LICENSE.txt`.
- Python-Bibliothek `qrcode` (nur für die Erzeugung der QR-Codes): MIT.
