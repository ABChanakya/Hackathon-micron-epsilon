@echo off
rem Sensor Cockpit fuer Windows: richtet beim ersten Start die Python-Umgebung ein und startet den Messserver.
setlocal
cd /d "%~dp0backend" || exit /b 1
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv 2>nul || python -m venv .venv || (
    echo Python 3.10 oder neuer wurde nicht gefunden. Installiere es von https://www.python.org/downloads/
    echo und setze bei der Installation den Haken "Add python.exe to PATH".
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --quiet -r requirements.txt || (pause & exit /b 1)
rem Startet Messserver und Handy-Freigabe zusammen (wie start.sh); die Adressen erscheinen hier im Fenster.
".venv\Scripts\python.exe" "%~dp0frontend\Handy frontend\serve.py" --with-backend app:app --host 127.0.0.1 --port 8000 %*
