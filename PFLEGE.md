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
   - **Notiz** (optional, nur für Mitglieder sichtbar).
4. Auf **Termin anlegen** klicken.

**Serien:** Für regelmäßige Termine das Feld **Wöchentliche Serie anlegen** aktivieren und die Anzahl eintragen (max. 52). Jeder Termin wird einzeln gespeichert.

## Doppelbelegung

Ein Platz kann zu einer Zeit nur einmal belegt werden. Wenn sich ein neuer Termin überschneidet, erscheint eine Meldung mit dem Namen des bestehenden Termins. Bitte dann eine andere Zeit wählen oder den Vorstand fragen.

Ein Termin, der genau um 18:00 Uhr endet, darf direkt ein Termin um 18:00 Uhr beginnen lassen.

## Termin bearbeiten oder löschen

1. Auf den Termin klicken (im Kalender oder im Belegungsplan).
2. **Bearbeiten** oder **Löschen** wählen.

Bei Serien gibt es zusätzlich **Ganze Serie löschen**. Bitte vorsichtig verwenden, es werden alle Termine der Serie entfernt.

## Mehrere Termine importieren (Excel oder CSV)

Nützlich für Trainingspläne, die bereits in einer Tabelle stehen.

1. Im **Belegungsplan** auf **Import (CSV/Excel)** klicken.
2. Die Vorlage herunterladen (Link im Dialog) und ausfüllen.
3. Die Datei auswählen.
4. Die **Vorschau** prüfen. Bei Fehlern wird genau angegeben, in welcher Zeile welches Problem liegt, z. B.:
   - „Zeile 7: Das Datum „31.02.2026“ existiert nicht.“
   - „Zeile 12: Die Endzeit (10:00) liegt nicht nach der Startzeit (18:00).“
   - „Zeile 15: Die Ressource „Platz 3“ ist unbekannt.“
5. Erst wenn keine Fehler mehr angezeigt werden, auf **Importieren** klicken.

**Wichtig:** Der Import ist vollständig oder gar nicht. Bei einem Fehler wird nichts übernommen.

**Format:**
- Pflichtspalten: Titel, Ressource, Kategorie, Datum, Start, Ende
- Optional: Notiz
- Datum: `25.10.2026` oder `2026-10-25`
- Uhrzeit: `17:30`
- Trennzeichen bei CSV: Semikolon (`;`) oder Komma

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

- **Neues Mitglied einladen:** Im Supabase-Dashboard unter *Authentication > Users > Invite user*. Danach die Rolle im SQL Editor vergeben (siehe `supabase/admin-setup.sql`).
- **Zugang entziehen:** Im SQL Editor die Zeile aus `memberships` löschen (Beispiel in `supabase/admin-setup.sql`). Das Konto kann danach keine Termine mehr ändern.
- **Neuer Raum oder Platz:** Eintrag in `data/seed.json` (und in der Datenbank unter *Table Editor > resources*) anlegen, danach den QR-Code neu erzeugen lassen.
- **Sicherung:** Läuft wöchentlich automatisch. Einrichtung und Wiederherstellung siehe `docs/EINRICHTUNG.md`.
- **Datenbank pausiert?** Wenn die Seite Fehler zeigt, im Supabase-Dashboard das Projekt mit **Restore** wieder aktivieren und prüfen, ob der Keepalive läuft.
