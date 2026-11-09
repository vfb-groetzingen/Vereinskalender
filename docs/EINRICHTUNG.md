# Einrichtung: Vereinskalender (Schritt für Schritt)

Diese Anleitung richtet die Webseite vollständig ein: Datenbank, Anmeldung, Veröffentlichung, Sicherung und Keepalive. Sie benötigt etwa 1 bis 2 Stunden. Die Schritte bauen aufeinander auf.

Vorhandene Konten: GitHub, Supabase, Brevo.

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
3. Danach den Inhalt von `supabase/seed.sql` einfügen und ausführen.
4. Unter **Table Editor** prüfen: Die Tabellen `resources`, `categories`, `bookings` und `memberships` sind vorhanden.

## Schritt 3: Anmeldung konfigurieren

1. **Authentication > Sign In / Providers > Email**: E-Mail-Anmeldung aktiviert lassen. Die Option **Allow new users to sign up** deaktivieren. Damit können sich nur eingeladene Personen anmelden.
2. **Authentication > URL Configuration**:
   - **Site URL**: `https://DEIN-GITHUB-NAME.github.io/vereinskalender/`
   - **Redirect URLs**: dieselbe Adresse eintragen.
3. **Authentication > Emails > SMTP Settings** (Tab „SMTP Settings“, Schalter **Enable Custom SMTP** einschalten; Versand über Brevo, da der Standardversand stark begrenzt ist). Hinweis: Die Oberfläche von Supabase ändert sich gelegentlich. Falls der Menüpunkt anders heißt, im Dashboard nach „SMTP“ suchen. Ältere Anleitungen nennen noch „Project Settings > Auth“.
   - Host: `smtp-relay.brevo.com`, Port: `587`
   - Benutzername und Passwort: die SMTP-Zugangsdaten aus dem Brevo-Konto (SMTP & API)
   - Absenderadresse: eine in Brevo verifizierte Adresse des Vereins
   - Mit Custom SMTP steigt das Limit für Anmelde-E-Mails von 2 auf 30 pro Stunde (anpassbar unter **Authentication > Rate Limits**).
4. **Authentication > Emails > Magic Link** (Vorlage): Der Text sollte erklären, dass es sich um einen Anmeldelink für den Vereinskalender handelt.

## Schritt 4: Ersten Administrator anlegen

1. **Authentication > Users > Invite user**: E-Mail-Adresse der Person eintragen. Die Person erhält eine Einladung.
2. Im SQL Editor den Inhalt von `supabase/admin-setup.sql` öffnen. Die Zeile mit `HIER-E-MAIL-EINTRAGEN` durch die E-Mail-Adresse ersetzen und ausführen.
3. Weitere Bearbeiter auf dieselbe Weise anlegen (Einladung, dann SQL mit Rolle `bearbeiter`).

## Schritt 5: Zugangsdaten in die Webseite eintragen

Die Werte stehen unter **Project Settings > API**.

Datei `assets/js/config.js` anpassen:

- `BASE_PATH`: `'/vereinskalender/'` (Name des GitHub-Repositorys, mit Schrägstrichen)
- `SUPABASE_URL`: die Project URL, z. B. `https://xyzxyz.supabase.co`
- `SUPABASE_ANON_KEY`: der Schlüssel mit der Bezeichnung **anon public**

> **Wichtig:** Niemals den Schlüssel **service_role** eintragen. Er umgeht alle Rechte und gehört nur in die Geheimnisse von GitHub (wird in diesem Projekt nicht benötigt).

Solange `SUPABASE_URL` leer ist, läuft die Seite im **Demo-Modus** mit Beispieldaten. Der Demo-Modus ist für Tests gedacht und bietet keinen echten Schutz.

Datei `data/seed.json` anpassen: Bei `settings.public_base_url` die eigene Adresse eintragen, z. B. `https://xyzxyz.github.io/vereinskalender`. Die QR-Codes werden danach automatisch neu erzeugt (Schritt 6).

## Schritt 6: GitHub-Repository und Veröffentlichung

1. Auf GitHub ein **öffentliches** Repository mit dem Namen `vereinskalender` anlegen.
   - Warum öffentlich: Der kostenlose Tarif von GitHub Pages erfordert ein öffentliches Repository. Es enthält keine Geheimnisse. Die Sicherheit liegt in der Datenbank.
2. Alle Dateien des Projekts hochladen (oder per Git übertragen). Dateien mit `.gitignore` werden ausgeschlossen.
3. **Settings > Pages**: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)**.
4. Nach ca. 1 bis 2 Minuten ist die Seite unter `https://DEIN-GITHUB-NAME.github.io/vereinskalender/` erreichbar.
5. Den Ordner `.nojekyll` nicht löschen. Er ist für GitHub Pages notwendig.

