# Lokaler Sensor-Assistent

Der Assistent nutzt Ollama auf demselben Rechner wie den Messserver. Das vorgesehene
Modell ist `qwen3:4b-instruct`; ein externer API-Key ist nicht erforderlich. Der
Browser spricht mit `/api/assistant/…` des Messservers. Ollama bleibt auf Loopback
und wird nicht direkt für das Handy oder andere WLAN-Geräte freigegeben.

## Einrichtung und Start

Voraussetzungen: Python 3 und eine vorhandene Ollama-Installation. Unter macOS
findet das Script auch `/Applications/Ollama.app/Contents/Resources/ollama`, wenn
`ollama` nicht im `PATH` liegt. Es installiert keine systemweiten Programme und
ändert keine `launchctl`-Einstellungen.

Vom Repository aus einmal mit Internetzugang:

```sh
./scripts/start-assistant.sh setup
```

Nur diese ausdrückliche `setup`-Aktion ruft `ollama pull` auf. Sie kann einen
vorhandenen Modelltag aktualisieren. Das aktuelle
[Ollama-Modellangebot](https://ollama.com/library/qwen3:4b-instruct) beschreibt den
4B-Instruct-Tag mit etwa 2,5 GB Modelldaten; der tatsächliche Arbeitsspeicherbedarf
enthält zusätzlich Kontext und Runtime. Für den 16-GB-Mac ist dieser Tag die hier
gewählte Ausgangskonfiguration; die Antwortzeit wird auf dem Zielrechner gemessen.

Danach bei jedem Start:

```sh
./scripts/start-assistant.sh start
export ASSISTANT_OLLAMA_URL=http://127.0.0.1:11434
export ASSISTANT_MODEL=qwen3:4b-instruct
./start.sh
```

`start` lädt kein Modell herunter. Bei fehlendem Modell beendet es sich mit
Exitcode 2 und verweist auf `setup`. `./start.sh` startet weiterhin ausschließlich
den Messserver; es installiert keine Modelle und startet Ollama nicht automatisch.
Die Exporte gelten für den anschließend gestarteten Messserver. Ein bereits
laufender Messserver muss für geänderte Umgebungsvariablen neu gestartet werden.

Das Hilfsscript verwendet einen erreichbaren Ollama-Dienst weiter. Andernfalls
startet es `ollama serve` als Hintergrundprozess mit `OLLAMA_NO_CLOUD=1` und dem
Loopback-Endpunkt aus `ASSISTANT_OLLAMA_URL`. Log und eigene PID liegen in
`.runtime/assistant/ollama.log` und `.runtime/assistant/ollama.pid`. Die Modelle
bleiben im Ollama-Modellspeicher außerhalb des Repositories; `.runtime/` ist
ebenfalls von Git ausgeschlossen.

Bei einem **bereits laufenden Dienst** ändert die Client-Umgebung dessen
Cloud-Konfiguration nicht. Für den ausdrücklich cloudfreien Betrieb einen zuvor
über die macOS-App gestarteten Dienst in der App beenden und anschließend das
Hilfsscript starten. Im neuen Serverlog lässt sich der deaktivierte Cloudmodus
prüfen. Dass diese Einstellung im Serverprozess gelten muss, erklärt die
[Ollama-Dokumentation](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).
Zum Beenden eines vom Script gestarteten Dienstes zuerst PID und Prozessbefehl
prüfen und dann genau diesen eigenen `ollama serve`-Prozess beenden; ein
weiterverwendeter Dienst wird vom Script weder beendet noch umkonfiguriert.

Optionale Scriptvariablen: `OLLAMA_BIN` für einen ausdrücklich angegebenen
CLI-Pfad und `ASSISTANT_RUNTIME_DIR` für Log/PID/Modellprotokoll. Ein abweichender
`ASSISTANT_OLLAMA_URL` muss eine HTTP-Loopback-Adresse mit explizitem Port sein.
Statusprüfungen umgehen HTTP-Proxys für diese lokalen Aufrufe.

## Status und reproduzierbarer Modellstand

```sh
./scripts/start-assistant.sh status
curl -fsS http://127.0.0.1:8000/api/assistant/status
```

`status` startet keinen Dienst und lädt kein Modell. Exitcode 0 bedeutet, dass
Ollama und der konfigurierte Modelltag vorhanden sind; 1 bedeutet einen
Dienst-/Konfigurationsfehler, 2 ein fehlendes Modell. Vorhandene Modelldaten sind
noch kein erfolgreicher Inferenztest: Dafür anschließend eine echte Chat-Anfrage
aus dem Monitor ausführen.

Nach erfolgreichem `setup` enthält `.runtime/assistant/model.json` den vollständigen
Modellnamen, Digest, Größe, Quantisierung, Ollama-Version und Erfassungszeit. Der
Digest stammt aus der lokalen [Modellliste von Ollama](https://docs.ollama.com/api/tags).
Für Demo, Benchmark und erneute Bereitstellung diesen JSON-Stand zusammen mit
dem Git-Commit protokollieren. Vor dem nächsten Vergleich `status` aufrufen und
den Digest mit dem aufgezeichneten Stand abgleichen. Ein gleicher Tag allein
garantiert keinen gleichen Modellstand; daher nicht vor jedem normalen Start
erneut `setup` ausführen. Modellgewichte gehören nicht in Git.

## Schnittstellen und Grenzen

| Methode/Pfad | Aufgabe |
|---|---|
| `GET /api/assistant/status` | Verfügbarkeit des lokalen Dienstes und Modells anzeigen |
| `POST /api/assistant/chat` | Fragen zur App und zum übergebenen Sensorkontext beantworten |
| `POST /api/assistant/explain-error` | Übergebene Fehler mit Ursache, Auswirkung und nächsten Schritten erklären |
| `POST /api/assistant/explain-chart` | Den übergebenen, zeitlich festgehaltenen Diagrammausschnitt erklären |
| `POST /api/assistant/command` | Eine natürlichsprachliche Anfrage als Parametervorschlag simulieren |

Parameterbefehle bleiben **Simulation**. Sie führen keine Hardware-, Messprofil-
oder ML-Änderung aus. Ein erzeugter Vorschlag und eine bestätigte simulierte
Vorschau sind keine Sensorbestätigung.

Das Fachwissen besteht aus kuratierten App-Informationen, Sensor-Metadaten und
den ausdrücklich übergebenen Mess-/Fehlerdaten. Dazu kommen kurze, manuell
geprüfte Handbuchparaphrasen in `assistant_sensor_knowledge.py`: optische
Triangulation und Oberflächeneinflüsse für ILD1900-10 sowie Infrarotmessung,
Messfleck und Emissionsgrad für thermoMETER UC-SF22. `facts_for(sensor)` und
`sources_for(sensor)` binden diese Auszüge an die bekannten Sensor-IDs;
unbekannte IDs erhalten keine Hardwarefakten. App-Meldungen wie `INVALID_SIGNAL`
werden ausdrücklich nicht als Herstellerfehlernummern ausgelegt.

Geprüfte Originalquellen, Abruf am **2026-11-28** (gedruckte Seitenzahlen):

- [optoNCDT 1900 – Operating Instructions](https://www.micro-epsilon.de/fileadmin/download/manuals/man--optoNCDT-1900--en.pdf): Kapitel 3.1, S.16; 5.1.1–5.1.2, S.25–28; 7.4.8, S.69; A3.4, S.131–132.
- [thermoMETER UC – Betriebsanleitung](https://www.micro-epsilon.de/fileadmin/download/manuals/man--thermoMETER-UC--de.pdf): Kapitel 2.1–2.2, S.7; 4.1, S.10; 10, S.33; 11.1–11.3, S.34.

Im Repository liegen keine vollständigen Handbücher und kein Handbuch-RAG-Index.
Die kurzen Auszüge ersetzen keine vollständige Micro-Epsilon-Dokumentation.
Das Modell soll fehlende Angaben benennen und keine Hardwareaktionen ableiten.
Empfehlungen bleiben an Sensortyp, Einheit und Datenquelle gebunden; ohne
Live-Verbindung werden Demo und Wiedergabe entsprechend beschrieben.

## Offlinebetrieb und Fehlerprüfung

Nach Installation der Python-Abhängigkeiten und dem einmaligen Modelldownload
kann die lokale Inferenz ohne Internet laufen. Weder `start` noch `status`
veranlassen einen Download. Für die Offlineprobe Netzwerkzugang trennen, Ollama
mit dem lokalen Modell starten und über den Monitor eine Antwort erzeugen. Dabei
den Backendstatus kontrollieren: Ein nicht verfügbarer LLM-Dienst muss erkennbar
bleiben; lokale Hilfetexte sind kein Nachweis einer Modellantwort.

Wenn Ollama nicht erreichbar ist, zuerst `start-assistant.sh status` und das
Serverlog prüfen. Bei fehlendem Modell einmal ausdrücklich `setup` mit Internet
ausführen. Bei einem anderen Modell die gleiche `ASSISTANT_MODEL`-Kennung beim
Hilfsscript und im Messserver verwenden. Sensorverbindung, Aufzeichnung und
Diagramme sind von der Ollama-Verfügbarkeit unabhängig.

## Benchmark auf dem Zielrechner

Keine Antwortzeit allein aus der Modellgröße ableiten. Für einen reproduzierbaren
Vergleich Modellprotokoll, Git-Commit, Rechner/RAM, verwendete Backendoptionen,
Sprache und vollständigen Request festhalten. Einen kalten Aufruf direkt nach dem
Modellladen getrennt von mindestens fünf gleichartigen warmen Aufrufen messen.
Den ersten kalten Aufruf nicht in den Median der warmen Antworten aufnehmen.

Im Monitor die gleichen drei Fälle prüfen: eine Bedienfrage, eine Fehlererklärung
und eine Diagrammerklärung mit festgehaltenem Datenfenster. Dauer und Antwort je
Fall erfassen; zusätzlich Herkunft/Modellkennung aus der Backendantwort prüfen.
Ausreißer und Fehler mitprotokollieren. Ein einzelner ungefährlicher Chat-Aufruf
mit explizitem Demo-Kontext lässt sich beispielsweise so messen:

```sh
curl -fsS http://127.0.0.1:8000/api/assistant/chat \
  -H 'Content-Type: application/json' \
  -d '{"text":"Wie starte ich eine Aufnahme?","language":"de","history":[],"context":{"source":"demo","connected":false,"valid":false,"sensor":{"id":"ild1900","model":"optoNCDT ILD1900-10","unit":"mm"}}}' \
  -w '\nHTTP %{http_code}; Gesamtzeit %{time_total} s\n'
```

Die Antwort enthält `model`, `createdAt`, `knowledgeSources` und `answerText`.
`createdAt` ist ein Erstellungszeitpunkt, keine Laufzeitmessung. Der aktuelle
Backendvertrag stellt keine Tokenzähler oder getrennte Ladezeit bereit; aus der
HTTP-Zeit lässt sich keine Tokenrate berechnen. Ein Zeitlimit oder ein lokaler
Ersatztext zählt nicht als erfolgreiche Modellantwort. Hardwarebefehle gehören
nicht in diesen Benchmark.

## Runtime-Tests ohne Ollama oder Hardware

Vom Repository aus:

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -p test_assistant_runtime.py -v
```

Die zehn Tests prüfen das Shellscript mit einer Fake-CLI, temporären Dateien und
kurzlebigen Loopback-Testservern. Sie laden keine Modelle, kontaktieren keine echte
Ollama-Instanz und öffnen keine Sensoranschlüsse. Die Datei ist auch Teil der
regulären Backend-unittest-Suite; zusätzliche Testframeworks sind nicht nötig.
