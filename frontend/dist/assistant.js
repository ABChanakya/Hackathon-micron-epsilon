// Local UI fixtures. These functions never contact a model or apply a parameter change.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const parameters = ['lower', 'upper', 'target'];
let proposalSequence = 0;

function snapshot(context = {}) {
  const sensor = context.sensor || {}, profile = context.profile || {};
  return {
    sensor: Object.fromEntries(['id', 'model', 'unit', 'rangeStart', 'rangeEnd'].map(key => [key, sensor[key]])),
    profile: Object.fromEntries(['id', 'name', 'version', 'target', 'lower', 'upper', 'learnedLower', 'learnedUpper'].map(key => [key, profile[key]])),
    source: ['live', 'demo', 'replay'].includes(context.source) ? context.source : 'live',
    connected: Boolean(context.connected), valid: Boolean(context.valid),
    value: context.connected && context.valid && finite(context.value) ? context.value : null,
    window: finite(context.window) ? context.window : 30,
    zeroOffset: finite(context.zeroOffset) ? context.zeroOffset : 0,
  };
}

export async function askQuestion(text, context) {
  const question = String(text || '').toLocaleLowerCase();
  const topic = /led|state|output|leucht/.test(question) ? 'led'
    : /lern|learning|learn|tolera|grenz|limit|apprent|学习|学習|학습/.test(question) ? 'learning'
    : /aufnahme|aufzeich|record|export|csv|pdf|enregistr|grabaci|registr|záznam|记录|記録|기록/.test(question) ? 'recording'
    : /messbereich|bereich|abstand|temperatur|range|rango|plage|intervall|rozsah|测量范围|測定範囲|측정 범위/.test(question) ? 'range'
    : 'general';
  return { kind: 'chat', topic, context: snapshot(context) };
}

export async function explainError(error = {}, context) {
  const copy = snapshot(context), code = String(error.code || ''), message = String(error.message || '');
  const text = `${code} ${message}`.toLocaleLowerCase();
  const topic = !copy.connected || /connect|verbindung|disconnect|port/.test(text) ? 'connection'
    : /tolera|grenz|limit|outside|deviation|abweich/.test(text) ? 'tolerance' : 'signal';
  return {
    kind: 'error', topic, error: { code, message }, context: copy,
    currentValue: copy.value,
    thresholdMin: finite(error.thresholdMin) ? error.thresholdMin : copy.profile.lower,
    thresholdMax: finite(error.thresholdMax) ? error.thresholdMax : copy.profile.upper,
  };
}

export async function explainChart(summary = {}, context) {
  const copy = snapshot(context);
  const available = Number.isInteger(summary.count) && summary.count > 0 &&
    [summary.min, summary.max, summary.mean].every(finite) && summary.min <= summary.max &&
    summary.mean >= summary.min && summary.mean <= summary.max;
  const count = available ? summary.count : 0;
  const chart = {
    count, min: count ? summary.min : null, max: count ? summary.max : null,
    mean: count ? summary.mean : null, trend: count && finite(summary.trend) ? summary.trend : null,
    outside: count && finite(summary.outside) ? Math.max(0, Math.min(count, Math.floor(summary.outside))) : 0,
    duration: finite(summary.duration) && summary.duration >= 0 ? summary.duration : copy.window,
  };
  const threshold = copy.sensor.unit === '°C' ? 0.05 : 0.001;
  const topic = !count ? 'empty' : chart.outside ? 'outside'
    : chart.trend > threshold ? 'rising' : chart.trend < -threshold ? 'falling' : 'stable';
  return { kind: 'chart', topic, summary: chart, context: copy };
}

const failure = (reasonCode, status = 'invalid') => ({ kind: 'command', status, reasonCode });
const unitOf = text => {
  if (/°\s*c|celsius|grad\s*c\b/.test(text)) return '°C';
  if (/(?<!\p{L})mm(?!\p{L})|millimeter|millimetre/u.test(text)) return 'mm';
  if (/°\s*f|fahrenheit|(?<!\p{L})(?:cm|µm|m)(?!\p{L})|zentimeter|centimet|mikrometer|micromet|\bmeter\b/u.test(text)) return 'unsupported';
  return null;
};

function matchesMention(text, sensor) {
  const code = `${sensor.id || ''} ${sensor.model || ''}`.toLocaleLowerCase();
  const mentions = [...text.matchAll(/\b(?:opto\s*ncdt|ild)\s*[- ]?\s*(1420|1900|5500)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?/gi)];
  for (const match of mentions) {
    if (!code.includes(match[1])) return false;
    if (match[2] && !new RegExp(`${match[1]}[-– ]${match[2].replace('.', '\\.').replace(',', '[.,]')}(?!\\d)`, 'i').test(code)) return false;
  }
  if (/thermo\s*meter|thermom[eè]tre|thermo_uc|uc-sf/i.test(text) && !/thermo|uc-sf/i.test(code)) return false;
  const thermalModel = text.match(/\buc[- ]?sf\d+(?:[- ]?s\d+)?\b/i)?.[0];
  if (thermalModel && !code.replace(/[^a-z0-9]/g, '').includes(thermalModel.replace(/[^a-z0-9]/g, ''))) return false;
  return true;
}

