# Pflegeanleitung für Vereinsmitglieder

Diese Anleitung erklärt, wie Räume und Plätze im Vereinskalender verwaltet werden. Technische Kenntnisse sind nicht nötig.

---

## Was Besucher sehen

Jeder kann ohne Anmeldung:

- die **Startseite** mit allen Räumen und Plätzen,
- den **Kalender jedes Raums** (Tag, Woche, Monat),
- den **Belegungsplan** mit allen Plätzen im Zeitstrahl,
- für jeden Raum einen **QR-Code** und einen **Link**, z. B. zum Aushang am Raum.

Notizen zu Terminen sind nur für angemeldete Mitglieder sichtbar.

## Anmelden

1. Oben rechts auf **Anmelden** klicken.
2. Die E-Mail-Adresse eingeben, mit der Sie eingeladen wurden.
3. Eine E-Mail mit einem **Anmeldelink** öffnen. Es ist kein Passwort nötig.

Der Link ist nur kurze Zeit gültig. Wenn er abgelaufen ist, einfach erneut anfordern.

Nicht eingeladene Adressen erhalten keinen Link. Dies ist Absicht.

## Termin anlegen

1. Den gewünschten Raum oder Platz öffnen, oder den **Belegungsplan** wählen.
2. Auf **Neuer Termin** klicken.
3. Ausfüllen:
   - **Titel**: kurz und allgemein, z. B. „A-Junioren Training“. Der Titel ist öffentlich sichtbar.
   - **Ressource** und **Kategorie** (z. B. Training, Spiel, Vermietung).
   - **Datum, Startzeit, Endzeit**.
   - **Kontakt-E-Mail** (optional): erhält Bestätigungen, Änderungen und Absagen.
   - **Erinnerung** (optional): keine, 1, 2 oder 7 Tage vorher; benötigt eine Kontakt-E-Mail.
   - **Notiz** (optional, nur für Mitglieder sichtbar).
4. Auf **Termin anlegen** klicken.

**Serien:** Für regelmäßige Termine im Feld **Wiederholung** eine Frequenz wählen und die Anzahl eintragen (max. 52). Jeder Termin wird einzeln gespeichert.

## Überschneidende Termine

Überschneidungen sind erlaubt – auch auf demselben Platz oder im selben Raum. Die Kalenderansichten zeigen gleichzeitig stattfindende Termine nebeneinander bzw. in getrennten Spuren. Bitte vor dem Speichern selbst prüfen, ob die Belegung organisatorisch möglich ist.

Ein Termin, der genau um 18:00 Uhr endet, kann direkt von einem Termin ab 18:00 Uhr gefolgt werden.

## Termin bearbeiten oder löschen

1. Auf den Termin klicken (im Kalender oder im Belegungsplan).
2. **Bearbeiten** oder **Löschen** wählen.
3. Beim Bearbeiten kann **Kalender / Platz / Raum** geändert werden; danach speichern.

Bei Serien fragt die Anwendung vor dem Bearbeiten oder Löschen nach dem Umfang: **Nur diesen Termin** oder **diesen und alle folgenden Termine der Serie**. Frühere Termine bleiben dabei unverändert. Bei einer Änderung ab dem ausgewählten Termin werden Datum und Uhrzeit der folgenden Vorkommen entsprechend fortgeschrieben.

## Mehrere Termine importieren (Excel oder CSV)

Nützlich für Trainingspläne, die bereits in einer Tabelle stehen.

1. Im **Belegungsplan** oder in einem einzelnen Kalender auf **Spiele importieren** klicken.
2. Eine der Beispielvorlagen im Dialog herunterladen und ausfüllen.
3. Die Datei auswählen und in der Vorschau die Hinweise prüfen.
4. Wenn die Datei keinen gültigen Kalendernamen/Slug enthält, im Feld **Zielkalender** den Kalender für diese Zeilen auswählen.
5. Erst wenn keine Fehler angezeigt werden, auf **Importieren** klicken.

