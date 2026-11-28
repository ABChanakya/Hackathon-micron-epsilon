# Micro-Epsilon · Mobiles Sensor Cockpit

Unter **Demodaten** läuft das Standardprofil „Abstand prüfen“ aus der Desktop-UI. Dieselbe Formel simuliert fünf Abstandswerte pro Sekunde um 25 mm. Die Simulation läuft lokal im Browser. Im Dropdown steht derzeit dieser eine Datensatz.

## Auf dem Handy öffnen

Starte im Stammordner des Repositorys die Messsoftware:

```sh
./start.sh
```

Verbinde den Sensor im Desktop-Cockpit. Verbinde das Handy mit demselben WLAN wie den Rechner und öffne die
Adresse unter **Einstellungen → Verbindung → Auf dem Handy öffnen**. Sie erscheint beim Start auch im
Terminal unter **Handy im gleichen WLAN**. Im Handy-Browser startet **PC-Messung** automatisch und
zeigt denselben Messdatenstrom mit Modell, Messwert und Einheit an. Strg+C beendet beide Dienste.

Wenn der Messserver bereits läuft, kannst du die Handy-Freigabe einzeln starten:

```sh
python3 "frontend/Handy frontend/serve.py"
```

Der Handy-Server liest den Messserver auf demselben Rechner, standardmäßig auf Port 8000. Für einen anderen
Messserver verwende beispielsweise `--backend-port 8001`. Der veröffentlichte Handy-Port ist normalerweise
4174. Ist er belegt, wählt der Server einen freien Port und zeigt die vollständige Adresse an. Mit
`--port 4180` kannst du den Handy-Port fest vorgeben.

## Fabrikplan: Plan und Modulansicht

Unter **Fabrikplan anzeigen** zeigt die Gesamtansicht den Hallenplan mit den Modulen (Stationen). Hineinzoomen (**+**,
zwei Finger auseinander, Strg + Mausrad oder Antippen einer Gruppe) wechselt zur **Modulansicht**: Jede Station wird
eine Kachel, und die Kacheln behalten ihre Lage aus dem Plan (was rechts oben liegt, bleibt rechts oben). Herauszoomen
(**−**, zwei Finger zusammen) zeigt wieder den Plan. Die Kachelgröße ist einstellbar (klein, mittel, groß).

Jede Kachel zeigt ihre Sensoren mit einem simulierten Messwert. Liegt ein Wert außerhalb seiner Grenzen, **blinkt das
Modul rot**, in der Modulansicht und auf dem Plan. Nach dem Ende des Ausschlags bleibt es rot umrandet, bis jemand
**Alarm quittieren** antippt. **Fehler simulieren** lässt nacheinander je einen Sensor ausschlagen (Demo und Test).
Bei reduzierter Bewegung (Systemeinstellung) blinkt nichts, das Modul ist dann dauerhaft rot; der Text sagt den
Zustand immer zusätzlich an.

## Bedienung und Prüfungen

Die Zeitachse zeigt ein mitlaufendes 30-Sekunden-Fenster. Sie beginnt bei 00:00–00:30 und schiebt sich danach mit der Messzeit weiter. **Anzeige pausieren** hält die Darstellung an. Beim Fortsetzen zeigt die Demo wieder das aktuelle Zeitfenster. Farbschema, Schriftgröße, farbsehfreundlicher Modus und Sprachausgabe für Live-Statuswechsel stehen unter **Anzeige**.

Im Handy-Querformat füllt der Messgraph mit seinen Achsen den Bildschirm. Beim Zurückdrehen erscheinen die Bedienelemente wieder.

Die Tests vergleichen die Demo auf dem Handy direkt mit den Werten und Sollgrenzen der Desktop-UI. Sie prüfen außerdem, dass das 30-Sekunden-Fenster ohne Rücksprung durchläuft und nur Messpunkte des sichtbaren Zeitraums enthält.

Wiederhole die automatisierten Tests mit Node.js ab Version 20 aus diesem Ordner.

```sh
node --test tests/*.test.mjs
```