export function checkProposal(proposal, context = {}) {
  const sensor = context.sensor || {}, profile = context.profile || {};
  const result = reasonCode => ({ valid: reasonCode === 'ready', reasonCode });
  if (!sensor.id || !profile.id || !finite(profile.version) ||
      ![sensor.rangeStart, sensor.rangeEnd, profile.lower, profile.upper, profile.target].every(finite) ||
      sensor.rangeStart >= sensor.rangeEnd || !['mm', '°C'].includes(sensor.unit)) return result('missing_context');
  if (!proposal || proposal.scope !== 'profile' || !parameters.includes(proposal.parameterName)) return result('unsupported_parameter');
  if (proposal.sensorId !== sensor.id) return result('sensor_mismatch');
  if (proposal.profileId !== profile.id) return result('profile_mismatch');
  if (proposal.expectedVersion !== profile.version) return result('stale_profile');
  if (proposal.unit !== sensor.unit) return result('unit_mismatch');
  if (proposal.oldValue !== profile[proposal.parameterName]) return result('stale_value');
  if (!finite(proposal.newValue)) return result('invalid_value');
  if (proposal.newValue < sensor.rangeStart || proposal.newValue > sensor.rangeEnd) return result('out_of_range');
  const next = { lower: profile.lower, upper: profile.upper, target: profile.target, [proposal.parameterName]: proposal.newValue };
  if (next.lower < sensor.rangeStart || next.upper > sensor.rangeEnd || next.lower >= next.upper ||
      next.target < next.lower || next.target > next.upper) return result('invalid_limits');
  return result('ready');
}

export async function parseParameterCommand(text, context = {}) {
  const request = String(text || '').trim().toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').replace(/−/g, '-');
  if (!request) return failure('empty_request', 'clarify');
  if (!context.sensor?.id || !context.profile?.id || !context.sensor?.unit) return failure('missing_context');
  if (!matchesMention(request, context.sensor || {})) return failure('sensor_mismatch');
  if (/messrate|samplerate|frequenz|frequency|laser|mittelung|averaging|nullpunkt|zero|lernen|learning/.test(request)) return failure('unsupported_parameter');
  const matches = [];
  if (/\bober(?:e|en|er|es)?\b|\bobergrenze\b|\bupper\b|limite(?:\s+[a-z]+){0,3}\s+superi(?:eur|eure|or|ore)\b|\bhorni(?:\s+[a-z]+){0,2}\s+mez\b|上限|상한/.test(request)) matches.push('upper');
  if (/\bunter(?:e|en|er|es)?\b|\buntergrenze\b|\blower\b|limite(?:\s+[a-z]+){0,3}\s+inferi(?:eur|eure|or|ore)\b|\bdolni(?:\s+[a-z]+){0,2}\s+mez\b|下限|하한/.test(request)) matches.push('lower');
  if (/\bsollwert\b|\bzielwert\b|\btarget\b|valeur\s+cible|valor\s+objetivo|valore\s+obiettivo|cilova\s+hodnota|目標値|目标值|목표값|설정값/.test(request)) matches.push('target');
  if (!matches.length) return failure('unsupported_parameter', 'clarify');
  if (matches.length > 1) return failure('ambiguous_parameter', 'clarify');
  if (/\bum\s*[+-]?\d/.test(request) || /increase\s+.*\bby\b|decrease\s+.*\bby\b/.test(request)) return failure('ambiguous_value', 'clarify');
  const withoutSensor = request.replace(/\b(?:opto\s*ncdt|ild)\s*[- ]?\s*(?:1420|1900|5500)(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?/gi, '')
    .replace(/uc-sf\d+(?:-s\d+)?/gi, '');
  const values = withoutSensor.match(/[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?/g) || [];
  if (!values.length) return failure('missing_value', 'clarify');
  if (values.length > 1) return failure('ambiguous_value', 'clarify');
  const unit = unitOf(request);
  if (unit && unit !== context.sensor?.unit) return failure('unit_mismatch');
  const parameterName = matches[0];
  const proposal = {
    id: `mock-proposal-${++proposalSequence}`, scope: 'profile', sensorId: context.sensor?.id,
    profileId: context.profile?.id, expectedVersion: context.profile?.version, parameterName,
    oldValue: context.profile?.[parameterName], newValue: Number(values[0].replace(',', '.')),
    unit: context.sensor?.unit,
  };
  const check = checkProposal(proposal, context);
  return check.valid ? { kind: 'command', status: 'proposal', reasonCode: 'ready', proposal }
    : failure(check.reasonCode);
}
