import {SENSOR, DISPLAY_RATE, createInitialState, loadState, saveState, makeDemoPoints, acceptFeedback, undoLearning, resetLearning, exportRecordingCSV, exportReportPDF, statistics, slicePoints, formatDuration, generateId, matchesBackendSensor, parseBridgeSample, bridgeLedState, useSensor, sensorFromStatus, adoptSensor, unitOf} from './data.js?v=multi-sensor-1';
import {createSensorViewer} from './sensor3d.js?v=viewer-glow-1';
import {LANGUAGES, getLanguage, getLocale, setLanguage, applyTranslations, startTranslations} from './i18n.js?v=cockpit-1';
import {createAssistantUI} from './assistant-ui.js?v=assistant-1';
import {assistantText} from './assistant-i18n.js?v=assistant-1';

const $ = (s,root=document)=>root.querySelector(s);
const esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = v=>structuredClone(v);
const num = (v,unit=SENSOR.unit)=>Number(v).toLocaleString(getLocale(),{minimumFractionDigits:unit==='°C'?2:3,maximumFractionDigits:unit==='°C'?2:3}); const U = () => SENSOR.unit;
const rate = v=>v>=1000?`${(v/1000).toLocaleString(getLocale())} kHz`:`${v} Hz`;
const rangeText = () => `${SENSOR.rangeStart}–${SENSOR.rangeEnd} ${SENSOR.unit}`;
const defaultBridgeUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname || 'localhost'}${location.port === '4173' || !location.host ? ':8000' : location.port ? ':' + location.port : ''}/ws/stream`;
const time = v=>new Date(v).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'});
const date = v=>new Date(v).toLocaleDateString(getLocale(),{day:'2-digit',month:'short',year:'numeric'});
const assistantLabel=(key,values)=>assistantText(key,values,getLanguage());
const icons={
 chat:'M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5',
 gear:'M19.24 10.06 L21.88 10.44 L21.88 13.56 L19.24 13.94 L18.50 15.75 L20.09 17.88 L17.88 20.09 L15.75 18.50 L13.94 19.24 L13.56 21.88 L10.44 21.88 L10.06 19.24 L8.25 18.50 L6.12 20.09 L3.91 17.88 L5.50 15.75 L4.76 13.94 L2.12 13.56 L2.12 10.44 L4.76 10.06 L5.50 8.25 L3.91 6.12 L6.12 3.91 L8.25 5.50 L10.06 4.76 L10.44 2.12 L13.56 2.12 L13.94 4.76 L15.75 5.50 L17.88 3.91 L20.09 6.12 L18.50 8.25 Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 wave:'M2 12h4l3-8 5 16 3-8h5', monitor:'M3 4h18v12H3z M8 21h8 M12 16v5', folder:'M3 7h7l2-3h9v16H3z', sliders:'M5 3v5m0 4v9 M2 8h6 M12 3v10m0 4v4 M9 13h6 M19 3v3m0 4v11 M16 6h6', sun:'M12 3v2m0 14v2M3 12h2m14 0h2 M5.6 5.6L7 7m10 10 1.4 1.4 M5.6 18.4 1.4-1.4M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', moon:'M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5',
 chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6', back:'m12 5-7 7 7 7 M5 12h16', arrow:'M4 12h16m-6-6 6 6-6 6', close:'m6 6 12 12M6 18 18 6', check:'m5 12 4 4L19 6', info:'M12 8v.01M12 11v6 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', alert:'m12 3 10 18H2z M12 9v5m0 3v.01', pause:'M8 5v14 M16 5v14', play:'m7 4 13 8-13 8z', zero:'M4 12h16 M12 4v16 M17 7a7 7 0 1 1-10 10', pin:'m9 3 6 0-1 6 4 4H6l4-4z M12 13v8', box:'m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',
 edit:'m15 4 5 5-11 11H4v-5z M13 6l5 5', search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', download:'M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5', file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8m-8 4h6', compare:'M4 7h15m-4-4 4 4-4 4 M20 17H5m4-4-4 4 4 4', reset:'M3 10a9 9 0 1 1 2 8 M3 4v6h6', help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17v.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', plug:'M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0z M12 17v5', plus:'M12 5v14M5 12h14', save:'M4 3h13l4 4v14H3V3z M7 3v6h9V3 M7 14h10v7', clock:'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', network:'M8 3h8v6H8z M3 16h6v5H3z M15 16h6v5h-6z M12 9v4 M6 16v-3h12v3', link:'m9 15 6-6 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0', spark:'m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z', trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7m4-7v7'
};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]||icons.info}"/></svg>`;
let state,bootError='';try{state=loadState()}catch(e){state=createInitialState();bootError=e.message}
const rt={route:'monitor',mode:'bridge',connected:false,paused:false,elapsed:0,value:SENSOR.midpoint,points:[],markers:[],zeroOffset:0,window:30,record:null,saving:false,unsaved:null,lastSaved:null,deviation:null,lastFeedback:null,cooldown:0,scenario:'normal',feedback:[],viewer:null,dialogViewer:null,led:{state:'unknown',output:'unknown'},selected:new Set(),analysis:null,offset:0,replayTime:0,replayPlaying:false,replaySpeed:1,reportStart:0,reportEnd:60,setupStep:1,setupMode:'bridge',setupChecked:false,socket:null,socketTimer:null,retryTimer:null,backendStatus:null,ports:[],backendAvailable:false,bridgeUrl:state.settings.bridgeUrl||defaultBridgeUrl(),connectionError:'',storageError:bootError,charts:[],tick:0};
let toastTimer,dialogType='',dialogContext=null,lastTick=performance.now(),assistant;
const profile=()=>state.profiles.find(p=>p.id===state.activeProfileId)||state.profiles[0];
const recording=()=>state.recordings.find(r=>r.id===[...rt.selected][0]);
const vnum=(v,offset=rt.zeroOffset)=>num(v-offset);
const gaugePosition = (value, p) => Math.max(1, Math.min(99, 15 + (value - p.lower) / (p.upper - p.lower) * 70));
const sourceLabel=()=>rt.mode==='demo'?'Demodaten':rt.backendReplay?'Wiedergabe':rt.backendStatus?.source==='sim'?'Simulator':'Sensor online';
const recordingSource=r=>r.source==='demo'?'Demo':r.source==='replay'?'Wiedergabe':'Sensor';
const currentStatus=()=>!rt.connected?'Nicht verbunden':rt.invalidSignal?'Kein gültiger Messwert':rt.saving?'Wird gespeichert':rt.unsaved?'Noch nicht gespeichert':rt.record?'Aufnahme läuft':rt.paused?'Anzeige pausiert':rt.backendReplay?'Wiedergabe':rt.mode==='demo'?'Demoanzeige':'Liveanzeige';
function assistantContext(){return {route:rt.route,sensor:{id:SENSOR.id,model:SENSOR.model,unit:SENSOR.unit,rangeStart:SENSOR.rangeStart,rangeEnd:SENSOR.rangeEnd},source:rt.mode==='demo'||rt.backendStatus?.source==='sim'?'demo':rt.backendReplay?'replay':'live',connected:rt.connected,valid:rt.connected&&!rt.invalidSignal,value:rt.value,profile:clone(profile()),window:rt.window,zeroOffset:rt.zeroOffset}}
function assistantChartSummary(){
  const start=Math.max(0,rt.elapsed-rt.window),end=Math.max(rt.elapsed,rt.window);
  const points=rt.points.filter(point=>point.t>=start&&point.t<=end&&Number.isFinite(point.value));
  const summary=statistics(points.map(point=>({...point,value:point.value-rt.zeroOffset}))),p=profile();
  const chunk=Math.max(1,Math.floor(points.length/4));
  const mean=list=>list.reduce((sum,point)=>sum+point.value,0)/Math.max(1,list.length);
  return {...summary,trend:points.length>1?mean(points.slice(-chunk))-mean(points.slice(0,chunk)):0,outside:points.filter(point=>point.value<p.lower||point.value>p.upper).length,duration:end-start};
}
function assistantError(){
  if(rt.connectionError||!rt.connected)return {code:'SENSOR_DISCONNECTED',message:rt.connectionError||'Nicht verbunden'};
  if(rt.invalidSignal)return {code:'INVALID_SIGNAL',message:rt.invalidError||'Kein gültiger Messwert'};
  if(rt.deviation)return {code:'OUTSIDE_TOLERANCE',message:'Außerhalb der Auswertungsgrenzen',currentValue:rt.deviation.value,thresholdMin:profile().learnedLower,thresholdMax:profile().learnedUpper};
  return null;
}
function persist(){try{saveState(state);rt.storageError='';return true}catch(e){rt.storageError=e.message;toast(e.message);return false}}
function toast(message){clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),4500)}
function setProfile(p){state.profiles=state.profiles.map(x=>x.id===p.id?p:x)}
function ledColor(value){return{green:'var(--good)',yellow:'var(--warn)',red:'var(--bad)',off:'var(--faint)',unknown:'var(--muted)'}[value]||'var(--muted)'}
const ledLabel=value=>({green:'Grün',yellow:'Gelb',red:'Rot',off:'Aus',unknown:'Unbekannt'})[value]||'Unbekannt';
function ledMeaning(name,value){return({state:{green:'Das Objekt liegt im Messbereich des Sensors.',yellow:'Das Objekt befindet sich in der Messbereichsmitte.',red:'Kein gültiger Abstand. Prüfe den Messbereich und die reflektierende Oberfläche.',off:'Der Laser ist ausgeschaltet.',unknown:'Der Sensorstatus ist nicht verfügbar.'},output:{green:'RS422 ist aktiv. Der Analogausgang ist aus.',yellow:'Die Schaltausgänge sind aktiv. RS422, Analogausgang oder Webinterface können zugeschaltet werden.',red:'Der Analogausgang ist aktiv: 4–20 mA, 0–5 V oder 0–10 V.',off:'Der Sensor ist ausgeschaltet oder ohne Versorgung.',unknown:'Der Ausgabestatus ist nicht verfügbar.'}})[name][value]}
function route(name){location.hash=name}

function liveConnectionPanel(){
  if(rt.mode==='demo'||rt.connected)return '';
  if(rt.route!=='advanced')return `<section class="notice" aria-label="Sensorverbindung"><div class="notice-body"><strong>Nicht verbunden</strong><div class="notice-actions"><a class="btn compact" href="#advanced">${icon('gear')} Sensor verbinden</a><button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div></section>`;
  return `<section class="notice" aria-label="Live-Verbindung"><div class="notice-body"><strong>${rt.backendAvailable?'Live-Daten vom USB-Sensor':'Messserver verbinden'}</strong>${rt.backendAvailable?'':'<p>Starte den Messserver mit ./start.sh und öffne dessen Adresse. Du kannst die Messbrücke auch in den Einstellungen wählen.</p>'}${rt.backendAvailable?`<div class="notice-actions">${rt.ports.length?`<div class="field"><label for="live-port">Sensoranschluss</label><select id="live-port">${rt.ports.map(p=>`<option value="${esc(p.sensor+'|'+p.port)}">${p.sensor==='thermo'?'thermoMETER UC':'optoNCDT'} · ${esc(p.port)}</option>`).join('')}</select></div><button type="button" class="btn compact" data-action="connect-sensor" ${rt.connecting?'disabled':''}>${icon('plug')} ${rt.connecting?'Wird verbunden …':'Sensor verbinden'}</button>`:'<span class="small">Kein USB-Sensoranschluss gefunden.</span>'}<button type="button" class="btn quiet compact" data-action="scan-sensors">${icon('reset')} Anschlüsse prüfen</button></div>`:''}</div></section>`;
}

async function backendRequest(path,options={},address=rt.bridgeUrl){
  const url=new URL(path,address);
  url.protocol=url.protocol==='wss:'?'https:':'http:';
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000),...options});
  const body=await response.json();
  if(!response.ok)throw new Error(body.detail||'Der Messserver antwortet nicht.');
  return body;
}

