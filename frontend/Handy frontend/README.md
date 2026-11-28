# Micro-Epsilon · Mobiles Sensor Cockpit

Unter **Demodaten** läuft das Standardprofil „Abstand prüfen“ aus der Desktop-UI. Dieselbe Formel simuliert fünf Abstandswerte pro Sekunde um 25 mm. Die Simulation läuft lokal im Browser. Im Dropdown steht derzeit dieser eine Datensatz.

## Auf dem Handy öffnen

Starte im Stammordner des Repositorys den Handy-Server mit Python 3.

```sh
python "frontend/Handy frontend/serve.py"
```

Verbinde das Handy mit demselben WLAN wie den Rechner. Öffne dann [den Messplatz](http://10.19.233.145:4174/) oder scanne den [QR-Code](handy-qr.png). Beides führt direkt zur Messansicht. Bei einer anderen WLAN-Adresse ersetze `10.19.233.145` durch die IPv4-Adresse des Rechners. Unter Windows zeigt sie `ipconfig` beim WLAN-Adapter an. Der mitgelieferte QR-Code verwendet die oben angegebene Adresse.

## Echte Live-Daten sehen

1. Starte den vorhandenen Sensorserver am Rechner und verbinde den Sensor über die PC-Ansicht.
2. Öffne am Handy **Live-Daten**. Der Monitor zeigt den Sensor, den aktuellen Messwert und den Verlauf der letzten 15 Sekunden. Die Verbindung wird automatisch erneut abgefragt, wenn der Server oder der Sensor vorübergehend ausfällt.

Der Handy-Server liest standardmäßig vom Sensorserver auf Port 8000 desselben Rechners. Läuft dieser auf Port 8001, starte den Handy-Server mit `python "frontend/Handy frontend/serve.py" --backend-port 8001`. Die Desktop-Demo funktioniert auch bei rein statischer Bereitstellung dieses Verzeichnisses.

## Bedienung und Prüfungen

Die Zeitachse zeigt ein mitlaufendes 30-Sekunden-Fenster. Sie beginnt bei 00:00–00:30 und schiebt sich danach mit der Messzeit weiter. **Anzeige pausieren** hält die Darstellung an. Beim Fortsetzen zeigt die Demo wieder das aktuelle Zeitfenster. Farbschema, Schriftgröße, farbsehfreundlicher Modus und Sprachausgabe für Live-Statuswechsel stehen unter **Anzeige**.

Im Handy-Querformat füllt der Messgraph mit seinen Achsen den Bildschirm. Beim Zurückdrehen erscheinen die Bedienelemente wieder.

Die Tests vergleichen die Demo auf dem Handy direkt mit den Werten und Sollgrenzen der Desktop-UI. Sie prüfen außerdem, dass das 30-Sekunden-Fenster ohne Rücksprung durchläuft und nur Messpunkte des sichtbaren Zeitraums enthält.

Wiederhole die automatisierten Tests mit Node.js ab Version 20 aus diesem Ordner.

```sh
node --test tests/*.test.mjs
```
