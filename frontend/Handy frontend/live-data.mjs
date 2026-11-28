import { describeError } from './recordings.mjs';

export function sensorState(status) {
  if (status?.status === 'error') return { label: 'Sensorfehler', detail: status.error, state: 'invalid' };
  if (status?.status !== 'streaming') return { label: 'Kein Sensor verbunden', state: 'unavailable' };
  // The backend's device check (backend/device.py) says what the device is. Only a verified, live, known device
  // gets the measurement elements; anything else is refused before a value is shown.
  const device = status.device;
  if (device && !device.verified) {
    return { label: 'Unbekanntes Gerät', detail: device.problems?.join(' · ') || 'Das Gerät konnte nicht geprüft werden.', state: 'invalid' };
  }
  if (device ? !device.live : !/^(serial-|ethernet-)|^(thermo-uc|medaqlib)$/.test(status.source ?? '')) {
    return { label: 'Keine Hardware-Messung aktiv', state: 'unavailable' };
  }
  const model = status.info?.model || 'Micro-Epsilon';
  const unit = device?.unit ?? status.info?.unit ?? (status.source === 'thermo-uc' ? '°C' : 'mm');
  return { model, unit, serial: status.info?.serial, source: status.source, family: device?.family, measures: device?.measures };
}

export function liveSample(frame, sensor) {
  if (frame?.source !== sensor.source || frame.status !== 'streaming' || !Number.isFinite(frame.t)) return null;
  if (sensor.family && (frame.device?.family !== sensor.family || frame.device.verified !== true)) return null;
  if (frame.info?.model && sensor.model !== 'Micro-Epsilon' && frame.info.model !== sensor.model) return null;
  if (frame.info?.serial && sensor.serial && frame.info.serial !== sensor.serial) return null;
  if ((frame.unit ?? frame.info?.unit ?? sensor.unit) !== sensor.unit) return null;
  let value = sensor.unit === '°C' ? frame.raw_value : frame.dist_from_face_mm;
  if (frame.current_valid !== true || !Number.isFinite(value)) value = null;
  const code = frame.last_error?.code;
  return { time: frame.t, value, error: value === null && code != null ? describeError(String(code)) : null };
}