async function refreshBackend(attach=false){
  const address=rt.bridgeUrl;
  try{
    const status=await backendRequest('/api/status');
    if(rt.mode!=='bridge'||address!==rt.bridgeUrl)return;
    rt.backendAvailable=true;
    rt.backendStatus=status;rt.connectionError='';
    if(attach&&status.status==='streaming'){connectBridge(true);return}
    const sources=await backendRequest('/api/sensors/scan');
    if(rt.mode!=='bridge'||address!==rt.bridgeUrl)return;
    rt.ports=sources.filter(s=>['serial','ME-Bus'].includes(s.interface)&&s.port);
    if(status.status==='error')rt.connectionError=status.error;
    render();
  }catch{
    if(rt.mode!=='bridge'||address!==rt.bridgeUrl)return;
    if(attach&&address!==defaultBridgeUrl()){connectBridge(true);return}
    rt.connectionError='Der Messserver ist nicht erreichbar. Starte ./start.sh oder prüfe die Adresse in den Einstellungen.';
    render();
  }
}

async function connectSensor(){
  if(rt.connecting||rt.record)return;
  const selection=$('#live-port')?.value;
  if(!selection)return;
  const selectedSource=(rt.ports||[]).find(item=>item.sensor+'|'+item.port===selection);
  const port=selectedSource?.port||selection;
  const sensor=selectedSource?.sensor||'ILD-serial';
  const address=rt.bridgeUrl;
  const current=()=>rt.mode==='bridge'&&rt.bridgeUrl===address;
  rt.connecting=true;rt.connectionError='';render();
  try{
    const status=await backendRequest('/api/status',{},address);
    if(!current())return;
    // A source may have been opened by another client since scanning. Attach without replacing it.
    if(status.status!=='streaming')await backendRequest('/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sensor,port})},address);
    if(!current())return;
    connectBridge(true);
  }catch(error){if(current())connectionFailed(`Sensor konnte nicht verbunden werden: ${error.message}`)}
  finally{rt.connecting=false;render()}
}

function useSensorSource(){
  if(rt.record||rt.saving){toast('Bitte zuerst die laufende Aufnahme stoppen.');return}
  disconnectSocket();
  Object.assign(rt,{mode:'bridge',connected:false,paused:false,invalidSignal:false,connectionError:'',points:[],markers:[],elapsed:0,zeroOffset:0,deviation:null,lastFeedback:null,led:{state:'unknown',output:'unknown'}});
  render();
  refreshBackend(true);
}

const nextTheme = () => document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
const themeActionLabel = () => nextTheme() === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren';
const themeIcon = () => icon(nextTheme() === 'dark' ? 'moon' : 'sun');

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  const browserColor = $('meta[name="theme-color"]');
  browserColor.content = getComputedStyle(root).getPropertyValue('--header-bg').trim();
  const button = $('[data-action="theme"]');
  if (button) {
    button.setAttribute('aria-label', themeActionLabel());
    button.title = themeActionLabel();
    button.innerHTML = themeIcon() + `<span>${themeActionLabel()}</span>`;
    applyTranslations(button);
  }
  drawCharts();
}
function header(){return `<header class="app-header"><a href="/pitch/" class="brand" aria-label="Zur Hauptseite" title="Zur Hauptseite"><img class="brand-logo" src="assets/micro-epsilon-logo.svg" alt="Micro-Epsilon" width="85" height="64"></a><nav class="nav" aria-label="Hauptnavigation"><a href="#monitor" ${rt.route==='monitor'?'aria-current="page"':''}>Sensor Cockpit</a><a href="#recordings" ${rt.route==='recordings'?'aria-current="page"':''}>Aufzeichnungen</a></nav><div class="header-right"><button type="button" class="assistant-launcher" data-action="assistant-open" aria-label="${esc(assistantLabel('open'))}" aria-haspopup="dialog" aria-controls="assistant-drawer" data-i18n-skip>${icon('chat')}<span>${esc(assistantLabel('title'))}</span></button><a class="icon-button settings-link" href="#advanced" aria-label="Einstellungen öffnen" title="Einstellungen" ${rt.route==='advanced'?'aria-current="page"':''}>${icon('gear')}</a></div></header>`}

function globalNotices(){return `${rt.record&&rt.route!=='monitor'?`<div class="notice">${icon('clock')}<div class="notice-body"><strong>Aufnahme läuft · <span id="record-duration">${formatDuration(rt.elapsed-rt.record.startElapsed)}</span></strong><p data-i18n-skip>${esc(rt.record.name)}</p></div><a class="btn compact" href="#monitor">Zur Aufnahme ${icon('arrow')}</a></div>`:''}${rt.invalidSignal?`<div class="notice error">${icon('alert')}<div class="notice-body"><strong>Kein gültiger Messwert</strong><p>${esc(rt.invalidError||'Simulierter Messfehler. Die Auswertungsgrenzen bleiben unverändert.')}</p><div class="notice-actions">${rt.mode==='demo'?'<button class="btn compact" data-action="resume-signal">Gültige Werte fortsetzen</button>':''}<button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div></div>`:''}${rt.storageError?`<div class="notice error">${icon('alert')}<div><strong>Lokales Speichern ist nicht verfügbar</strong><p>${esc(rt.storageError)}</p></div></div>`:''}${rt.connectionError?`<div class="notice error">${icon('plug')}<div class="notice-body"><strong>Datenquelle getrennt</strong><p>${esc(rt.connectionError)}</p><div class="notice-actions"><button class="btn compact" data-action="reconnect">${icon('reset')} Erneut verbinden</button><button class="btn quiet compact" data-action="connection">Verbindung prüfen</button><button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div></div>`:''}`}
function learningNotice(){if(rt.deviation){const d=rt.deviation,p=d.profile;return `<section class="notice" aria-label="Messabweichung">${icon('alert')}<div class="notice-body"><strong>Außerhalb der Auswertungsgrenzen</strong><p><span class="mono">${num(d.value)} ${U()}</span> bei Auswertungsgrenzen von <span class="mono">${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}</span>.</p><input class="feedback-note" id="feedback-note" placeholder="Optionale Begründung …" aria-label="Begründung zur Bewertung" maxlength="300"><div class="notice-actions"><button class="btn compact" data-action="feedback" data-accepted="true">${icon('check')} Akzeptabel</button><button class="btn quiet compact" data-action="feedback" data-accepted="false">${icon('close')} Nicht akzeptabel</button><button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div><button class="icon-button" data-action="dismiss-deviation" aria-label="Später bewerten">${icon('close')}</button></section>`}
 if(rt.lastFeedback){const e=rt.lastFeedback;return `<section class="notice success">${icon('check')}<div class="notice-body"><strong>${e.changed?'Auswertungsgrenzen angepasst':'Bewertung gespeichert'}</strong><p>${e.changed?`Gelernte Grenzen: ${num(e.previousLower)}–${num(e.previousUpper)} → ${num(e.nextLower)}–${num(e.nextUpper)} ${U()}. Die Sollgrenzen bleiben erhalten.`:esc(e.reason)}</p>${e.changed?'<button class="text-button small" data-action="undo-learning">Anpassung rückgängig machen</button>':''}</div><button class="icon-button" data-action="dismiss-feedback" aria-label="Hinweis schließen">${icon('close')}</button></section>`}return ''}