**Format:**
- Pflichtspalten: `Start Date`, `Start Time`, `Subject`
- Optional: `End Date`, `End Time`, `Calendar Name`
- Wenn End Date oder End Time fehlt, werden 90 Minuten ab Start angenommen. Fehlt nur eine der beiden Endangaben, erscheint ein Hinweis und ebenfalls die 90-Minuten-Dauer.
- `Calendar Name` akzeptiert Kalendername oder Slug und kann pro Zeile einen Zielkalender festlegen. Beim Import aus dem Belegungsplan fragt die Anwendung über das Feld **Zielkalender** nach, wenn eine oder mehrere Zeilen keinen gültigen Wert haben. In einem einzelnen Kalender dient dieser als Standard.
- Datum: `2027-03-01` oder `01.03.2027`; Uhrzeit: `17:30`
- CSV wird mit Semikolon oder Komma unterstützt.
- Überschneidungen sind zulässig. Bei Eingabefehlern wird nichts importiert; eine Zeilennummer hilft beim Korrigieren.



## Automatische Aufbewahrung

Die Cron-Migration `supabase/migration-booking-retention-3-years.sql` plant eine tägliche Bereinigung um 03:00 UTC. Dabei werden Termine aus allen Plätzen und Räumen gelöscht, deren Startzeit mehr als drei Jahre zurückliegt; jüngere Termine bleiben erhalten. Einzelne alte Vorkommen einer Serie werden gelöscht, spätere Vorkommen bleiben bestehen. Die Löschung ist dauerhaft. Vor dem erstmaligen Ausführen bei Bedarf einen CSV-/Excel-Export oder ein Datenbank-Backup erstellen.

Die vereinbarte Regel löscht keine jüngeren Termine, um Speicher freizumachen. Daher kann sie keine Reserve von 20 MB garantieren. Außerdem wird Datenbankplatz nach `DELETE` nicht zwingend sofort an den Tarif-Speicher zurückgegeben; PostgreSQL markiert gelöschte Zeilen zunächst zur Wiederverwendung und Autovacuum bereinigt sie später.

## Kalender exportieren

- Auf einer Platz-/Raumseite über **Exportieren** den einzelnen Kalender exportieren.
- Im Belegungsplan über **Kalender exportieren** entweder alle aktiven Kalender oder einen einzelnen Kalender auswählen.
- Als **CSV** oder **Excel (.xlsx)** herunterladen. Der Export umfasst alle Termine, nicht nur den aktuell sichtbaren Zeitraum. Notizen werden nicht exportiert.

## Ansicht anpassen

Im **Belegungsplan** links können Sie Rubriken ein- und ausblenden. Die Farbe jeder Rubrik entspricht dem Balken im Zeitstrahl. Der linke Rand der Balken zeigt die Kategorie. Die Einstellung betrifft nur Ihre Ansicht und ändert keine Daten.

Mit **Kategorie** lassen sich Termine einer Art filtern. Mit den Pfeilen und dem Datumsfeld wechseln Sie den Zeitraum.

## QR-Code und Link

- Auf der Startseite oder beim Raum auf **QR-Code** klicken, um die SVG-Datei zu laden. Die Datei kann gedruckt werden.
- Mit **Link kopieren** die Adresse des Kalenders in die Zwischenablage legen.

Der QR-Code führt direkt zum Kalender des Raums. Die Adresse bleibt dauerhaft gleich.

## Häufige Fragen

**Ich sehe keine Schaltfläche „Neuer Termin“.**
Sie sind nicht angemeldet oder haben keine Berechtigung. Bitte mit Ihrer eingeladenen E-Mail-Adresse anmelden.

**Die Meldung „Keine Berechtigung“ erscheint.**
Ihr Konto hat keine Rolle. Der Administrator kann diese vergeben.

**Der Anmeldelink funktioniert nicht mehr.**
Links sind nur kurze Zeit gültig. Einfach einen neuen anfordern. Bitte immer den neuesten Link verwenden.

