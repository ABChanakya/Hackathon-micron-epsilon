import {pdfText} from './pdf-i18n.js?v=ui-review-3';
import {SENSOR, DISPLAY_RATE, createInitialState, loadState, saveState, makeDemoPoints, acceptFeedback, acceptRange, fitToTraining, undoLearning, resetLearning, exportRecordingCSV, exportReportPDF, statistics, slicePoints, formatDuration, generateId, matchesBackendSensor, parseBridgeSample, bridgeLedState, useSensor, sensorFromStatus, adoptSensor, unitOf} from './data.js?v=ui-review-3';
import {buildSlopeSeries} from './measurement-series.js?v=slope-1';
import {LANGUAGES, getLanguage, getLocale, setLanguage, applyTranslations, startTranslations} from './i18n.js?v=ui-review-3';
import {createAssistantUI} from './assistant-ui.js?v=local-ai-1';
import {assistantText} from './assistant-i18n.js?v=ui-review-3';
import {installHints, announce} from './hints.js?v=hints-3';
import {createSettingsDraftStore,readSettingsForm,restoreSettingsForm,validateProfileFields,validateProfileSettings,validateConnectionSettings,validateMlSettings,mlSettingsValues,mlOperatingState,mlEventTime,ML_FIELD_LIMITS} from './settings-revisions.js?v=settings-2';

// The 3D sensor view is only for devices whose data call for it: a verified distance sensor (backend device check:
// device.ui.sensor_3d). It is loaded on demand, so the 3D engine is not even downloaded for the thermometer.
let viewerModule;
const loadViewer=()=>viewerModule??=import('./sensor3d.js?v=ui-review-3');
function has3d(){const d=rt.backendStatus?.device;return SENSOR.kind==='distance'&&(rt.mode==='demo'||!d||(d.verified===true&&d.ui?.sensor_3d===true))}
function mountViewer(target,options,assign){if(!target)return;loadViewer().then(m=>{if(!target.isConnected||!has3d())return;assign(m.createSensorViewer(target,options))}).catch(()=>{target.hidden=true})}
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
const rt={route:'monitor',mode:'bridge',connected:false,paused:false,channelBreak:false,lastValidAt:null,breaks:[],scaleMode:'spec',tableSnapshot:null,tableOpen:false,highlightTime:null,pdfBusy:false,elapsed:0,value:SENSOR.midpoint,points:[],markers:[],zeroOffset:0,window:30,record:null,saving:false,unsaved:null,lastSaved:null,deviation:null,lastFeedback:null,cooldown:0,scenario:'normal',feedback:[],viewer:null,dialogViewer:null,led:{state:'unknown',output:'unknown'},selected:new Set(),analysis:null,offset:0,replayTime:0,replayPlaying:false,replaySpeed:1,reportStart:0,reportEnd:60,setupStep:1,setupMode:'bridge',setupChecked:false,socket:null,socketTimer:null,retryTimer:null,backendStatus:null,ports:[],simAvailable:false,backendAvailable:false,bridgeUrl:state.settings.bridgeUrl||defaultBridgeUrl(),connectionError:'',storageError:bootError,charts:[],tick:0,errorEvents:[],activeErrorKeys:new Set(),alertSound:true,alertAudio:null,deviationAlarmTimer:null,deviationAlarmMode:'single',outsideEpisode:false};
try{rt.alertSound=localStorage.getItem('me-error-sound')!=='off';rt.deviationAlarmMode=localStorage.getItem('me-deviation-alarm-mode')==='repeat'?'repeat':'single'}catch{}
let toastTimer,dialogType='',dialogContext=null,lastTick=performance.now(),assistant;
const profile=()=>state.profiles.find(p=>p.id===state.activeProfileId)||state.profiles[0];
const recording=()=>state.recordings.find(r=>r.id===[...rt.selected][0]);
const vnum=(v,offset=rt.zeroOffset)=>num(v-offset);
const gaugePosition = (value, p) => Math.max(1, Math.min(99, 15 + (value - p.lower) / (p.upper - p.lower) * 70));
const sourceLabel=()=>rt.mode==='demo'?'Demodaten':rt.backendReplay?'Wiedergabe':rt.backendStatus?.source==='sim'?'Simulator':'Sensor online';
const recordingSource=r=>r.source==='demo'?'Demo':r.source==='replay'?'Wiedergabe':'Sensor';
const currentStatus=()=>!rt.connected?'Nicht verbunden':rt.invalidSignal?'Kein gültiger Messwert':rt.saving?'Wird gespeichert':rt.unsaved?'Noch nicht gespeichert':rt.record?'Aufnahme läuft':rt.paused?'Anzeige pausiert':'Messung läuft';
function measurementSource(){return rt.mode==='demo'||rt.backendStatus?.source==='sim'?'demo':rt.backendReplay?'replay':'live'}
function measurementSourceLabel(){return {demo:'Demo',replay:'Wiedergabe',live:'Sensor'}[measurementSource()]}
function visibleWindow(){return {start:Math.max(0,rt.elapsed-rt.window),end:Math.max(rt.elapsed,rt.window)}}
function markInterruption(reason){
  const previous=rt.breaks.at(-1);
  if(rt.points.length&&!(previous?.t===rt.elapsed&&previous.reason===reason))rt.breaks.push({t:rt.elapsed,reason});
  rt.channelBreak=true;
}
function chartStatus(){
  const frozen=!rt.connected||rt.invalidSignal||rt.paused;
  if(!rt.points.length)return 'Warte auf gültige Messwerte';
  if(frozen)return `Historischer Stand · ${rt.lastValidAt?new Date(rt.lastValidAt).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit',second:'2-digit'}):formatDuration(rt.elapsed)}`;
  return rt.scaleMode==='auto'?'Y-Achse automatisch vergrößert':'Sollgrenzen und Messwerte sichtbar';
}
function assistantContext(){return {route:rt.route,sensor:{id:SENSOR.id,model:SENSOR.model,unit:SENSOR.unit,rangeStart:SENSOR.rangeStart,rangeEnd:SENSOR.rangeEnd},source:measurementSource(),connected:rt.connected,valid:rt.connected&&!rt.invalidSignal,value:rt.value,profile:clone(profile()),window:rt.window,zeroOffset:rt.zeroOffset,capturedAt:new Date().toISOString(),lastValidAt:rt.lastValidAt,paused:rt.paused,...visibleWindow()}}
function assistantChartSummary(){
  const {start,end}=visibleWindow();
  const points=rt.points.filter(point=>point.t>=start&&point.t<=end&&Number.isFinite(point.value));
  const summary=statistics(points.map(point=>({...point,value:point.value-rt.zeroOffset}))),p=profile();
  const chunk=Math.max(1,Math.floor(points.length/4));
  const mean=list=>list.reduce((sum,point)=>sum+point.value,0)/Math.max(1,list.length);
  return {...summary,trend:points.length>1?mean(points.slice(-chunk))-mean(points.slice(0,chunk)):0,outside:points.filter(point=>point.value<p.lower||point.value>p.upper).length,duration:end-start,start,end};
}
function assistantError(){
  if(rt.connectionError||!rt.connected)return {code:'SENSOR_DISCONNECTED',message:rt.connectionError||'Nicht verbunden'};
  if(rt.invalidSignal)return {code:'INVALID_SIGNAL',message:rt.invalidError||'Kein gültiger Messwert'};
  if(rt.deviation)return {code:'OUTSIDE_TOLERANCE',message:'Außerhalb der Auswertungsgrenzen',eventValue:rt.deviation.value,eventTime:rt.deviation.t,thresholdMin:rt.deviation.profile?.learnedLower??profile().learnedLower,thresholdMax:rt.deviation.profile?.learnedUpper??profile().learnedUpper};
  return null;
}
const storageRecoveryMessage='Die Originaldaten bleiben erhalten. Lokales Speichern ist gesperrt. Neue Aufnahmen kannst du als CSV sichern.';
function persist(){if(bootError){rt.storageError=bootError;toast(storageRecoveryMessage);return false}try{saveState(state);rt.storageError='';resolveIncident('storage');return true}catch(e){rt.storageError=e.message;reportIncident('storage','Speichern nicht möglich',e.message);toast(e.message);return false}}
function primeAlertAudio(){if(!rt.alertSound)return;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;rt.alertAudio??=new Audio();if(rt.alertAudio.state==='suspended')rt.alertAudio.resume().catch(()=>{})}catch{}}
function playAlertSound(){if(!rt.alertSound)return;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;const ctx=rt.alertAudio??=new Audio();const play=()=>{if(ctx.state!=='running')return;[920,920,760].forEach((hz,i)=>{const start=ctx.currentTime+i*.19,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='square';osc.frequency.setValueAtTime(hz,start);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.2,start+.012);gain.gain.setValueAtTime(.2,start+.105);gain.gain.exponentialRampToValueAtTime(.0001,start+.125);osc.connect(gain);gain.connect(ctx.destination);osc.start(start);osc.stop(start+.13)})};if(ctx.state==='suspended')ctx.resume().then(play).catch(()=>{});else play()}catch{}}
function startDeviationAlarm(){if(!rt.alertSound||rt.deviationAlarmMode!=='repeat'||rt.deviationAlarmTimer)return;playAlertSound();rt.deviationAlarmTimer=setInterval(()=>playAlertSound(),1600)}
function stopDeviationAlarm(){if(rt.deviationAlarmTimer){clearInterval(rt.deviationAlarmTimer);rt.deviationAlarmTimer=null}}
function setDeviationAlarmMode(mode){rt.deviationAlarmMode=mode==='repeat'?'repeat':'single';try{localStorage.setItem('me-deviation-alarm-mode',rt.deviationAlarmMode)}catch{}if(rt.deviationAlarmMode==='repeat'&&(rt.activeErrorKeys.has('deviation')||rt.activeErrorKeys.has('ml-anomaly')))startDeviationAlarm();else stopDeviationAlarm();toast(rt.deviationAlarmMode==='repeat'?'Der Alarm wiederholt sich, bis der Wert wieder in den Grenzen liegt.':'Ein Signalton pro Überschreitung.')}
function reportIncident(key,type,message){if(rt.activeErrorKeys.has(key))return;rt.activeErrorKeys.add(key);rt.errorTotal=(rt.errorTotal||0)+1;rt.errorEvents.unshift({id:generateId('error'),time:new Date().toISOString(),type,message});rt.errorEvents=rt.errorEvents.slice(0,5);if(['deviation','ml-anomaly'].includes(key)&&rt.deviationAlarmMode==='repeat')startDeviationAlarm();else playAlertSound();const n=$('#error-count');if(n)n.textContent=String(rt.errorTotal);}
// The factory plan (shared with the phone view: /handy/fabrikplan/karte.mjs) sits below the measuring area. It lives
// outside #app so the frequent re-renders do not rebuild it. The real sensor drives one of its modules; simulated
// modules that go into alarm are reported like any other incident (sound and error list).
let factoryMounted=false;
function showFactory(){const host=$('#factory-host');if(!host)return;host.hidden=rt.route!=='monitor';if(factoryMounted||host.hidden)return;factoryMounted=true;
  import('/handy/fabrikplan/karte.mjs').then(({mountFactoryPlan})=>mountFactoryPlan(host,{open:true,
    selectSensor(sensor){if(sensor.live){const panel=$('.measurement-panel');panel?.scrollIntoView({block:'start',behavior:'smooth'});panel?.querySelector('[data-action="record"]')?.focus({preventScroll:true})}else toast(`${sensor.name} · ${sensor.model}${sensor.suffix?' · Messkopf '+sensor.suffix:''}: simuliertes Modul. Echte Werte liefert der angeschlossene Sensor (LIVE).`)},
    onAlarm({key,active,text}){if(active)reportIncident('factory:'+key,'Modul-Alarm',text);else resolveIncident('factory:'+key)}}))
  .catch(()=>{host.hidden=true})}
function resolveIncident(key){rt.activeErrorKeys.delete(key);if(['deviation','ml-anomaly'].includes(key)&&!rt.activeErrorKeys.has('deviation')&&!rt.activeErrorKeys.has('ml-anomaly'))stopDeviationAlarm()}
function toggleAlertSound(){rt.alertSound=!rt.alertSound;try{localStorage.setItem('me-error-sound',rt.alertSound?'on':'off')}catch{}if(rt.alertSound){primeAlertAudio();if(rt.activeErrorKeys.has('deviation'))startDeviationAlarm()}else stopDeviationAlarm();render();toast(rt.alertSound?'Alarmton aktiviert.':'Alarmton ausgeschaltet.')}
function toast(message){clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),4500)}
function placeToast(el){const main=$('#main');if(!el||!main)return;const notices=$('#monitor-notices');(notices?.parentElement||main).insertBefore(el,notices||main.firstChild)}
function setProfile(p){state.profiles=state.profiles.map(x=>x.id===p.id?p:x)}
function ledColor(value){return{green:'var(--good)',yellow:'var(--warn)',red:'var(--bad)',off:'var(--faint)',unknown:'var(--muted)'}[value]||'var(--muted)'}
const ledLabel=value=>({green:'Grün',yellow:'Gelb',red:'Rot',off:'Aus',unknown:'Unbekannt'})[value]||'Unbekannt';
function ledMeaning(name,value){return({state:{green:'Das Objekt liegt im Messbereich des Sensors.',yellow:'Das Objekt befindet sich in der Messbereichsmitte.',red:'Kein gültiger Abstand. Prüfe den Messbereich und die reflektierende Oberfläche.',off:'Der Laser ist ausgeschaltet.',unknown:'Der Sensorstatus ist nicht verfügbar.'},output:{green:'RS422 ist aktiv. Der Analogausgang ist aus.',yellow:'Die Schaltausgänge sind aktiv. RS422, Analogausgang oder Webinterface können zugeschaltet werden.',red:'Der Analogausgang ist aktiv: 4–20 mA, 0–5 V oder 0–10 V.',off:'Der Sensor ist ausgeschaltet oder ohne Versorgung.',unknown:'Der Ausgabestatus ist nicht verfügbar.'}})[name][value]}
function route(name){location.hash=name}

function liveConnectionPanel(){
  if(rt.mode==='demo'||rt.connected)return '';
  return `<section class="notice" aria-label="Datenquelle"><div class="notice-body"><strong>${rt.backendAvailable?'Datenquelle wählen':'Messserver verbinden'}</strong><p>${rt.backendAvailable?'Du kannst ohne Sensor üben oder einen echten Sensor anschließen.':'Starte den Messserver mit ./start.sh. Ohne Sensor kannst du „Demo“ im Verbindungsmenü wählen.'}</p>${rt.backendAvailable?`<div class="notice-actions">${rt.simAvailable?`<button type="button" class="btn compact" data-action="connect-simulator" ${rt.connecting?'disabled':''}>${icon('wave')} ${rt.connecting?'Wird gestartet …':'Echte Aufnahmen abspielen'}</button>`:''}${rt.ports.length?`<div class="field"><label for="live-port">Sensoranschluss</label><select id="live-port">${rt.ports.map(p=>`<option value="${esc(p.sensor+'|'+p.port)}">${p.sensor==='thermo'?'thermoMETER UC':'optoNCDT'} · ${esc(p.port)}</option>`).join('')}</select></div><button type="button" class="btn compact" data-action="connect-sensor" ${rt.connecting?'disabled':''}>${icon('plug')} ${rt.connecting?'Wird verbunden …':'Sensor verbinden'}</button>`:'<span class="small">Kein USB-Sensoranschluss gefunden.</span>'}<button type="button" class="btn quiet compact" data-action="scan-sensors">${icon('reset')} Anschlüsse prüfen</button></div>`:''}</div></section>`;
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
    rt.simAvailable=sources.some(s=>s.sensor==='SIM');
    rt.ports=sources.filter(s=>['serial','ME-Bus'].includes(s.interface)&&s.port);
    if(status.status==='error'){rt.connectionError=status.error;reportIncident('connection', 'Verbindung zum Server', status.error)}
    render();
  }catch{
    if(rt.mode!=='bridge'||address!==rt.bridgeUrl)return;
    if(attach&&address!==defaultBridgeUrl()){connectBridge(true);return}
    rt.connectionError='Der Messserver ist nicht erreichbar. Starte ./start.sh oder prüfe die Adresse in den Einstellungen.';
    reportIncident('connection', 'Verbindung zum Server', rt.connectionError);
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
  Object.assign(rt,{mode:'bridge',connected:false,paused:false,invalidSignal:false,connectionError:'',points:[],markers:[],elapsed:0,lastValidAt:null,breaks:[],tableSnapshot:null,tableOpen:false,zeroOffset:0,deviation:null,lastFeedback:null,led:{state:'unknown',output:'unknown'}});
  render();
  refreshBackend(true);
}