Die Datei `404.html` leitet Direktaufrufe wie `/raeume/trainingsplatz-a` auf die Startseite um. Der Basispfad in `404.html` muss mit `BASE_PATH` übereinstimmen.

## Schritt 7: Geheimnisse für Automatisierung hinterlegen

**Settings > Secrets and variables > Actions > New repository secret**:

| Name | Inhalt |
|---|---|
| `SUPABASE_URL` | Project URL (wie in Schritt 5) |
| `SUPABASE_ANON_KEY` | Schlüssel anon public |
| `SUPABASE_DB_URL` | Verbindungs-URI für Datenbankzugriff (siehe unten) |
| `BACKUP_PASSPHRASE` | Langes Zufallspasswort für verschlüsselte Sicherungen (mindestens 24 Zeichen) |

**Verbindungs-URI** (für `SUPABASE_DB_URL`): Im Dashboard auf **Connect** klicken. Die Variante **Session pooler** wählen (Port 5432). Das Datenbankpasswort aus Schritt 1 eintragen. Die direkte Verbindung funktioniert auf GitHub-Servern oft nicht, da sie IPv6 benötigt.

Das Passwort für `BACKUP_PASSPHRASE` ist notwendig, um Sicherungen zu entschlüsseln. **Ohne dieses Passwort sind die Sicherungen unbrauchbar.** Es muss an mindestens zwei Stellen gespeichert werden (z. B. im Vereins-Passwortmanager).

## Schritt 8: Automatisierung prüfen

Unter **Actions** die drei Workflows prüfen:

1. **QR-Codes aktualisieren**: Läuft automatisch nach Änderungen an `data/seed.json`. Manuell mit **Run workflow** starten. Ergebnis: Im Ordner `qr/` liegen die SVG-Dateien mit der richtigen Adresse.
2. **Supabase Keepalive**: Mit **Run workflow** starten. Erwartet: `Antwort HTTP 200`.
3. **Datenbank-Sicherung**: Mit **Run workflow** starten. Erwartet: Ein Artefakt `vereinskalender-backup-…` mit der Datei `backup.sql.gpg`.

**Keepalive und Pausierung:** Der Free-Tarif von Supabase pausiert Projekte nach 7 Tagen ohne Aktivität. Der Keepalive verhindert das nach bisherigem Kenntnisstand, ist aber nicht zugesichert. Deshalb unbedingt prüfen, ob das Projekt nach 2 bis 3 Wochen noch läuft. Wenn nicht, auf Supabase Pro umstellen (ca. 25 US-Dollar im Monat).

**Hinweis GitHub:** Geplante Workflows werden in öffentlichen Repositories nach 60 Tagen ohne Aktivität automatisch deaktiviert. Ein Commit oder ein manueller Start reaktiviert sie.

## Schritt 9: Sicherung wiederherstellen (Probe durchführen)

Die Wiederherstellung sollte einmal auf einem Testprojekt geübt werden, bevor sie im Ernstfall nötig ist.

1. Artefakt aus dem Lauf der Datenbank-Sicherung herunterladen.
2. Entschlüsseln: `gpg --batch --passphrase "PASSPHRASE" -o backup.sql -d backup.sql.gpg`
3. Einspielen in ein Testprojekt mit `psql` (Verbindungs-URI wie oben) oder über den SQL Editor.

## Schritt 10: Rechtliche Seiten vervollständigen

Die Dateien `impressum.html` und `datenschutz.html` sind Vorlagen. Alle Angaben in eckigen Klammern müssen ergänzt werden. Für Supabase, GitHub und Brevo müssen Auftragsverarbeitungsverträge abgeschlossen werden. Diese Verträge stellen die Anbieter bereit (Stand der Verfügbarkeit bitte prüfen).

## Schritt 11: Eigene Domain (optional)

Eine eigene Domain wird in den GitHub-Pages-Einstellungen unter **Custom domain** eingetragen. Danach die Site URL in Supabase (Schritt 3) und `public_base_url` in `data/seed.json` (Schritt 5) anpassen. Die QR-Codes werden danach automatisch neu erzeugt.

---

## Checkliste vor dem Start

- [ ] Schema und Startdaten eingespielt
- [ ] Öffentliche Registrierung in Supabase deaktiviert
- [ ] Site URL und Redirect URL korrekt
- [ ] SMTP über Brevo funktioniert (Testanmeldung)
- [ ] Administrator eingeladen und in `memberships` eingetragen
- [ ] `config.js` mit URL und anon-Schlüssel gefüllt
- [ ] `public_base_url` gesetzt, QR-Codes neu erzeugt
- [ ] Geheimnisse (vier Stück) hinterlegt
- [ ] Keepalive, Sicherung und Wiederherstellung geprüft
- [ ] Impressum und Datenschutzerklärung vervollständigt
- [ ] Testprotokoll (`docs/TESTPROTOKOLL.md`) durchgeführt
