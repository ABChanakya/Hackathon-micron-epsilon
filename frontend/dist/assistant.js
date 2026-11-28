// The browser only talks to our backend. No model response can write profile or hardware settings.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const parameters = ['lower', 'upper', 'target'];
const languages = ['de', 'en', 'fr', 'es', 'it', 'cs', 'zh', 'ja', 'ko', 'pirate'];

function snapshot(context = {}) {
  const sensor = context.sensor || {}, profile = context.profile || {};
  return {
    sensor: Object.fromEntries(['id', 'model', 'unit', 'rangeStart', 'rangeEnd'].map(key => [key, sensor[key]])),
    profile: Object.fromEntries(['id', 'name', 'version', 'target', 'lower', 'upper', 'learnedLower', 'learnedUpper'].map(key => [key, profile[key]])),
    source: ['live', 'demo', 'replay'].includes(context.source) ? context.source : 'live',
    connected: Boolean(context.connected), valid: Boolean(context.valid),
    value: context.connected && context.valid && !context.paused && finite(context.value) ? context.value : null,
    window: finite(context.window) ? context.window : 30,
    zeroOffset: finite(context.zeroOffset) ? context.zeroOffset : 0,
    capturedAt: typeof context.capturedAt === 'string' ? context.capturedAt : new Date().toISOString(),
    lastValidAt: typeof context.lastValidAt === 'string' ? context.lastValidAt : null, paused: Boolean(context.paused),
    start: finite(context.start) ? context.start : 0, end: finite(context.end) ? context.end : (context.window || 30),
  };
}

export class AssistantError extends Error {
  constructor(code) { super(code); this.name = 'AssistantError'; this.code = code; }
}

function endpoint(path, baseUrl) {
  const address = baseUrl || globalThis.location?.origin || 'http://127.0.0.1:8000';
  const url = new URL('/api/assistant/' + path, address);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (!['http:', 'https:'].includes(url.protocol)) throw new AssistantError('unavailable');
  return url.href;
}

async function request(path, payload, {signal, baseUrl, timeoutMs = payload ? 90000 : 5000} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(endpoint(path, baseUrl), {
      method: payload ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
      ...(payload ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)} : {}),
    });
    let body;
    try { body = await response.json(); } catch { throw new AssistantError('invalid_response'); }
    if (!response.ok) throw new AssistantError(body?.detail?.code || (response.status === 429 ? 'busy' : 'unavailable'));
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new AssistantError(timedOut ? 'timeout' : 'cancelled');
    if (error instanceof AssistantError) throw error;
    throw new AssistantError('unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function getAssistantStatus(options) {
  const status = await request('status', null, options);
  if (!['ready', 'unavailable', 'model_missing', 'busy'].includes(status?.state) || typeof status.model !== 'string') throw new AssistantError('invalid_response');
  return status;
}

function historyCopy(history = []) {
  const result=[];
  let remaining=12000;
  for(const item of history.filter(item=>['user','assistant'].includes(item?.role)&&typeof item.content==='string'&&item.content.trim()).slice(-8).reverse()) {
    const content=item.content.slice(0,Math.min(2000,remaining));
    if(!content)break;
    result.unshift({role:item.role,content});remaining-=content.length;
  }
  return result;
}

async function generate(kind, path, fields, context, options = {}) {
  const copy = snapshot(context);
  const response = await request(path, {
    ...fields, context: copy, language: languages.includes(options.language) ? options.language : 'de',
    history: historyCopy(options.history),
  }, options);
  if (response?.kind !== kind || typeof response.answerText !== 'string' || !response.answerText.trim() || response.answerText.length > 16000) throw new AssistantError('invalid_response');
  // Preserve the original snapshot and calculated values rather than accepting upstream replacements.
  return {...response, ...fields, kind, context: copy};
}

export function askQuestion(text, context, options) {
  return generate('chat', 'chat', {text: String(text || '').trim()}, context, options);
}

export async function explainError(error = {}, context, options) {
  const copy = snapshot(context);
  const details = {
    code: String(error.code || ''), message: String(error.message || ''),
    eventValue: finite(error.eventValue) ? error.eventValue : null, eventTime: finite(error.eventTime) ? error.eventTime : null,
    thresholdMin: finite(error.thresholdMin) ? error.thresholdMin : copy.profile.lower,
    thresholdMax: finite(error.thresholdMax) ? error.thresholdMax : copy.profile.upper,
  };
  const response = await generate('error', 'explain-error', {error: details}, copy, options);
  return {...response, ...details, error: details, currentValue: copy.value};
}

export function explainChart(summary = {}, context, options) {
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
    start: finite(summary.start) ? summary.start : copy.start, end: finite(summary.end) ? summary.end : copy.end,
  };
  return generate('chart', 'explain-chart', {summary: chart}, copy, options);
}

export function checkProposal(proposal, context = {}) {
  const sensor = context.sensor || {}, profile = context.profile || {};
  const result = reasonCode => ({valid: reasonCode === 'ready', reasonCode});
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
  const next = {lower: profile.lower, upper: profile.upper, target: profile.target, [proposal.parameterName]: proposal.newValue};
  if (next.lower < sensor.rangeStart || next.upper > sensor.rangeEnd || next.lower >= next.upper ||
      next.target < next.lower || next.target > next.upper) return result('invalid_limits');
  return result('ready');
}

export async function parseParameterCommand(text, context = {}, options) {
  const response = await generate('command', 'command', {text: String(text || '').trim()}, context, options);
  if (!['proposal', 'clarify', 'invalid'].includes(response.status)) throw new AssistantError('invalid_response');
  if (response.status === 'proposal') {
    const check = checkProposal(response.proposal, context);
    if (!check.valid) return {...response, status: 'invalid', reasonCode: check.reasonCode, proposal: undefined};
    response.proposal = {...response.proposal, confirmed: false};
  }
  return response;
}
