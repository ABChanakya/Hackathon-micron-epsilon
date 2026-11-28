// Signal and standard profile from frontend/dist/data.js and frontend/dist/app.js.
export const DEMO_RATE = 5;

function distanceAt(time) {
  const signal = Math.sin(time * 1.23) * .011
    + Math.sin(time * 4.7) * .003
    + Math.sin(time * .31) * .004;
  return Math.round((25 + signal) * 1e6) / 1e6;
}

export const DEMO_DATASETS = [
  {
    id: 'desktop-distance',
    name: 'Abstand prüfen',
    model: 'optoNCDT 1900-10',
    unit: 'mm',
    lower: 24.95,
    upper: 25.05,
    valueAt: distanceAt,
  },
];

export function demoWindow(dataset, elapsed) {
  const duration = 30;
  const start = Math.max(0, elapsed - duration);
  const firstIndex = Math.ceil(start * DEMO_RATE);
  const lastIndex = Math.floor(elapsed * DEMO_RATE);
  const samples = [];
  let min = Infinity;
  let max = -Infinity;

  for (let index = firstIndex; index <= lastIndex; index++) {
    const time = index / DEMO_RATE;
    const value = dataset.valueAt(time);
    samples.push({ time, value });
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { start, duration, samples, min, max };
}
