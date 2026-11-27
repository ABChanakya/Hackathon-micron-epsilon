# Micro-Epsilon · Sensor Monitor

Browser-Messplatz für den optoNCDT 1420-25. Im Messplatz kannst du Abstände verfolgen und Aufnahmen mit Zeitmarken versehen. Unter **Aufzeichnungen** lassen sich Messungen wiedergeben, vergleichen und als CSV oder PDF exportieren.

## Starten

Im Projektordner mit Python 3:

```sh
python3 -m http.server 4173 --directory dist --bind 127.0.0.1
```

Öffne anschließend http://127.0.0.1:4173/. HTML, CSS, JavaScript, Schriften und Bibliotheken liegen in `dist/`. Du kannst diesen Ordner direkt mit einem statischen Webserver bereitstellen.

## Datenquelle

Die Demo zeigt fünf simulierte Werte pro Sekunde. Die Profilrate beschreibt die vorgesehene Sensoreinstellung. Akzeptierte Abweichungen können die Auswertungsgrenzen erweitern. Messwerte und Sollgrenzen bleiben dabei erhalten.

Für echte Messwerte braucht der Browser eine Messbrücke, die den Sensor ausliest. Unter **Einstellungen** kannst du die WebSocket-Adresse eintragen, zum Beispiel `ws://localhost:8765`. Bei einer per HTTPS geöffneten Seite kann eine WSS-Verbindung nötig sein.

Die Messbrücke sendet Nachrichten in diesem Format:

```json
{
  "value": 37.501,
  "unit": "mm",
  "sensor": "optoNCDT 1420-25",
  "state": "green",
  "output": "green"
}
```

`value` ist eine endliche Zahl zwischen 25 und 50 mm. Falls die Nachricht `sensor` enthält, prüft die Anwendung das Modell. Die LED-Felder akzeptieren `green`, `yellow`, `red`, `off` und `unknown`. Die 3D-Ansicht zeigt ein Schema des Sensors. Die Bedeutung der LEDs steht im [Sensorhandbuch](https://www.micro-epsilon.com/fileadmin/download/manuals/man--optoNCDT-1420--en.pdf).

Aufzeichnungen und Profile liegen im Browser. Exportiere wichtige Aufnahmen als Datei, bevor du die Browserdaten löschst.

## Tests

Mit Node.js ab Version 20:

```sh
npm test
```

Die Tests decken Messbereich, Auswertungsgrenzen, Browser-Speicherung und CSV-/PDF-Export ab.
