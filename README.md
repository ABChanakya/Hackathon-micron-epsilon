# Micro-Epsilon · Sensor Monitor

Live-Messplatz für den optoNCDT 1900-10 mit Diagramm, Aufzeichnung und CSV-/PDF-Export.

## Start

Python 3.10 oder neuer muss installiert sein. Im Repository:

```sh
./start.sh
```

Der erste Start installiert die Python-Abhängigkeiten in `backend/.venv`.
Öffne anschließend **http://127.0.0.1:8000/** und klicke auf **Sensor verbinden**.
Der Anschluss wird automatisch gefunden; bei mehreren USB-Geräten wählst du ihn aus.
Schließe vorher sensorTOOL oder andere Programme, die denselben Sensor verwenden.
Eine bereits aktive Backend-Verbindung wird beim Öffnen sofort angezeigt.

Das Dashboard verwendet standardmäßig echte Sensordaten. Ohne Messserver oder Sensor
zeigt es den Verbindungsstatus; die Demo lässt sich über die Datenquellenauswahl aktivieren.
Wiedergaben sind als solche gekennzeichnet. Bei ungültigem Signal erscheint kein alter
Messwert. Nach einem Verbindungsabbruch versucht der Monitor, sich erneut zu verbinden.

Dashboard, API und WebSocket laufen auf demselben Server. Mit Strg+C beendest du ihn;
der Sensor erhält dabei seine ursprünglichen Ausgabeeinstellungen zurück.
Die separate Diagnoseansicht liegt unter http://127.0.0.1:8000/diagnostics/.
Die neue Präsentationsseite erreichst du unter http://127.0.0.1:8000/pitch/.

## Prüfen

```sh
npm test --prefix frontend
backend/.venv/bin/pip install -r backend/requirements-dev.txt
(cd backend && .venv/bin/python -m unittest discover -s tests -v)
```

Weitere Details: [Frontend](frontend/README.md), [Backend](backend/README.md), [API](backend/API.md).
