# Micro-Epsilon · Sensor Monitor

Frontend der veröffentlichten Sensor-Monitor-Website für den optoNCDT 1420.

## Lokal starten

Voraussetzung: Python 3. Im Ordner `frontend` ausführen:

```sh
python3 -m http.server 4173 --directory dist --bind 127.0.0.1
```

Anschließend http://127.0.0.1:4173 öffnen. Alternativ mit installiertem Node.js: `npm start`.

## Dateien und Tests

`dist/` enthält den direkt bearbeitbaren HTML-, CSS- und JavaScript-Code sowie alle benötigten Schriftarten und Bibliotheken. Es ist kein Build und keine Paketinstallation nötig. Die Lizenzhinweise liegen unter `dist/vendor/` und `dist/assets/fonts/`.

Die vorhandenen Tests prüfen unter anderem Messbereich, Lernverhalten und CSV-/PDF-Export. Mit Node.js ab Version 20:

```sh
npm test
```

Demo-Daten und Einstellungen werden im Browser gespeichert. Echte Sensordaten werden über eine separat gestartete lokale Sensor-Bridge angebunden; der Server-Code für diese Bridge gehört nicht zu diesem Frontend. Details zur Verbindung zeigt die Anwendung.

Übernommener Website-Stand: Sites-Quellcommit `60e87ab19b761e3274ff6e893da933a7adda2846`.
