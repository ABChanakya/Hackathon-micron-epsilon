// Demo values and alarms for the factory plan, and the map-to-grid layout. No DOM here, so it can be tested in Node.
//
// Every sensor head gets a simulated value around its profile target. "Fehler simulieren" makes one head spike out of
// its limits for a few seconds. A head is in alarm while its value is outside the limits; after it returns, the alarm
// stays latched (steady red) until a person acknowledges it, so a short spike is never missed.

const FAULT_SECONDS = 6;

const profiles = {
  mm: { target: 25, lower: 24.95, upper: 25.05, spike: 0.4, digits: 3 },
  '°C': { target: 23.5, lower: 21.5, upper: 25.5, spike: 12, digits: 2 },
};

function baseValue(unit, time, phase) {
  if (unit === '°C') return 23.5 + Math.sin(time * 0.21 + phase) * 0.35 + Math.sin(time * 1.7 + phase) * 0.05;
  return 25 + Math.sin(time * 1.23 + phase) * 0.011 + Math.sin(time * 4.7 + phase) * 0.003 + Math.sin(time * 0.31 + phase) * 0.004;
}

// Rises in about half a second, holds, and falls back: a clear spike in the chart, out of the limits for most of it.
function spikeShape(age) {
  if (age < 0 || age > FAULT_SECONDS) return 0;
  const rise = Math.min(1, age / 0.5);
  const fall = Math.min(1, (FAULT_SECONDS - age) / 1.2);
  return Math.min(rise, fall);
}

export function createFactorySim(heads) {
  const state = new Map(heads.map((head, index) => [head.key, {
    head, profile: profiles[head.unit] ?? profiles.mm, phase: index * 1.7, fault: null, latched: false, live: null,
  }]));
  let next = 0;

  function read(time) {
    const out = [];
    for (const [key, s] of state) {
      if (s.live) {                                  // a real sensor drives this head: its own alarm decides
        if (s.live.alarm) s.latched = true;
        out.push({ key, value: s.live.value, unit: s.head.unit, digits: s.profile.digits, lower: s.profile.lower,
          upper: s.profile.upper, live: true, reason: s.live.reason,
          alarm: s.live.alarm ? 'active' : s.latched ? 'latched' : 'ok' });
        continue;
      }
      const age = s.fault === null ? -1 : time - s.fault;
      if (age > FAULT_SECONDS) s.fault = null;
      const value = baseValue(s.head.unit, time, s.phase) + s.profile.spike * spikeShape(age);
      const outside = value < s.profile.lower || value > s.profile.upper;
      if (outside) s.latched = true;
      out.push({ key, value, unit: s.head.unit, digits: s.profile.digits, lower: s.profile.lower, upper: s.profile.upper,
        alarm: outside ? 'active' : s.latched ? 'latched' : 'ok' });
    }
    return out;
  }

  return {
    read,
    // Spike one head: the given key, or the next one in turn (so repeated clicks walk through the plant).
    injectFault(time, key) {
      const keys = [...state.keys()];
      const chosen = key && state.has(key) ? key : keys[next++ % keys.length];
      state.get(chosen).fault = time;
      return chosen;
    },
    acknowledge(key) {
      const s = state.get(key);
      if (s && s.fault === null && !s.live?.alarm) s.latched = false;   // an active alarm cannot be acknowledged away
    },
    // Live data for one head ({ value, alarm: bool, reason }) or null to go back to the simulation.
    setLive(key, live) {
      const s = state.get(key);
      if (s) s.live = live;
    },
    profile: (key) => state.get(key)?.profile,
  };
}

// The worst state of a group of heads: active beats latched beats ok.
export function worstAlarm(states) {
  return states.includes('active') ? 'active' : states.includes('latched') ? 'latched' : 'ok';
}

// Place items (with x, y on the plan) in a grid that keeps their order on the plan: what is further right on the plan is
// in a column further right, what is higher up is in a row further up. Positions closer than `tolerance` share a
// column (or row). Two items that would land in the same cell are put side by side.
export function gridLayout(items, tolerance = 40) {
  const ranks = (values) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const groups = [];
    for (const v of sorted) {
      if (groups.length && v - groups.at(-1).at(-1) <= tolerance) groups.at(-1).push(v);
      else groups.push([v]);
    }
    return (v) => groups.findIndex(group => group.includes(v));
  };
  const col = ranks(items.map(item => item.x));
  const row = ranks(items.map(item => item.y));
  const cells = items.map(item => ({ item, col: col(item.x), row: row(item.y) }))
    .sort((a, b) => a.row - b.row || a.item.x - b.item.x);
  const taken = new Set();
  for (const cell of cells) {
    while (taken.has(cell.row + ':' + cell.col)) cell.col += 1;
    taken.add(cell.row + ':' + cell.col);
  }
  return {
    cells,
    cols: Math.max(1, ...cells.map(cell => cell.col + 1)),
    rows: Math.max(1, ...cells.map(cell => cell.row + 1)),
  };
}
