import { describeError } from './recordings.mjs';

const sources = {
  hardware: 'Sensor',
  simulator: 'Simulator',
  replay: 'Wiedergabe',
};

export function sensorState(status) {
  if (status?.status === 'error') return { label: 'Sensorfehler', detail: status.error, state: 'invalid' };
  if (status?.status !== 'streaming') return { label: 'Kein Sensor verbunden', state: 'unavailable' };

  const {device, source} = status;
  const info = status.info || {};
  if (device && !device.verified) {
    return { label: 'Unbekanntes Gerät', detail: device.problems?.join(' · ') || 'Das Gerät konnte nicht geprüft werden.', state: 'invalid' };
  }
  let origin;
  if (source === 'replay') origin = 'replay';
  else if (source === 'sim') origin = 'simulator';
  else if (/^(serial-|ethernet-)|^(thermo-uc|medaqlib)$/.test(source)) origin = 'hardware';
  if (!origin || (device && (device.origin !== origin || device.live !== (origin === 'hardware')))) {
    return { label: 'Keine Hardware-Messung aktiv', state: 'unavailable' };
  }
  const unit = device?.unit ?? info.unit ?? (source === 'thermo-uc' ? '°C' : 'mm');
  const lower = unit === '°C' ? info.range_min ?? -50 : info.smr_mm;
  const upper = unit === '°C' ? info.range_max ?? 900 : lower + info.range_mm;
  return {
    model: info.model || 'Micro-Epsilon', unit, serial: info.serial, source, origin, sourceLabel: sources[origin],
    family: device?.family, measures: device?.measures, lower, upper,
  };
}

export function liveSample(frame, sensor) {
  if (frame?.source !== sensor.source || frame.status !== 'streaming' || !Number.isFinite(frame.t)) return null;
  if (sensor.family && (frame.device?.family !== sensor.family || frame.device.verified !== true || frame.device.origin !== sensor.origin)) return null;
  if (frame.info?.model && sensor.model !== 'Micro-Epsilon' && frame.info.model !== sensor.model) return null;
  if (frame.info?.serial && sensor.serial && frame.info.serial !== sensor.serial) return null;
  if ((frame.unit ?? frame.info?.unit ?? sensor.unit) !== sensor.unit) return null;
  const value = sensor.unit === '°C' ? frame.raw_value : frame.dist_from_face_mm;
  const led = sensor.unit === 'mm' ? frame.state_flags?.led ?? frame.state : undefined;
  const invalidSignal = frame.current_valid !== true || frame.n === 0 || led === 'red' || led === 'off' || Boolean(frame.error);
  const outsideRange = value < sensor.lower || value > sensor.upper;
  const valid = !invalidSignal && Number.isFinite(value) && !outsideRange;
  const code = frame.last_error?.code;
  return { time: frame.t, value: valid ? value : null, error: !valid && code != null && invalidSignal ? describeError(String(code)) : null };
}
