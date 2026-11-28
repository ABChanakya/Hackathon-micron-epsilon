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
echo Micro-Epsilon Live-Monitor: http://127.0.0.1:8000/
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000 %*
