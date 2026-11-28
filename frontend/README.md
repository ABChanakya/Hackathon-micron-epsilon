# Micro-Epsilon · Sensor Cockpit

Browser-Messplatz für den optoNCDT 1900-10 und thermoMETER UC. Die Sensorverbindung schaltet Einheit, Messbereich und Profile automatisch zwischen mm und °C um. Aufzeichnungen behalten beim Sensorwechsel ihre eigene Einheit. Der Sensor erfasst Abstände von 20 bis 30 mm ab Sensorfront. Laufende Messungen lassen sich mit Zeitmarken aufzeichnen, vergleichen und als CSV oder PDF exportieren.

Das interaktive 3D-Modell orientiert sich an Maßzeichnung und Bedienfeld der Betriebsanleitung. Die Montagebohrungen, Optik, Kabeldurchführung und LEDs sind am Modell dargestellt. Das Kabel ist für die Bildschirmansicht gekürzt. Beim Klick auf eine LED erscheint ihre Bedeutung. [Betriebsanleitung, S. 18–19, 31 und 33](https://www.micro-epsilon.de/fileadmin/download/manuals/man--optoNCDT-1900--de.pdf)

## Starten

Im Repository mit Python 3.10 oder neuer:

```sh
./start.sh
```

Öffne anschließend http://127.0.0.1:8000/ und wähle **Sensor verbinden**. Alternativ startet `npm start` im Ordner `frontend/` denselben Messserver. Dashboard, API und WebSocket teilen sich einen Ursprung. Läuft im Backend bereits ein Sensor (optoNCDT in mm oder thermoMETER in °C), zeigt der Monitor ihn sofort an.

HTML, CSS, JavaScript, Schriften und Bibliotheken liegen in `dist/`. Für eine reine statische Ansicht steht `npm run start:static` bereit; Live-Daten benötigen den Messserver am selben Ursprung, auf Port 8000 oder über einen passenden Proxy.

## Datenquelle

Standardmäßig wird die Live-Verbindung geprüft. Die Demo wird ausdrücklich über **Einstellungen → Datenquelle** aktiviert und zeigt fünf simulierte Werte pro Sekunde. Die Profilrate beschreibt die vorgesehene Sensoreinstellung. Der Sensor bietet sieben feste Messraten von 250 Hz bis 10 kHz. Aufzeichnungen und Profile liegen im Browser. Wiedergaben bleiben auch in neu erstellten Aufnahmen und Exporten als Wiedergabe gekennzeichnet.

## Einstellungen und Sprache

Das Zahnrad oben rechts öffnet Datenquelle, Sprache, Farbschema, Messprofil und Hilfe. Das Micro-Epsilon-Logo oben links führt zur Hauptseite zurück.

Die Sprachwahl gilt für Cockpit, Aufzeichnungen, Einrichtung, Dialoge und Hauptseite. Unterstützt werden Deutsch, Englisch, Französisch, Spanisch, Italienisch, Tschechisch, Chinesisch, Japanisch, Koreanisch und Pirate. Die Auswahl wird in diesem Browser gespeichert und mit der Hauptseite geteilt. Eigene Profilnamen, Aufnahmen und Notizen bleiben unverändert.

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

## Assistentenvorschau

Der Assistent in der Kopfzeile öffnet eine Vorschau mit Fragen, Fehlererklärungen, Diagrammzusammenfassungen und Parameterbefehlen. Am Cockpit-Diagramm und an Sensorhinweisen gibt es direkte Einstiege. Die Vorschau berücksichtigt alle zehn Oberflächensprachen.

`dist/assistant.js` stellt die vier asynchronen Funktionen `askQuestion`, `explainError`, `explainChart` und `parseParameterCommand` bereit. Aktuell liefern sie lokale Beispielantworten ohne Netzwerkzugriff. `dist/assistant-ui.js` erhält aktuelle Sensor-, Profil- und Diagrammdaten über drei Callback-Funktionen. Die Diagrammfunktion steht im Cockpit zur Verfügung und erklärt dessen sichtbaren Zeitraum.

Parameterbefehle erzeugen einen Vorschlag. Bestätigen und Verwerfen sind vollständig durchspielbar; auch eine Bestätigung verändert weder Profil noch Hardware. Vor der Bestätigung werden Sensor, Einheit, Profilversion und bisheriger Wert erneut geprüft. Für die spätere Backend-Anbindung kann der Mock-Client ersetzt werden, ohne den Drawer umzubauen.

## Tests

Mit Node.js ab Version 20:

```sh
npm test
```

Die Tests decken Sensorbereich, Übernahme vorhandener Aufzeichnungen, Datenformate der Messbrücke, Auswertungsgrenzen und CSV-/PDF-Export ab.