async function connectSimulator(){
  if(rt.connecting||rt.record)return;
  const address=rt.bridgeUrl;rt.connecting=true;rt.connectionError='';render();
  try{const status=await backendRequest('/api/status',{},address);if(status.status!=='streaming'){
    // No sensor: play back the real recordings we made with the ILD1900 (one take per material, looped).
    // Only if there are none does the backend's artificial simulator step in.
    const recordings=await backendRequest('/api/recordings',{},address).catch(()=>[]);
    const files=recordings.filter(r=>r.file&&/^ILD1900/.test(r.info?.model||'')&&/median 9/.test(r.label||'')).map(r=>r.file).reverse();
    await backendRequest('/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(SENSOR.id==='ild1900'&&files.length?{sensor:'REPLAY',files,loop:true}:{sensor:'SIM'})},address)}if(rt.mode==='bridge'&&address===rt.bridgeUrl)connectBridge(true)}
  catch(error){rt.connectionError=`Die Aufnahmen konnten nicht abgespielt werden: ${error.message}`;reportIncident('simulator', 'Wiedergabe', rt.connectionError);render()}
  finally{rt.connecting=false;render()}
}

const nextTheme = () => document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
const themeActionLabel = () => nextTheme() === 'dark' ? 'Dunkles Farbschema aktivieren' : 'Helles Farbschema aktivieren';
const themeIcon = () => icon(nextTheme() === 'dark' ? 'moon' : 'sun');

// Text size for large rooms: "Saal" scales the whole page (text, buttons, charts) so it can be read from the back of a
// hall on a projector. Stored per browser like the colour scheme.
const TEXT_SIZES = { normal: 1, large: 1.25, hall: 1.5 };
const textSizeKey = 'me-text-size';
function savedTextSize() { try { return localStorage.getItem(textSizeKey); } catch { return null; } }
function applyTextSize(size) {
  const key = Object.hasOwn(TEXT_SIZES, size) ? size : 'normal';
  const root = document.documentElement;
  root.dataset.textSize = key;
  root.style.zoom = key === 'normal' ? '' : String(TEXT_SIZES[key]);
  for (const button of document.querySelectorAll('[data-action="hall"]')) button.setAttribute('aria-pressed', String(key === 'hall'));
  const select = $('#text-size-select');
  if (select) select.value = key;
  drawCharts();
}
function setTextSize(size) {
  applyTextSize(size);
  try { localStorage.setItem(textSizeKey, document.documentElement.dataset.textSize); } catch {}
}

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
function header(){return `<header class="app-header"><a href="/pitch/" class="brand" aria-label="Zur Hauptseite" title="Zur Hauptseite"><img class="brand-logo" src="assets/micro-epsilon-logo.svg" alt="Micro-Epsilon" width="85" height="64"></a><nav class="nav" aria-label="Hauptnavigation"><a href="#monitor" ${rt.route==='monitor'?'aria-current="page"':''}>Sensor Cockpit</a><a href="#recordings" ${rt.route==='recordings'?'aria-current="page"':''}>Aufzeichnungen</a></nav><div class="header-right"><button type="button" class="assistant-launcher" data-action="assistant-open" aria-label="${esc(assistantLabel('open'))}" aria-haspopup="dialog" aria-controls="assistant-drawer" data-i18n-skip>${icon('chat')}<span>${esc(assistantLabel('title'))}</span></button><button type="button" class="icon-button hall-toggle" data-action="hall" aria-pressed="${document.documentElement.dataset.textSize==='hall'}" aria-label="Saalansicht: große Schrift für Beamer und große Räume" title="Saalansicht: große Schrift für Beamer und große Räume"><span aria-hidden="true">Aa</span></button><a class="icon-button settings-link" href="#advanced" aria-label="Einstellungen öffnen" title="Einstellungen" ${rt.route==='advanced'?'aria-current="page"':''}>${icon('gear')}</a></div></header>`}

function globalNotices(){return `${rt.record&&rt.route!=='monitor'?`<div class="notice">${icon('clock')}<div class="notice-body"><strong>Aufnahme läuft · <span id="record-duration">${formatDuration(rt.elapsed-rt.record.startElapsed)}</span></strong><p data-i18n-skip>${esc(rt.record.name)}</p></div><a class="btn compact" href="#monitor">Zur Aufnahme ${icon('arrow')}</a></div>`:''}${rt.invalidSignal&&rt.route!=='monitor'?`<div class="notice error">${icon('alert')}<div class="notice-body"><strong>Kein gültiger Messwert</strong><p>${esc(rt.invalidError||'Simulierter Messfehler. Die Auswertungsgrenzen bleiben unverändert.')}</p><div class="notice-actions">${rt.mode==='demo'?'<button class="btn compact" data-action="resume-signal">Gültige Werte fortsetzen</button>':''}<button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div></div>`:''}${rt.storageError&&rt.route!=='monitor'?`<div class="notice error">${icon('alert')}<div><strong>Lokales Speichern ist nicht verfügbar</strong><p>${esc(rt.storageError)}</p>${bootError?`<p>${esc(storageRecoveryMessage)}</p>`:''}</div></div>`:''}${rt.connectionError&&rt.route!=='monitor'?`<div class="notice error">${icon('plug')}<div class="notice-body"><strong>Datenquelle getrennt</strong><p>${esc(rt.connectionError)}</p><div class="notice-actions"><button class="btn compact" data-action="reconnect">${icon('reset')} Erneut verbinden</button><button class="btn quiet compact" data-action="connection">Verbindung prüfen</button><button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div></div>`:''}`}
function monitorNotices(){
  const storage=rt.storageError?`<div class="notice error"><div><strong>Lokales Speichern ist nicht verfügbar</strong><p>${esc(rt.storageError)}</p>${bootError?`<p>${esc(storageRecoveryMessage)}</p>`:''}</div></div>`:'';
  if(rt.invalidSignal)return storage+`<section class="notice error" aria-label="Signalfehler"><div class="notice-body"><strong>Kein gültiger Messwert</strong><p>${esc(rt.invalidError||'Simulierter Messfehler. Die Auswertungsgrenzen bleiben unverändert.')}</p><div class="notice-actions">${rt.mode==='demo'?'<button class="btn compact" data-action="resume-signal">Gültige Werte fortsetzen</button>':''}<button class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${esc(assistantLabel('error'))}</button></div></div></section>`;
  if(rt.connectionError)return storage+`<section class="notice error" aria-label="Sensorverbindung"><div class="notice-body"><strong>Datenquelle getrennt</strong><p>${esc(rt.connectionError)}</p><div class="notice-actions"><button class="btn compact" data-action="reconnect">${icon('reset')} Erneut verbinden</button><button class="btn quiet compact" data-action="connection">Verbindungshilfe</button></div></div></section>`;
  return storage+liveConnectionPanel();
}
function chartDataView(){return `<details class="chart-data" id="chart-data" ${rt.tableOpen?'open':''}><summary>Messwerte als Tabelle</summary><div id="chart-data-content">${rt.tableSnapshot?chartDataRows(rt.tableSnapshot):''}</div></details>`}
function captureChartData(){
  const {start,end}=visibleWindow(),slope=buildSlopeSeries(rt.points,{start,end,sensorUnit:U()});
  const trends=new Map(slope.points.map(point=>[point.t,point.value]));
  rt.tableSnapshot={capturedAt:new Date().toISOString(),start,end,unit:U(),offset:rt.zeroOffset,points:rt.points.filter(point=>point.t>=start&&point.t<=end).map(point=>({t:point.t,value:point.value-rt.zeroOffset,slope:trends.get(point.t)??null}))};
  return rt.tableSnapshot;
}
function chartDataRows(snapshot){
  const captured=new Date(snapshot.capturedAt).toLocaleTimeString(getLocale());
  return `<p><span>Tabellenstand</span> <span data-i18n-skip>${esc(captured)} · ${formatDuration(snapshot.start)}–${formatDuration(snapshot.end)}</span></p><button class="btn compact" data-action="refresh-chart-data">Aktualisieren</button>${snapshot.points.length?`<div class="table-wrap"><table><caption class="sr-only">Messwerte im eingefrorenen Zeitfenster</caption><thead><tr><th>Zeit</th><th>${esc(SENSOR.quantity)} (${snapshot.unit})</th><th>Slope (${snapshot.unit}/s)</th></tr></thead><tbody data-i18n-skip>${snapshot.points.map(point=>`<tr><td>${num(point.t,'s')} s</td><td>${num(point.value,snapshot.unit)}</td><td>${Number.isFinite(point.slope)?num(point.slope,snapshot.unit+'/s'):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p>Keine Messwerte in diesem Zeitfenster.</p>'}`;
}
// What "In Ordnung" would confirm: the lowest and highest value of the window being looked at (10/30/60 s).
function localSuggest(){const from=rt.elapsed-rt.window,vals=rt.points.filter(p=>p.t>=from).map(p=>p.value);return vals.length?{lo:Math.min(...vals),hi:Math.max(...vals),seconds:rt.window}:null}
async function fetchSuggest(){
  let s=null;
  if(rt.mode==='bridge'&&rt.connected){try{s=await backendRequest(`/api/ml/suggest?seconds=${rt.window}`)}catch{}}
  rt.suggest=s||localSuggest();
  return rt.suggest;
}
function refreshSuggest(){fetchSuggest().then(()=>{const target=$('#learning-notice');if(target&&rt.deviation)target.innerHTML=learningNotice()})}
function suggestLine(){const s=rt.suggest;if(!s||!Number.isFinite(s.lo))return '';return `<p class="suggest"><strong>Vorschlag:</strong> Bei „In Ordnung“ werden die Auswertungsgrenzen auf <span class="mono">${num(s.lo)}–${num(s.hi)} ${U()}</span> erweitert, den tiefsten und höchsten Wert der letzten ${rt.window} s.</p>`}
const ML_REASON={no_match:'Passt zu keinen bekannten Daten',mean:'Messwert verschoben',std:'Rauschen erhöht',p2p:'Schwankung erhöht',slope:'Ungewöhnlicher Verlauf',jitter:'Unruhiges Signal',err_frac:'Mehr ungültige Messwerte',intensity:'Signalstärke verändert',invalid_samples:'Zu viele ungültige Messwerte',dropped_samples:'Messwerte verloren',hard_limit:'Grenzwert überschritten',extreme_score:'Extreme Abweichung'};
const mlReason=r=>ML_REASON[r]||'Ungewöhnliches Muster';
const mlNum=v=>Number(v).toLocaleString(getLocale(),{maximumFractionDigits:1});
function mlChip(){const m=rt.ml;if(!m||!rt.connected||rt.mode!=='bridge'||['idle','off'].includes(m.state))return '';const known=m.known?`Bekannte Anomalie${m.known.label_note?' · '+m.known.label_note:''}`:null;const text={learning:`KI lernt Normalzustand · ${Math.round((m.progress||0)*100)} %`,watching:'KI überwacht',alert:known||`KI · ${mlReason(m.reason)}`,error:`KI · ${mlReason(m.reason)} · verworfen`}[m.state]||'KI';const dot={learning:'accent',watching:'good'}[m.state]||'bad';const title=m.score!=null?`Abweichung vom Normalzustand ${mlNum(m.score)} (Meldung ab ${mlNum(m.sensitivity)})`:'Anomalieerkennung';return `<span class="badge ml-chip" title="${esc(title)}"><span class="dot ${dot}"></span>${esc(text)}</span>`}
function fitLimitsToTraining(range){
  if(!Array.isArray(range)||rt.record)return;
  const key=range.join('|')+'|'+profile().id;if(rt.trainFitted===key)return;rt.trainFitted=key;
  const r=fitToTraining(profile(),range[0],range[1]);if(!r)return;
  setProfile(r.profile);persist();toast(`Auswertungsgrenzen an die Trainingsdaten angepasst: ${num(r.event.nextLower)}–${num(r.event.nextUpper)} ${U()}.`);
  if(rt.route==='advanced'||rt.route==='monitor')render();
}
function mlFrame(ml){rt.ml=ml;fitLimitsToTraining(ml.train_range);if(ml.state!=='alert')resolveIncident('ml-anomaly');const chip=$('#ml-chip');if(chip)chip.innerHTML=mlChip();const kn=ml.known;if(kn&&kn.id!==rt.mlKnownSeen&&!rt.deviation?.ml&&!rt.paused){reportIncident('ml-anomaly','Bekannte Anomalie erkannt',`${mlReason(kn.reason)}${kn.label_note?' · '+kn.label_note:''}`);rt.mlKnownSeen=kn.id;rt.mlKnown=kn;announce('KI: Bekannte Anomalie erkannt.');rt.deviation=null;rt.cooldown=rt.elapsed+10;if(rt.record)rt.record.markers.push({id:generateId('ml-known'),t:Math.max(0,rt.elapsed-rt.record.startElapsed),note:`KI · Bekannte Anomalie${kn.label_note?': '+kn.label_note:''}`});const target=$('#learning-notice');if(target)target.innerHTML=learningNotice()}const ev=ml.pending;if(ev&&ev.id!==rt.mlSeen&&!rt.deviation?.ml&&!rt.paused){reportIncident('ml-anomaly','Anomalie erkannt',`${mlReason(ev.reason)} · score ${mlNum(ev.score)}`);rt.mlSeen=ev.id;announce('KI: Auffälligkeit erkannt. Bitte bewerten.');refreshSuggest();rt.deviation={value:ev.value,t:rt.elapsed,profile:clone(profile()),ml:ev};rt.lastFeedback=null;const target=$('#learning-notice');if(target)target.innerHTML=learningNotice()}}
function nearestLine(e){const n=e?.nearest;return n?`<p class="suggest"><strong>Ähnlichste bekannte Daten:</strong> <span data-i18n-skip>${esc(n.note||'ohne Name')}</span> (${n.cls==='anomaly'?'Anomalie':'normal'}). ${e.reason==='no_match'?'Zu keinen bekannten Daten passend, bitte beurteilen: Deine Antwort wird als beschriftete Daten gelernt.':''}</p>`:''}
function mlNotice(d){const e=d.ml;return `<section class="notice" aria-label="Auffälligkeit">${icon('spark')}<div class="notice-body"><strong>KI-Auffälligkeit · ${esc(mlReason(e.reason))}</strong><p><span>Ereignis bei</span> <span class="mono">${formatDuration(d.t)}</span> · ${e.value!=null?`<span class="mono">${num(e.value)} ${U()}</span> · `:''}${mlNum(e.score)}-fache Abweichung vom gelernten Normalzustand (Meldung ab ${mlNum(rt.ml?.sensitivity??6)}). Bewerte dieses Signalmuster.</p><button type="button" class="text-button" data-action="focus-event">Im Diagramm anzeigen</button>${nearestLine(e)}${suggestLine()}<input class="feedback-note" id="feedback-note" placeholder="Optionale Begründung …" aria-label="Begründung zur Bewertung" maxlength="300"><div class="notice-actions" data-feedback-kind="ml"><button class="btn compact" data-action="feedback" data-accepted="true">${icon('check')} Als Normalmuster lernen</button><button class="btn quiet compact" data-action="feedback" data-accepted="false">${icon('close')} Als Anomalie lernen</button></div></div><button class="icon-button" data-action="dismiss-deviation" aria-label="Später bewerten">${icon('close')}</button></section>`}
function learningNotice(){if(rt.deviation?.ml)return mlNotice(rt.deviation);if(rt.mlKnown&&!rt.deviation){const e=rt.mlKnown;return `<section class="notice error" aria-label="Bekannte Anomalie">${icon('alert')}<div class="notice-body"><strong>Anomalie erkannt${e.label_note?' · '+esc(e.label_note):''}</strong><p>${e.value!=null?`<span class="mono">${num(e.value)} ${U()}</span> · `:''}Gleicht einer als „nicht in Ordnung“ gelernten Messung. Auffälligstes Merkmal: ${esc(mlReason(e.reason))}.</p></div><button class="icon-button" data-action="dismiss-known" aria-label="Hinweis schließen">${icon('close')}</button></section>`}if(rt.lastFeedback?.ml){const e=rt.lastFeedback;return `<section class="notice success">${icon('check')}<div class="notice-body"><strong>${e.accepted?'Als normal gelernt':'Als Anomalie gelernt'}</strong><p>${e.accepted?'Ähnliche Signale werden nicht mehr gemeldet.':'Ähnliche Signale werden künftig direkt als Anomalie erkannt.'}${e.accepted&&e.limits?.changed?` Auswertungsgrenzen: ${num(e.limits.nextLower)}–${num(e.limits.nextUpper)} ${U()}.`:''}</p></div><button class="icon-button" data-action="dismiss-feedback" aria-label="Hinweis schließen">${icon('close')}</button></section>`}if(rt.deviation){const d=rt.deviation,p=d.profile;return `<section class="notice" aria-label="Messabweichung">${icon('alert')}<div class="notice-body"><strong>Außerhalb der Auswertungsgrenzen</strong><p><span>Ereignis bei</span> <span class="mono">${formatDuration(d.t)}</span> · <span class="mono">${num(d.value)} ${U()}</span> bei Auswertungsgrenzen von <span class="mono">${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}</span>.</p>${suggestLine()}<p>Diese Bewertung verändert nur die Auswertungsgrenzen. Die Sollgrenzen bleiben erhalten.</p><button type="button" class="text-button" data-action="focus-event">Im Diagramm anzeigen</button><input class="feedback-note" id="feedback-note" placeholder="Optionale Begründung …" aria-label="Begründung zur Bewertung" maxlength="300"><div class="notice-actions"><button class="btn compact" data-action="feedback" data-accepted="true">${icon('check')} Auswertungsgrenzen erweitern</button><button class="btn quiet compact" data-action="feedback" data-accepted="false">${icon('close')} Grenzen beibehalten</button><button type="button" class="btn quiet compact" data-action="assistant-error" data-i18n-skip>${icon('chat')}${esc(assistantLabel('error'))}</button></div></div><button class="icon-button" data-action="dismiss-deviation" aria-label="Später bewerten">${icon('close')}</button></section>`}
 if(rt.lastFeedback){const e=rt.lastFeedback;return `<section class="notice success">${icon('check')}<div class="notice-body"><strong>${e.changed?'Auswertungsgrenzen angepasst':'Bewertung gespeichert'}</strong><p>${e.changed?`Gelernte Grenzen: ${num(e.previousLower)}–${num(e.previousUpper)} → ${num(e.nextLower)}–${num(e.nextUpper)} ${U()}. Die Sollgrenzen bleiben erhalten.`:esc(e.reason)}</p>${e.changed?'<button class="text-button small" data-action="undo-learning">Anpassung rückgängig machen</button>':''}</div><button class="icon-button" data-action="dismiss-feedback" aria-label="Hinweis schließen">${icon('close')}</button></section>`}return ''}
function slopeChart(){return `<section class="slope-section" aria-labelledby="slope-heading"><div class="slope-head"><div><h2 id="slope-heading">Slope</h2><p class="small muted" id="slope-description">Trend über 1 s</p></div><div class="slope-current" id="slope-current"><span class="sr-only">Aktueller Slope</span><span id="slope-value" data-i18n-skip>— ${U()}/s</span></div></div><div class="chart-wrap slope-chart-wrap"><canvas id="slope-chart" role="img" aria-label="Slope-Diagramm: Änderung pro Sekunde über Zeit" aria-describedby="slope-description slope-current"></canvas><div class="chart-empty" id="slope-empty">Warte auf Messwerte</div></div></section>`}
function monitor(){const p=profile();return `<div class="page-heading monitor-heading">
  <div class="monitor-title"><h1>Sensor Cockpit</h1></div>
  ${rt.mode==='bridge'&&rt.backendReplay?`<span class="badge" title="Gespeicherte Messung, keine Live-Daten">Wiedergabe · <span data-i18n-skip>${esc(String(rt.backendReplay))}</span></span>`:''}<span id="ml-chip">${mlChip()}</span>
</div><div id="monitor-notices">${monitorNotices()}</div><div id="learning-notice">${learningNotice()}</div><div class="monitor-grid">
  <section class="panel measurement-panel" aria-label="Aktuelle Messung"><div class="reading-zone"><div class="reading-top"><div class="measurement-profile profile-selector">${icon('sliders','profile-icon')}<div><label class="sr-only" for="profile-select">Messprofil wählen</label><select id="profile-select" data-field="profile" ${rt.record?'disabled':''}>${state.profiles.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div></div><span class="badge" id="reading-source">${measurementSourceLabel()}</span><span class="status-label" id="record-state"><span class="dot ${rt.record||!rt.connected||rt.invalidSignal?'bad':'good'}"></span>${currentStatus()}</span></div><div class="reading-display"><span class="eyebrow">${rt.zeroOffset?SENSOR.labels.relative:SENSOR.labels.reading}</span><div class="reading-main"><span id="reading-value" class="reading-value">${rt.connected&&!rt.invalidSignal?vnum(rt.value):'—'}</span><span class="reading-unit">${U()}</span></div><div class="reading-sub" id="reading-sub">${rt.zeroOffset?`<span class="reading-detail">Nullpunkt ${num(rt.zeroOffset)} ${U()}</span>`:''}<span class="reading-detail">Sollwert <span id="target-value">${vnum(p.target)} ${U()}</span></span><span class="reading-detail">Abweichung <span id="deviation-value">${rt.connected&&!rt.invalidSignal?num(rt.value-p.target)+' '+U():'—'}</span></span></div></div><div class="tolerance"><div id="reading-state" class="reading-state good"><span class="dot"></span>Im Soll</div><div class="tolerance-track"><div class="tolerance-corridor"></div><div class="tolerance-mid" style="left:${gaugePosition(p.target, p)}%"></div><div class="tolerance-pointer" id="tolerance-pointer"></div></div><div class="tolerance-labels"><span>${vnum(p.lower)} ${U()}</span><span>Sollbereich</span><span>${vnum(p.upper)} ${U()}</span></div></div><div class="measurement-actions"><button class="btn quiet" data-action="pause" ${!rt.connected||rt.invalidSignal||rt.record?'disabled':''}>${icon(rt.paused?'play':'pause')} ${rt.paused?'Fortsetzen':'Anzeige pausieren'}</button><button class="btn quiet" data-action="zero" ${!rt.connected||rt.invalidSignal||rt.record?'disabled':''}>${icon('zero')} ${rt.zeroOffset?'Nullpunkt lösen':'Nullpunkt setzen'}</button></div></div></section>
  <section class="panel sensor-card"><div class="panel-heading"><div><h2 class="sensor-title" data-i18n-skip>${esc(SENSOR.model)}</h2></div><span class="dot" id="device-connected-dot" style="color:${!rt.connected?'var(--faint)':rt.invalidSignal?'var(--bad)':'var(--good)'}"></span></div>${has3d()?`<div class="sensor-mini" id="mini-viewer"><span class="viewer-stage-hint" aria-hidden="true">Ziehen zum Drehen</span></div><div class="device-leds">${['state','output'].map(name=>`<button class="led-status" data-action="sensor" data-led="${name}" data-led-state="${esc(rt.led[name])}" aria-label="${name==='state'?'State':'Output'}-LED: ${ledLabel(rt.led[name])}. ${esc(ledMeaning(name,rt.led[name]))}"><span class="led-indicator" id="${name}-dot" aria-hidden="true"></span><span class="led-copy"><span>${name==='state'?'State':'Output'}</span><strong id="${name}-led-label">${ledLabel(rt.led[name])}</strong></span></button>`).join('')}</div><div class="device-bottom"><button class="text-button small" data-action="sensor">Vergrößern ${icon('arrow')}</button></div>`:`<div class="metric-row"><span class="muted">Messgröße</span><span>${SENSOR.quantity} (${U()})</span></div><p class="small muted">${esc(SENSOR.interface)}</p>`}<div class="metric-row"><span class="muted">Messbereich</span><span class="mono">${rangeText()}</span></div></section>
  <section class="panel capture-panel" aria-labelledby="capture-heading">
  <div class="panel-heading"><h2 id="capture-heading">Aufnahme und Notizen</h2></div>
  <div class="capture-actions"><button class="btn primary record" data-action="record" ${!rt.connected||rt.invalidSignal||rt.saving?'disabled':''}>${rt.record?'<span class="stop-square"></span> Stoppen und speichern':rt.saving?'Wird gespeichert …':'<span class="record-dot"></span> Aufnahme starten'}</button></div>${rt.record?`<div class="recording-meta"><span class="recording row"><span class="dot"></span><span id="record-duration">00:00</span></span><span data-i18n-skip>${esc(rt.record.name)}</span></div>`:rt.unsaved?`<div class="recording-meta"><span class="warn">Noch nicht gespeichert</span><button class="text-button" data-action="retry-save">Erneut speichern</button><button class="text-button" data-action="export-unsaved">CSV sichern</button></div>`:rt.lastSaved?`<div class="recording-meta"><span class="good">${icon('check')} Gespeichert</span><span data-i18n-skip>${esc(rt.lastSaved.name)}</span><a href="#recordings" class="accent">Zu den Aufzeichnungen ${icon('arrow')}</a></div>`:''}<form class="note-entry" data-form="marker">${icon('pin')}<label class="sr-only" for="marker-note">Notiz zur aktuellen Messung</label><input id="marker-note" name="note" placeholder="Notiz zur Zeitmarke" maxlength="300" required ${!rt.connected||rt.invalidSignal?'disabled':''}><button class="btn compact quiet" type="submit" ${!rt.connected||rt.invalidSignal?'disabled':''}>Zeitmarke setzen ${icon('plus')}</button></form><div class="marker-list">${rt.markers.slice(-4).map(m=>`<button class="marker-chip" data-action="edit-marker" data-id="${esc(m.id)}">${icon('pin')} ${formatDuration(m.t)} · ${esc(m.note)}</button>`).join('')}</div></section>
  <section class="panel history-panel" aria-label="Messverlauf"><div class="chart-section"><div class="chart-head"><div><div class="row wrap"><h2>Messverlauf</h2><button type="button" class="text-button assistant-chart-button" data-action="assistant-chart" aria-label="${esc(assistantLabel('chart'))}" data-i18n-skip>${icon('chat')}${esc(assistantLabel('explain'))}</button></div><div class="chart-legend"><span><i class="legend-line"></i>${SENSOR.quantity} (${U()})</span><span><i class="legend-line spec"></i>Sollgrenzen</span></div></div><div class="chart-toolbar"><div class="segmented" aria-label="Angezeigter Zeitraum">${[10,30,60].map(n=>`<button data-action="window" data-value="${n}" class="${rt.window===n?'active':''}" aria-pressed="${rt.window===n}">${n} s</button>`).join('')}</div><div class="segmented scale-controls" aria-label="Y-Achse">${[['spec','Sollbereich'],['auto','Autozoom']].map(([mode,label])=>`<button data-action="scale" data-value="${mode}" aria-pressed="${rt.scaleMode===mode}" class="${rt.scaleMode===mode?'active':''}">${label}</button>`).join('')}</div></div></div><p class="chart-status small muted" id="chart-status">${chartStatus()}</p><div class="chart-wrap"><canvas id="live-chart" tabindex="0" aria-label="Live-Diagramm: ${SENSOR.labels.chart} über Zeit" role="img"></canvas><div class="chart-tooltip hidden" id="live-tooltip"></div></div></div><div class="monitor-foot"><span id="sample-count">${rt.points.length} Messpunkte</span></div></section>
  <section class="panel trend-panel" aria-labelledby="slope-heading">${slopeChart()}${chartDataView()}</section>
  <section class="panel learning-card"><div class="panel-heading"><h2>Auswertungsgrenzen</h2><span class="learning-state ${p.learning?'good':'muted'}"><span class="dot"></span>${p.learning?'Anpassung eingeschaltet':'Anpassung pausiert'}</span></div><div class="bound-row"><span class="muted">Sollgrenzen</span><span class="mono">${num(p.lower)}–${num(p.upper)} ${U()}</span></div><div class="bound-row"><span class="muted">Aktuelle Grenzen</span><span class="mono">${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}</span></div><div class="row between" style="margin-top:15px"><button class="text-button muted small" data-action="toggle-learning">${icon(p.learning?'pause':'play')} ${p.learning?'Anpassung pausieren':'Anpassung fortsetzen'}</button><a href="#advanced" class="text-button muted small">Verlauf ${icon('chevron')}</a></div>${rt.mode==='demo'?`<details class="demo-tools" ${rt.demoToolsOpen?'open':''}><summary>Störungen simulieren</summary><div class="demo-controls"><button class="btn" data-action="simulate-deviation" ${!rt.connected||rt.invalidSignal?'disabled':''}>Abweichung auslösen ${icon('arrow')}</button><button class="btn" data-action="simulate-disconnect" ${!rt.connected?'disabled':''}>Verbindung unterbrechen ${icon('plug')}</button><button class="btn" data-action="simulate-invalid" ${!rt.connected?'disabled':''}>Messfehler erzeugen ${icon('alert')}</button></div></details>`:''}</section>
</div>`}
function renameRecording(form,id,name){
  const recording=state.recordings.find(item=>item.id===id),next=String(name||'').trim();
  if(!recording||!next){showSettingsFailure(form,'Bitte gib einen Namen ein.');return false}
  const previous=recording.name;recording.name=next;
  if(!persist()){recording.name=previous;showSettingsFailure(form,'Speichern fehlgeschlagen. Die Eingaben bleiben erhalten.');return false}
  closeDialog();render();toast('Messung umbenannt.');return true;
}
function recordingsView(){const query=(rt.search||'').trim().toLocaleLowerCase(getLocale()),filtered=state.recordings.filter(r=>!query||[r.name,r.sensor,r.profile.name].some(value=>String(value||'').toLocaleLowerCase(getLocale()).includes(query)));const selected=[...rt.selected].map(id=>state.recordings.find(x=>x.id===id)).filter(Boolean);return `<div class="page-heading"><div><h1 id="recordings-heading" tabindex="-1">Aufzeichnungen</h1></div><span class="status-label">${filtered.length} von ${state.recordings.length} Aufzeichnungen</span></div><div class="recordings-toolbar"><div class="search-box">${icon('search')}<input id="run-search" type="search" value="${esc(rt.search||'')}" placeholder="Messung suchen …" aria-label="Aufzeichnungen durchsuchen"></div></div>${recordingUndoView()}<section class="panel"><div class="table-wrap"><table class="runs-table"><thead><tr><th><span class="sr-only">Auswahl</span></th><th>Messung</th><th>Datum</th><th>Dauer</th><th>Zeitmarken</th><th>Quelle</th><th><span class="sr-only">Aktionen</span></th></tr></thead><tbody>${filtered.map(r=>`<tr data-run-id="${esc(r.id)}" class="${rt.selected.has(r.id)?'selected':''}"><td><input type="checkbox" data-field="run" value="${esc(r.id)}" ${rt.selected.has(r.id)?'checked':''} aria-label="${esc(r.name)} auswählen"></td><td><span class="run-name">${esc(r.name)}</span><span class="run-profile">${esc(r.sensor || 'Sensor unbekannt')} · ${esc(r.profile.name)}</span></td><td>${date(r.createdAt)}<div class="run-profile mono">${time(r.createdAt)}</div></td><td class="mono">${formatDuration(r.duration)}</td><td class="mono">${r.markers?.length||0}</td><td><span class="badge"><span class="dot ${r.source==='demo'?'muted':'good'}"></span>${recordingSource(r)}</span>${r.interrupted?'<div class="small warn">Unterbrochen</div>':''}</td><td><div class="run-actions"><button class="icon-button" data-action="run-menu" data-id="${esc(r.id)}" aria-label="${esc(r.name)} umbenennen">${icon('edit')}</button><button class="icon-button" data-action="delete-run" data-id="${esc(r.id)}" aria-label="${esc(r.name)} löschen" title="Aufzeichnung löschen">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>${state.recordings.length&&!filtered.length?`<div class="empty" role="status"><h2>Keine passende Aufzeichnung</h2><p>Versuche einen anderen Suchbegriff.</p><button class="btn" data-action="clear-search">Suche zurücksetzen</button></div>`:''}${!state.recordings.length?`<div class="empty">${icon('folder')}<h2>Noch keine Aufzeichnung</h2><p>Aufnahmen startest du am Messplatz.</p><a class="btn primary" href="#monitor">Zum Cockpit ${icon('arrow')}</a></div>`:''}<div class="selection-bar"><span class="small muted">${selected.length?`${selected.length} ${selected.length===1?'Messung':'Messungen'} ausgewählt`:'Wähle eine Messung für Wiedergabe oder Export, zwei für den Vergleich.'}</span><div class="row"><button class="btn ${rt.analysis==='replay'?'primary':''}" data-action="analysis" data-view="replay" ${selected.length!==1?'disabled':''}>${icon('play')} Wiedergeben</button><button class="btn ${rt.analysis==='compare'?'primary':''}" data-action="analysis" data-view="compare" ${selected.length!==2?'disabled':''}>${icon('compare')} Vergleichen</button><button class="btn ${rt.analysis==='report'?'primary':''}" data-action="analysis" data-view="report" ${selected.length!==1?'disabled':''}>${icon('file')} PDF-Bericht</button><button class="btn quiet" data-action="csv" ${selected.length!==1?'disabled':''} aria-label="Ausgewählte Messung als CSV herunterladen">${icon('download')} CSV</button><button class="btn quiet" data-action="delete-selected-runs" ${!selected.length?'disabled':''} aria-label="Ausgewählte Aufzeichnungen löschen">${icon('trash')} Ausgewählte löschen</button></div></div></section>${analysisView(selected)}`}

let recordingUndo=null;
function recordingUndoView(){
 if(!recordingUndo)return '';
 const count=recordingUndo.removed.length;
 return `<div class="notice recording-undo" role="status"><div class="notice-body"><strong>${count} ${count===1?'Aufzeichnung lokal gelöscht.':'Aufzeichnungen lokal gelöscht.'}</strong><p>Rückgängig ist bis zum Neuladen oder zur nächsten Löschung möglich.</p>${recordingUndo.error?`<p id="recording-undo-error" role="alert" tabindex="-1">${esc(recordingUndo.error)}</p>`:''}</div><div class="notice-actions"><button class="btn quiet compact" data-action="undo-delete-runs" aria-label="Letzte Löschung rückgängig machen">${icon('reset')} Rückgängig</button></div></div>`;
}
function requestRecordingDeletion(ids){
 const requested=new Set(ids),targets=state.recordings.filter(record=>requested.has(record.id));
 if(!targets.length){toast('Keine Aufzeichnungen zum Löschen ausgewählt.');return false}
 openDialog('delete-runs',targets.map(record=>record.id));
 return true;
}
function recordingDeleteError(form,message){
 const error=form.querySelector('[data-delete-error]');
 error.textContent=message;applyTranslations(error);error.focus({preventScroll:true});
}
function confirmRecordingDeletion(form){
 const requested=new Set(dialogContext||[]),before=state.recordings;
 const removed=before.filter(record=>requested.has(record.id));
 if(!removed.length)return false;
 state.recordings=before.filter(record=>!requested.has(record.id));
 if(!persist()){
  state.recordings=before;
  recordingDeleteError(form,'Löschen fehlgeschlagen. Die Aufzeichnungen bleiben erhalten. Versuche es erneut.');
  return false;
 }
 recordingUndo={removed,order:before.map(record=>record.id),error:''};
 const affected=[...rt.selected].some(id=>requested.has(id));
 rt.selected=new Set([...rt.selected].filter(id=>!requested.has(id)));
 if(affected){rt.analysis=null;rt.analysisOpener=null;rt.replayPlaying=false;rt.replayTime=0;rt.replayWindow=0;rt.offset=0;rt.reportStart=0;rt.reportEnd=60}
 if(rt.lastSaved&&requested.has(rt.lastSaved.id))rt.lastSaved=null;
 closeDialog();render();
 toast(`${removed.length} ${removed.length===1?'Aufzeichnung lokal gelöscht.':'Aufzeichnungen lokal gelöscht.'}`);
 $('[data-action="undo-delete-runs"]')?.focus({preventScroll:true});
 return true;
}
function undoRecordingDeletion(){
 if(!recordingUndo)return false;
 const before=state.recordings,byId=new Map(before.map(record=>[record.id,record])),originalIds=new Set(recordingUndo.order);
 let count=0;
 for(const record of recordingUndo.removed)if(!byId.has(record.id)){byId.set(record.id,record);count++}
 state.recordings=[...before.filter(record=>!originalIds.has(record.id)),...recordingUndo.order.map(id=>byId.get(id)).filter(Boolean)];
 if(!persist()){
  state.recordings=before;recordingUndo.error='Wiederherstellen fehlgeschlagen. Die Löschung bleibt rückgängig machbar.';
  render();$('#recording-undo-error')?.focus({preventScroll:true});
  return false;
 }
 recordingUndo=null;render();
 toast(`${count} ${count===1?'Aufzeichnung wiederhergestellt.':'Aufzeichnungen wiederhergestellt.'}`);
 $('#run-search')?.focus({preventScroll:true});
 return true;
}

function analysisView(runs){if(!rt.analysis)return '';const r=runs[0];if(!r)return '';if(rt.analysis==='compare'&&runs.length!==2)return '';if(rt.analysis!=='compare'&&runs.length!==1)return '';const stats=statistics(r.points);const recordNum=v=>num(v,unitOf(r));if(rt.analysis==='report')return reportView(r);return `<section class="panel analysis-panel"><div class="panel-heading"><div><h2 id="analysis-heading" tabindex="-1">${rt.analysis==='compare'?'Messungen vergleichen':'Messung wiedergeben'}</h2></div><button class="icon-button" data-action="close-analysis" aria-label="Analyse schließen">${icon('close')}</button></div>${rt.analysis==='compare'&&unitOf(r)!==unitOf(runs[1])?'<div class="notice error">Die Messungen verwenden unterschiedliche Einheiten.</div>':`<div class="chart-legend"><span data-i18n-skip><i class="legend-line"></i>${esc(r.name)}</span>${runs[1]?`<span><i class="legend-line ref"></i>Referenz: <span data-i18n-skip>${esc(runs[1].name)}</span></span>`:''}</div><div class="chart-wrap"><canvas id="analysis-chart" role="img" aria-label="${rt.analysis==='compare'?'Überlagerte Messkurven':'Gespeicherter Messverlauf'}"></canvas></div>${rt.analysis==='compare'?`<div class="analysis-controls"><div class="field"><label for="compare-offset">Referenz verschieben <span class="mono" id="offset-label">${rt.offset.toLocaleString(getLocale(),{minimumFractionDigits:1,maximumFractionDigits:1})} s</span></label><input id="compare-offset" data-field="offset" type="range" min="-10" max="10" value="${rt.offset}" step="0.2"></div><button class="btn compact" data-action="align">${icon('compare')} Zeitversatz zurücksetzen</button></div><div class="stats-grid"><div><span class="eyebrow">Mittlere Differenz</span><div class="stat-value" id="compare-mean">—</div><div class="stat-label">Erste Messung minus Referenz</div></div><div><span class="eyebrow">Größte absolute Differenz</span><div class="stat-value" id="compare-max">—</div></div><div><span class="eyebrow">Zugeordnete Messpunkte</span><div class="stat-value" id="compare-count">—</div></div></div>`:`<div class="replay-controls"><button class="btn compact" data-action="replay-toggle" aria-label="${rt.replayPlaying?'Wiedergabe pausieren':'Wiedergabe starten'}">${icon(rt.replayPlaying?'pause':'play')}</button><span class="mono small" id="replay-time">${formatDuration(rt.replayTime)}</span><input type="range" data-field="replay" aria-label="Wiedergabeposition" min="0" max="${r.duration}" step=".2" value="${rt.replayTime}"><span class="mono small">${formatDuration(r.duration)}</span><select data-field="speed" aria-label="Wiedergabegeschwindigkeit">${[.5,1,2,4].map(s=>`<option value="${s}" ${rt.replaySpeed===s?'selected':''}>${s}×</option>`).join('')}</select></div><div class="row between" style="margin-top:15px"><span class="small muted" id="replay-value">${recordNum(r.points[0]?.value)} ${unitOf(r)}</span><div class="segmented" aria-label="Wiedergabe-Zoom">${[10,30,0].map(n=>`<button data-action="replay-window" data-value="${n}" class="${(rt.replayWindow||0)===n?'active':''}">${n?n+' s':'Gesamt'}</button>`).join('')}</div></div><div class="stats-grid"><div><span class="eyebrow">Minimum</span><div class="stat-value">${recordNum(stats.min)} <small>${unitOf(r)}</small></div></div><div><span class="eyebrow">Mittelwert</span><div class="stat-value">${recordNum(stats.mean)} <small>${unitOf(r)}</small></div></div><div><span class="eyebrow">Maximum</span><div class="stat-value">${recordNum(stats.max)} <small>${unitOf(r)}</small></div></div></div>${r.markers?.length?`<div class="marker-list">${r.markers.map(m=>`<button class="marker-chip" data-action="jump-marker" data-value="${m.t}">${icon('pin')} ${formatDuration(m.t)} · ${esc(m.note)}</button>`).join('')}</div>`:''}`}`}</section>`}
function reportView(r){
  const label=(key,values)=>esc(pdfText(key,values,getLanguage())),recordNum=v=>num(v,unitOf(r));
  const start=rt.reportStart,end=rt.reportEnd,points=r.points.filter(point=>point.t>=start&&point.t<=end),stats=statistics(points);
  return `<section class="panel analysis-panel"><div class="panel-heading"><div><h2 id="analysis-heading" tabindex="-1">PDF-Export</h2></div><button class="icon-button" data-action="close-analysis" aria-label="${label('closeReport')}" data-i18n-skip>${icon('close')}</button></div><div class="report-grid"><div class="report-options stack"><div class="fields"><div class="field"><label for="report-start" data-i18n-skip>${label('fromSeconds')}</label><input id="report-start" data-field="report-start" type="number" min="0" max="${r.duration}" step=".2" value="${start}" ${rt.pdfBusy?'disabled':''}></div><div class="field"><label for="report-end" data-i18n-skip>${label('toSeconds')}</label><input id="report-end" data-field="report-end" type="number" min="0" max="${r.duration}" step=".2" value="${end}" ${rt.pdfBusy?'disabled':''}></div></div><button class="btn primary" data-action="pdf" ${rt.pdfBusy?'disabled aria-busy="true"':''} data-i18n-skip>${icon('download')} ${label(rt.pdfBusy?'exporting':'download')}</button></div><article class="report-paper" data-i18n-skip><div class="report-brand">Micro-Epsilon</div><h2>${label('reportTitle')}</h2><p>${esc(r.name)} · ${date(r.createdAt)}</p><div class="chart-wrap"><canvas id="report-chart" role="img" aria-label="${label('reportTitle')}"></canvas></div><dl><div><dt>${label('sensor')}</dt><dd>${esc(r.sensor)}</dd></div><div><dt>${label('period')}</dt><dd>${formatDuration(start)}–${formatDuration(end)}</dd></div><div><dt>${label('profile')}</dt><dd>${esc(r.profile.name)}</dd></div><div><dt>${label('profileRate')}</dt><dd>${rate(r.profile.rate)}</dd></div><div><dt>${label('target')}</dt><dd>${recordNum(r.profile.target)} ${unitOf(r)}</dd></div><div><dt>${label('minMax')}</dt><dd>${stats.count?recordNum(stats.min)+' / '+recordNum(stats.max):'—'} ${unitOf(r)}</dd></div></dl><h3>${label('notes')}</h3>${r.markers.filter(marker=>marker.t>=start&&marker.t<=end).map(marker=>`<div class="report-note"><span class="mono">${formatDuration(marker.t)}</span> · ${esc(marker.note)}</div>`).join('')||`<p>${label('noNotes')}</p>`}<h3>${label('evaluations')}</h3><p>${label('evaluationCount',{count:r.feedback?.filter(event=>event.t>=start&&event.t<=end).length||0,version:r.profile.version})}</p><div class="report-disclaimer">${label(r.source==='demo'?'sourceDemo':r.source==='replay'?'sourceReplay':'sourceSensor')}<br>${label('sampleCount',{count:points.length})}</div></article></div></section>`;
}

let settingsDrafts, settingsConfirm;
const settingsSaving=new Set(),settingsExpanded=new Map();
function settingsStore(){return settingsDrafts ||= createSettingsDraftStore()}
function settingsKey(section){return section==='profile'?`profile:${SENSOR.id}:${profile().id}`:section==='ml'?`ml:${rt.bridgeUrl}:${rt.mlStatus?.model||SENSOR.id}`:section}
function captureSettingsDrafts(){for(const form of document.querySelectorAll('[data-settings-key]')){settingsStore().set(form.dataset.settingsKey,readSettingsForm(form));settingsExpanded.set(form.dataset.settingsKey,[...form.querySelectorAll('details')].map(details=>details.open))}}
function restoreSettingsDrafts(){for(const form of document.querySelectorAll('[data-settings-key]')){const key=form.dataset.settingsKey;restoreSettingsForm(form,settingsStore().value(key));[...form.querySelectorAll('details')].forEach((details,index)=>{if(settingsExpanded.get(key)?.[index]!==undefined)details.open=settingsExpanded.get(key)[index]});const dirty=settingsStore().dirty(key),status=form.querySelector('[data-settings-dirty]');if(status){status.dataset.dirty=String(dirty);status.textContent=dirty?'Ungespeicherte Änderungen':'Keine ungespeicherten Änderungen';applyTranslations(status)}for(const button of form.querySelectorAll('[data-settings-save], [data-action="settings-discard"]'))button.disabled=!dirty||settingsSaving.has(key)||Boolean(rt.record);for(const input of form.querySelectorAll('input, select'))input.disabled=settingsSaving.has(key)||Boolean(rt.record);form.setAttribute('aria-busy',String(settingsSaving.has(key)))}for(const button of document.querySelectorAll('[data-action="ml-reset"], [data-action="ml-forget"]'))button.disabled=!rt.mlStatus?.model||settingsSaving.has(settingsKey('ml'))}
function settingsFooter(label){return `<div class="settings-actions"><span class="settings-dirty" data-settings-dirty aria-live="polite">Keine ungespeicherten Änderungen</span><button type="button" class="btn quiet compact" data-action="settings-discard">Verwerfen</button><button type="submit" class="btn primary compact" data-settings-save>${icon('save')} ${label}</button></div><p class="settings-form-error" data-settings-error role="alert"></p>`}
function settingsField(name,label,value,{prefix='ml',hint='',min,max,step='any',type='number'}={}){const id=`${prefix}-${name}`;return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}" ${min===undefined?'':`min="${min}" max="${max}"`} step="${step}" value="${esc(value)}" ${hint?`aria-describedby="${id}-hint"`:''} ${type==='number'?'inputmode="decimal"':''}>${hint?`<small id="${id}-hint">${hint}</small>`:''}<span class="field-error" id="${id}-error"></span></div>`}
function clearSettingsErrors(form){for(const field of form.querySelectorAll('[aria-invalid]')){field.removeAttribute('aria-invalid');const ids=(field.getAttribute('aria-describedby')||'').split(' ').filter(id=>id!==`${field.id}-error`);if(ids.length)field.setAttribute('aria-describedby',ids.join(' '));else field.removeAttribute('aria-describedby')}for(const error of form.querySelectorAll('.field-error, [data-settings-error], #dialog-error'))error.textContent=''}
function showSettingsErrors(form,errors){clearSettingsErrors(form);let first;for(const[name,message]of Object.entries(errors)){const input=form.elements.namedItem(name);if(!input)continue;input.setAttribute('aria-invalid','true');let error=form.querySelector(`#${CSS.escape(input.id)}-error`);if(!error){error=document.createElement('span');error.id=`${input.id}-error`;error.className='field-error';input.after(error)}error.textContent=message;input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));input.closest('details')?.setAttribute('open','');first ||= input}applyTranslations(form);first?.focus();return !first}
function showSettingsFailure(form,message){const error=form.querySelector('[data-settings-error], #dialog-error');if(error){error.textContent=message;applyTranslations(error)}}
function settingsDirty(){captureSettingsDrafts();return settingsStore().anyDirty()}
function confirmSettingsAction({title,message,context='',button='Änderungen verwerfen',onConfirm}){if(settingsConfirm?.open)return;if(!settingsConfirm){settingsConfirm=document.createElement('dialog');settingsConfirm.className='settings-confirm';settingsConfirm.setAttribute('aria-labelledby','settings-confirm-title');document.body.append(settingsConfirm)}settingsConfirm.innerHTML=`<h2 id="settings-confirm-title">${esc(title)}</h2>${context?`<p class="mono" data-i18n-skip>${esc(context)}</p>`:''}<p>${esc(message)}</p><form method="dialog"><div class="dialog-actions"><button class="btn quiet" value="cancel" autofocus>Abbrechen</button><button class="btn primary" value="confirm">${esc(button)}</button></div></form>`;settingsConfirm.returnValue='';settingsConfirm.onclose=()=>{if(settingsConfirm.returnValue==='confirm')Promise.resolve(onConfirm()).catch(error=>toast(error.message))};applyTranslations(settingsConfirm);settingsConfirm.showModal()}
function confirmSettingsLeave(onConfirm){confirmSettingsAction({title:'Ungespeicherte Änderungen',message:'Beim Verlassen werden die ungespeicherten Änderungen verworfen.',onConfirm:()=>{settingsStore().clearAll();onConfirm()}})}

function saveProfileEditor(form){
 const result=validateProfileFields(readSettingsForm(form),SENSOR);if(!showSettingsErrors(form,result.errors))return;
 const values=result.value,old=profile(),p=clone(old),before=clone(state),changed=values.target!==p.target||values.lower!==p.lower||values.upper!==p.upper;
 Object.assign(p,{name:values.name,description:values.description,target:values.target,lower:values.lower,upper:values.upper,rate:values.rate});
 if(changed){p.learnedLower=p.lower;p.learnedUpper=p.upper;p.version++;p.history.push({id:generateId('profile-change'),type:'profile',at:new Date().toISOString(),version:p.version,changed:true,previousLower:old.learnedLower,previousUpper:old.learnedUpper,nextLower:p.lower,nextUpper:p.upper,reason:'Profil geändert und Auswertungsgrenzen zurückgesetzt.'})}
 if(values.saveMode==='copy'){p.id=generateId('profile');p.history=[];p.version=1;state.profiles.push(p);state.activeProfileId=p.id}else setProfile(p);
 if(!persist()){state=before;showSettingsFailure(form,'Speichern fehlgeschlagen. Die Eingaben bleiben erhalten.');return}
 settingsStore().clear('profile-editor');settingsStore().clear(settingsKey('profile'));
 if(changed){rt.points=rt.mode==='demo'?makeDemoPoints(60,0,0,p.target):[];if(rt.mode==='demo'){rt.value=p.target;rt.elapsed=60}rt.zeroOffset=0;rt.markers=[];rt.deviation=null;rt.lastFeedback=null}
 closeDialog(true);render();toast('Messprofil gespeichert.');
}
function saveLocalSettings(section,form){
 if(rt.record){toast('Bitte zuerst die Aufnahme stoppen.');return}
 const key=form.dataset.settingsKey,values=readSettingsForm(form),result=section==='connection'?validateConnectionSettings(values):validateProfileSettings(values,SENSOR);
 if(!showSettingsErrors(form,result.errors))return;
 const before=clone(state),previousAddress=rt.bridgeUrl;
 if(section==='connection')state.settings.bridgeUrl=result.value.bridgeUrl;
 else{const p={...clone(profile()),...result.value};setProfile(p);state.settings.rate=p.rate}
 if(!persist()){state=before;showSettingsFailure(form,'Speichern fehlgeschlagen. Die Eingaben bleiben erhalten.');return}
 settingsStore().clear(key);
 if(section==='connection'){rt.bridgeUrl=result.value.bridgeUrl;if(previousAddress!==rt.bridgeUrl){useSensorSource();toast('Verbindung gespeichert. Die Datenquelle wird geprüft.');return}}
 else rt.window=result.value.window;
 render();toast(section==='connection'?'Verbindung gespeichert.':'Messprofil gespeichert.');
}
async function saveMlSettings(form){
 const key=form.dataset.settingsKey;if(settingsSaving.has(key))return;
 const result=validateMlSettings(readSettingsForm(form));if(!showSettingsErrors(form,result.errors))return;
 captureSettingsDrafts();settingsSaving.add(key);restoreSettingsDrafts();
 try{await backendRequest('/api/ml/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(result.value)});settingsStore().clear(key);await loadMl();toast('Parameter der Anomalieerkennung gespeichert.')}
 catch{showSettingsFailure(form,'Speichern fehlgeschlagen. Die Eingaben bleiben erhalten.')}
 finally{settingsSaving.delete(key);restoreSettingsDrafts()}
}
function requestMlReset(keepLabels){
 const model=rt.mlStatus?.model,key=settingsKey('ml');if(!model||settingsSaving.has(key))return;
 captureSettingsDrafts();if(settingsStore().dirty(settingsKey('ml'))){toast('Speichere oder verwirf zuerst die Anomalieparameter.');return}
 confirmSettingsAction({context:rt.mlStatus?.sensor||SENSOR.model,title:keepLabels?'Normalzustand neu lernen?':'Gelernte Beispiele zurücksetzen?',message:keepLabels?'Der Normalzustand des aktiven Sensormodells wird neu gelernt. Gelernte Beispiele, Ereignisverlauf und Fehlerdatei bleiben erhalten.':'Normalzustand und gelernte Normal- und Anomaliebeispiele des aktiven Sensormodells werden entfernt. Ereignisverlauf und Fehlerdatei bleiben erhalten.',button:keepLabels?'Neu lernen':'Lernzustand zurücksetzen',onConfirm:async()=>{
  if(settingsSaving.has(key))return;if(rt.mlStatus?.model!==model){toast('Das Sensormodell hat sich geändert. Bitte prüfe die Aktion erneut.');return}
  settingsSaving.add(key);restoreSettingsDrafts();try{rt.mlStatus=await backendRequest('/api/ml/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keep_labels:keepLabels})});rt.deviation=null;rt.mlKnown=null;await loadMl();toast(keepLabels?'Der Normalzustand wird neu gelernt. Gelernte Beispiele bleiben erhalten.':'Normalzustand und gelernte Beispiele wurden zurückgesetzt.')}finally{settingsSaving.delete(key);restoreSettingsDrafts()}
 }});
}

function advancedView(){
 const p=profile(),history=[...(p.history||[])].reverse();
 settingsStore().ensure(settingsKey('connection'),{bridgeUrl:rt.bridgeUrl});
 settingsStore().ensure(settingsKey('profile'),{rate:String(p.rate),window:String(p.window)});
 return `<div class="page-heading"><h1>Einstellungen</h1></div><div class="settings-layout">
 <section class="panel"><div class="settings-section-head"><h2>Anzeige</h2><span class="settings-scope">Änderungen gelten sofort in diesem Browser.</span></div><div class="settings-immediate"><div class="field"><label for="language-select">Sprache für alle Seiten</label><select id="language-select" data-field="language" data-i18n-skip>${LANGUAGES.map(language=>`<option value="${language.code}" ${getLanguage()===language.code?'selected':''}>${language.name}</option>`).join('')}</select></div><div class="field"><label for="text-size-select">Schriftgröße</label><select id="text-size-select" data-field="text-size">${[['normal','Normal'],['large','Groß'],['hall','Saal (Beamer, große Räume)']].map(([value,name])=>`<option value="${value}" ${(document.documentElement.dataset.textSize||'normal')===value?'selected':''}>${name}</option>`).join('')}</select></div><div class="field"><label>Farbschema</label><button type="button" class="btn" data-action="theme" aria-label="${themeActionLabel()}">${themeIcon()}<span>${themeActionLabel()}</span></button></div></div></section>
 <section class="panel source-settings"><div class="settings-section-head"><h2>Verbindung</h2><span class="settings-scope">Die Adresse wird in diesem Browser gespeichert.</span></div><div class="connection-choices" role="group" aria-label="Datenquelle"><button type="button" class="choice-card ${rt.mode==='bridge'?'selected':''}" data-action="sensor-source" aria-pressed="${rt.mode==='bridge'}" ${rt.record||rt.saving?'disabled':''}>${icon('plug')}<h3>Sensordaten</h3></button><button type="button" class="choice-card ${rt.mode==='demo'?'selected':''}" data-action="demo" aria-pressed="${rt.mode==='demo'}" ${rt.record||rt.saving?'disabled':''}>${icon('wave')}<h3>Demo</h3></button></div><p class="small muted">Die Auswahl der Datenquelle gilt sofort.</p>${liveConnectionPanel()}<div class="metric-row"><span class="muted">Sensormodell</span><span data-i18n-skip>${esc(SENSOR.model)}</span></div><div class="metric-row"><span class="muted">Messbereich</span><span class="mono">${rangeText()}</span></div><form class="settings-form" data-form="connection-settings" data-settings-key="${esc(settingsKey('connection'))}" novalidate>${settingsField('bridgeUrl','Adresse der lokalen Messbrücke',rt.bridgeUrl,{prefix:'bridge',type:'url',hint:'WebSocket-Adresse mit ws:// oder wss://.'})}<div class="row wrap" style="margin-top:12px"><button type="button" class="btn quiet compact" data-action="connect-bridge">${icon('link')} Gespeicherte Messbrücke verbinden</button><button type="button" class="btn quiet compact" data-action="bridge-help">Datenformat ${icon('info')}</button></div>${settingsFooter('Verbindung speichern und prüfen')}</form></section>
 <section class="panel"><div class="settings-section-head"><h2>Messprofil</h2><span class="settings-scope">Gilt für das gewählte Profil in diesem Browser.</span></div><p data-i18n-skip><strong>${esc(p.name)}</strong></p><form class="settings-form" data-form="profile-settings" data-settings-key="${esc(settingsKey('profile'))}" novalidate><div class="fields"><div class="field"><label for="setting-rate">Profilrate</label><select id="setting-rate" name="rate">${SENSOR.rates.map(n=>`<option value="${n}" ${p.rate===n?'selected':''}>${rate(n)}</option>`).join('')}</select></div><div class="field"><label for="setting-window">Diagrammfenster</label><select id="setting-window" name="window">${[10,30,60].map(n=>`<option value="${n}" ${p.window===n?'selected':''}>${n} Sekunden</option>`).join('')}</select></div></div>${settingsFooter('Messprofil speichern')}</form><div class="row wrap" style="margin-top:18px"><button type="button" class="btn compact" data-action="edit-profile" ${rt.record?'disabled':''}>${icon('edit')} Profil bearbeiten</button><button type="button" class="btn quiet compact" data-action="zero" ${rt.record||!rt.connected||rt.invalidSignal?'disabled':''}>${icon('zero')} ${rt.zeroOffset?'Nullpunkt lösen':'Nullpunkt setzen'}</button></div></section>
 <section class="panel"><div class="settings-section-head"><h2>Auswertungsgrenzen</h2><span class="learning-state ${p.learning?'good':'muted'}"><span class="dot"></span>${p.learning?'Anpassung eingeschaltet':'Anpassung pausiert'}</span></div><div class="settings-learning-info"><p>Akzeptierte Messwerte können die Auswertungsgrenzen dieses Profils erweitern. Die Sollgrenzen bleiben erhalten. Die Anpassungen werden in diesem Browser gespeichert.</p></div><div class="metric-row"><span class="muted">Sollgrenzen</span><span class="mono">${num(p.lower)}–${num(p.upper)} ${U()}</span></div><div class="metric-row"><span class="muted">Aktuelle Auswertungsgrenzen</span><span class="mono">${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}</span></div><div class="row wrap" style="margin-top:16px"><button type="button" class="btn compact" data-action="toggle-learning">${icon(p.learning?'pause':'play')} ${p.learning?'Anpassung pausieren':'Anpassung fortsetzen'}</button><button type="button" class="btn quiet compact" data-action="undo-learning" ${!history.some(h=>h.changed)?'disabled':''}>${icon('back')} Rückgängig</button><button type="button" class="btn quiet compact" data-action="reset-learning">${icon('reset')} Auf Sollgrenzen zurücksetzen</button></div>${history.length?`<details class="settings-advanced"><summary>Änderungsverlauf</summary><div class="history-list">${history.map(h=>`<div class="history-item"><div class="row between"><strong>${h.type==='feedback'?(h.accepted?'Als akzeptabel bewertet':'Als nicht akzeptabel bewertet'):h.type==='undo'?'Anpassung rückgängig':h.type==='training'?'An Trainingsdaten angepasst':h.type==='profile'?'Sollgrenzen geändert':'Grenzen zurückgesetzt'}</strong><span class="mono">${time(h.at)}</span></div><p>${h.value!==undefined?num(h.value)+' '+U()+' · ':''}${h.changed?`${num(h.previousLower)}–${num(h.previousUpper)} → ${num(h.nextLower)}–${num(h.nextUpper)} ${U()}`:esc(h.reason||'Grenzen unverändert.')}</p>${h.note?`<p data-i18n-skip>${esc(h.note)}</p>`:''}</div>`).join('')}</div></details>`:''}</section>
 ${mlPanel()}
 <section class="panel help-settings"><div class="settings-section-head"><h2>Hilfe</h2></div><p>Aufzeichnungen und Profile werden in diesem Browser gespeichert.</p><div class="row wrap"><button type="button" class="btn compact" data-action="help">${icon('help')} Hilfe öffnen</button><a class="btn quiet compact" href="#setup">${icon('plug')} Einrichtung öffnen</a>${SENSOR.manual?`<a class="btn quiet compact" href="${SENSOR.manual}" target="_blank" rel="noopener">Sensorhandbuch ${icon('arrow')}</a>`:''}</div></section></div>`;
}
async function loadMl(){try{const[st,recs,errs]=await Promise.all([backendRequest('/api/ml'),backendRequest('/api/recordings').catch(()=>[]),backendRequest('/api/ml/errors?limit=5').catch(()=>[])]);Object.assign(rt,{mlStatus:st,mlRecordings:recs,mlErrors:errs,mlError:''})}catch{Object.assign(rt,{mlStatus:null,mlError:'Messserver nicht erreichbar'})}if(rt.route==='advanced')render()}
function mlPanel(){
 const st=rt.mlStatus;if(!st)return `<section class="panel"><h2>Anomalieerkennung</h2><p role="status">${esc(rt.mlError||'Wird geladen …')}</p><p class="small muted">Die Anomalieerkennung läuft auf dem Messserver.</p><button class="btn quiet compact" data-action="ml-refresh">Erneut laden</button></section>`;
 const c=st.config,key=settingsKey('ml');settingsStore().ensure(key,mlSettingsValues(c));const sameModel=(a,b)=>!!a&&!!b&&(a===b||a.startsWith(b+'-')||b.startsWith(a+'-'));const recs=(rt.mlRecordings||[]).filter(r=>(r.unit||r.info?.unit||'mm')===SENSOR.unit&&sameModel(String(r.info?.model||''),String(st.sensor||'')));
 const field=(name,label,hint='',step='any')=>{const limits=ML_FIELD_LIMITS[name];return settingsField(name,label,name==='error_fraction'?Math.round(c[name]*100):c[name]??'',{hint,min:limits?.[0],max:limits?.[1],step})};
 const row=(label,value)=>`<div class="metric-row"><span class="muted">${label}</span><span>${esc(value)}</span></div>`;
 const radius=st.match_radius==null?'—':Number(st.match_radius).toLocaleString(getLocale(),{maximumFractionDigits:3})+(c.label_match_radius==null?' (aus den Daten berechnet)':'');
 return `<section class="panel"><div class="settings-section-head"><h2>Anomalieerkennung</h2><span class="learning-state ${['watching','learning'].includes(st.state)?'good':'muted'}" role="status"><span class="dot"></span><span>${esc(mlOperatingState(st))}</span>${st.state==='learning'?`<span data-i18n-skip> · ${Math.round((st.progress||0)*100)} %</span>`:''}</span></div><div class="settings-learning-info"><p>Diese Erkennung lernt Signalformen auf dem Messserver. Als Normalmuster akzeptierte Daten können die Auswertungsgrenzen erweitern. Die Sollgrenzen bleiben erhalten.</p></div><div class="metric-row"><span class="muted">Gelernt für</span><span data-i18n-skip>${esc(st.sensor||'—')}</span></div><div class="settings-status-grid"><div><span>Gelernte Zeitfenster</span><strong>${st.baseline_windows}</strong></div><div><span>Normalmuster / Anomalien</span><strong>${st.normal_examples} / ${st.anomaly_examples}</strong></div><div><span>Offene Meldungen</span><strong>${st.pending_count||0}</strong></div></div>${row('Beschriftete Daten',`${Number(st.labeled_windows||0).toLocaleString(getLocale())} Fenster aus ${(st.labeled_sources||[]).length.toLocaleString(getLocale())} Quellen`)}${row('Trefferradius',radius)}${row('Gelernter Wertebereich',st.train_range?`${num(st.train_range[0])}–${num(st.train_range[1])} ${U()}`:'—')}<form class="settings-form" data-form="ml-config" data-settings-key="${esc(key)}" novalidate><div class="row wrap"><label class="row"><input type="checkbox" name="enabled" ${c.enabled?'checked':''}> Erkennung eingeschaltet</label><label class="row"><input type="checkbox" name="learn_online" ${c.learn_online?'checked':''}> Normale Signale laufend dazulernen</label>${Object.hasOwn(c,'label_match')?`<label class="row"><input type="checkbox" name="label_match" ${c.label_match?'checked':''}> Bei unbekannten Daten fragen</label>`:''}</div><p class="small muted">Eingeschaltet bedeutet konfiguriert. Der Betriebszustand steht oben.</p><div class="fields" style="margin-top:18px">${field('sensitivity','Meldeschwelle','1,5–100 · Vielfaches der normalen Streuung. Kleiner = empfindlicher.')}${field('consecutive','Zeitfenster in Folge','1–50 · So oft hintereinander, bevor gemeldet wird.','1')}</div><details class="settings-advanced"><summary>Technische Parameter</summary><div class="fields">${Object.hasOwn(c,'label_match_radius')?field('label_match_radius','Trefferradius','Optional. 0,5–500 · Leer = aus den beschrifteten Daten berechnet.'):''}${field('window_s','Zeitfensterlänge (s)','0,1–10 s · Ändern startet die Lernphase neu.')}${field('warmup_s','Lernphase (s)','1–600 s · Normales Signal nach dem Verbinden.')}${field('cooldown_s','Pause nach Meldung (s)','0–600 s')}${field('match_radius','Ähnlichkeit zu Bewertungen','0,1–50 · Größer erfasst mehr ähnliche Signale.')}${field('error_fraction','Fehler ab ungültigen Werten (%)','1–100 % · Anteil je Zeitfenster.','1')}${field('reject_z','Verwerfen ab Abweichung','Optional. Leer = ausgeschaltet; größer als die Meldeschwelle.')}${field('hard_min',`Untere Grenze (${U()})`,'Optional. Leer = ausgeschaltet.')}${field('hard_max',`Obere Grenze (${U()})`,'Optional. Leer = ausgeschaltet.')}${settingsField('error_file','Fehlerdatei (.jsonl)',c.error_file,{type:'text',hint:'Relativer oder absoluter Serverpfad. Eine JSON-Zeile je Fehler.'})}</div><p class="small muted" data-i18n-skip>${esc(st.error_file)}</p>${recs.length?`<div class="field"><label for="ml-learn-file">Aufnahme lernen</label><select id="ml-learn-file" data-i18n-skip>${recs.map(r=>`<option value="${esc(r.file)}">${esc(r.label||r.file)}</option>`).join('')}</select></div><div class="row wrap"><button type="button" class="btn quiet compact" data-action="ml-learn" data-label="normal">Als normal lernen</button><button type="button" class="btn quiet compact" data-action="ml-learn" data-label="anomaly">Als Anomalie lernen</button></div>`:''}<p>Verworfene Fehler: <span data-i18n-skip>${st.errors_written||0}</span></p>${(rt.mlErrors||[]).length?`<div class="history-list">${rt.mlErrors.map(error=>`<div class="history-item"><strong>${esc(mlReason(error.reason))}</strong><p><span data-i18n-skip>${esc(error.sensor||'')} · ${esc(mlEventTime(error.t_start,getLocale()))}</span></p></div>`).join('')}</div>`:''}</details>${settingsFooter('Anomalieparameter speichern')}</form><div class="settings-danger"><h3>Lernzustand zurücksetzen</h3><p class="small muted">Betrifft nur das aktive Sensormodell auf dem Messserver.</p><div class="row wrap"><button type="button" class="btn compact" data-action="ml-reset" ${!st.model||settingsSaving.has(key)?'disabled':''}>${icon('reset')} Normalzustand neu lernen</button><button type="button" class="btn quiet compact" data-action="ml-forget" ${!st.model||settingsSaving.has(key)?'disabled':''}>${icon('trash')} Normalzustand und gelernte Beispiele zurücksetzen</button></div></div></section>`;
}

function setupView(){const n=rt.setupStep;let content='';if(n===1)content=`<h2>Datenquelle wählen</h2><div class="connection-choices"><button class="choice-card ${rt.setupMode==='demo'?'selected':''}" data-action="setup-source" data-value="demo">${icon('wave')}<div><h3>Demo</h3><p>5 simulierte Messwerte pro Sekunde.</p></div></button><button class="choice-card ${rt.setupMode==='bridge'?'selected':''}" data-action="setup-source" data-value="bridge">${icon('plug')}<div><h3>Sensor</h3><p>${esc(SENSOR.model)} über eine lokale Messbrücke.</p></div></button></div>${rt.setupMode==='bridge'?`<div class="field" style="margin-top:18px"><label for="setup-bridge-url">WebSocket-Adresse</label><input id="setup-bridge-url" type="url" value="${esc(rt.bridgeUrl)}"></div><button class="btn compact" style="margin-top:12px" data-action="connect-bridge">Verbindung herstellen ${icon('arrow')}</button>`:''}`;
 if(n===2)content=`<h2>${rt.setupMode==='demo'?'Demoprofil':'Eingestelltes Sensormodell'}</h2><div class="detected-device">${icon('box')}<div><h3>${esc(SENSOR.model)}</h3><p>Messbereich ${rangeText()} · Profilrate ${rate(profile().rate)}</p>${rt.setupMode==='bridge'?`<p>${esc(SENSOR.interface)} · Messbrücke</p>`:''}</div></div>${rt.setupMode==='bridge'?`<p class="small muted">Vergleiche das Modell mit dem Typenschild am Sensor.</p>`:''}`;
 if(n===3)content=`<h2>Signal prüfen</h2>${rt.setupMode==='bridge'?`<p>Richte den Sensor auf das Messobjekt aus. Der Messbereich liegt bei ${rangeText()} ${SENSOR.labels.rangeNote}</p>`:''}<div class="check-item">${icon(rt.connected?'check':'close',rt.connected?'':'bad')} ${rt.connected?'Datenquelle ist verbunden':'Noch keine Verbindung'}</div><div class="check-item">${icon(rt.connected&&!rt.invalidSignal&&rt.value>=SENSOR.rangeStart&&rt.value<=SENSOR.rangeEnd?'check':'close',rt.connected?'':'bad')} ${rt.connected&&!rt.invalidSignal?'Messwert im Messbereich':'Gültiger Messwert fehlt'}</div><div class="wizard-reading"><div class="reading-main"><span class="reading-value">${rt.connected&&!rt.invalidSignal?num(rt.value):'—'}</span><span class="reading-unit">${U()}</span></div><span class="small muted">${rt.connected&&!rt.invalidSignal?(rt.mode==='demo'?'Simulierter Messwert':'Aktueller Sensorwert'):''}</span></div>${!rt.connected?'<button class="btn" data-action="reconnect">Erneut verbinden</button>':''}`;
 if(n===4)content=`<h2>Messwert und Profil</h2><div class="wizard-reading"><div class="reading-main"><span class="reading-value">${rt.connected&&!rt.invalidSignal?num(rt.value):'—'}</span><span class="reading-unit">${U()}</span></div><div class="small muted">${!rt.connected?'Verbindung unterbrochen':rt.invalidSignal?'Gültiger Messwert fehlt':rt.mode==='demo'?'Simulierter Messwert':'Aktueller Sensorwert'}</div></div><div class="detected-device" style="margin-top:18px">${icon('sliders')}<div><h3 data-i18n-skip>${esc(profile().name)}</h3><p>Sollwert ${num(profile().target)} ${U()} · ${rate(profile().rate)}</p></div><span class="spacer"></span><button class="text-button" data-action="edit-profile">Bearbeiten ${icon('edit')}</button></div>`;
 return `<div class="wizard"><a href="#monitor" class="text-button muted small">${icon('back')} Zum Cockpit</a><div class="wizard-intro"><h1>Einrichtung</h1></div><div class="stepper" aria-label="Einrichtungsfortschritt">${['Datenquelle','Sensormodell','Signal prüfen','Messprofil'].map((s,i)=>`<div class="step ${i+1<n?'done':i+1===n?'active':''}" ${i+1===n?'aria-current="step"':''}><span class="step-circle">${i+1<n?icon('check'):i+1}</span><span>${s}</span></div>`).join('')}</div><section class="panel wizard-card">${content}<div class="wizard-actions"><button class="btn quiet" data-action="setup-back" ${n===1?'disabled':''}>${icon('back')} Zurück</button><button class="btn primary" data-action="setup-next" ${n===3&&(!rt.connected||rt.invalidSignal)?'disabled':''}>${n===4?'Zum Cockpit':n===3?'Messprofil prüfen':'Weiter'} ${icon('arrow')}</button></div></section></div>`}

function dialogShell(title,content){return `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Dialog schließen">${icon('close')}</button></div><div class="dialog-content">${content}</div>`}
function openDialog(type,context=null){if(type==='sensor'&&!has3d())return;if(rt.dialogViewer){rt.dialogViewer.dispose();rt.dialogViewer=null}dialogType=type;dialogContext=context;const d=$('#dialog');d.className=type==='sensor'?'wide':'';let title='',body='';const p=profile();
 if(type==='profile'){title='Messprofil bearbeiten';body=`<p>Wenn du Sollwert oder Sollgrenzen änderst, setzt das Profil seine Auswertungsgrenzen zurück.</p><form class="settings-form" data-form="profile" data-settings-key="profile-editor" novalidate><div class="fields"><div class="field full"><label for="profile-name">Profilname</label><input id="profile-name" name="name" value="${esc(p.name)}" required maxlength="80"></div><div class="field full"><label for="profile-description">Kurzbeschreibung</label><input id="profile-description" name="description" value="${esc(p.description)}" maxlength="180"></div><div class="field full"><label for="profile-target">Sollwert in ${U()}</label><input id="profile-target" name="target" type="number" min="${SENSOR.rangeStart}" max="${SENSOR.rangeEnd}" step=".001" value="${p.target}" required></div><div class="field"><label for="profile-lower">Untere Sollgrenze (${U()})</label><input id="profile-lower" name="lower" type="number" min="${SENSOR.rangeStart}" max="${SENSOR.rangeEnd}" step=".001" value="${p.lower}" required></div><div class="field"><label for="profile-upper">Obere Sollgrenze (${U()})</label><input id="profile-upper" name="upper" type="number" min="${SENSOR.rangeStart}" max="${SENSOR.rangeEnd}" step=".001" value="${p.upper}" required></div><div class="field"><label for="profile-rate">Profilrate</label><select id="profile-rate" name="rate">${SENSOR.rates.map(n=>`<option value="${n}" ${p.rate===n?'selected':''}>${rate(n)}</option>`).join('')}</select></div><div class="field"><label for="profile-save-mode">Speichern als</label><select id="profile-save-mode" name="saveMode"><option value="update">Aktuelles Profil ändern</option><option value="copy">Neues Profil anlegen</option></select></div></div><div class="dialog-error" id="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit">${icon('save')} Profil speichern</button></div></form>`}
 if(type==='profile-preview'){const n=state.profiles.find(x=>x.id===context);if(!n)return;title='Messprofil wechseln';const changes=[['Profil',p.name,n.name],['Sollwert',num(p.target)+' '+U(),num(n.target)+' '+U()],['Sollgrenzen',num(p.lower)+'–'+num(p.upper)+' '+U(),num(n.lower)+'–'+num(n.upper)+' '+U()],['Profilrate',rate(p.rate),rate(n.rate)],['Diagrammfenster',p.window+' s',n.window+' s']].filter(([, before, after], index) => index === 0 || before !== after);body=`${n.description?`<p data-i18n-skip>${esc(n.description)}</p>`:''}<div class="change-list">${changes.map(c=>`<div class="change-row"><span>${c[0]}</span><span data-i18n-skip>${esc(c[1])} → ${esc(c[2])}</span></div>`).join('')}</div><div class="dialog-actions"><button class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" data-action="apply-profile" data-id="${esc(n.id)}">Profil laden ${icon('arrow')}</button></div>`}
 if(type==='record'){title='Neue Aufnahme';body=`<form data-form="start-record"><div class="field"><label for="record-name">Name der Messung</label><input id="record-name" name="name" value="${esc(p.name)} · ${new Date().toLocaleDateString(getLocale())} ${new Date().toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}" required maxlength="100"></div><div class="field"><label for="record-class">Beschriftung für die KI</label><select id="record-class" name="cls"><option value="">Nicht beschriften</option><option value="normal">Normal: so soll es aussehen</option><option value="anomaly">Anomalie: so soll es nicht aussehen</option></select><small>Eine beschriftete Aufnahme lernt die KI als Trainingsdaten. Die Auswertungsgrenzen passen sich ihr an.</small></div><div class="metric-row"><span class="muted">Speicherort</span><span>Dieser Browser</span></div><div class="metric-row"><span class="muted">Quelle</span><span>${rt.mode==='demo'?'Demo · 5 Werte/s':'Sensor · Messbrücke'}</span></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit"><span class="record-dot"></span> Aufnahme starten</button></div></form>`}
 if(type==='marker'){const m=rt.markers.find(x=>x.id===context);if(!m)return;title='Notiz bearbeiten';body=`<form data-form="edit-marker"><div class="field"><label for="edit-marker-note">Notiz bei ${formatDuration(m.t)}</label><textarea id="edit-marker-note" name="note" required maxlength="300">${esc(m.note)}</textarea></div><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit">Notiz speichern</button></div></form>`}
 if(type==='run'){const r=state.recordings.find(x=>x.id===context);if(!r)return;title='Aufzeichnung umbenennen';body=`<form data-form="rename-run"><div class="field"><label for="rename-run-name">Name der Messung</label><input name="name" id="rename-run-name" value="${esc(r.name)}" required maxlength="100"></div><div class="metric-row"><span class="muted">Aufgenommen am</span><span>${date(r.createdAt)} · ${time(r.createdAt)}</span></div><p class="settings-form-error" data-settings-error role="alert"></p><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog">Abbrechen</button><button class="btn primary" type="submit">Umbenennen</button></div></form>`}


 if(type==='delete-runs'){const ids=new Set(context),runs=state.recordings.filter(record=>ids.has(record.id));if(!runs.length)return;title='Aufzeichnungen löschen?';body=`<form data-form="delete-runs"><p>${runs.length} ${runs.length===1?'Aufzeichnung wird aus diesem Browser gelöscht.':'Aufzeichnungen werden aus diesem Browser gelöscht.'}</p><ul class="recording-delete-list">${runs.map(record=>`<li data-i18n-skip>${esc(record.name)}</li>`).join('')}</ul><p>Aufzeichnungen auf dem Messserver und gelernte Modelle bleiben erhalten.</p><p class="small muted">Rückgängig ist bis zum Neuladen oder zur nächsten Löschung möglich.</p><p class="settings-form-error" data-delete-error role="alert" tabindex="-1"></p><div class="dialog-actions"><button type="button" class="btn quiet" data-action="close-dialog" autofocus>Abbrechen</button><button class="btn primary" type="submit">${icon('trash')} Nur hier löschen</button></div></form>`}

 if(type==='help'){title='Hilfe';body=`<div class="stack"><div><h3>Aufnehmen</h3><p class="small muted">Wähle ein Profil und starte die Aufnahme. Nach „Stoppen und speichern“ erscheint sie unter Aufzeichnungen.</p></div><div><h3>Abweichungen bewerten</h3><p class="small muted">Im Demo-Modus kannst du Abweichungen simulieren. Akzeptierte Werte können die Auswertungsgrenzen erweitern. Die Sollgrenzen bleiben erhalten.</p></div><div><h3>Speichern und exportieren</h3><p class="small muted">Profile und Aufnahmen liegen in diesem Browser. Exportiere benötigte Messungen als CSV oder PDF, bevor du Browserdaten löschst.</p></div><div><h3>Sensor anschließen</h3><p class="small muted">Für Sensordaten brauchst du eine lokale Messbrücke. Das Sensorhandbuch erklärt die Bedeutung der LEDs.</p></div></div><div class="dialog-actions">${SENSOR.manual?`<a class="btn" href="${SENSOR.manual}" target="_blank" rel="noopener">Sensorhandbuch ${icon('arrow')}</a>`:''}<button class="btn primary" data-action="close-dialog">Schließen</button></div>`}
 if(type==='bridge-help'){title='Datenformat der Messbrücke';body=`<p>Eine lokale Anwendung liest den RS422-Sensor und sendet die Messwerte per WebSocket als JSON:</p><pre style="font:14px/1.7 var(--mono);padding:15px;background:var(--bg);border-radius:6px;overflow:auto">${esc(JSON.stringify({value:SENSOR.midpoint + 0.001,unit:SENSOR.unit,sensor:SENSOR.model,...(SENSOR.kind==='distance'?{state:'green',output:'green'}:{})},null,2))}</pre><p class="info-line">${icon('info')}<span><code>value</code> ist eine Zahl in ${U()}. Wenn <code>sensor</code> angegeben ist, muss der Wert <code>${esc(SENSOR.model)}</code> sein. Für die LEDs gelten <code>green</code>, <code>yellow</code>, <code>red</code>, <code>off</code> und <code>unknown</code>. Fehlende LED-Daten zeigt der Monitor als unbekannt an. Beim Projekt-Backend nutze <code>/ws/stream</code> mit erreichbarem <code>/api/status</code>. Bei HTTPS kann WSS nötig sein.</span></p><div class="dialog-actions"><button class="btn primary" data-action="close-dialog">Schließen</button></div>`}
 if(type==='sensor'){title=SENSOR.model;body=`<p>${rt.mode==='demo'?'Wähle eine LED-Farbe, um den Status zu simulieren.':'LED-Zustände von der Messbrücke'}</p><div class="sensor-dialog-grid"><div><div class="sensor-large" id="large-viewer"><div class="viewer-help">Ziehen zum Drehen · Scrollen zum Zoomen</div></div><div class="viewer-controls"><span class="small muted">Nach der Maßzeichnung im Handbuch</span><button class="text-button small" data-action="reset-viewer">${icon('reset')} Ansicht zurücksetzen</button></div></div><div>${['state','output'].map(name=>`<section class="sensor-detail"><div class="sensor-detail-header" data-led="${name}" data-led-state="${esc(rt.led[name])}"><span class="led-indicator" id="dialog-${name}-dot" aria-hidden="true"></span><h3>${name==='state'?'State':'Output'}-LED</h3><span class="led-color-label" id="dialog-${name}-led-label">${ledLabel(rt.led[name])}</span></div>${rt.mode==='demo'?`<div class="led-options" aria-label="${name} LED simulieren">${['green','yellow','red','off'].map(c=>`<button class="led-option ${rt.led[name]===c?'active':''}" data-action="led" data-led="${name}" data-value="${c}" aria-pressed="${rt.led[name]===c}" aria-label="${name}-LED ${({green:'grün',yellow:'gelb',red:'rot',off:'aus'})[c]}" style="--led:${ledColor(c)}"><span></span></button>`).join('')}</div>`:''}<p class="led-explanation" id="led-${name}-description">${ledMeaning(name,rt.led[name])}</p></section>`).join('')}</div></div>`}
 d.innerHTML=dialogShell(title,body);if(type==='profile')settingsStore().ensure('profile-editor',readSettingsForm(d.querySelector('[data-form="profile"]')));if(!d.open)d.showModal();if (type === 'sensor') {
   const revealLed = name => $(`#led-${name}-description`)?.scrollIntoView({block: 'nearest'});
   mountViewer($('#large-viewer'), {
     initialState: rt.led,
     onSelect: revealLed,
   }, v => { rt.dialogViewer?.dispose(); rt.dialogViewer = v; v.setStatus(rt.led); });
   if (context) revealLed(context);
 }
}
function closeDialog(force=false){if(!force&&dialogType==='profile'){captureSettingsDrafts();if(settingsStore().dirty('profile-editor')){confirmSettingsAction({title:'Profiländerungen verwerfen?',message:'Die ungespeicherten Änderungen an diesem Profil werden verworfen.',onConfirm:()=>{settingsStore().clear('profile-editor');closeDialog(true)}});return}}if(dialogType==='profile')settingsStore().clear('profile-editor');rt.dialogViewer?.dispose();rt.dialogViewer=null;$('#dialog').close();dialogType='';dialogContext=null}

function errorCenter(){return `<section class="panel error-center" aria-label="Erkannte Fehler"><div class="error-center-head"><div><h2>Erkannte Fehler</h2><p><strong id="error-count">${rt.errorTotal||0}</strong> Vorfälle seit dem Öffnen</p></div><div class="notice-actions"><button class="btn quiet compact" data-action="toggle-alert-sound" aria-pressed="${rt.alertSound}">${rt.alertSound?'Ton an':'Ton aus'}</button><label class="small">Alarm bei Überschreitung <select data-field="deviation-alarm-mode" aria-label="Alarmton bei Überschreitung"><option value="single" ${rt.deviationAlarmMode==='single'?'selected':''}>Einmal piepen</option><option value="repeat" ${rt.deviationAlarmMode==='repeat'?'selected':''}>Wiederholen, bis der Wert stabil ist</option></select></label><button class="btn quiet compact" data-action="test-alert-sound">Ton testen</button>${rt.errorTotal?'<button class="btn quiet compact" data-action="clear-error-history">Zähler zurücksetzen</button>':''}</div></div>${rt.errorEvents.length?`<ul class="error-list">${rt.errorEvents.slice(0,3).map(e=>`<li><span class="badge">${esc(e.type)}</span><span>${esc(e.message)}</span><time>${time(e.time)}</time></li>`).join('')}</ul>`:'<p class="error-empty">Keine Fehler erkannt. Ungültige Messwerte und Überschreitungen der Profilgrenzen werden hier angezeigt.</p>'}</section>`}
function render(){const table=$('#chart-data');if(table)rt.tableOpen=table.open;const tools=$('.demo-tools');if(tools)rt.demoToolsOpen=tools.open;captureSettingsDrafts();const focused=document.activeElement;const focusedInApp=focused&&$('#app').contains(focused);let focusSelector='';if(focusedInApp){if(focused.id)focusSelector='#'+CSS.escape(focused.id);else if(focused.dataset.action){focusSelector='[data-action="'+CSS.escape(focused.dataset.action)+'"]';for(const k of ['id','value','view'])if(focused.dataset[k])focusSelector+='[data-'+k+'="'+CSS.escape(focused.dataset[k])+'"]'}else if(focused.dataset.field){focusSelector='[data-field="'+CSS.escape(focused.dataset.field)+'"]';if(focused.value)focusSelector+='[value="'+CSS.escape(focused.value)+'"]'}}rt.viewer?.dispose();rt.viewer=null;rt.charts=[];const main=rt.route==='recordings'?recordingsView():rt.route==='advanced'?advancedView():rt.route==='setup'?setupView():monitor();const toastElement=$('#toast');if(toastElement)document.body.append(toastElement);$('#app').innerHTML=header()+`<main id="main" class="main" tabindex="-1">${globalNotices()}${main}${rt.route==='monitor'?errorCenter():''}</main>`;placeToast(toastElement);document.title=`${{monitor:'Sensor Cockpit',recordings:'Aufzeichnungen',advanced:'Einstellungen',setup:'Einrichtung'}[rt.route]} · Micro-Epsilon`;if(rt.route==='monitor'){if(has3d())mountViewer($('#mini-viewer'),{initialState:rt.led,onSelect:name=>openDialog('sensor',name)},viewer=>{rt.viewer=viewer});updateLive();const canvas=$('#live-chart');canvas.addEventListener('pointermove',chartHover);canvas.addEventListener('pointerleave',()=>$('#live-tooltip')?.classList.add('hidden'))}drawCharts();showFactory();if(focusSelector)$(focusSelector)?.focus({preventScroll:true});if(rt.search&&rt.route==='recordings')document.querySelectorAll('[data-run-id]').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(rt.search.toLocaleLowerCase()));restoreSettingsDrafts();applyTranslations();assistant?.refresh()}

function drawChart(canvas,{points,reference=null,profile:p,start=0,end=60,markers=[],offset=0,refOffset=0,cursor=null,limits=true,includeZero=false,scaleMode='auto',breaks=[],highlight=null}){if(!canvas)return;const rect=canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;const ratio=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);const colors = getComputedStyle(canvas);
 const chartColor = name => colors.getPropertyValue(`--chart-${name}`).trim();
 const text = chartColor('ink'), line = chartColor('line'), accent = chartColor('signal');const left=w<400?56:65,right=14,top=15,bottom=31,pw=w-left-right,ph=h-top-bottom;const visible=points.filter(x=>x.t>=start&&x.t<=end);const data=visible.filter(x=>Number.isFinite(x.value));const ref=reference?.filter(x=>x.t+refOffset>=start&&x.t+refOffset<=end&&Number.isFinite(x.value))||[];const shown=[...data.map(x=>x.value),...ref.map(x=>x.value)];const vals=shown.length?[...shown,...(includeZero?[0]:[]),...(limits&&scaleMode==='spec'?[p.lower,p.upper]:[])]:limits?[p.lower,p.upper,p.target]:[-1,1];let low=Math.min(...vals),high=Math.max(...vals);const pad=Math.max((high-low)*.3,.012);low-=pad;high+=pad;const x=t=>left+(t-start)/Math.max(.001,end-start)*pw,y=v=>top+ph-(v-low)/(high-low)*ph;
 ctx.clearRect(0,0,w,h);ctx.font='12px "JetBrains Mono"';ctx.textBaseline='middle';ctx.fillStyle=text;ctx.strokeStyle=line;ctx.lineWidth=.7;const steps=4;for(let i=0;i<=steps;i++){const yy=top+ph*i/steps;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.textAlign='right';const tickValue=high-(high-low)*i/steps-offset;ctx.fillText(num(includeZero&&Math.abs(tickValue)<.0005?0:tickValue,p.unit||'mm'),left-9,yy)}
 ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
 ctx.strokeStyle = line;
 for (let tick = 0; tick <= 8; tick++) {
   const xx = left + pw * tick / 8;
   ctx.beginPath();
   ctx.moveTo(xx, top);
   ctx.lineTo(xx, top + ph);
   ctx.stroke();
 }if(limits){ctx.fillStyle=chartColor('band');ctx.fillRect(left,y(p.upper),pw,y(p.lower)-y(p.upper));for(const value of[p.lower,p.upper]){ctx.strokeStyle=chartColor('limit');ctx.setLineDash([4,5]);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(w-right,y(value));ctx.stroke()}}else if(includeZero){ctx.strokeStyle=chartColor('limit');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(w-right,y(0));ctx.stroke()}ctx.setLineDash([]);const draw=(arr,shift,color,dash=[])=>{if(arr.length<1)return;ctx.strokeStyle=color;ctx.lineWidth=1.65;ctx.setLineDash(dash);ctx.beginPath();let drawing=false;arr.forEach(pt=>{if(!Number.isFinite(pt.value)){drawing=false;return}if(!drawing||pt.breakBefore)ctx.moveTo(x(pt.t+shift),y(pt.value));else ctx.lineTo(x(pt.t+shift),y(pt.value));drawing=true});ctx.stroke();ctx.setLineDash([])};draw(visible,0,accent);draw(ref,refOffset,chartColor('reference'),[4,4]);
 for(const gap of breaks.filter(point=>point.t>=start&&point.t<=end)){ctx.strokeStyle=chartColor('reference');ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x(gap.t),top);ctx.lineTo(x(gap.t),top+ph);ctx.stroke();ctx.setLineDash([])}
 if(highlight!==null&&highlight>=start&&highlight<=end){ctx.strokeStyle=chartColor('cursor');ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x(highlight),top);ctx.lineTo(x(highlight),top+ph);ctx.stroke()}
 markers.filter(m=>m.t>=start&&m.t<=end).forEach(m=>{ctx.strokeStyle=chartColor('reference');ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(x(m.t),top+8);ctx.lineTo(x(m.t),top+ph);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=accent;ctx.beginPath();ctx.arc(x(m.t),top+6,2.5,0,Math.PI*2);ctx.fill()});if(cursor!==null){ctx.strokeStyle=chartColor('cursor');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(cursor),top);ctx.lineTo(x(cursor),top+ph);ctx.stroke()}ctx.restore();ctx.fillStyle=text;ctx.font='12px "JetBrains Mono"';ctx.textBaseline='top';
 const timeSteps = pw < 230 ? 2 : 4;
 for (let i = 0; i <= timeSteps; i++) {
   const t = start + (end - start) * i / timeSteps;
   ctx.textAlign = i === 0 ? 'left' : i === timeSteps ? 'right' : 'center';
   ctx.fillText(formatDuration(t), x(t), h - bottom + 10);
 }canvas._plot={start,end,left,pw,data,x,y,w,h,offset};
}
function drawSlope(start,end){
  const canvas=$('#slope-chart');if(!canvas)return;
  const series=buildSlopeSeries(rt.points,{start,end,sensorUnit:U()});
  drawChart(canvas,{points:series.points,profile:{unit:series.unit},start,end,limits:false,includeZero:true,breaks:rt.breaks,highlight:rt.highlightTime});
  const latest=rt.connected&&!rt.invalidSignal?series.points.at(-1)?.value:null;
  const displayed=Number.isFinite(latest)&&Math.abs(latest)<.0005?0:latest;
  const current=$('#slope-value');
  if(current)current.textContent=Number.isFinite(displayed)?`${displayed>0?'+':''}${num(displayed,series.unit)} ${series.unit}`:`— ${series.unit}`;
  const empty=$('#slope-empty');
  if(empty){empty.hidden=series.available;empty.textContent=!rt.connected?'Warte auf Messwerte':rt.invalidSignal?'Keine gültigen Messwerte':'Noch nicht genügend Messwerte';applyTranslations(empty)}
  const status=$('#slope-current');
  if(status){if(series.available&&!Number.isFinite(latest))status.title='Messreihe unterbrochen';else status.removeAttribute('title');applyTranslations(status)}
}
function drawCharts(){const p=profile();if($('#live-chart')){const start=Math.max(0,rt.elapsed-rt.window),end=Math.max(rt.elapsed,rt.window);drawChart($('#live-chart'),{points:rt.points,profile:p,start,end,markers:[...rt.markers,...(rt.deviation?[{t:rt.deviation.t,note:'Abweichung'}]:[])],offset:rt.zeroOffset,scaleMode:rt.scaleMode,breaks:rt.breaks,highlight:rt.highlightTime});drawSlope(start,end)}if(rt.route==='recordings'&&rt.analysis){const runs=[...rt.selected].map(id=>state.recordings.find(r=>r.id===id)).filter(Boolean),r=runs[0];if(!r)return;if(rt.analysis==='report'){drawChart($('#report-chart'),{points:r.points,profile:r.profile,start:rt.reportStart,end:rt.reportEnd,markers:r.markers});return}if(rt.analysis==='compare'&&runs.length===2){if(unitOf(r)!==unitOf(runs[1]))return;drawChart($('#analysis-chart'),{points:r.points,reference:runs[1].points,profile:r.profile,start:0,end:Math.max(r.duration,runs[1].duration+rt.offset),markers:r.markers,refOffset:rt.offset});updateComparison(r,runs[1])}else if(rt.analysis==='replay'){const window=rt.replayWindow||r.duration;let start=Math.max(0,rt.replayTime-window*.8);start=Math.min(start,Math.max(0,r.duration-window));drawChart($('#analysis-chart'),{points:r.points,profile:r.profile,start,end:Math.min(r.duration,start+window),markers:r.markers,cursor:rt.replayTime});const current=r.points.reduce((a,b)=>Math.abs(b.t-rt.replayTime)<Math.abs(a.t-rt.replayTime)?b:a,r.points[0]);if($('#replay-value'))$('#replay-value').textContent=`${num(current?.value,unitOf(r))} ${unitOf(r)} · ${recordingSource(r)}daten`}}}
function updateComparison(a,b){const recordNum=v=>num(v,unitOf(a));const diffs=[];for(const pt of a.points){const t=pt.t-rt.offset;if(t<0||t>b.duration)continue;let lo=0,hi=b.points.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(b.points[mid].t<t)lo=mid+1;else hi=mid}const point=b.points[lo];const previous=b.points[Math.max(0,lo-1)];const nearest=Math.abs(point.t-t)<Math.abs(previous.t-t)?point:previous;if(Math.abs(nearest.t-t)<=.21)diffs.push(pt.value-nearest.value)}const mean=diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:null;$('#compare-mean').textContent=mean===null?'—':recordNum(mean)+' '+unitOf(a);$('#compare-max').textContent=diffs.length?recordNum(Math.max(...diffs.map(Math.abs)))+' '+unitOf(a):'—';$('#compare-count').textContent=String(diffs.length)}
function chartHover(e){const canvas=e.currentTarget,plot=canvas._plot,tooltip=$('#live-tooltip');if(!plot||!plot.data.length||!tooltip)return;const rect=canvas.getBoundingClientRect(),tx=plot.start+((e.clientX-rect.left-plot.left)/plot.pw)*(plot.end-plot.start);const point=plot.data.reduce((a,b)=>Math.abs(b.t-tx)<Math.abs(a.t-tx)?b:a);tooltip.textContent=`${formatDuration(point.t)} · ${vnum(point.value)} ${U()}`;tooltip.classList.remove('hidden');tooltip.style.left=Math.min(plot.w-tooltip.offsetWidth-4,Math.max(4,e.clientX-rect.left+10))+'px';tooltip.style.top=Math.max(4,e.clientY-rect.top-32)+'px'}
function updateLive(){const p=profile();if($('#reading-source'))$('#reading-source').textContent=measurementSourceLabel();if($('#chart-status')){$('#chart-status').textContent=chartStatus();applyTranslations($('#chart-status'))}const reading=$('#reading-value');if(reading)reading.textContent=rt.connected&&!rt.invalidSignal?vnum(rt.value):'—';if($('#deviation-value'))$('#deviation-value').textContent=rt.connected&&!rt.invalidSignal?num(rt.value-p.target)+' '+U():'—';const pointer=$('#tolerance-pointer');if (pointer) {
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
function addValue(value,{led=null}={}){if(!Number.isFinite(value))return;if(rt.mode==='demo')rt.elapsed+=1/DISPLAY_RATE;else rt.elapsed=Math.max(0,(performance.now()-rt.bridgeStart)/1000);rt.value=value;rt.lastValidAt=new Date().toISOString();const point={t:rt.elapsed,value,version:profile().version,...(rt.channelBreak?{breakBefore:true}:{})};rt.channelBreak=false;rt.points.push(point);rt.points=rt.points.filter(p=>p.t>=rt.elapsed-65);if(led){rt.led=led}else if(rt.scenario==='normal'){rt.led={state:Math.abs(value-SENSOR.midpoint)<.001?'yellow':'green',output:state.settings.output==='analog'?'red':'green'}}if(rt.record)rt.record.points.push({...point,t:Math.max(0,Math.round((rt.elapsed-rt.record.startElapsed)*1000)/1000)});const p=profile(),outsideProfile=value<p.learnedLower||value>p.learnedUpper;if(!outsideProfile){resolveIncident('deviation');rt.outsideEpisode=false}else if(!rt.outsideEpisode){rt.outsideEpisode=true;if(rt.elapsed>rt.cooldown&&!rt.mlKnown&&!rt.deviation?.ml){rt.deviation={value,t:rt.elapsed,profile:clone(p)};rt.lastFeedback=null;refreshSuggest();reportIncident('deviation','Grenzwert überschritten',`Messwert ${num(value)} ${U()}; Profilgrenzen ${num(p.learnedLower)}–${num(p.learnedUpper)} ${U()}.`);if(rt.route==='monitor'){const target=$('#learning-notice');if(target)target.innerHTML=learningNotice()}}}if(rt.mode==='demo'||performance.now()-(rt.lastDraw||0)>100){updateLive();drawCharts();rt.lastDraw=performance.now()}}
function startRecord(name,cls=''){if(!name.trim()){toast('Bitte gib einen Namen für die Aufnahme ein.');return}if(rt.invalidSignal){toast('Warte auf einen gültigen Messwert.');return}if(rt.unsaved){toast('Speichere zuerst die vorherige Aufnahme.');return}if(!rt.connected){toast('Verbinde zuerst eine Datenquelle.');return}rt.paused=false;rt.lastSaved=null;rt.deviation=null;rt.lastFeedback=null;rt.record={id:generateId('run'),name,createdAt:new Date().toISOString(),source:rt.mode==='demo'?'demo':rt.backendReplay?'replay':'sensor',sensor:SENSOR.model,profile:clone(profile()),profileAtStart:clone(profile()),points:[{t:0,value:rt.value,version:profile().version}],markers:[],feedback:[],parameterHistory:[],storage:'Browser · lokal',displayRate:DISPLAY_RATE,zeroOffset:rt.zeroOffset,startElapsed:rt.elapsed};rt.record.cls=cls;rt.record.backend=false;if(rt.mode==='bridge'&&rt.connected&&cls&&!rt.backendReplay)backendRequest('/api/record/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:name,cls})}).then(()=>{if(rt.record)rt.record.backend=true;else backendRequest('/api/record/stop',{method:'POST'}).catch(()=>{})}).catch(error=>toast(`Die beschriftete Aufnahme konnte am Messserver nicht gestartet werden: ${error.message}`));closeDialog();render();toast(cls&&!rt.backendReplay?'Aufnahme läuft. Beschriftete Daten werden vom Messserver gelernt.':'Aufnahme läuft. Messwerte werden erfasst.')}
function finishRecord(interrupted=false){const r=rt.record;if(!r)return null;if(r.backend)backendRequest('/api/record/stop',{method:'POST'}).then(()=>{if(r.cls)toast(`Beschriftete Aufnahme (${r.cls==='anomaly'?'Anomalie':'normal'}) an die KI übergeben.`)}).catch(()=>{});r.duration=Math.max(.2,Math.round((rt.elapsed-r.startElapsed)*1000)/1000);r.profile=clone(profile());r.interrupted=interrupted;if(r.source!=='demo')r.displayRate=Math.round(r.points.length/r.duration*100)/100;delete r.startElapsed;rt.record=null;return r}
function saveRecording(r){if(!r)return;const old=state.recordings;state.recordings=[r,...old.filter(x=>x.id!==r.id)];if(persist()){rt.unsaved=null;rt.lastSaved=r;toast('Aufzeichnung lokal gespeichert.');render()}else{state.recordings=old;rt.unsaved=r;render()}}
function stopRecord(){if(!rt.record)return;const r=finishRecord();rt.saving=true;render();setTimeout(()=>{rt.saving=false;saveRecording(r)},300)}
function interruptRecord(){if(rt.record){rt.unsaved=finishRecord(true);toast('Aufnahme unterbrochen. Sichere die bisher erfassten Daten.')}}
function useDemo(){if(rt.record||rt.saving){toast('Bitte zuerst die laufende Aufnahme stoppen.');return}disconnectSocket();resolveIncident('connection');resolveIncident('sensor');resolveIncident('deviation');rt.outsideEpisode=false;rt.backendReplay=null;rt.backendStatus=null;rt.mode='demo';rt.connected=true;rt.invalidSignal=false;rt.paused=false;rt.connectionError='';rt.scenario='normal';rt.led={state:'green',output:'green'};rt.value=profile().target;rt.elapsed=60;rt.points=makeDemoPoints(60,0,0,profile().target);rt.channelBreak=false;rt.lastValidAt=new Date().toISOString();rt.breaks=[];rt.tableSnapshot=null;rt.tableOpen=false;rt.markers=[];rt.deviation=null;rt.lastFeedback=null;rt.zeroOffset=0;closeDialog();render();toast('Demo-Sensor verbunden.')}
function disconnectSocket() {
  rt.channelBreak=true;
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
  Object.assign(rt, { points: [], markers: [], deviation: null, lastFeedback: null, zeroOffset: 0, value: SENSOR.midpoint, paused:false, elapsed:0, lastValidAt:null,breaks:[],tableSnapshot:null,tableOpen:false,cooldown:0,
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
  const keepHistory=quiet&&rt.mode==='bridge'&&rt.bridgeUrl===address&&rt.points.length>0;
  const retained=keepHistory?{points:rt.points,markers:rt.markers,elapsed:rt.elapsed,zeroOffset:rt.zeroOffset,lastValidAt:rt.lastValidAt,breaks:rt.breaks,backendReplay:rt.backendReplay,backendStatus:rt.backendStatus}:{};
  disconnectSocket();
  Object.assign(rt, {
    mode: 'bridge', connected: false, invalidSignal: false, bridgeUrl: address, backendReplay: null,backendStatus:null,cooldown:0,
    connectionError: '', paused: false, points: [], markers: [], deviation: null,
    lastFeedback: null, zeroOffset: 0, elapsed: 0, lastValidAt:null,breaks:[],tableSnapshot:null,tableOpen:false,led: { state: 'unknown', output: 'unknown' },...retained,
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
  let gotValue = Boolean(keepHistory);
  let sourceIdentity = keepHistory?rt.sourceIdentity:null;
  const applySource = status => {
    const info=status.info||{};
    const identity=JSON.stringify([status.source,info.model,info.serial,info.replay_of,info.label,info.unit,info.range_mm,info.smr_mm,info.range_min,info.range_max]);
    const changed=sourceIdentity!==identity;
    if(sourceIdentity!==null&&changed){
      interruptRecord();
      Object.assign(rt,{points:[],markers:[],zeroOffset:0,elapsed:0,lastValidAt:null,breaks:[],tableSnapshot:null,tableOpen:false,deviation:null,lastFeedback:null,cooldown:0,paused:false});
      gotValue=false;
    }
    const sensorId=sensorFromStatus(status);
    const differentThermo=sensorId==='thermo_uc'&&(info.model&&!SENSOR.model.endsWith(info.model)||Number.isFinite(info.range_min)&&info.range_min!==SENSOR.rangeStart||Number.isFinite(info.range_max)&&info.range_max!==SENSOR.rangeEnd);
    if(sensorId&&(sensorId!==SENSOR.id||differentThermo))switchSensor(sensorId,info);
    sourceIdentity=identity;rt.sourceIdentity=identity;
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
    if(data.ml&&typeof data.ml==='object')mlFrame(data.ml);
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
      if(!wasInvalid)markInterruption('Kein gültiger Messwert');
      rt.invalidSignal=true;
      resolveIncident('deviation');rt.outsideEpisode=false;
      rt.invalidError=message;
      reportIncident('sensor','Ungültiger Messwert',message);
      rt.led=nextLeds;
      if(!wasInvalid||!wasConnected||sourceChanged||messageChanged)render();
      else if(ledsChanged)updateLive();
      return;
    }

    rt.invalidSignal = false;
    resolveIncident('sensor');
    resolveIncident('connection');
    if (!gotValue) rt.bridgeStart = performance.now();
    gotValue = true;
    rt.led=sample.led;
    if (!rt.paused) addValue(sample.value, { led: sample.led });
    else updateLive();
    if (!wasConnected) announce('Messwerte werden empfangen.');
    if (!wasConnected || wasInvalid || sourceChanged) render();
  };
  socket.onerror = () => fail('Die Messbrücke ist nicht erreichbar. Die Verbindung wird erneut aufgebaut.',true);
  socket.onclose = () => fail('Die Verbindung zur Messbrücke wurde getrennt. Die Verbindung wird erneut aufgebaut.',true);
}
function connectionFailed(message,retry=false){markInterruption('Verbindung getrennt');if(rt.connected){interruptRecord();announce('Verbindung getrennt.')}rt.connected=false;rt.invalidSignal=false;resolveIncident('deviation');rt.outsideEpisode=false;rt.connectionError=message;reportIncident('connection','Verbindung verloren',message);rt.led={state:'unknown',output:'unknown'};render();clearTimeout(rt.retryTimer);if(retry&&rt.mode==='bridge'){refreshBackend();rt.retryTimer=setTimeout(()=>connectBridge(true),3000)}}
function reconnect(){if(rt.mode==='demo'){rt.connected=true;rt.invalidSignal=false;rt.connectionError='';rt.scenario='normal';rt.led={state:'green',output:'green'};render();toast('Demo-Verbindung wiederhergestellt.')}else connectBridge()}

async function handleAction(el,event){const action=el.dataset.action;if(settingsSaving.size&&['demo','sensor-source','connect-sensor','connect-bridge','edit-profile'].includes(action)){toast('Bitte warte, bis das Speichern abgeschlossen ist.');return}if(['demo','sensor-source','connect-sensor'].includes(action)&&settingsDirty()){confirmSettingsLeave(()=>handleAction(el,event));return}if(action==='edit-profile'){captureSettingsDrafts();if(settingsStore().dirty(settingsKey('profile'))){toast('Speichere oder verwirf zuerst die Änderungen am Messprofil.');return}}switch(action){
 case'hall':setTextSize(document.documentElement.dataset.textSize==='hall'?'normal':'hall');break;case'assistant-open':assistant.open();break;case'assistant-chart':assistant.open('chart');break;case'assistant-error':assistant.open('error');break;
 case'close-dialog':closeDialog();break;
 case 'theme': {
   const theme = nextTheme();
   applyTheme(theme);
   try { localStorage.setItem('me-theme', theme); } catch {}
   break;
 }
 case'help':openDialog('help');break;case'bridge-help':openDialog('bridge-help');break;case'connection':openDialog('connection');break;case'connect-bridge':connectBridge();break;case'scan-sensors':refreshBackend();break;case'connect-sensor':connectSensor();break;case'connect-simulator':connectSimulator();break;case'dismiss-setup':state.setupComplete=true;persist();render();break;case'toggle-alert-sound':toggleAlertSound();break;case'test-alert-sound':if(rt.alertSound){primeAlertAudio();playAlertSound()}else toast('Aktiviere zuerst den Alarmton.');break;case'clear-error-history':rt.errorEvents=[];rt.errorTotal=0;render();toast('Der Fehlerzähler wurde zurückgesetzt.');break;case'demo':useDemo();break;case'reconnect':reconnect();break;
 case'edit-profile':if(rt.record){toast('Stoppe die Aufnahme, um das Profil zu ändern.');break}openDialog('profile');break;
 case'apply-profile':{const p=state.profiles.find(p=>p.id===el.dataset.id);if(!p)break;state.activeProfileId=p.id;rt.window=p.window;rt.zeroOffset=0;rt.points=rt.mode==='demo'?makeDemoPoints(60,0,0,p.target):[];if(rt.mode==='demo'){rt.elapsed=60;rt.value=p.target;}rt.markers=[];rt.deviation=null;rt.lastFeedback=null;rt.cooldown=0;persist();closeDialog();render();toast(`Profil „${p.name}“ geladen.`);break}
 case'record':if(rt.record)stopRecord();else if(rt.unsaved)toast('Speichere zuerst die vorherige Aufnahme.');else openDialog('record');break;
 case'retry-save':saveRecording(rt.unsaved);break;case'export-unsaved':exportRecordingCSV(rt.unsaved);break;
 case'pause':if(rt.record)break;if(!rt.paused)markInterruption('Anzeige pausiert');rt.paused=!rt.paused;rt.channelBreak=true;render();break;
 case'zero':if(rt.invalidSignal||!rt.connected){toast('Warte auf einen gültigen Messwert.');break}if(rt.record){toast('Der Nullpunkt bleibt während einer Aufnahme unverändert.');break}rt.zeroOffset=rt.zeroOffset?0:rt.value;render();toast(rt.zeroOffset?'Nullpunkt für die Anzeige gesetzt.':'Absoluter Messwert wird angezeigt.');break;
 case'window':rt.window=Number(el.dataset.value);render();if(rt.deviation)refreshSuggest();break;
 case'scale':rt.scaleMode=el.dataset.value==='auto'?'auto':'spec';render();break;
 case'focus-event':if(rt.deviation){if(rt.deviation.t<rt.elapsed-60){toast('Dieses Ereignis liegt außerhalb des Live-Puffers.');break}rt.highlightTime=rt.deviation.t;rt.window=Math.max(rt.window,Math.min(60,Math.ceil(rt.elapsed-rt.deviation.t+1)));render();$('#live-chart')?.focus({preventScroll:true});$('#live-chart')?.scrollIntoView({block:'center',behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}break;
 case'refresh-chart-data':captureChartData();if($('#chart-data-content')){$('#chart-data-content').innerHTML=chartDataRows(rt.tableSnapshot);applyTranslations($('#chart-data-content'));}break;
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
 case'simulate-invalid':if(rt.mode==='demo'&&rt.connected){interruptRecord();markInterruption('Kein gültiger Messwert');rt.invalidSignal=true;resolveIncident('deviation');rt.outsideEpisode=false;reportIncident('sensor','Ungültiger Messwert','Der Simulator erhält keinen gültigen Messwert mehr.');rt.invalidError='';rt.scenario='invalid';rt.deviation=null;rt.led={state:'red',output:'green'};render()}break;case'resume-signal':rt.invalidSignal=false;resolveIncident('sensor');rt.scenario='normal';rt.led={state:'green',output:'green'};render();toast('Der Demo-Sensor liefert wieder gültige Werte.');break;
 case'simulate-disconnect':if(rt.mode!=='demo')break;if(rt.connected){interruptRecord();markInterruption('Verbindung getrennt');rt.connected=false;rt.connectionError='Die Demo simuliert einen Verbindungsabbruch. Mit „Erneut verbinden“ kannst du fortfahren.';rt.led={state:'unknown',output:'unknown'};render()}else reconnect();break;
 case'feedback':{if(rt.deviation?.ml){const d=rt.deviation,note=$('#feedback-note')?.value||'',accepted=el.dataset.accepted==='true';const answer=await backendRequest(`/api/ml/events/${encodeURIComponent(d.ml.id)}/label`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:accepted?'normal':'anomaly',note,learn_s:accepted?rt.window:null})});let limits=null;if(accepted){const range=answer.suggest||await fetchSuggest();if(range){const r=acceptRange(profile(),{value:d.value,lo:range.lo,hi:range.hi,seconds:rt.window},note,d.t);setProfile(r.profile);rt.feedback.push(r.event);limits=r.event;persist()}}if(rt.record)rt.record.markers.push({id:generateId('feedback-note'),t:Math.max(0,d.t-rt.record.startElapsed),note:`KI · ${mlReason(d.ml.reason)}: ${accepted?'in Ordnung':'nicht in Ordnung'}${note?' · '+note:''}`});rt.deviation=null;rt.lastFeedback={ml:true,accepted,limits};rt.cooldown=rt.elapsed+5;render();if(rt.route==='advanced')loadMl();break}if(!rt.deviation)break;const d=rt.deviation,note=$('#feedback-note')?.value||'',accepted=el.dataset.accepted==='true';let result;if(accepted){const range=await fetchSuggest();if(rt.mode==='bridge'&&rt.connected)backendRequest('/api/ml/learn_recent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seconds:rt.window,note})}).catch(()=>{});result=acceptRange(profile(),{value:d.value,lo:range?.lo,hi:range?.hi,seconds:rt.window},note,d.t)}else result=acceptFeedback(profile(),d.value,false,note,d.t);setProfile(result.profile);rt.feedback.push(result.event);if(rt.record){const converted={...result.event,t:Math.max(0,d.t-rt.record.startElapsed)};rt.record.feedback.push(converted);if(result.event.changed)rt.record.parameterHistory.push({...converted,t:Math.max(0,Math.round((rt.elapsed-rt.record.startElapsed)*1000)/1000)});rt.record.markers.push({id:generateId('feedback-note'),t:converted.t,note:`${accepted?'Akzeptabel':'Nicht akzeptabel'}: ${num(d.value)} ${U()}${note?' · '+note:''}`})}rt.deviation=null;rt.lastFeedback=result.event;rt.cooldown=rt.elapsed+5;persist();render();break}
 case'ml-reset':case'ml-forget':requestMlReset(action==='ml-reset');break;
 case'ml-refresh':loadMl();break;
 case'settings-discard':{const form=el.closest('[data-settings-key]');if(form){settingsStore().discard(form.dataset.settingsKey);restoreSettingsDrafts();clearSettingsErrors(form)}break}
 case'ml-learn':{const file=$('#ml-learn-file')?.value;if(!file)break;const label=el.dataset.label==='anomaly'?'anomaly':'normal';const r=await backendRequest('/api/ml/learn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file,label})});toast(`${r.learned_windows} Zeitfenster als ${label==='anomaly'?'Anomalie':'normal'} gelernt.`);loadMl();break}
 case'dismiss-known':rt.mlKnown=null;render();break;
 case'dismiss-deviation':rt.deviation=null;rt.cooldown=rt.elapsed+10;render();break;case'dismiss-feedback':rt.lastFeedback=null;render();break;
 case'run-menu':openDialog('run',el.dataset.id);break;
 case'delete-run':requestRecordingDeletion([el.dataset.id]);break;
 case'delete-selected-runs':requestRecordingDeletion(rt.selected);break;
 case'undo-delete-runs':undoRecordingDeletion();break;
 case'analysis':{rt.analysisOpener=el.dataset.view;rt.analysis=el.dataset.view;rt.offset=0;rt.replayPlaying=false;rt.replayTime=0;rt.reportStart=0;rt.reportEnd=recording()?.duration||60;render();$('#analysis-heading')?.focus({preventScroll:true});$('.analysis-panel')?.scrollIntoView({behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});break}
 case'close-analysis':rt.analysis=null;rt.replayPlaying=false;render();$(`[data-action="analysis"][data-view="${rt.analysisOpener||'replay'}"]`)?.focus({preventScroll:true});break;
 case'csv':if(recording()){exportRecordingCSV(recording());toast('CSV-Datei zum Download bereit.')}break;
 case'clear-search':rt.search='';render();$('#run-search')?.focus();break;
 case'pdf':if(recording()&&!rt.pdfBusy){const run=clone(recording()),options={start:rt.reportStart,end:rt.reportEnd,language:getLanguage()};rt.pdfBusy=true;render();try{await exportReportPDF(run,options);toast('PDF-Bericht zum Download bereit.')}catch(e){toast(e.message)}finally{rt.pdfBusy=false;render();$('[data-action="pdf"]')?.focus({preventScroll:true})}}break;
 case'align':rt.offset=0;render();toast('Beide Messungen beginnen bei 00:00.');break;
 case'replay-toggle':{const r=recording();if(rt.replayTime>=r.duration)rt.replayTime=0;rt.replayPlaying=!rt.replayPlaying;render();break}
 case'replay-window':rt.replayWindow=Number(el.dataset.value);render();break;
 case'jump-marker':rt.replayTime=Number(el.dataset.value);rt.replayPlaying=false;render();break;
 case'setup-source':rt.setupMode=el.dataset.value;render();break;
 case'setup-back':rt.setupStep=Math.max(1,rt.setupStep-1);render();break;
 case'setup-next':if(rt.setupStep===1){if(rt.setupMode==='demo')useDemo();else if(!rt.connected||rt.invalidSignal||rt.mode!=='bridge'){toast('Verbinde zuerst die Messbrücke.');break}}if(rt.setupStep===4){state.setupComplete=true;persist();rt.setupStep=1;route('monitor');toast('Einrichtung abgeschlossen.')}else{rt.setupStep++;render();const heading=$('.wizard-card h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}}break;
 }}

document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link&&link.target!=='_blank'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&link.getAttribute('href')!=='#main'){const url=new URL(link.href,location.href);if(url.href!==location.href&&(settingsSaving.size||settingsDirty())){event.preventDefault();if(settingsSaving.size)toast('Bitte warte, bis das Speichern abgeschlossen ist.');else confirmSettingsLeave(()=>location.assign(url.href))}}},true);
document.addEventListener('click',event=>{primeAlertAudio();if(event.target.closest('.skip-link')){event.preventDefault();$('#main')?.focus();return}const el=event.target.closest('[data-action]');if(el&&!el.disabled){handleAction(el,event).catch(e=>toast(e.message))}});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.demo-tools')){rt.demoToolsOpen=event.target.open;return}if(event.target.id!=='chart-data')return;rt.tableOpen=event.target.open;if(rt.tableOpen&&!rt.tableSnapshot){captureChartData();$('#chart-data-content').innerHTML=chartDataRows(rt.tableSnapshot);applyTranslations($('#chart-data-content'));}},true);
for(const eventName of ['input','change'])document.addEventListener(eventName,event=>{const form=event.target.closest('[data-settings-key]');if(form){settingsStore().set(form.dataset.settingsKey,readSettingsForm(form));restoreSettingsDrafts()}});
document.addEventListener('submit',event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form);try{switch(form.dataset.form){
 case'marker':{const note=data.get('note').trim();if(!note)return;const m={id:generateId('note'),t:rt.elapsed,note};rt.markers.push(m);if(rt.record)rt.record.markers.push({...m,t:Math.max(0,m.t-rt.record.startElapsed)});render();toast('Notiz hinzugefügt.');break}
 case'edit-marker':{const note=data.get('note').trim();const marker=rt.markers.find(x=>x.id===dialogContext);if(marker)marker.note=note;if(rt.record){const rm=rt.record.markers.find(x=>x.id===dialogContext);if(rm)rm.note=note}closeDialog();render();toast('Notiz aktualisiert.');break}
 case'profile':saveProfileEditor(form);break;
 case'start-record':startRecord(data.get('name').trim(),String(data.get('cls')||''));break;
 case'rename-run':renameRecording(form,dialogContext,data.get('name'));break;
 case'delete-runs':confirmRecordingDeletion(form);break;
 case'ml-config':saveMlSettings(form);break;
 case'connection-settings':saveLocalSettings('connection',form);break;
 case'profile-settings':saveLocalSettings('profile',form);break;
 }}catch(e){toast(e.message)}});
document.addEventListener('change',async event=>{const el=event.target;const field=el.dataset.field;if(!field)return;switch(field){case'text-size':setTextSize(el.value);break;case'deviation-alarm-mode':setDeviationAlarmMode(el.value);break;case'language':{
  await setLanguage(el.value);
  const drafts=['#bridge-url','#setting-rate','#setting-window','#live-port'].map(selector=>[selector,$(selector)?.value]);
  const expanded=$('.connection-details')?.open;
  render();
  for(const [selector,value] of drafts){const input=$(selector);if(input&&value!==undefined&&(!input.options||Array.from(input.options).some(option=>option.value===value)))input.value=value}
  if(expanded&&$('.connection-details'))$('.connection-details').open=true;
  break;
}case'profile':if(el.value!==profile().id)openDialog('profile-preview',el.value);el.value=profile().id;break;case'run':if(el.checked)rt.selected.add(el.value);else rt.selected.delete(el.value);rt.analysis=null;rt.replayPlaying=false;render();break;case'speed':rt.replaySpeed=Number(el.value);break;case'report-start':case'report-end':{const r=recording(),start=field==='report-start'?Number(el.value):rt.reportStart,end=field==='report-end'?Number(el.value):rt.reportEnd;try{slicePoints(r,start,end);rt.reportStart=start;rt.reportEnd=end;render()}catch(e){el.value=field==='report-start'?rt.reportStart:rt.reportEnd;toast(e.message)}break}}});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='run-search'){rt.search=el.value;const cursor=el.selectionStart;render();const search=$('#run-search');search?.focus({preventScroll:true});if(search&&Number.isInteger(cursor))search.setSelectionRange(cursor,cursor)}if(el.dataset.field==='offset'){rt.offset=Number(el.value);$('#offset-label').textContent=rt.offset.toLocaleString(getLocale(),{minimumFractionDigits:1,maximumFractionDigits:1})+' s';drawCharts()}if(el.dataset.field==='replay'){rt.replayTime=Number(el.value);rt.replayPlaying=false;$('#replay-time').textContent=formatDuration(rt.replayTime);drawCharts()}});
$('#dialog').addEventListener('close',()=>{settingsStore().clear('profile-editor');rt.dialogViewer?.dispose();rt.dialogViewer=null;dialogType='';dialogContext=null});
$('#dialog').addEventListener('cancel',event=>{if(dialogType==='profile'){captureSettingsDrafts();if(settingsStore().dirty('profile-editor')){event.preventDefault();closeDialog()}}});
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog()}});
function readRoute(){const name=location.hash.slice(1);rt.route=['monitor','recordings','advanced','setup'].includes(name)?name:'monitor';rt.replayPlaying=false;render();if(rt.route==='advanced')loadMl()}
window.addEventListener('hashchange',()=>{if(settingsSaving.size||settingsDirty()){const target=location.hash;history.replaceState(null,'','#'+rt.route);if(settingsSaving.size)toast('Bitte warte, bis das Speichern abgeschlossen ist.');else confirmSettingsLeave(()=>{closeDialog(true);location.hash=target});return}closeDialog();readRoute();window.scrollTo(0,0)});
window.addEventListener('resize',()=>drawCharts());
window.addEventListener('storage',event=>{if(event.key==='me-theme')applyTheme(event.newValue);if(event.key===textSizeKey)applyTextSize(event.newValue);if(event.key==='landing-lang'){updateLive();drawCharts();if(rt.route==='recordings'&&rt.analysis==='report')render();assistant?.refresh();}});
let savedTheme;
try { savedTheme = localStorage.getItem('me-theme'); } catch {}
applyTheme(savedTheme);
applyTextSize(savedTextSize());
assistant=createAssistantUI({getContext:assistantContext,getChartSummary:assistantChartSummary,getError:assistantError,getApiBase:()=>rt.bridgeUrl});
rt.window=profile().window;readRoute();startTranslations();installHints();for(const type of ['pointerdown','keydown'])document.addEventListener(type,primeAlertAudio,{once:true,capture:true});document.fonts.ready.then(()=>drawCharts());refreshBackend(true);
setInterval(()=>{const now=performance.now(),dt=Math.min(1,(now-lastTick)/1000);lastTick=now;if(rt.mode==='demo'&&rt.connected&&!rt.paused&&!rt.invalidSignal){rt.tick++;const t=rt.elapsed+1/DISPLAY_RATE,p=profile(),value=p.target+Math.sin(t*1.23)*.011+Math.sin(t*4.7)*.003+Math.sin(t*.31)*.004;addValue(Math.round(value*1e6)/1e6)}if(rt.mode==='bridge'&&rt.connected&&now-rt.lastBridgeAt>4000){disconnectSocket();connectionFailed('Seit vier Sekunden wurden keine neuen Messwerte empfangen. Die Verbindung wird erneut aufgebaut.',true)}if(rt.replayPlaying&&rt.route==='recordings'){const r=recording();if(r){rt.replayTime=Math.min(r.duration,rt.replayTime+dt*rt.replaySpeed);if(rt.replayTime>=r.duration){rt.replayPlaying=false;render()}else{const range=$('[data-field="replay"]');if(range)range.value=rt.replayTime;if($('#replay-time'))$('#replay-time').textContent=formatDuration(rt.replayTime);drawCharts()}}}},200);
window.addEventListener('beforeunload',event=>{if(rt.record||rt.unsaved||settingsSaving.size||settingsDirty()){event.preventDefault();event.returnValue=''}});