function monitor(){const p=profile();return `<div class="page-heading monitor-heading">
  <div class="monitor-title"><h1>Sensor Cockpit</h1></div>
  ${rt.mode==='bridge'&&rt.backendReplay?`<span class="badge" title="Gespeicherte Messung, keine Live-Daten">Wiedergabe · <span data-i18n-skip>${esc(String(rt.backendReplay))}</span></span>`:''}
</div>${liveConnectionPanel()}<div class="profile-bar"><div class="profile-selector">${icon('sliders','profile-icon')}<div><label class="sr-only" for="profile-select">Messprofil wählen</label><select id="profile-select" data-field="profile" ${rt.record?'disabled':''}>${state.profiles.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div></div><button class="btn compact quiet" data-action="edit-profile" ${rt.record?'disabled':''}>${icon('edit')} Profil bearbeiten</button></div><div id="learning-notice">${learningNotice()}</div><div class="monitor-grid"><section class="panel measurement-panel" aria-label="Aktuelle Messung"><div class="reading-zone"><div class="reading-top"><span class="eyebrow">${rt.zeroOffset?SENSOR.labels.relative:SENSOR.labels.reading}</span><span class="status-label" id="record-state"><span class="dot ${rt.record||!rt.connected||rt.invalidSignal?'bad':'good'}"></span>${currentStatus()}</span></div><div class="reading-display"><div class="reading-main"><span id="reading-value" class="reading-value">${rt.connected&&!rt.invalidSignal?vnum(rt.value):'—'}</span><span class="reading-unit">${U()}</span></div><div class="reading-sub" id="reading-sub">${rt.zeroOffset?`<span class="reading-detail">Nullpunkt ${num(rt.zeroOffset)} ${U()}</span>`:''}<span class="reading-detail">Sollwert <span id="target-value">${vnum(p.target)} ${U()}</span></span><span class="reading-detail">Abweichung <span id="deviation-value">${rt.connected&&!rt.invalidSignal?num(rt.value-p.target)+' '+U():'—'}</span></span></div></div><div class="tolerance"><div id="reading-state" class="reading-state good"><span class="dot"></span>Im Soll</div><div class="tolerance-track"><div class="tolerance-corridor"></div><div class="tolerance-mid" style="left:${gaugePosition(p.target, p)}%"></div><div class="tolerance-pointer" id="tolerance-pointer"></div></div><div class="tolerance-labels"><span>${vnum(p.lower)} ${U()}</span><span>Sollbereich</span><span>${vnum(p.upper)} ${U()}</span></div></div><div class="measurement-actions"><button class="btn primary record" data-action="record" ${!rt.connected||rt.invalidSignal||rt.saving?'disabled':''}>${rt.record?'<span class="stop-square"></span> Stoppen und speichern':rt.saving?'Wird gespeichert …':'<span class="record-dot"></span> Aufnahme starten'}</button><button class="btn quiet" data-action="pause" ${!rt.connected||rt.invalidSignal||rt.record?'disabled':''}>${icon(rt.paused?'play':'pause')} ${rt.paused?'Fortsetzen':'Anzeige pausieren'}</button><button class="btn quiet" data-action="zero" ${!rt.connected||rt.invalidSignal||rt.record?'disabled':''}>${icon('zero')} ${rt.zeroOffset?'Nullpunkt lösen':'Nullpunkt setzen'}</button></div>${rt.record?`<div class="recording-meta"><span class="recording row"><span class="dot"></span><span id="record-duration">00:00</span></span><span data-i18n-skip>${esc(rt.record.name)}</span></div>`:rt.unsaved?`<div class="recording-meta"><span class="warn">Noch nicht gespeichert</span><button class="text-button" data-action="retry-save">Erneut speichern</button><button class="text-button" data-action="export-unsaved">CSV sichern</button></div>`:rt.lastSaved?`<div class="recording-meta"><span class="good">${icon('check')} Gespeichert</span><span data-i18n-skip>${esc(rt.lastSaved.name)}</span><a href="#recordings" class="accent">Zu den Aufzeichnungen ${icon('arrow')}</a></div>`:''}</div><div class="chart-section"><div class="chart-head"><div><div class="row wrap"><h2>Messverlauf</h2><button type="button" class="text-button assistant-chart-button" data-action="assistant-chart" aria-label="${esc(assistantLabel('chart'))}" data-i18n-skip>${icon('chat')}${esc(assistantLabel('explain'))}</button></div><div class="chart-legend"><span><i class="legend-line"></i>${SENSOR.quantity} (${U()})</span><span><i class="legend-line spec"></i>Sollgrenzen</span></div></div><div class="segmented" aria-label="Angezeigter Zeitraum">${[10,30,60].map(n=>`<button data-action="window" data-value="${n}" class="${rt.window===n?'active':''}" aria-pressed="${rt.window===n}">${n} s</button>`).join('')}</div></div><div class="chart-wrap"><canvas id="live-chart" aria-label="Live-Diagramm: ${SENSOR.labels.chart} über Zeit" role="img"></canvas><div class="chart-tooltip hidden" id="live-tooltip"></div></div><form class="note-entry" data-form="marker">${icon('pin')}<label class="sr-only" for="marker-note">Notiz zur aktuellen Messung</label><input id="marker-note" name="note" placeholder="Notiz zur Zeitmarke" maxlength="300" required ${!rt.connected||rt.invalidSignal?'disabled':''}><button class="btn compact quiet" type="submit" ${!rt.connected||rt.invalidSignal?'disabled':''}>Zeitmarke setzen ${icon('plus')}</button></form><div class="marker-list">${rt.markers.slice(-4).map(m=>`<button class="marker-chip" data-action="edit-marker" data-id="${esc(m.id)}">${icon('pin')} ${formatDuration(m.t)} · ${esc(m.note)}</button>`).join('')}</div></div><div class="monitor-foot"><span id="sample-count">${rt.points.length} Messpunkte</span></div></section><aside class="side-stack" aria-label="Sensor und Auswertung"><section class="panel sensor-card"><div class="panel-heading"><div><h2 class="sensor-title" data-i18n-skip>${esc(SENSOR.model)}</h2></div><span class="dot" id="device-connected-dot" style="color:${!rt.connected?'var(--faint)':rt.invalidSignal?'var(--bad)':'var(--good)'}"></span></div>${SENSOR.kind==='distance'?`<div class="sensor-mini" id="mini-viewer"><span class="viewer-stage-hint" aria-hidden="true">Ziehen zum Drehen</span></div><div class="device-leds">${['state','output'].map(name=>`<button class="led-status" data-action="sensor" data-led="${name}" data-led-state="${esc(rt.led[name])}" aria-label="${name==='state'?'State':'Output'}-LED: ${ledLabel(rt.led[name])}. ${esc(ledMeaning(name,rt.led[name]))}"><span class="led-indicator" id="${name}-dot" aria-hidden="true"></span><span class="led-copy"><span>${name==='state'?'State':'Output'}</span><strong id="${name}-led-label">${ledLabel(rt.led[name])}</strong></span></button>`).join('')}</div><div class="device-bottom"><button class="text-button small" data-action="sensor">Vergrößern ${icon('arrow')}</button></div>`:`<div class="metric-row"><span class="muted">Messgröße</span><span>${SENSOR.quantity} (${U()})</span></div><p class="small muted">${esc(SENSOR.interface)}</p>`}<div class="metric-row"><span class="muted">Messbereich</span><span class="mono">${rangeText()}</span></div></section><section class="panel learning-card"><div class="panel-heading"><h2>Auswertungsgrenzen</h2><span class="learning-state ${p.learning?'good':'muted'}"><span class="dot"></span>${p.learning?'Aktiv':'Pausiert'}</span></div><div class="bound-row"><span class="muted">Sollgrenzen</span><span class="mono">${num(p.lower)}–${num(p.upper)} ${U()}</span></div><div class="bound-row"><span class="muted">Aktuelle Grenzen</span><span class="mono">${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}</span></div><div class="row between" style="margin-top:15px"><button class="text-button muted small" data-action="toggle-learning">${icon(p.learning?'pause':'play')} ${p.learning?'Lernen pausieren':'Lernen fortsetzen'}</button><a href="#advanced" class="text-button muted small">Verlauf ${icon('chevron')}</a></div>${rt.mode==='demo'?`<hr class="divider"><span class="eyebrow">Störungen simulieren</span><div class="demo-controls"><button class="btn" data-action="simulate-deviation" ${!rt.connected||rt.invalidSignal?'disabled':''}>Abweichung auslösen ${icon('arrow')}</button><button class="btn" data-action="simulate-disconnect">${rt.connected?'Verbindung unterbrechen':'Erneut verbinden'} ${icon(rt.connected?'plug':'reset')}</button><button class="btn" data-action="simulate-invalid" ${!rt.connected?'disabled':''}>Messfehler erzeugen ${icon('alert')}</button></div>`:''}</section></aside></div>`}
function recordingsView(){const selected=[...rt.selected].map(id=>state.recordings.find(x=>x.id===id)).filter(Boolean);return `<div class="page-heading"><div><h1>Aufzeichnungen</h1></div><span class="status-label">${state.recordings.length} ${state.recordings.length===1?'Messung':'Messungen'}</span></div><div class="recordings-toolbar"><div class="search-box">${icon('search')}<input id="run-search" type="search" value="${esc(rt.search||'')}" placeholder="Messung suchen …" aria-label="Aufzeichnungen durchsuchen"></div></div><section class="panel"><div class="table-wrap"><table class="runs-table"><thead><tr><th><span class="sr-only">Auswahl</span></th><th>Messung</th><th>Datum</th><th>Dauer</th><th>Zeitmarken</th><th>Quelle</th><th><span class="sr-only">Aktionen</span></th></tr></thead><tbody>${state.recordings.map(r=>`<tr data-run-id="${esc(r.id)}" class="${rt.selected.has(r.id)?'selected':''}"><td><input type="checkbox" data-field="run" value="${esc(r.id)}" ${rt.selected.has(r.id)?'checked':''} aria-label="${esc(r.name)} auswählen"></td><td><span class="run-name">${esc(r.name)}</span><span class="run-profile">${esc(r.sensor || 'Sensor unbekannt')} · ${esc(r.profile.name)}</span></td><td>${date(r.createdAt)}<div class="run-profile mono">${time(r.createdAt)}</div></td><td class="mono">${formatDuration(r.duration)}</td><td class="mono">${r.markers?.length||0}</td><td><span class="badge"><span class="dot ${r.source==='demo'?'muted':'good'}"></span>${recordingSource(r)}</span>${r.interrupted?'<div class="small warn">Unterbrochen</div>':''}</td><td><button class="icon-button" data-action="run-menu" data-id="${esc(r.id)}" aria-label="${esc(r.name)} bearbeiten">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div>${!state.recordings.length?`<div class="empty">${icon('folder')}<h2>Noch keine Aufzeichnung</h2><p>Aufnahmen startest du am Messplatz.</p><a class="btn primary" href="#monitor">Zum Cockpit ${icon('arrow')}</a></div>`:''}<div class="selection-bar"><span class="small muted">${selected.length?`${selected.length} ${selected.length===1?'Messung':'Messungen'} ausgewählt`:'Wähle eine Messung für Wiedergabe oder Export, zwei für den Vergleich.'}</span><div class="row"><button class="btn ${rt.analysis==='replay'?'primary':''}" data-action="analysis" data-view="replay" ${selected.length!==1?'disabled':''}>${icon('play')} Wiedergeben</button><button class="btn ${rt.analysis==='compare'?'primary':''}" data-action="analysis" data-view="compare" ${selected.length!==2?'disabled':''}>${icon('compare')} Vergleichen</button><button class="btn ${rt.analysis==='report'?'primary':''}" data-action="analysis" data-view="report" ${selected.length!==1?'disabled':''}>${icon('file')} PDF-Bericht</button><button class="btn quiet" data-action="csv" ${selected.length!==1?'disabled':''} aria-label="Ausgewählte Messung als CSV herunterladen">${icon('download')} CSV</button></div></div></section>${analysisView(selected)}`}
function analysisView(runs){if(!rt.analysis)return '';const r=runs[0];if(!r)return '';if(rt.analysis==='compare'&&runs.length!==2)return '';if(rt.analysis!=='compare'&&runs.length!==1)return '';const stats=statistics(r.points);const recordNum=v=>num(v,unitOf(r));if(rt.analysis==='report')return reportView(r);return `<section class="panel analysis-panel"><div class="panel-heading"><div><h2>${rt.analysis==='compare'?'Messungen vergleichen':'Messung wiedergeben'}</h2></div><button class="icon-button" data-action="close-analysis" aria-label="Analyse schließen">${icon('close')}</button></div>${rt.analysis==='compare'&&unitOf(r)!==unitOf(runs[1])?'<div class="notice error">Die Messungen verwenden unterschiedliche Einheiten.</div>':`<div class="chart-legend"><span data-i18n-skip><i class="legend-line"></i>${esc(r.name)}</span>${runs[1]?`<span><i class="legend-line ref"></i>Referenz: <span data-i18n-skip>${esc(runs[1].name)}</span></span>`:''}</div><div class="chart-wrap"><canvas id="analysis-chart" role="img" aria-label="${rt.analysis==='compare'?'Überlagerte Messkurven':'Gespeicherter Messverlauf'}"></canvas></div>${rt.analysis==='compare'?`<div class="analysis-controls"><div class="field"><label for="compare-offset">Referenz verschieben <span class="mono" id="offset-label">${rt.offset.toFixed(1)} s</span></label><input id="compare-offset" data-field="offset" type="range" min="-10" max="10" value="${rt.offset}" step="0.2"></div><button class="btn compact" data-action="align">${icon('compare')} Zeitversatz zurücksetzen</button></div><div class="stats-grid"><div><span class="eyebrow">Mittlere Differenz</span><div class="stat-value" id="compare-mean">—</div><div class="stat-label">Erste Messung minus Referenz</div></div><div><span class="eyebrow">Größte absolute Differenz</span><div class="stat-value" id="compare-max">—</div></div><div><span class="eyebrow">Zugeordnete Messpunkte</span><div class="stat-value" id="compare-count">—</div></div></div>`:`<div class="replay-controls"><button class="btn compact" data-action="replay-toggle" aria-label="${rt.replayPlaying?'Wiedergabe pausieren':'Wiedergabe starten'}">${icon(rt.replayPlaying?'pause':'play')}</button><span class="mono small" id="replay-time">${formatDuration(rt.replayTime)}</span><input type="range" data-field="replay" aria-label="Wiedergabeposition" min="0" max="${r.duration}" step=".2" value="${rt.replayTime}"><span class="mono small">${formatDuration(r.duration)}</span><select data-field="speed" aria-label="Wiedergabegeschwindigkeit">${[.5,1,2,4].map(s=>`<option value="${s}" ${rt.replaySpeed===s?'selected':''}>${s}×</option>`).join('')}</select></div><div class="row between" style="margin-top:15px"><span class="small muted" id="replay-value">${recordNum(r.points[0]?.value)} ${unitOf(r)}</span><div class="segmented" aria-label="Wiedergabe-Zoom">${[10,30,0].map(n=>`<button data-action="replay-window" data-value="${n}" class="${(rt.replayWindow||0)===n?'active':''}">${n?n+' s':'Gesamt'}</button>`).join('')}</div></div><div class="stats-grid"><div><span class="eyebrow">Minimum</span><div class="stat-value">${recordNum(stats.min)} <small>${unitOf(r)}</small></div></div><div><span class="eyebrow">Mittelwert</span><div class="stat-value">${recordNum(stats.mean)} <small>${unitOf(r)}</small></div></div><div><span class="eyebrow">Maximum</span><div class="stat-value">${recordNum(stats.max)} <small>${unitOf(r)}</small></div></div></div>${r.markers?.length?`<div class="marker-list">${r.markers.map(m=>`<button class="marker-chip" data-action="jump-marker" data-value="${m.t}">${icon('pin')} ${formatDuration(m.t)} · ${esc(m.note)}</button>`).join('')}</div>`:''}`}`}</section>`}
function reportView(r){const recordNum=v=>num(v,unitOf(r));let start=rt.reportStart,end=rt.reportEnd;const points=r.points.filter(p=>p.t>=start&&p.t<=end);const s=statistics(points);return `<section class="panel analysis-panel"><div class="panel-heading"><div><h2>PDF-Export</h2></div><button class="icon-button" data-action="close-analysis" aria-label="Bericht schließen">${icon('close')}</button></div><div class="report-grid"><div class="report-options stack"><div class="fields"><div class="field"><label for="report-start">Beginn (s)</label><input id="report-start" data-field="report-start" type="number" min="0" max="${r.duration}" step=".2" value="${start}"></div><div class="field"><label for="report-end">Ende (s)</label><input id="report-end" data-field="report-end" type="number" min="0" max="${r.duration}" step=".2" value="${end}"></div></div><button class="btn primary" data-action="pdf">${icon('download')} PDF herunterladen</button></div><article class="report-paper"><div class="report-brand">Micro-Epsilon</div><h2>Messbericht</h2><p data-i18n-skip>${esc(r.name)} · ${date(r.createdAt)}</p><div class="chart-wrap"><canvas id="report-chart" role="img" aria-label="Diagrammvorschau des ausgewählten Berichtszeitraums"></canvas></div><dl><div><dt>Sensor</dt><dd>${esc(r.sensor)}</dd></div><div><dt>Zeitraum</dt><dd>${formatDuration(start)}–${formatDuration(end)}</dd></div><div><dt>Profil</dt><dd data-i18n-skip>${esc(r.profile.name)}</dd></div><div><dt>Profilrate</dt><dd>${rate(r.profile.rate)}</dd></div><div><dt>Sollwert</dt><dd>${recordNum(r.profile.target)} ${unitOf(r)}</dd></div><div><dt>Minimum / Maximum</dt><dd>${s.count?recordNum(s.min)+' / '+recordNum(s.max):'—'} ${unitOf(r)}</dd></div></dl><h3>Notizen</h3>${r.markers.filter(m=>m.t>=start&&m.t<=end).map(m=>`<div class="report-note"><span class="mono">${formatDuration(m.t)}</span> · ${esc(m.note)}</div>`).join('')||'<p>Keine Notizen in diesem Zeitraum.</p>'}<h3>Auswertung</h3><p>${r.feedback?.filter(f=>f.t>=start&&f.t<=end).length||0} Bewertungen · Parameterstand Version ${r.profile.version}</p><div class="report-disclaimer">${r.source==='demo'?'DEMO · SIMULIERTE MESSDATEN':r.source==='replay'?'WIEDERGABE · GESPEICHERTE MESSDATEN':'SENSORDATEN · MESSBRÜCKE'}<br>${points.length} Werte im gewählten Zeitraum</div></article></div></section>`}

function advancedView(){
  const p=profile(),history=[...(p.history||[])].reverse();
  return `<div class="page-heading"><h1>Einstellungen</h1></div>
  <form data-form="settings"><div class="advanced-grid">
    <section class="panel advanced-panel source-settings">
      <div class="panel-heading"><h2>Datenquelle</h2></div>
      <div class="connection-choices" role="group" aria-label="Datenquelle">
        <button type="button" class="choice-card ${rt.mode==='bridge'?'selected':''}" data-action="sensor-source" aria-pressed="${rt.mode==='bridge'}" ${rt.record||rt.saving?'disabled':''}>${icon('plug')}<h3>Sensordaten</h3></button>
        <button type="button" class="choice-card ${rt.mode==='demo'?'selected':''}" data-action="demo" aria-pressed="${rt.mode==='demo'}" ${rt.record||rt.saving?'disabled':''}>${icon('wave')}<h3>Demo</h3></button>
      </div>
      ${liveConnectionPanel()}
      <div class="metric-row"><span class="muted">Sensormodell</span><span data-i18n-skip>${esc(SENSOR.model)}</span></div>
      <div class="metric-row"><span class="muted">Messbereich</span><span class="mono">${rangeText()}</span></div>
      <div class="metric-row"><span class="muted">Schnittstelle</span><span data-i18n-skip>${esc(SENSOR.interface)}</span></div>
      <details class="connection-details"><summary>Adresse der lokalen Messbrücke</summary>
        <div class="field"><label class="sr-only" for="bridge-url">Adresse der lokalen Messbrücke</label><input id="bridge-url" name="bridgeUrl" type="url" value="${esc(rt.bridgeUrl)}" placeholder="ws://localhost:8000/ws/stream"></div>
        <div class="row wrap"><button type="button" class="btn compact" data-action="connect-bridge">${icon('link')} Messbrücke verbinden</button><button type="button" class="btn quiet compact" data-action="bridge-help">Datenformat ${icon('info')}</button></div>
      </details>
    </section>
    <section class="panel advanced-panel language-settings">
      <div class="panel-heading"><h2>Sprache</h2></div>
      <div class="field"><label for="language-select">Sprache für alle Seiten</label><select id="language-select" data-field="language" data-i18n-skip>${LANGUAGES.map(language=>`<option value="${language.code}" ${getLanguage()===language.code?'selected':''}>${language.name}</option>`).join('')}</select></div>
      <div class="panel-heading" style="margin-top:28px"><h2>Farbschema</h2></div>
      <button type="button" class="btn" data-action="theme" aria-label="${themeActionLabel()}" title="${themeActionLabel()}">${themeIcon()}<span>${themeActionLabel()}</span></button>
    </section>
    <section class="panel advanced-panel">
      <div class="panel-heading"><h2>Messprofil</h2></div>
      <p data-i18n-skip><strong>${esc(p.name)}</strong></p>
      <div class="fields"><div class="field"><label for="setting-rate">Profilrate</label><select id="setting-rate" name="rate">${SENSOR.rates.map(n=>`<option value="${n}" ${p.rate===n?'selected':''}>${rate(n)}</option>`).join('')}</select></div><div class="field"><label for="setting-window">Diagrammfenster</label><select id="setting-window" name="window">${[10,30,60].map(n=>`<option value="${n}" ${p.window===n?'selected':''}>${n} Sekunden</option>`).join('')}</select></div></div>
      <div class="row wrap" style="margin-top:18px"><button type="button" class="btn compact" data-action="edit-profile">${icon('edit')} Sollgrenzen bearbeiten</button><button type="button" class="btn quiet compact" data-action="zero" ${rt.record?'disabled':''}>${icon('zero')} ${rt.zeroOffset?'Nullpunkt lösen':'Nullpunkt setzen'}</button></div>
    </section>
    <section class="panel advanced-panel">
      <div class="panel-heading"><h2>Auswertungsgrenzen</h2><span class="learning-state ${p.learning?'good':'muted'}"><span class="dot"></span>${p.learning?'Aktiv':'Pausiert'}</span></div>
      <div class="metric-row"><span class="muted">Sollgrenzen</span><span class="mono">${num(p.lower)}–${num(p.upper)} ${U()}</span></div>
      <div class="metric-row"><span class="muted">Aktuelle Auswertungsgrenzen</span><span class="mono">${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}</span></div>
      <div class="row wrap" style="margin-top:18px"><button type="button" class="btn compact" data-action="toggle-learning">${icon(p.learning?'pause':'play')} ${p.learning?'Pausieren':'Fortsetzen'}</button><button type="button" class="btn quiet compact" data-action="undo-learning" ${!history.some(h=>h.changed)?'disabled':''}>${icon('back')} Rückgängig</button><button type="button" class="btn quiet compact" data-action="reset-learning">${icon('reset')} Zurücksetzen</button></div>
    </section>
    <section class="panel advanced-panel help-settings">
      <div class="panel-heading"><h2>Hilfe</h2></div>
      <p>Aufzeichnungen und Profile werden in diesem Browser gespeichert.</p>
      <div class="row wrap" style="margin-top:18px"><button type="button" class="btn compact" data-action="help">${icon('help')} Hilfe öffnen</button><a class="btn quiet compact" href="#setup">${icon('plug')} Einrichtung öffnen</a>${SENSOR.manual?`<a class="btn quiet compact" href="${SENSOR.manual}" target="_blank" rel="noopener">Sensorhandbuch ${icon('arrow')}</a>`:''}</div>
    </section>
    ${history.length?`<section class="panel advanced-panel"><div class="panel-heading"><h2>Änderungsverlauf</h2></div><div class="history-list">${history.map(h=>`<div class="history-item"><div class="row between"><strong>${h.type==='feedback'?(h.accepted?'Als akzeptabel bewertet':'Als nicht akzeptabel bewertet'):h.type==='undo'?'Anpassung rückgängig':h.type==='profile'?'Sollgrenzen geändert':'Grenzen zurückgesetzt'}</strong><span class="mono">${time(h.at)}</span></div><p>${h.value!==undefined?num(h.value)+' '+U()+' · ':''}${h.changed?`${num(h.previousLower)}–${num(h.previousUpper)} → ${num(h.nextLower)}–${num(h.nextUpper)} ${U()}`:esc(h.reason||'Grenzen unverändert.')}</p>${h.note?`<p data-i18n-skip>${esc(h.note)}</p>`:''}</div>`).join('')}</div></section>`:''}
  </div><div class="setting-footer"><button type="submit" class="btn primary" ${rt.record?'disabled':''}>${icon('save')} Änderungen speichern</button></div></form>`;
}

function setupView(){const n=rt.setupStep;let content='';if(n===1)content=`<h2>Datenquelle wählen</h2><div class="connection-choices"><button class="choice-card ${rt.setupMode==='demo'?'selected':''}" data-action="setup-source" data-value="demo">${icon('wave')}<div><h3>Demo</h3><p>5 simulierte Messwerte pro Sekunde.</p></div></button><button class="choice-card ${rt.setupMode==='bridge'?'selected':''}" data-action="setup-source" data-value="bridge">${icon('plug')}<div><h3>Sensor</h3><p>${esc(SENSOR.model)} über eine lokale Messbrücke.</p></div></button></div>${rt.setupMode==='bridge'?`<div class="field" style="margin-top:18px"><label for="setup-bridge-url">WebSocket-Adresse</label><input id="setup-bridge-url" type="url" value="${esc(rt.bridgeUrl)}"></div><button class="btn compact" style="margin-top:12px" data-action="connect-bridge">Verbindung herstellen ${icon('arrow')}</button>`:''}`;
 if(n===2)content=`<h2>${rt.setupMode==='demo'?'Demoprofil':'Eingestelltes Sensormodell'}</h2><div class="detected-device">${icon('box')}<div><h3>${esc(SENSOR.model)}</h3><p>Messbereich ${rangeText()} · Profilrate ${rate(profile().rate)}</p>${rt.setupMode==='bridge'?`<p>${esc(SENSOR.interface)} · Messbrücke</p>`:''}</div></div>${rt.setupMode==='bridge'?`<p class="small muted">Vergleiche das Modell mit dem Typenschild am Sensor.</p>`:''}`;
 if(n===3)content=`<h2>Signal prüfen</h2>${rt.setupMode==='bridge'?`<p>Richte den Sensor auf das Messobjekt aus. Der Messbereich liegt bei ${rangeText()} ${SENSOR.labels.rangeNote}</p>`:''}<div class="check-item">${icon(rt.connected?'check':'close',rt.connected?'':'bad')} ${rt.connected?'Datenquelle ist verbunden':'Noch keine Verbindung'}</div><div class="check-item">${icon(rt.connected&&!rt.invalidSignal&&rt.value>=SENSOR.rangeStart&&rt.value<=SENSOR.rangeEnd?'check':'close',rt.connected?'':'bad')} ${rt.connected&&!rt.invalidSignal?'Messwert im Messbereich':'Gültiger Messwert fehlt'}</div><div class="wizard-reading"><div class="reading-main"><span class="reading-value">${rt.connected&&!rt.invalidSignal?num(rt.value):'—'}</span><span class="reading-unit">${U()}</span></div><span class="small muted">${rt.connected&&!rt.invalidSignal?(rt.mode==='demo'?'Simulierter Messwert':'Aktueller Sensorwert'):''}</span></div>${!rt.connected?'<button class="btn" data-action="reconnect">Erneut verbinden</button>':''}`;
 if(n===4)content=`<h2>Messwert und Profil</h2><div class="wizard-reading"><div class="reading-main"><span class="reading-value">${rt.connected&&!rt.invalidSignal?num(rt.value):'—'}</span><span class="reading-unit">${U()}</span></div><div class="small muted">${!rt.connected?'Verbindung unterbrochen':rt.invalidSignal?'Gültiger Messwert fehlt':rt.mode==='demo'?'Simulierter Messwert':'Aktueller Sensorwert'}</div></div><div class="detected-device" style="margin-top:18px">${icon('sliders')}<div><h3 data-i18n-skip>${esc(profile().name)}</h3><p>Sollwert ${num(profile().target)} ${U()} · ${rate(profile().rate)}</p></div><span class="spacer"></span><button class="text-button" data-action="edit-profile">Bearbeiten ${icon('edit')}</button></div>`;
 return `<div class="wizard"><a href="#monitor" class="text-button muted small">${icon('back')} Zum Cockpit</a><div class="wizard-intro"><h1>Einrichtung</h1></div><div class="stepper" aria-label="Einrichtungsfortschritt">${['Datenquelle','Sensormodell','Signal prüfen','Messprofil'].map((s,i)=>`<div class="step ${i+1<n?'done':i+1===n?'active':''}" ${i+1===n?'aria-current="step"':''}><span class="step-circle">${i+1<n?icon('check'):i+1}</span><span>${s}</span></div>`).join('')}</div><section class="panel wizard-card">${content}<div class="wizard-actions"><button class="btn quiet" data-action="setup-back" ${n===1?'disabled':''}>${icon('back')} Zurück</button><button class="btn primary" data-action="setup-next" ${n===3&&(!rt.connected||rt.invalidSignal)?'disabled':''}>${n===4?'Zum Cockpit':n===3?'Messprofil prüfen':'Weiter'} ${icon('arrow')}</button></div></section></div>`}

function dialogShell(title,content){return `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Dialog schließen">${icon('close')}</button></div><div class="dialog-content">${content}</div>`}
function openDialog(type,context=null){if(type==='sensor'&&SENSOR.kind!=='distance')return;if(rt.dialogViewer){rt.dialogViewer.dispose();rt.dialogViewer=null}dialogType=type;dialogContext=context;const d=$('#dialog');d.className=type==='sensor'?'wide':'';let title='',body='';const p=profile();
 if(type==='profile'){title='Messprofil bearbeiten';body=`<p>Wenn du Sollwert oder Sollgrenzen änderst, setzt das Profil seine Auswertungsgrenzen zurück.</p><form data-form="profile"><div class="fields"><div class="field full"><label for="profile-name">Profilname</label><input id="profile-name" name="name" value="${esc(p.name)}" required maxlength="80"></div><div class="field full"><label for="profile-description">Kurzbeschreibung</label><input id="profile-description" name="description" value="${esc(p.description)}" maxlength="180"></div><div class="field full"><label for="profile-target">Sollwert in ${U()}</label><input id="profile-target" name="target" type="number" min="${SENSOR.rangeStart}" max="${SENSOR.rangeEnd}" step=".001" value="${p.target}" required></div><div class="field"><label for="profile-lower">Untere Sollgrenze (${U()})</label><input id="profile-lower" name="lower" type="number" min="${SENSOR.rangeStart}" max="${SENSOR.rangeEnd}" step=".001" value="${p.lower}" required></div><div class="field"><label for="profile-upper">Obere Sollgrenze (${U()})</label><input id="profile-upper" name="upper" type="number" min="${SENSOR.rangeStart}" max="${SENSOR.rangeEnd}" step=".001" value="${p.upper}" required></div><div class="field"><label for="profile-rate">Profilrate</label><select id="profile-rate" name="rate">${SENSOR.rates.map(n=>`<option value="${n}" ${p.rate===n?'selected':''}>${rate(n)}</option>`).join('')}</select></div><div class="field"><label for="profile-save-mode">Speichern als</label><select id="profile-save-mode" name="saveMode"><option value="update">Aktuelles Profil ändern</option><option value="copy">Neues Profil anlegen</option></select></div></div><div class="dialog-error" id="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit">${icon('save')} Profil speichern</button></div></form>`}
 if(type==='profile-preview'){const n=state.profiles.find(x=>x.id===context);if(!n)return;title='Messprofil wechseln';const changes=[['Profil',p.name,n.name],['Sollwert',num(p.target)+' '+U(),num(n.target)+' '+U()],['Sollgrenzen',num(p.lower)+'–'+num(p.upper)+' '+U(),num(n.lower)+'–'+num(n.upper)+' '+U()],['Profilrate',rate(p.rate),rate(n.rate)],['Diagrammfenster',p.window+' s',n.window+' s']].filter(([, before, after], index) => index === 0 || before !== after);body=`${n.description?`<p data-i18n-skip>${esc(n.description)}</p>`:''}<div class="change-list">${changes.map(c=>`<div class="change-row"><span>${c[0]}</span><span data-i18n-skip>${esc(c[1])} → ${esc(c[2])}</span></div>`).join('')}</div><div class="dialog-actions"><button class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" data-action="apply-profile" data-id="${esc(n.id)}">Profil laden ${icon('arrow')}</button></div>`}
 if(type==='record'){title='Neue Aufnahme';body=`<form data-form="start-record"><div class="field"><label for="record-name">Name der Messung</label><input id="record-name" name="name" value="${esc(p.name)} · ${new Date().toLocaleDateString(getLocale())} ${new Date().toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}" required maxlength="100"></div><div class="metric-row"><span class="muted">Speicherort</span><span>Dieser Browser</span></div><div class="metric-row"><span class="muted">Quelle</span><span>${rt.mode==='demo'?'Demo · 5 Werte/s':'Sensor · Messbrücke'}</span></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit"><span class="record-dot"></span> Aufnahme starten</button></div></form>`}
 if(type==='marker'){const m=rt.markers.find(x=>x.id===context);if(!m)return;title='Notiz bearbeiten';body=`<form data-form="edit-marker"><div class="field"><label for="edit-marker-note">Notiz bei ${formatDuration(m.t)}</label><textarea id="edit-marker-note" name="note" required maxlength="300">${esc(m.note)}</textarea></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit">Notiz speichern</button></div></form>`}
 if(type==='run'){const r=state.recordings.find(x=>x.id===context);if(!r)return;title='Aufzeichnung umbenennen';body=`<form data-form="rename-run"><div class="field"><label for="rename-run-name">Name der Messung</label><input name="name" id="rename-run-name" value="${esc(r.name)}" required maxlength="100"></div><div class="metric-row"><span class="muted">Aufgenommen am</span><span>${date(r.createdAt)} · ${time(r.createdAt)}</span></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit">Umbenennen</button></div></form>`}

 if(type==='help'){title='Hilfe';body=`<div class="stack"><div><h3>Aufnehmen</h3><p class="small muted">Wähle ein Profil und starte die Aufnahme. Nach „Stoppen und speichern“ erscheint sie unter Aufzeichnungen.</p></div><div><h3>Abweichungen bewerten</h3><p class="small muted">Im Demo-Modus kannst du Abweichungen simulieren. Akzeptierte Werte können die Auswertungsgrenzen erweitern. Die Sollgrenzen bleiben erhalten.</p></div><div><h3>Speichern und exportieren</h3><p class="small muted">Profile und Aufnahmen liegen in diesem Browser. Exportiere benötigte Messungen als CSV oder PDF, bevor du Browserdaten löschst.</p></div><div><h3>Sensor anschließen</h3><p class="small muted">Für Sensordaten brauchst du eine lokale Messbrücke. Das Sensorhandbuch erklärt die Bedeutung der LEDs.</p></div></div><div class="dialog-actions">${SENSOR.manual?`<a class="btn" href="${SENSOR.manual}" target="_blank" rel="noopener">Sensorhandbuch ${icon('arrow')}</a>`:''}<button class="btn primary" data-action="close-dialog">Schließen</button></div>`}
 if(type==='bridge-help'){title='Datenformat der Messbrücke';body=`<p>Eine lokale Anwendung liest den RS422-Sensor und sendet die Messwerte per WebSocket als JSON:</p><pre style="font:11px/1.7 var(--mono);padding:15px;background:var(--bg);border-radius:6px;overflow:auto">${esc(JSON.stringify({value:SENSOR.midpoint + 0.001,unit:SENSOR.unit,sensor:SENSOR.model,...(SENSOR.kind==='distance'?{state:'green',output:'green'}:{})},null,2))}</pre><p class="info-line">${icon('info')}<span><code>value</code> ist eine Zahl in ${U()}. Wenn <code>sensor</code> angegeben ist, muss der Wert <code>${esc(SENSOR.model)}</code> sein. Für die LEDs gelten <code>green</code>, <code>yellow</code>, <code>red</code>, <code>off</code> und <code>unknown</code>. Fehlende LED-Daten zeigt der Monitor als unbekannt an. Beim Projekt-Backend nutze <code>/ws/stream</code> mit erreichbarem <code>/api/status</code>. Bei HTTPS kann WSS nötig sein.</span></p><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Schließen</button></div>`}
 if(type==='sensor'){title=SENSOR.model;body=`<p>${rt.mode==='demo'?'Wähle eine LED-Farbe, um den Status zu simulieren.':'LED-Zustände von der Messbrücke'}</p><div class="sensor-dialog-grid"><div><div class="sensor-large" id="large-viewer"><div class="viewer-help">Ziehen zum Drehen · Scrollen zum Zoomen</div></div><div class="viewer-controls"><span class="small muted">Nach der Maßzeichnung im Handbuch</span><button class="text-button small" data-action="reset-viewer">${icon('reset')} Ansicht zurücksetzen</button></div></div><div>${['state','output'].map(name=>`<section class="sensor-detail"><div class="sensor-detail-header" data-led="${name}" data-led-state="${esc(rt.led[name])}"><span class="led-indicator" id="dialog-${name}-dot" aria-hidden="true"></span><h3>${name==='state'?'State':'Output'}-LED</h3><span class="led-color-label" id="dialog-${name}-led-label">${ledLabel(rt.led[name])}</span></div>${rt.mode==='demo'?`<div class="led-options" aria-label="${name} LED simulieren">${['green','yellow','red','off'].map(c=>`<button class="led-option ${rt.led[name]===c?'active':''}" data-action="led" data-led="${name}" data-value="${c}" aria-pressed="${rt.led[name]===c}" aria-label="${name}-LED ${({green:'grün',yellow:'gelb',red:'rot',off:'aus'})[c]}" style="--led:${ledColor(c)}"><span></span></button>`).join('')}</div>`:''}<p class="led-explanation" id="led-${name}-description">${ledMeaning(name,rt.led[name])}</p></section>`).join('')}</div></div>`}
 d.innerHTML=dialogShell(title,body);if(!d.open)d.showModal();if (type === 'sensor') {
   const revealLed = name => $(`#led-${name}-description`)?.scrollIntoView({block: 'nearest'});
   rt.dialogViewer = createSensorViewer($('#large-viewer'), {
     initialState: rt.led,
     onSelect: revealLed,
   });
   if (context) revealLed(context);
 }
}
function closeDialog(){rt.dialogViewer?.dispose();rt.dialogViewer=null;$('#dialog').close();dialogType='';dialogContext=null}

function render(){const focused=document.activeElement;const focusedInApp=focused&&$('#app').contains(focused);let focusSelector='';if(focusedInApp){if(focused.id)focusSelector='#'+CSS.escape(focused.id);else if(focused.dataset.action){focusSelector='[data-action="'+CSS.escape(focused.dataset.action)+'"]';for(const k of ['id','value','view'])if(focused.dataset[k])focusSelector+='[data-'+k+'="'+CSS.escape(focused.dataset[k])+'"]'}else if(focused.dataset.field){focusSelector='[data-field="'+CSS.escape(focused.dataset.field)+'"]';if(focused.value)focusSelector+='[value="'+CSS.escape(focused.value)+'"]'}}rt.viewer?.dispose();rt.viewer=null;rt.charts=[];const main=rt.route==='recordings'?recordingsView():rt.route==='advanced'?advancedView():rt.route==='setup'?setupView():monitor();$('#app').innerHTML=header()+`<main id="main" class="main" tabindex="-1">${globalNotices()}${main}</main>`;document.title=`${{monitor:'Sensor Cockpit',recordings:'Aufzeichnungen',advanced:'Einstellungen',setup:'Einrichtung'}[rt.route]} · Micro-Epsilon`;if(rt.route==='monitor'){if(SENSOR.kind==='distance')rt.viewer=createSensorViewer($('#mini-viewer'),{initialState:rt.led,onSelect:name=>openDialog('sensor',name)});updateLive();const canvas=$('#live-chart');canvas.addEventListener('pointermove',chartHover);canvas.addEventListener('pointerleave',()=>$('#live-tooltip')?.classList.add('hidden'))}drawCharts();if(focusSelector)$(focusSelector)?.focus({preventScroll:true});if(rt.search&&rt.route==='recordings')document.querySelectorAll('[data-run-id]').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(rt.search.toLocaleLowerCase()));applyTranslations();assistant?.refresh()}

