/**
 * Build a visible slope series from chronological measurement points (t in seconds).
 * Null values explicitly break chart paths. breakBefore also resets the regression.
 * The sign-preserving slope is a trailing 1 s least-squares trend in sensorUnit/s.
 * zeroOffset may be passed by callers; a constant display offset cannot change dy/dt.
 */
export function buildSlopeSeries(points, {
  start = -Infinity, end = Infinity, sensorUnit = 'mm', connected = true, valid = true,
  maxGapSeconds = 1, regressionWindowSeconds = 1,
} = {}) {
  const slope = { points: [], unit: `${sensorUnit}/s`, available: false };
  if (!connected || !valid || !Array.isArray(points) || start > end) return slope;
  const gapLimit = Number.isFinite(maxGapSeconds) && maxGapSeconds > 0 ? maxGapSeconds : 1;
  const windowSeconds = Number.isFinite(regressionWindowSeconds) && regressionWindowSeconds > 0 ? regressionWindowSeconds : 1;
  let previousTime = null;
  let pendingBreak = false;
  let window = [];
  const append = (t, value) => {
    if (t >= start && t <= end) slope.points.push({ t, value });
  };

  for (const point of points) {
    const t = point?.t;
    if (!Number.isFinite(t)) {
      window = [];
      pendingBreak = true;
      continue;
    }
    if (t > end) continue;
    const interrupted = previousTime !== null && (pendingBreak || point.breakBefore || t <= previousTime || t - previousTime > gapLimit);
    if (interrupted) {
      window = [];
      append(t, null);
    }
    pendingBreak = false;
    previousTime = t;
    if (!Number.isFinite(point.value) || point.valid === false || point.current_valid === false || point.connected === false || point.error) {
      window = [];
      append(t, null);
      continue;
    }

    window.push({ t, value: point.value });
    window = window.filter(sample => sample.t >= t - windowSeconds);
    let trend = null;
    if (window.length >= 2) {
      // Translate both axes to the first sample to avoid cancellation on large offsets.
      const origin = window[0];
      const meanT = window.reduce((sum, sample) => sum + sample.t - origin.t, 0) / window.length;
      const meanV = window.reduce((sum, sample) => sum + sample.value - origin.value, 0) / window.length;
      let covariance = 0;
      let variance = 0;
      for (const sample of window) {
        const dt = sample.t - origin.t - meanT;
        covariance += dt * (sample.value - origin.value - meanV);
        variance += dt * dt;
      }
      if (variance > 0) {
        const value = covariance / variance;
        if (Number.isFinite(value)) trend = value;
      }
    }
    append(t, trend);
  }

  slope.available = slope.points.some(point => Number.isFinite(point.value));
  if (!slope.available) slope.points = [];
  return slope;
}
