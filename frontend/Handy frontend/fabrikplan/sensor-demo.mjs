import { loadRecording, Playback, recordingWindow } from '../recordings.mjs';

const sectionSeconds = 30;

export function recordingSection(recording, time) {
  const lastSection = Math.ceil(recording.duration / sectionSeconds) - 1;
  const start = Math.min(Math.floor(time / sectionSeconds), lastSection) * sectionSeconds;
  const end = start + sectionSeconds;
  const { samples } = recordingWindow(recording, time, time - start);
  return { start, end, duration: sectionSeconds, endOfData: time, samples };
}

export function createSensorDemo({ clock, onChange }) {
  let selected = null;
  let request;
  let playback;
  let profileClock;
  let autoplay = false;

  function clear() {
    request?.abort();
    request = undefined;
    playback = undefined;
    profileClock = undefined;
    selected = null;
    autoplay = false;
  }

  async function open(sensor, dataset) {
    clear();
    autoplay = true;
    selected = {
      sensor,
      dataset,
      name: sensor.model + (sensor.suffix ? ' · Messkopf ' + sensor.suffix : ''),
      status: sensor.file ? 'Demo-Aufzeichnung wird geladen …' : 'Keine passende Demo-Aufzeichnung vorhanden',
      statusType: '',
    };
    if (dataset) profileClock = { offset: 0, startedAt: clock() };
    onChange();
    if (dataset || !sensor.file) return;

    const controller = new AbortController();
    request = controller;
    try {
      const recording = await loadRecording(sensor, url => fetch(url, { signal: controller.signal }));
      if (controller.signal.aborted) return;
      if (recording.model !== 'ILD1900' || recording.unit !== sensor.unit) {
        selected.status = 'Keine passende Demo-Aufzeichnung vorhanden';
      } else {
        const context = sensor.quantity === 'Bauteilhöhe' ? 'Abstand am Stufenprofil' : 'Abstand ab Sensorfront';
        const averaging = sensor.suffix === 'A' ? 'Median 9' : 'Ohne Mittelung';
        selected.source = ['Demo-Aufzeichnung', recording.material, averaging, context].join(' · ');
        playback = new Playback(recording, { loop: false });
        if (autoplay) playback.start(clock());
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      selected.status = 'Demo-Aufzeichnung · ' + error.message;
      selected.statusType = 'unavailable';
    }
    onChange();
  }

  function profileFrame() {
    if (!profileClock) return null;
    const { offset, startedAt } = profileClock;
    const playing = startedAt !== null;
    return { playing, elapsed: offset + (playing ? clock() - startedAt : 0) };
  }

  function pauseProfile() {
    profileClock = { offset: profileFrame().elapsed, startedAt: null };
  }

  return {
    open,
    clear,
    get selected() { return selected; },
    get recording() { return playback?.recording; },
    frame() { return playback?.frame(clock()); },
    profileFrame,
    pause() {
      autoplay = false;
      if (profileClock) pauseProfile();
      if (playback?.frame(clock()).playing) playback.pause(clock());
    },
    toggle() {
      if (profileClock) {
        if (profileFrame().playing) pauseProfile();
        else profileClock.startedAt = clock();
        return;
      }
      if (!playback) return;
      const now = clock();
      if (playback.frame(now).playing) playback.pause(now);
      else playback.start(now);
    },
    restart() {
      if (profileClock) profileClock = { offset: 0, startedAt: clock() };
      else playback?.restart(clock());
    },
  };
}