**Ein Termin ist falsch eingetragen.**
Termin öffnen und bearbeiten oder löschen. Bei Unsicherheit den Administrator fragen.

**Die Uhrzeiten wirken eine Stunde verschoben.**
Bitte prüfen, ob der Computer auf die deutsche Zeitzone eingestellt ist. Die Umstellung auf Winterzeit findet am 25.10.2026 statt.

---

## Für Administratoren

- **Neues Mitglied einladen:** In der Administration unter **Benutzer und Einladungen** die E-Mail-Adresse und Rolle wählen. Der erste Administrator wird einmalig über `supabase/admin-setup.sql` eingerichtet.
- **Zugang entziehen:** In **Benutzer und Einladungen** den Zugang entfernen. Das Konto kann danach keine Termine mehr ändern.
- **Neuer Raum oder Platz:** Eintrag in `data/seed.json` (und in der Datenbank unter *Table Editor > resources*) anlegen, danach den QR-Code neu erzeugen lassen.
- **Sicherung:** Läuft wöchentlich automatisch. Einrichtung und Wiederherstellung siehe `docs/EINRICHTUNG.md`.
- **Mehrfach löschen:** Im Belegungsplan **Mehrere löschen** öffnen, einzelne Termine oder alle markieren und die Löschung bestätigen. Die Liste umfasst Termine aus allen Kalendern und Zeiträumen.
- **Überschneidungen aktivieren:** Bei bestehenden Supabase-Projekten einmal `supabase/migration-allow-booking-overlaps.sql` im SQL Editor ausführen. Neue Installationen erhalten das aktualisierte Schema.
- **Datenbank pausiert?** Wenn die Seite Fehler zeigt, im Supabase-Dashboard das Projekt mit **Restore** wieder aktivieren und prüfen, ob der Keepalive läuft.


## Ereignisse und E-Mail-Erinnerungen

Bearbeiter und Administratoren öffnen **Ereignisse** im Menü. Beim Anlegen ist **Jährliche Wiederholung** vorausgewählt; alternativ kann ein konkretes einmaliges Datum gewählt werden. Jahresereignisse werden über Tag und Monat wiederholt; am 29. Februar wird nur in Schaltjahren versendet. Einmalige Ereignisse werden am eingetragenen Datum versendet. Der Versand ist jeweils für 06:00 Uhr deutscher Zeit vorgesehen. Empfänger erhalten separate Nachrichten, damit ihre Adressen einander nicht offengelegt werden. Zustellversuche werden pro Empfänger und Ereignisdatum protokolliert; fehlgeschlagene Versuche können im nächsten Workflow-Lauf erneut versucht werden. Einmalige Ereignisse werden durch den GitHub-Workflow **Ereignisdaten nach drei Jahren bereinigen** nach Ablauf von drei Jahren samt ereignisspezifischen Dateien gelöscht; Originale aus der zentralen Dokumentenablage bleiben bestehen. Bei Jahresereignissen werden nur Durchläufe, Testanfragen und Versandprotokolle gelöscht, die älter als drei Jahre sind; die Wiederholungsregel und zukünftigen Versandtermine bleiben bestehen. Die Protokollbereinigung läuft über Supabase Cron; einmalige Ereignisse und Dateien über GitHub Actions, daher kann der Zeitplan etwas verzögert ausgeführt werden.

Bilder und PDFs werden in der privaten Dokumentenablage gespeichert. Bilder werden auf höchstens 1600 Pixel verkleinert. Einzeldateien und die Summe aller Ereignis-Anhänge bleiben auf 5 MB begrenzt. Wird ein Ereignis gelöscht, wird nur dessen Dokumentauswahl entfernt; die Originale bleiben in der Ablage. Ein Dokument, das noch einem Ereignis zugeordnet ist, lässt sich nicht endgültig löschen; es kann archiviert werden.

## Buchungsnachrichten und Erinnerungen

