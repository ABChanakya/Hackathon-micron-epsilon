# Landing page (pitch)

A one-page showcase for the 5-minute pitch. Built with the ScrollCraft skill (grammar: split stage).
Brief and decisions: [BRIEF.md](BRIEF.md).

## Open it
```
cd scrollcraft/builds/landing
python3 -m http.server 4500
```
Then open http://localhost:4500. Opening `index.html` directly also works.

- **Language:** the switch at the top right, or `?lang=de|en|fr|es|it|cs|zh|ja|ko|pirate`.
- **Live mode** (the "Live schalten" button in the curve section): needs the project backend on port 8000 with a sensor
  connected (`backend/`, `/ws/bridge`). Without it the page says so and keeps playing the recording. If the backend is
  replaying a recording, the badge says "Wiedergabe", never "Live". Other address: `?ws=ws://host:8000/ws/bridge`.
- **"Monitor öffnen"** links to the monitor website at http://127.0.0.1:4173/ (start it from `frontend/`).
  Other address: `?monitor=http://...`.

## What is real
Every number comes from this repository: the ILD1900 recordings in `backend/recordings/` (reduced into `data.js`),
the info package (727 PDFs, 1,825-page MEDAQLib manual) and the ILD1900 manual (wire format p.79). The bytes on the
"Im Kabel" side are the exact RS422 encoding of the recorded readings. Product photos: Micro-Epsilon, from the
hackathon info package. Translations were written by Claude and not checked by native speakers.

## Files
`index.html` (markup and styles), `page.js` (translations, data panels, the scroll playback and live mode),
`i18n.js` (10 languages), `data.js` (reduced recordings), `scrollcraft.js/.css` (engine, unchanged), `assets/`.
