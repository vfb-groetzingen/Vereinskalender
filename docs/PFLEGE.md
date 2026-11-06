# Pflegeanleitung für Vereinsmitglieder

Diese Anleitung erklärt, wie Räume und Plätze im Vereinskalender verwaltet werden. Technische Kenntnisse sind nicht nötig.

---

## Was Besucher sehen

Jeder kann ohne Anmeldung:

- die **Startseite** mit allen Räumen und Plätzen,
- den **Kalender jedes Raums** (Tag, Woche, Monat),
- den **Belegungsplan** mit allen Plätzen im Zeitstrahl,
- für jeden Raum einen **QR-Code**, ein **druckbares DIN-A4-Plakat** und einen **Link**, z. B. zum Aushang am Raum.

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

**Wiederholungen:** Bei **Wiederholung** wöchentlich, alle zwei Wochen, monatlich oder jährlich wählen und die Gesamtzahl der Termine eintragen (max. 52 einschließlich des ersten Termins). Monatliche Serien bleiben am Kalendertag verankert; fehlt dieser Tag im Monat, wird der letzte Monatstag verwendet. Jährliche Termine am 29. Februar fallen in Nicht-Schaltjahren auf den 28. Februar. Die Termine werden einzeln gespeichert und einzeln auf Doppelbelegung geprüft.

## Doppelbelegung

Ein Platz kann zu einer Zeit nur einmal belegt werden. Wenn sich ein neuer Termin überschneidet, erscheint eine Meldung mit dem Namen des bestehenden Termins. Bitte dann eine andere Zeit wählen oder den Vorstand fragen.

Ein Termin, der genau um 18:00 Uhr endet, darf direkt ein Termin um 18:00 Uhr beginnen lassen.

## Termin bearbeiten oder löschen

1. Auf den Termin klicken (im Kalender oder im Belegungsplan).
2. **Bearbeiten** oder **Löschen** wählen.

Bei Serien gibt es zusätzlich **Ganze Serie löschen**. Bitte vorsichtig verwenden, es werden alle Termine der Serie entfernt.

## Mehrere Termine importieren (Excel oder CSV)

Nützlich für Trainingspläne, die bereits in einer Tabelle stehen.

1. Den gewünschten Raum- oder Platzkalender öffnen und auf **Spiele importieren** klicken.
2. Die CSV- oder XLSX-Beispieldatei im Dialog herunterladen.
3. Die Datei so ausfüllen, dass sie die Spalten `Start Date`, `Start Time` und `Subject` enthält. Ziel ist immer der geöffnete Kalender; jeder Eintrag reserviert 90 Minuten.
4. Die Datei auswählen und die **Vorschau** prüfen. Bei Fehlern wird die betroffene Zeile angezeigt, z. B.:
   - „Zeile 7: Das Datum „31.02.2026“ existiert nicht.“
   - „Zeile 12: Die Endzeit (10:00) liegt nicht nach der Startzeit (18:00).“
   - „Zeile 15: Die Ressource „Platz 3“ ist unbekannt.“
5. Erst wenn keine Fehler mehr angezeigt werden, auf **Importieren** klicken.

**Wichtig:** Der Import ist vollständig oder gar nicht. Bei einem Fehler wird nichts übernommen.

**Importformat:** CSV oder XLSX, Pflichtspalten `Start Date`, `Start Time`, `Subject`. Andere Spalten werden ignoriert. Datum z. B. `2026-10-25`, Uhrzeit `17:30`. Importiert wird nur, wenn alle Zeilen gültig und ohne Überschneidungen sind.

## Ansicht anpassen

Im **Belegungsplan** links können Sie Rubriken ein- und ausblenden. Die Farbe jeder Rubrik entspricht dem Balken im Zeitstrahl. Der linke Rand der Balken zeigt die Kategorie. Die Einstellung betrifft nur Ihre Ansicht und ändert keine Daten.

Mit **Kategorie** lassen sich Termine einer Art filtern. Mit den Pfeilen und dem Datumsfeld wechseln Sie den Zeitraum.

## QR-Code und Link

- Auf der Startseite oder im Raum-/Platzkalender **Plakat drucken** wählen. Das A4-Plakat enthält das unverzerrte VfB-Logo, das Motto und den QR-Code; über **Drucken** den Druckdialog öffnen.
- Mit **QR-Code laden** kann die SVG-Datei separat gespeichert werden; **Link kopieren** legt die Kalenderadresse in die Zwischenablage.

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

- **Räume/Plätze sortieren:** In der Administration die gewünschte Reihenfolgenzahl eintragen und **Speichern** wählen. Eine kleinere Zahl erscheint weiter oben; die Einstellung gilt für alle.
- **Deaktivieren:** In der Administration **Deaktivieren** wählen. Die Ressource verschwindet aus den Kalendern, Buchungen bleiben erhalten; über **Aktivieren** kann sie zurückgeholt werden.
- **Endgültig löschen:** Nur möglich, wenn keine aktuellen oder zukünftigen Termine mehr bestehen. Vergangene Buchungen werden endgültig gelöscht; Audit-Einträge bleiben. Vorher erscheint eine deutliche Bestätigung.
- **Neuen Raum/Platz anlegen:** Im Admin-Bereich hinzufügen. Für einen QR-Code zusätzlich den exakten Slug in `data/seed.json` eintragen und pushen; der QR-Workflow erstellt dann die SVG-Datei.
- **Mitglied einladen/Rolle ändern/Zugang entziehen:** Im Admin-Bereich der Website. Für den allerersten Admin ist die Einrichtung aus `ADMIN_EINRICHTUNG.md` erforderlich.
- **Sicherung:** Läuft wöchentlich automatisch. Einrichtung und Wiederherstellung siehe `docs/EINRICHTUNG.md`.
- **Datenbank pausiert?** Wenn die Seite Fehler zeigt, im Supabase-Dashboard das Projekt mit **Restore** wieder aktivieren und prüfen, ob der Keepalive läuft.