function drawChart(canvas,{points,reference=null,profile:p,start=0,end=60,markers=[],offset=0,refOffset=0,cursor=null}){if(!canvas)return;const rect=canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;const ratio=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);const colors = getComputedStyle(canvas);
 const chartColor = name => colors.getPropertyValue(`--chart-${name}`).trim();
 const text = chartColor('ink'), line = chartColor('line'), accent = chartColor('signal');const left=w<400?56:65,right=14,top=15,bottom=31,pw=w-left-right,ph=h-top-bottom;const data=points.filter(x=>x.t>=start&&x.t<=end&&Number.isFinite(x.value));const ref=reference?.filter(x=>x.t+refOffset>=start&&x.t+refOffset<=end&&Number.isFinite(x.value))||[];const shown=[...data.map(x=>x.value),...ref.map(x=>x.value)];const vals=shown.length?shown:[p.lower,p.upper,p.target];let low=Math.min(...vals),high=Math.max(...vals);const pad=Math.max((high-low)*.3,.012);low-=pad;high+=pad;const x=t=>left+(t-start)/Math.max(.001,end-start)*pw,y=v=>top+ph-(v-low)/(high-low)*ph;
 ctx.clearRect(0,0,w,h);ctx.font='11px "JetBrains Mono"';ctx.textBaseline='middle';ctx.fillStyle=text;ctx.strokeStyle=line;ctx.lineWidth=.7;const steps=4;for(let i=0;i<=steps;i++){const yy=top+ph*i/steps;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.textAlign='right';ctx.fillText(num(high-(high-low)*i/steps-offset,p.unit||'mm'),left-9,yy)}
 ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
 ctx.strokeStyle = line;
 for (let tick = 0; tick <= 8; tick++) {
   const xx = left + pw * tick / 8;
   ctx.beginPath();
   ctx.moveTo(xx, top);
   ctx.lineTo(xx, top + ph);
   ctx.stroke();
 }ctx.fillStyle=chartColor('band');ctx.fillRect(left,y(p.upper),pw,y(p.lower)-y(p.upper));for(const value of[p.lower,p.upper]){ctx.strokeStyle=chartColor('limit');ctx.setLineDash([4,5]);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(w-right,y(value));ctx.stroke()}ctx.setLineDash([]);const draw=(arr,shift,color,dash=[])=>{if(arr.length<1)return;ctx.strokeStyle=color;ctx.lineWidth=1.65;ctx.setLineDash(dash);ctx.beginPath();arr.forEach((pt,i)=>{i?ctx.lineTo(x(pt.t+shift),y(pt.value)):ctx.moveTo(x(pt.t+shift),y(pt.value))});ctx.stroke();ctx.setLineDash([])};draw(data,0,accent);draw(ref,refOffset,chartColor('reference'),[4,4]);
 markers.filter(m=>m.t>=start&&m.t<=end).forEach(m=>{ctx.strokeStyle=chartColor('reference');ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(x(m.t),top+8);ctx.lineTo(x(m.t),top+ph);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=accent;ctx.beginPath();ctx.arc(x(m.t),top+6,2.5,0,Math.PI*2);ctx.fill()});if(cursor!==null){ctx.strokeStyle=chartColor('cursor');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(cursor),top);ctx.lineTo(x(cursor),top+ph);ctx.stroke()}ctx.restore();ctx.fillStyle=text;ctx.font='11px "JetBrains Mono"';ctx.textBaseline='top';
 const timeSteps = pw < 230 ? 2 : 4;
 for (let i = 0; i <= timeSteps; i++) {
   const t = start + (end - start) * i / timeSteps;
   ctx.textAlign = i === 0 ? 'left' : i === timeSteps ? 'right' : 'center';
   ctx.fillText(formatDuration(t), x(t), h - bottom + 10);
 }canvas._plot={start,end,left,pw,data,x,y,w,h,offset};
}
function drawCharts(){const p=profile();if($('#live-chart'))drawChart($('#live-chart'),{points:rt.points,profile:p,start:Math.max(0,rt.elapsed-rt.window),end:Math.max(rt.elapsed,rt.window),markers:[...rt.markers,...(rt.deviation?[{t:rt.deviation.t,note:'Abweichung'}]:[])],offset:rt.zeroOffset});if(rt.route==='recordings'&&rt.analysis){const runs=[...rt.selected].map(id=>state.recordings.find(r=>r.id===id)).filter(Boolean),r=runs[0];if(!r)return;if(rt.analysis==='report'){drawChart($('#report-chart'),{points:r.points,profile:r.profile,start:rt.reportStart,end:rt.reportEnd,markers:r.markers});return}if(rt.analysis==='compare'&&runs.length===2){if(unitOf(r)!==unitOf(runs[1]))return;drawChart($('#analysis-chart'),{points:r.points,reference:runs[1].points,profile:r.profile,start:0,end:Math.max(r.duration,runs[1].duration+rt.offset),markers:r.markers,refOffset:rt.offset});updateComparison(r,runs[1])}else if(rt.analysis==='replay'){const window=rt.replayWindow||r.duration;let start=Math.max(0,rt.replayTime-window*.8);start=Math.min(start,Math.max(0,r.duration-window));drawChart($('#analysis-chart'),{points:r.points,profile:r.profile,start,end:Math.min(r.duration,start+window),markers:r.markers,cursor:rt.replayTime});const current=r.points.reduce((a,b)=>Math.abs(b.t-rt.replayTime)<Math.abs(a.t-rt.replayTime)?b:a,r.points[0]);if($('#replay-value'))$('#replay-value').textContent=`${num(current?.value,unitOf(r))} ${unitOf(r)} · ${recordingSource(r)}daten`}}}
function updateComparison(a,b){const recordNum=v=>num(v,unitOf(a));const diffs=[];for(const pt of a.points){const t=pt.t-rt.offset;if(t<0||t>b.duration)continue;let lo=0,hi=b.points.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(b.points[mid].t<t)lo=mid+1;else hi=mid}const point=b.points[lo];const previous=b.points[Math.max(0,lo-1)];const nearest=Math.abs(point.t-t)<Math.abs(previous.t-t)?point:previous;if(Math.abs(nearest.t-t)<=.21)diffs.push(pt.value-nearest.value)}const mean=diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:null;$('#compare-mean').textContent=mean===null?'—':recordNum(mean)+' '+unitOf(a);$('#compare-max').textContent=diffs.length?recordNum(Math.max(...diffs.map(Math.abs)))+' '+unitOf(a):'—';$('#compare-count').textContent=String(diffs.length)}
function chartHover(e){const canvas=e.currentTarget,plot=canvas._plot,tooltip=$('#live-tooltip');if(!plot||!plot.data.length||!tooltip)return;const rect=canvas.getBoundingClientRect(),tx=plot.start+((e.clientX-rect.left-plot.left)/plot.pw)*(plot.end-plot.start);const point=plot.data.reduce((a,b)=>Math.abs(b.t-tx)<Math.abs(a.t-tx)?b:a);tooltip.textContent=`${formatDuration(point.t)} · ${vnum(point.value)} ${U()}`;tooltip.classList.remove('hidden');tooltip.style.left=Math.min(plot.w-tooltip.offsetWidth-4,Math.max(4,e.clientX-rect.left+10))+'px';tooltip.style.top=Math.max(4,e.clientY-rect.top-32)+'px'}
function updateLive(){const p=profile();const reading=$('#reading-value');if(reading)reading.textContent=rt.connected&&!rt.invalidSignal?vnum(rt.value):'—';if($('#deviation-value'))$('#deviation-value').textContent=rt.connected&&!rt.invalidSignal?num(rt.value-p.target)+' '+U():'—';const pointer=$('#tolerance-pointer');if (pointer) {
  pointer.hidden = !rt.connected || rt.invalidSignal;
  pointer.style.left = gaugePosition(rt.value, p) + '%';
}const status=$('#reading-state');if(status){const inside=rt.value>=p.lower&&rt.value<=p.upper;status.className='reading-state '+(!rt.connected?'muted':rt.invalidSignal?'bad':inside?'good':'warn');status.innerHTML=`<span class="dot"></span>${!rt.connected?'Warte auf gültige Messwerte':rt.invalidSignal?'Kein gültiger Messwert':inside?'Im Soll':rt.value>=p.learnedLower&&rt.value<=p.learnedUpper?'Außerhalb der Sollgrenzen, in der Auswertung akzeptiert':'Außerhalb der Sollgrenzen'}`}
 if($('#record-duration')&&rt.record)$('#record-duration').textContent=formatDuration(rt.elapsed-rt.record.startElapsed);if($('#sample-count'))$('#sample-count').textContent=`${rt.points.length} Messpunkte`;for(const name of['state','output']){
  const value=rt.led[name];
  const control=$(`.led-status[data-led="${name}"]`);
  if(control){control.dataset.ledState=value;control.setAttribute('aria-label',`${name==='state'?'State':'Output'}-LED: ${ledLabel(value)}. ${ledMeaning(name,value)}`)}
  const detail=$(`.sensor-detail-header[data-led="${name}"]`);
  if(detail)detail.dataset.ledState=value;
  for(const prefix of['','dialog-']){const label=$(`#${prefix}${name}-led-label`);if(label)label.textContent=ledLabel(value)}
  if($(`#led-${name}-description`))$(`#led-${name}-description`).textContent=ledMeaning(name,value);
  document.querySelectorAll(`.led-option[data-led="${name}"]`).forEach(button=>{const active=button.dataset.value===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
}rt.viewer?.setStatus(rt.led);rt.dialogViewer?.setStatus(rt.led)}
function addValue(value,{led=null}={}){if(!Number.isFinite(value))return;if(rt.mode==='demo')rt.elapsed+=1/DISPLAY_RATE;else rt.elapsed=Math.max(0,(performance.now()-rt.bridgeStart)/1000);rt.value=value;const point={t:rt.elapsed,value,version:profile().version};rt.points.push(point);rt.points=rt.points.filter(p=>p.t>=rt.elapsed-65);if(led){rt.led=led}else if(rt.scenario==='normal'){rt.led={state:Math.abs(value-SENSOR.midpoint)<.001?'yellow':'green',output:state.settings.output==='analog'?'red':'green'}}if(rt.record)rt.record.points.push({...point,t:Math.max(0,Math.round((rt.elapsed-rt.record.startElapsed)*1000)/1000)});const p=profile();if(rt.elapsed>rt.cooldown&&!rt.deviation&&(value<p.learnedLower||value>p.learnedUpper)){rt.deviation={value,t:rt.elapsed,profile:clone(p)};rt.lastFeedback=null;if(rt.route==='monitor'){const target=$('#learning-notice');if(target)target.innerHTML=learningNotice()}}if(rt.mode==='demo'||performance.now()-(rt.lastDraw||0)>100){updateLive();drawCharts();rt.lastDraw=performance.now()}}
function startRecord(name){if(!name.trim()){toast('Bitte gib einen Namen für die Aufnahme ein.');return}if(rt.invalidSignal){toast('Warte auf einen gültigen Messwert.');return}if(rt.unsaved){toast('Speichere zuerst die vorherige Aufnahme.');return}if(!rt.connected){toast('Verbinde zuerst eine Datenquelle.');return}rt.paused=false;rt.lastSaved=null;rt.deviation=null;rt.lastFeedback=null;rt.record={id:generateId('run'),name,createdAt:new Date().toISOString(),source:rt.mode==='demo'?'demo':rt.backendReplay?'replay':'sensor',sensor:SENSOR.model,profile:clone(profile()),profileAtStart:clone(profile()),points:[{t:0,value:rt.value,version:profile().version}],markers:[],feedback:[],parameterHistory:[],storage:'Browser · lokal',displayRate:DISPLAY_RATE,zeroOffset:rt.zeroOffset,startElapsed:rt.elapsed};closeDialog();render();toast('Aufnahme läuft. Messwerte werden erfasst.')}
function finishRecord(interrupted=false){const r=rt.record;if(!r)return null;r.duration=Math.max(.2,Math.round((rt.elapsed-r.startElapsed)*1000)/1000);r.profile=clone(profile());r.interrupted=interrupted;if(r.source!=='demo')r.displayRate=Math.round(r.points.length/r.duration*100)/100;delete r.startElapsed;rt.record=null;return r}
function saveRecording(r){if(!r)return;const old=state.recordings;state.recordings=[r,...old.filter(x=>x.id!==r.id)];if(persist()){rt.unsaved=null;rt.lastSaved=r;toast('Aufzeichnung lokal gespeichert.');render()}else{state.recordings=old;rt.unsaved=r;render()}}
function stopRecord(){if(!rt.record)return;const r=finishRecord();rt.saving=true;render();setTimeout(()=>{rt.saving=false;saveRecording(r)},300)}
function interruptRecord(){if(rt.record){rt.unsaved=finishRecord(true);toast('Aufnahme unterbrochen. Sichere die bisher erfassten Daten.')}}
function useDemo(){if(rt.record||rt.saving){toast('Bitte zuerst die laufende Aufnahme stoppen.');return}disconnectSocket();rt.backendReplay=null;rt.backendStatus=null;rt.mode='demo';rt.connected=true;rt.invalidSignal=false;rt.paused=false;rt.connectionError='';rt.scenario='normal';rt.led={state:'green',output:'green'};rt.value=profile().target;rt.elapsed=60;rt.points=makeDemoPoints(60,0,0,profile().target);rt.markers=[];rt.deviation=null;rt.lastFeedback=null;rt.zeroOffset=0;closeDialog();render();toast('Demo-Sensor verbunden.')}
function disconnectSocket() {
  clearTimeout(rt.socketTimer);
  clearTimeout(rt.retryTimer);
  const socket = rt.socket;
  rt.socket = null;
  if (!socket) return;
  socket.onmessage = socket.onclose = socket.onerror = null;
  socket.close();
}

function switchSensor(id, info) {
  // Another sensor is connected: units, ranges, labels and the measuring profiles switch with it.
  if(dialogType==='sensor')closeDialog();
  useSensor(id, info);
  state = adoptSensor(state);
  persist();
  Object.assign(rt, { points: [], markers: [], deviation: null, lastFeedback: null, zeroOffset: 0, value: SENSOR.midpoint, paused:false, elapsed:0, cooldown:0,
    window: profile().window || rt.window });
  render();
  toast(`${SENSOR.model} verbunden. Anzeige in ${SENSOR.unit}.`);
}

async function verifyBackend(socketUrl) {
  const statusUrl = new URL('/api/status', socketUrl);
  statusUrl.protocol = socketUrl.protocol === 'wss:' ? 'https:' : 'http:';
  try {
    const response = await fetch(statusUrl, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!response.ok) return false;
    const status = await response.json();
    return matchesBackendSensor(status) ? status : null;
  } catch {
    return false;
  }
}

function connectBridge(quiet=false) {
  if (rt.record) {
    toast('Bitte zuerst die Aufnahme stoppen.');
    return;
  }
  const field = $('#setup-bridge-url') || $('#bridge-url');
  const address = (!quiet && field?.value.trim()) || rt.bridgeUrl;
  let url;
  try { url = new URL(address); } catch {}
  if (!url || !['ws:', 'wss:'].includes(url.protocol)) {
    toast('Gib eine gültige ws://- oder wss://-Adresse ein.');
    return;
  }
  disconnectSocket();
  Object.assign(rt, {
    mode: 'bridge', connected: false, invalidSignal: false, bridgeUrl: address, backendReplay: null,backendStatus:null,cooldown:0,
    connectionError: '', paused: false, points: [], markers: [], deviation: null,
    lastFeedback: null, zeroOffset: 0, elapsed: 0, led: { state: 'unknown', output: 'unknown' },
  });
  closeDialog();
  render();
  if(!quiet)toast('Verbindung zur Messbrücke wird hergestellt …');

  let socket;
  try { socket = new WebSocket(url); } catch {
    connectionFailed('Die Verbindung konnte nicht geöffnet werden. Prüfe die WebSocket-Adresse.');
    return;
  }
  rt.socket = socket;
  let modelVerified = false;
  let checkingModel = false;
  let gotValue = false;
  let sourceIdentity = null;
  const applySource = status => {
    const info=status.info||{};
    const identity=JSON.stringify([status.source,info.model,info.serial,info.replay_of,info.label,info.unit,info.range_mm,info.smr_mm,info.range_min,info.range_max]);
    const changed=sourceIdentity!==identity;
    if(sourceIdentity!==null&&changed){
      interruptRecord();
      Object.assign(rt,{points:[],markers:[],zeroOffset:0,elapsed:0,deviation:null,lastFeedback:null,cooldown:0,paused:false});
      gotValue=false;
    }
    const sensorId=sensorFromStatus(status);
    const differentThermo=sensorId==='thermo_uc'&&(info.model&&!SENSOR.model.endsWith(info.model)||Number.isFinite(info.range_min)&&info.range_min!==SENSOR.rangeStart||Number.isFinite(info.range_max)&&info.range_max!==SENSOR.rangeEnd);
    if(sensorId&&(sensorId!==SENSOR.id||differentThermo))switchSensor(sensorId,info);
    sourceIdentity=identity;
    rt.backendStatus=status;
    rt.backendReplay=status.source==='replay'?(info.label||info.replay_of||'Aufzeichnung'):null;
    return changed;
  };
  const fail = (message,retry=false) => {
    if (rt.socket !== socket) return;
    disconnectSocket();
    connectionFailed(message,retry);
  };
  rt.socketTimer = setTimeout(() => fail('Die Messbrücke liefert keine passenden Messdaten. Prüfe Adresse und Sensor.'), 8000);
  socket.onmessage = async event => {
    if (rt.socket !== socket || checkingModel) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if(!data||typeof data!=='object'||Array.isArray(data))return;
    let sourceChanged=false;
    if(data.status&&data.status!=='streaming'){
      fail('Die Datenquelle wurde getrennt. Verbinde den Sensor erneut.',true);
      refreshBackend();
      return;
    }
    let metadata=data.info?data:null;
    if(!metadata&&data.source&&data.range_start!==undefined){
      const info={model:data.sensor,serial:data.serial,unit:data.unit};
      if(data.unit==='°C'){
        if(Number.isFinite(data.range_start))info.range_min=data.range_start;
        if(Number.isFinite(data.range_end))info.range_max=data.range_end;
      }else Object.assign(info,{smr_mm:data.range_start,range_mm:data.range});
      metadata={source:data.source,info};
    }
    if(metadata){
      if(!matchesBackendSensor(metadata)){fail(`Die Datenquelle passt nicht zum ${SENSOR.model} (${rangeText()}).`);return}
      sourceChanged=applySource(metadata);
      modelVerified=true;
    }
    let sample = parseBridgeSample(data, modelVerified);
    if (!sample) return;
    if (sample.error === 'unverified') {
      checkingModel = true;
      const status = await verifyBackend(url);
      checkingModel = false;
      if(rt.socket!==socket)return;
      if (!status) {
        fail(`${SENSOR.model} konnte über /api/status nicht bestätigt werden. Prüfe den angeschlossenen Sensor oder verwende eine Messbrücke mit Modellangabe.`);
        return;
      }
      sourceChanged=applySource(status);
      modelVerified=true;
      sample=parseBridgeSample(data,true);
      if(!sample)return;
    }
    if (sample.error === 'model') {
      fail(`Die Messbrücke meldet ein anderes Modell als ${SENSOR.model}.`);
      return;
    }

    const wasConnected = rt.connected;
    const wasInvalid = rt.invalidSignal;
    rt.connected = true;
    rt.connectionError = '';
    rt.lastBridgeAt = performance.now();
    clearTimeout(rt.socketTimer);
    if (sample.error) {
      const nextLeds=bridgeLedState(data);
      const ledsChanged=nextLeds.state!==rt.led.state||nextLeds.output!==rt.led.output;
      const message=sample.error==='range'
        ? `${SENSOR.labels.outOfRange} ${rangeText()}.`
        : `Der Sensor liefert keinen gültigen ${SENSOR.labels.valueWord}.${data.last_error?.text||data.error?' '+(data.last_error?.text||data.error):''}`;
      const messageChanged=message!==rt.invalidError;
      if(!wasInvalid)interruptRecord();
      rt.invalidSignal=true;
      rt.invalidError=message;
      rt.led=nextLeds;
      if(!wasInvalid||!wasConnected||sourceChanged||messageChanged)render();
      else if(ledsChanged)updateLive();
      return;
    }

    rt.invalidSignal = false;
    if (!gotValue) rt.bridgeStart = performance.now();
    gotValue = true;
    rt.led=sample.led;
    if (!rt.paused) addValue(sample.value, { led: sample.led });
    else updateLive();
    if (!wasConnected || wasInvalid || sourceChanged) render();
  };
  socket.onerror = () => fail('Die Messbrücke ist nicht erreichbar. Die Verbindung wird erneut aufgebaut.',true);
  socket.onclose = () => fail('Die Verbindung zur Messbrücke wurde getrennt. Die Verbindung wird erneut aufgebaut.',true);
}
function connectionFailed(message,retry=false){if(rt.connected)interruptRecord();rt.connected=false;rt.invalidSignal=false;rt.connectionError=message;rt.led={state:'unknown',output:'unknown'};render();clearTimeout(rt.retryTimer);if(retry&&rt.mode==='bridge'){refreshBackend();rt.retryTimer=setTimeout(()=>connectBridge(true),3000)}}
function reconnect(){if(rt.mode==='demo'){rt.connected=true;rt.invalidSignal=false;rt.connectionError='';rt.scenario='normal';rt.led={state:'green',output:'green'};render();toast('Demo-Verbindung wiederhergestellt.')}else connectBridge()}

async function handleAction(el,event){const action=el.dataset.action;switch(action){
 case'assistant-open':assistant.open();break;case'assistant-chart':assistant.open('chart');break;case'assistant-error':assistant.open('error');break;
 case'close-dialog':closeDialog();break;
 case 'theme': {
   const theme = nextTheme();
   applyTheme(theme);
   try { localStorage.setItem('me-theme', theme); } catch {}
   break;
 }
 case'help':openDialog('help');break;case'bridge-help':openDialog('bridge-help');break;case'connection':route('advanced');break;case'sensor-source':useSensorSource();break;case'connect-bridge':connectBridge();break;case'scan-sensors':refreshBackend();break;case'connect-sensor':connectSensor();break;case'demo':useDemo();break;case'reconnect':reconnect();break;
 case'dismiss-setup':state.setupComplete=true;persist();render();break;
 case'edit-profile':if(rt.record){toast('Stoppe die Aufnahme, um das Profil zu ändern.');break}openDialog('profile');break;
 case'apply-profile':{const p=state.profiles.find(p=>p.id===el.dataset.id);if(!p)break;state.activeProfileId=p.id;rt.window=p.window;rt.zeroOffset=0;rt.points=rt.mode==='demo'?makeDemoPoints(60,0,0,p.target):[];if(rt.mode==='demo'){rt.elapsed=60;rt.value=p.target;}rt.markers=[];rt.deviation=null;rt.lastFeedback=null;rt.cooldown=0;persist();closeDialog();render();toast(`Profil „${p.name}“ geladen.`);break}
 case'record':if(rt.record)stopRecord();else if(rt.unsaved)toast('Speichere zuerst die vorherige Aufnahme.');else openDialog('record');break;
 case'retry-save':saveRecording(rt.unsaved);break;case'export-unsaved':exportRecordingCSV(rt.unsaved);break;
 case'pause':if(rt.record)break;rt.paused=!rt.paused;render();break;
 case'zero':if(rt.invalidSignal||!rt.connected){toast('Warte auf einen gültigen Messwert.');break}if(rt.record){toast('Der Nullpunkt bleibt während einer Aufnahme unverändert.');break}rt.zeroOffset=rt.zeroOffset?0:rt.value;render();toast(rt.zeroOffset?'Nullpunkt für die Anzeige gesetzt.':'Absoluter Messwert wird angezeigt.');break;
 case'window':rt.window=Number(el.dataset.value);render();break;
 case'edit-marker':openDialog('marker',el.dataset.id);break;
 case'sensor':openDialog('sensor',el.dataset.led);break;
 case'reset-viewer':rt.dialogViewer?.reset();break;
 case'led':{if(rt.mode!=='demo')break;rt.scenario='led';rt.led[el.dataset.led]=el.dataset.value;updateLive();break}
 case'toggle-learning':{const p=clone(profile());p.learning=!p.learning;setProfile(p);persist();render();toast(p.learning?'Grenzanpassung aktiv.':'Grenzanpassung pausiert. Bewertungen sind weiter möglich.');break}
 case'undo-learning':setProfile(undoLearning(profile()));if(rt.record)rt.record.parameterHistory.push({...clone(profile().history.at(-1)),t:rt.elapsed-rt.record.startElapsed});rt.lastFeedback=null;persist();render();toast('Letzte Grenzanpassung rückgängig gemacht.');break;
 case'reset-learning':setProfile(resetLearning(profile()));if(rt.record)rt.record.parameterHistory.push({...clone(profile().history.at(-1)),t:rt.elapsed-rt.record.startElapsed});rt.lastFeedback=null;persist();render();toast('Auswertungsgrenzen auf Sollgrenzen zurückgesetzt.');break;
 case'simulate-deviation':if(rt.mode==='demo'&&rt.connected){rt.paused=false;rt.cooldown=0;rt.scenario='normal';const p = profile();
   const upper = Math.max(p.upper, p.learnedUpper) + .025;
   const lower = Math.min(p.lower, p.learnedLower) - .025;
   if (upper > SENSOR.rangeEnd && lower < SENSOR.rangeStart) {
     toast('Die Auswertungsgrenzen decken den gesamten Sensorbereich ab.');
     break;
   }
   addValue(upper <= SENSOR.rangeEnd ? upper : lower);
   render()}break;
 case'simulate-invalid':if(rt.mode==='demo'&&rt.connected){interruptRecord();rt.invalidSignal=true;rt.invalidError='';rt.scenario='invalid';rt.deviation=null;rt.led={state:'red',output:'green'};render()}break;case'resume-signal':rt.invalidSignal=false;rt.scenario='normal';rt.led={state:'green',output:'green'};render();toast('Der Demo-Sensor liefert wieder gültige Werte.');break;
 case'simulate-disconnect':if(rt.mode!=='demo')break;if(rt.connected){interruptRecord();rt.connected=false;rt.connectionError='Die Demo simuliert einen Verbindungsabbruch. Mit „Erneut verbinden“ kannst du fortfahren.';rt.led={state:'unknown',output:'unknown'};render()}else reconnect();break;
 case'feedback':{if(!rt.deviation)break;const d=rt.deviation,note=$('#feedback-note')?.value||'',accepted=el.dataset.accepted==='true';const result=acceptFeedback(profile(),d.value,accepted,note,d.t);setProfile(result.profile);rt.feedback.push(result.event);if(rt.record){const converted={...result.event,t:Math.max(0,d.t-rt.record.startElapsed)};rt.record.feedback.push(converted);if(result.event.changed)rt.record.parameterHistory.push({...converted,t:Math.max(0,Math.round((rt.elapsed-rt.record.startElapsed)*1000)/1000)});rt.record.markers.push({id:generateId('feedback-note'),t:converted.t,note:`${accepted?'Akzeptabel':'Nicht akzeptabel'}: ${num(d.value)} ${U()}${note?' · '+note:''}`})}rt.deviation=null;rt.lastFeedback=result.event;rt.cooldown=rt.elapsed+5;persist();render();break}
 case'dismiss-deviation':rt.deviation=null;rt.cooldown=rt.elapsed+10;render();break;case'dismiss-feedback':rt.lastFeedback=null;render();break;
 case'run-menu':openDialog('run',el.dataset.id);break;
 case'analysis':{rt.analysis=el.dataset.view;rt.offset=0;rt.replayPlaying=false;rt.replayTime=0;rt.reportStart=0;rt.reportEnd=recording()?.duration||60;render();$('.analysis-panel')?.scrollIntoView({behavior:'smooth',block:'start'});break}
 case'close-analysis':rt.analysis=null;rt.replayPlaying=false;render();break;
 case'csv':if(recording()){exportRecordingCSV(recording());toast('CSV-Datei heruntergeladen.')}break;
 case'pdf':if(recording()){try{exportReportPDF(recording(),{start:rt.reportStart,end:rt.reportEnd});toast('PDF-Bericht heruntergeladen.')}catch(e){toast(e.message)}}break;
 case'align':rt.offset=0;render();toast('Beide Messungen beginnen bei 00:00.');break;
 case'replay-toggle':{const r=recording();if(rt.replayTime>=r.duration)rt.replayTime=0;rt.replayPlaying=!rt.replayPlaying;render();break}
 case'replay-window':rt.replayWindow=Number(el.dataset.value);render();break;
 case'jump-marker':rt.replayTime=Number(el.dataset.value);rt.replayPlaying=false;render();break;
 case'setup-source':rt.setupMode=el.dataset.value;render();break;
 case'setup-back':rt.setupStep=Math.max(1,rt.setupStep-1);render();break;
 case'setup-next':if(rt.setupStep===1){if(rt.setupMode==='demo')useDemo();else if(!rt.connected||rt.invalidSignal||rt.mode!=='bridge'){toast('Verbinde zuerst die Messbrücke.');break}}if(rt.setupStep===4){state.setupComplete=true;persist();rt.setupStep=1;route('monitor');toast('Einrichtung abgeschlossen.')}else{rt.setupStep++;render();const heading=$('.wizard-card h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}}break;
 }}

document.addEventListener('click',event=>{if(event.target.closest('.skip-link')){event.preventDefault();$('#main')?.focus();return}const el=event.target.closest('[data-action]');if(el&&!el.disabled){handleAction(el,event).catch(e=>toast(e.message))}});
document.addEventListener('submit',event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form);try{switch(form.dataset.form){
 case'marker':{const note=data.get('note').trim();if(!note)return;const m={id:generateId('note'),t:rt.elapsed,note};rt.markers.push(m);if(rt.record)rt.record.markers.push({...m,t:Math.max(0,m.t-rt.record.startElapsed)});render();toast('Notiz hinzugefügt.');break}
 case'edit-marker':{const note=data.get('note').trim();const marker=rt.markers.find(x=>x.id===dialogContext);if(marker)marker.note=note;if(rt.record){const rm=rt.record.markers.find(x=>x.id===dialogContext);if(rm)rm.note=note}closeDialog();render();toast('Notiz aktualisiert.');break}
 case'profile':{const old=profile(),target=Number(data.get('target')),lower=Number(data.get('lower')),upper=Number(data.get('upper'));if(!(lower<upper&&target>=lower&&target<=upper&&lower>=SENSOR.rangeStart&&upper<=SENSOR.rangeEnd)){ $('#dialog-error').textContent=`Der Sollwert muss zwischen den Sollgrenzen liegen. Beide Grenzen müssen im Messbereich ${rangeText()} liegen.`;break}const p=clone(old),changed=target!==p.target||lower!==p.lower||upper!==p.upper;p.name=data.get('name').trim();if(!p.name){$('#dialog-error').textContent='Bitte gib einen Profilnamen ein.';break}p.description=data.get('description').trim();p.target=target;p.lower=lower;p.upper=upper;p.rate=Number(data.get('rate'));if(changed){p.learnedLower=lower;p.learnedUpper=upper;p.version++;p.history.push({id:generateId('profile-change'),type:'profile',at:new Date().toISOString(),version:p.version,changed:true,previousLower:old.learnedLower,previousUpper:old.learnedUpper,nextLower:lower,nextUpper:upper,reason:'Profil geändert und Auswertungsgrenzen zurückgesetzt.'})}if(data.get('saveMode')==='copy'){p.id=generateId('profile');p.history=[];p.version=1;state.profiles.push(p);state.activeProfileId=p.id}else setProfile(p);if(changed){rt.points=rt.mode==='demo'?makeDemoPoints(60,0,0,target):[];if(rt.mode==='demo'){rt.value=target;rt.elapsed=60;}rt.zeroOffset=0;rt.markers=[];rt.deviation=null;rt.lastFeedback=null}const saved=persist();closeDialog();render();if(saved)toast('Messprofil gespeichert.');break}
 case'start-record':startRecord(data.get('name').trim());break;
 case'rename-run':{const r=state.recordings.find(x=>x.id===dialogContext);if(!data.get('name').trim()){toast('Bitte gib einen Namen ein.');break}if(r)r.name=data.get('name').trim();const saved=persist();closeDialog();render();if(saved)toast('Messung umbenannt.');break}
 case'settings':{if(rt.record){toast('Bitte zuerst die Aufnahme stoppen.');break}const p=clone(profile());p.rate=Number(data.get('rate'));p.window=Number(data.get('window'));setProfile(p);rt.window=p.window;rt.bridgeUrl=data.get('bridgeUrl').trim();state.settings.bridgeUrl=rt.bridgeUrl;state.settings.rate=p.rate;if(persist())toast('Einstellungen gespeichert.');render();break}
 }}catch(e){toast(e.message)}});
document.addEventListener('change',async event=>{const el=event.target;const field=el.dataset.field;if(!field)return;switch(field){case'language':{
  await setLanguage(el.value);
  const drafts=['#bridge-url','#setting-rate','#setting-window','#live-port'].map(selector=>[selector,$(selector)?.value]);
  const expanded=$('.connection-details')?.open;
  render();
  for(const [selector,value] of drafts){const input=$(selector);if(input&&value!==undefined&&(!input.options||Array.from(input.options).some(option=>option.value===value)))input.value=value}
  if(expanded&&$('.connection-details'))$('.connection-details').open=true;
  break;
}case'profile':if(el.value!==profile().id)openDialog('profile-preview',el.value);el.value=profile().id;break;case'run':if(el.checked){if(rt.selected.size>=2){el.checked=false;toast('Wähle höchstens zwei Messungen für einen Vergleich.');break}rt.selected.add(el.value)}else rt.selected.delete(el.value);rt.analysis=null;rt.replayPlaying=false;render();break;case'speed':rt.replaySpeed=Number(el.value);break;case'report-start':case'report-end':{const r=recording(),start=field==='report-start'?Number(el.value):rt.reportStart,end=field==='report-end'?Number(el.value):rt.reportEnd;try{slicePoints(r,start,end);rt.reportStart=start;rt.reportEnd=end;render()}catch(e){el.value=field==='report-start'?rt.reportStart:rt.reportEnd;toast(e.message)}break}}});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='run-search'){rt.search=el.value;const query=el.value.toLocaleLowerCase();document.querySelectorAll('[data-run-id]').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(query))}if(el.dataset.field==='offset'){rt.offset=Number(el.value);$('#offset-label').textContent=rt.offset.toFixed(1)+' s';drawCharts()}if(el.dataset.field==='replay'){rt.replayTime=Number(el.value);rt.replayPlaying=false;$('#replay-time').textContent=formatDuration(rt.replayTime);drawCharts()}});
$('#dialog').addEventListener('close',()=>{rt.dialogViewer?.dispose();rt.dialogViewer=null;dialogType='';dialogContext=null});
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog()}});
function readRoute(){const name=location.hash.slice(1);rt.route=['monitor','recordings','advanced','setup'].includes(name)?name:'monitor';rt.replayPlaying=false;render()}
window.addEventListener('hashchange',()=>{closeDialog();readRoute();window.scrollTo(0,0)});
window.addEventListener('resize',()=>drawCharts());
let savedTheme;
try { savedTheme = localStorage.getItem('me-theme'); } catch {}
applyTheme(savedTheme);
assistant=createAssistantUI({getContext:assistantContext,getChartSummary:assistantChartSummary,getError:assistantError});
rt.window=profile().window;readRoute();startTranslations();document.fonts.ready.then(()=>drawCharts());refreshBackend(true);
setInterval(()=>{const now=performance.now(),dt=Math.min(1,(now-lastTick)/1000);lastTick=now;if(rt.mode==='demo'&&rt.connected&&!rt.paused&&!rt.invalidSignal){rt.tick++;const t=rt.elapsed+1/DISPLAY_RATE,p=profile(),value=p.target+Math.sin(t*1.23)*.011+Math.sin(t*4.7)*.003+Math.sin(t*.31)*.004;addValue(Math.round(value*1e6)/1e6)}if(rt.mode==='bridge'&&rt.connected&&now-rt.lastBridgeAt>4000){disconnectSocket();connectionFailed('Seit vier Sekunden wurden keine neuen Messwerte empfangen. Die Verbindung wird erneut aufgebaut.',true)}if(rt.replayPlaying&&rt.route==='recordings'){const r=recording();if(r){rt.replayTime=Math.min(r.duration,rt.replayTime+dt*rt.replaySpeed);if(rt.replayTime>=r.duration){rt.replayPlaying=false;render()}else{const range=$('[data-field="replay"]');if(range)range.value=rt.replayTime;if($('#replay-time'))$('#replay-time').textContent=formatDuration(rt.replayTime);drawCharts()}}}},200);
window.addEventListener('beforeunload',event=>{if(rt.record||rt.unsaved){event.preventDefault();event.returnValue=''}});