Beim Anlegen oder Bearbeiten eines Termins kann eine Kontakt-E-Mail-Adresse hinterlegt werden. Die automatische Erinnerung ist standardmäßig ausgeschaltet und kann auf 1, 2 oder 7 Tage vor dem Termin gestellt werden. Bestätigungen, Änderungen und Absagen werden an die Kontaktadresse gesendet; Erinnerungen werden durch den Workflow etwa alle fünf Minuten aus der geschützten Outbox verarbeitet. Der Versandstatus ist unter **GitHub > Actions > Buchungsnachrichten und Erinnerungen** zu prüfen. Ohne Kontaktadresse wird keine Buchungsnachricht versendet.

## Administration und Texte

Administratoren verwalten Mitglieder und Einladungen, Räume und Plätze, Änderungsprotokolle, Mailprofile, Vorlagen, Besuchertexte, Rechtstexte, Dokumente und die Navigationsreihenfolge unter **Administration**. Die Navigationspflege und der Weg zur Konfiguration bleiben immer sichtbar. Rechtstexte werden als Klartext angezeigt; vor Veröffentlichung müssen die Vorlagen vollständig angepasst und fachlich geprüft werden.

## Kalender abonnieren

Die öffentliche Seite **Kalender abonnieren** bietet einen schreibgeschützten iCalendar-Link für alle aktiven Ressourcen oder einen einzelnen Platz/Raum. Zum Bereitstellen der Supabase-Funktion siehe `docs/EINRICHTUNG.md`. Der Feed enthält keine internen Notizen oder Kontaktdaten; Kalenderprogramme rufen ihn regelmäßig ab.


Der Versand läuft serverseitig über GitHub Actions und Strato SMTP. Der technische Absender ist immer `vfb-app@vfb-groetzingen.de`; konfigurierbare Mailprofile setzen Anzeigename und Antwortadresse (`Reply-To`). In einem Ereignis kann unter „Testmail versenden“ eine Adresse eingetragen werden. Der Testauftrag wird in eine geschützte Warteschlange gestellt und üblicherweise innerhalb weniger Minuten verarbeitet. Das Versandprotokoll am Seitenende zeigt SMTP-Ablehnungen und Verarbeitungsfehler. Jeder Eintrag nennt Ereignisname, betroffenes Ereignisdatum und Empfängeradresse; das Ereignisprotokoll enthält zusätzlich den Status je Empfänger und den Fehlertext. Führe nach `migration-annual-email-log-context.sql` auch `migration-event-recurrence-retention-3-years.sql` aus und prüfe den neuen Cron-Job unter **Integrations > Cron** sowie den Bereinigungs-Workflow unter **GitHub > Actions**. Hinterlege `SUPABASE_SERVICE_ROLE_KEY`, `STRATO_SMTP_USER` und `STRATO_SMTP_PASSWORD` unter **GitHub > Settings > Secrets and variables > Actions**. Für `SUPABASE_SERVICE_ROLE_KEY` nimm den Supabase-Secret-API-Key (`sb_secret_…`); falls dein Projekt noch keine neuen Keys hat, den Legacy-Key `service_role`. Verwende dafür das Strato-Postfach des Vereins; schreibe Zugangsdaten niemals in Projektdateien. Den Workflow **Jährliche Ereignis-E-Mails** regelmäßig unter **Actions** auf erfolgreiche Läufe prüfen. Geplante GitHub-Läufe können verspätet sein oder nach längerer Inaktivität deaktiviert werden. Ein SMTP-Erfolg bedeutet, dass Strato die Nachricht angenommen hat; ein späterer Bounce des Empfänger-Mailservers wird über SMTP nicht zuverlässig an die Seite zurückgemeldet.

## Mehrere Ressourcen pro Termin

Beim Anlegen oder Bearbeiten eines Termins können mehrere Räume und Plätze markiert werden. Es bleibt ein gemeinsamer Termin, der in den Kalendern aller ausgewählten Ressourcen erscheint.
