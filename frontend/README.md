# Micro-Epsilon · Sensor Monitor

Browser-Messplatz für den optoNCDT 1900-10. Der Sensor erfasst Abstände von 20 bis 30 mm ab Sensorfront. Laufende Messungen lassen sich mit Zeitmarken aufzeichnen, vergleichen und als CSV oder PDF exportieren.

Das interaktive 3D-Modell orientiert sich an Maßzeichnung und Bedienfeld der Betriebsanleitung. Die Montagebohrungen, Optik, Kabeldurchführung und LEDs sind am Modell dargestellt. Das Kabel ist für die Bildschirmansicht gekürzt. Beim Klick auf eine LED erscheint ihre Bedeutung. [Betriebsanleitung, S. 18–19, 31 und 33](https://www.micro-epsilon.de/fileadmin/download/manuals/man--optoNCDT-1900--de.pdf)

## Starten

Im Projektordner mit Python 3:

```sh
python3 -m http.server 4173 --directory dist --bind 127.0.0.1
```

Öffne anschließend http://127.0.0.1:4173/. HTML, CSS, JavaScript, Schriften und Bibliotheken liegen in `dist/`. Der Ordner kann direkt mit einem statischen Webserver bereitgestellt werden.

## Datenquelle

Die Demo zeigt fünf simulierte Werte pro Sekunde. Die Profilrate beschreibt die vorgesehene Sensoreinstellung. Der Sensor bietet sieben feste Messraten von 250 Hz bis 10 kHz. Aufzeichnungen und Profile liegen im Browser.

### Messbrücke

Unter **Einstellungen** gibst du die WebSocket-Adresse der Messbrücke ein, beispielsweise `ws://localhost:8765`. Bei einer per HTTPS geöffneten Seite kann WSS nötig sein.

Die Messbrücke sendet den absoluten Abstand ab Sensorfront:

```json
{
  "value": 25.001,
  "unit": "mm",
  "sensor": "optoNCDT 1900-10",
  "state": "green",
  "output": "green"
}
```

`value` liegt im Bereich 20–30 mm. Die optionalen LED-Felder verstehen `green`, `yellow`, `red`, `off` und `unknown`.

Das Projekt-Backend kann über `ws://localhost:8000/ws/stream` angebunden werden, wenn der Browser auch dessen `/api/status` lesen kann. Dort prüft der Monitor Modell und Messbereich. Verwende bei einem lokalen Aufbau denselben Ursprung oder einen dafür konfigurierten Proxy. Der Monitor liest `dist_from_face_mm`, also den Abstand ab Sensorfront ohne Nullpunktverschiebung.

## Tests

Mit Node.js ab Version 20:

```sh
npm test
```

Die Tests decken Sensorbereich, Übernahme vorhandener Aufzeichnungen, Datenformate der Messbrücke, Auswertungsgrenzen und CSV-/PDF-Export ab.
