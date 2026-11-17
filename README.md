# Vereinskalender – Dokumentenablage: Drag-and-drop und Titelpflege

## Enthaltene Änderungen
- Dateien können in einen Drop-Bereich gezogen oder weiterhin per Dateiauswahl gewählt werden.
- Pro Upload wird eine Datei verarbeitet; Titel und Dateigröße werden angezeigt.
- Der Titel wird beim Auswählen der Datei aus dem Dateinamen vorgeschlagen, kann vor dem Upload geändert und später durch Administratoren bearbeitet werden.
- Unterstützt bleiben JPEG, PNG, WebP und PDF; das bestehende Größenlimit und die Bildkomprimierung bleiben erhalten.

## Einspielen
Im bestehenden Vereinskalender-Projekt die drei Dateien aus diesem ZIP an denselben relativen Pfaden ersetzen:
- `assets/js/admin-config.js`
- `assets/js/data.js`
- `assets/css/style.css`

Anschließend die Änderungen wie gewohnt über GitHub Pages veröffentlichen. Eine zusätzliche SQL-Migration ist für diese UI-Änderung nicht erforderlich; das bestehende `event_documents`-Schema erlaubt Administratoren bereits, Dokumente zu aktualisieren.
