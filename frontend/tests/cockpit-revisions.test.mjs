import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as engine from '../dist/data.js';
import {buildSlopeSeries} from '../dist/measurement-series.js';
import {assistantText} from '../dist/assistant-i18n.js';
import {askQuestion,explainError,explainChart} from '../dist/assistant.js';
import {pdfText,getPdfLocale} from '../dist/pdf-i18n.js';

const appSource=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const end=appSource.indexOf("document.addEventListener('click'");
assert.ok(end>0);
const views=appSource.slice(0,end).replace(/^import .*;\n/gm,'');
const fixedTime='2026-11-28T10:20:30.000Z';
class FixedDate extends Date {constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return Date.parse(fixedTime);}}
function canvas(){
  const labels=[],paths=[];let path=[];
  const ctx={scale(){},clearRect(){},save(){},restore(){},rect(){},clip(){},setLineDash(){},arc(){},fill(){},fillRect(){},
    fillText(text,x,y){labels.push({text,x,y});},beginPath(){path=[];},moveTo(x,y){path.push(['M',x,y]);},lineTo(x,y){path.push(['L',x,y]);},stroke(){paths.push({color:this.strokeStyle,path});}};
  return{labels,paths,getBoundingClientRect:()=>({width:650,height:240}),getContext:()=>ctx};
}
function harness(){
  engine.useSensor('ild1900');
  const effects=[];
  const elements=new Map([
    ['#live-chart',canvas()],['#slope-chart',canvas()],['#slope-value',{}],['#slope-empty',{}],
    ['#slope-current',{removeAttribute(name){delete this[name];}}],['#chart-data-content',{innerHTML:''}],
    ['#analysis-heading',{focus(options){effects.push({type:'focus-heading',options});}}],
    ['.analysis-panel',{scrollIntoView(options){effects.push({type:'scroll-analysis',options});}}],
    ['[data-action="analysis"][data-view="replay"]',{focus(options){effects.push({type:'focus-opener',options});}}],
    ['#run-search',{focus(){effects.push({type:'focus-search'});}}],
  ]);
  const context=vm.createContext({
    ...engine,buildSlopeSeries,assistantText,pdfText,getPdfLocale,loadState:engine.createInitialState,structuredClone,Date:FixedDate,
    getLocale:()=> 'de-DE',getLanguage:()=> 'de',applyTranslations(){},effects,
    location:{protocol:'http:',hostname:'localhost',host:'localhost:8000',port:'8000'},
    performance:{now:()=>0},devicePixelRatio:1,matchMedia:()=>({matches:true}),
    document:{querySelector:selector=>elements.get(selector)||null,querySelectorAll:()=>[]},
    getComputedStyle:()=>({getPropertyValue:key=>key}),clearTimeout(){},
  });
  vm.runInContext(views,context);
  return{context,elements,effects,run:code=>vm.runInContext(code,context)};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('failed rename restores the stored name and keeps the form open for retry',()=>{
  const h=harness(),error={textContent:''};
  h.context.renameForm={querySelector:()=>error};
  const previous=h.run('state.recordings[0].name');
  h.run("persist=()=>false;closeDialog=()=>effects.push('closed');render=()=>effects.push('rendered');toast=message=>effects.push(message)");
  assert.equal(h.run("renameRecording(renameForm,state.recordings[0].id,'New name')"),false);
  assert.equal(h.run('state.recordings[0].name'),previous);
  assert.match(error.textContent,/Eingaben bleiben erhalten/);
  assert.deepEqual(h.effects,[]);
  h.run('persist=()=>true');
  assert.equal(h.run("renameRecording(renameForm,state.recordings[0].id,'New name')"),true);
  assert.equal(h.run('state.recordings[0].name'),'New name');
  assert.deepEqual(h.effects,['closed','rendered','Messung umbenannt.']);
});

test('measurement provenance remains explicit through pause, invalid signal and disconnection',()=>{
  const h=harness();
  for(const mode of ['demo','replay','live'])for(const status of ['paused','invalid','disconnected']){
    h.run(`rt.mode=${mode==='demo'?"'demo'":"'bridge'"};rt.backendReplay=${mode==='replay'?"'saved trial'":'null'};rt.connected=${status!=='disconnected'};rt.paused=${status==='paused'};rt.invalidSignal=${status==='invalid'};`);
    const label={demo:'Demo',replay:'Wiedergabe',live:'Sensor'}[mode],html=h.run('monitor()');
    assert.ok(html.includes(`id="reading-source">${label}</span>`),`${mode}/${status}`);
    assert.ok(html.includes({paused:'Anzeige pausiert',invalid:'Kein gültiger Messwert',disconnected:'Nicht verbunden'}[status]));
    assert.equal(h.run('assistantContext().source'),mode);
  }
});

test('assistant snapshots distinguish event readings and event limits from the current measurement',async t=>{
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({kind:'error',answerText:'Testantwort'})}));
  const h=harness();
  h.run(`rt.mode='demo';rt.connected=true;rt.value=25.01;rt.elapsed=100;rt.window=10;
    rt.deviation={value:25.075,t:88,profile:{learnedLower:24.94,learnedUpper:25.06}};`);
  const context=h.run('assistantContext()'),error=h.run('assistantError()');
  const result=await explainError(error,context);
  assert.equal(result.currentValue,25.01);
  assert.equal(result.eventValue,25.075);
  assert.equal(result.eventTime,88);
  assert.equal(result.thresholdMin,24.94);
  assert.equal(result.thresholdMax,25.06);
  assert.equal(result.context.capturedAt,fixedTime);
  assert.deepEqual([result.context.start,result.context.end],[90,100]);
  h.run('rt.value=29;profile().upper=28');
  assert.equal(result.context.value,25.01);
  assert.equal(result.context.profile.upper,25.05);
  h.run('rt.invalidSignal=true');
  const invalid=await explainError(error,h.run('assistantContext()'));
  assert.equal(invalid.currentValue,null);
  assert.equal(invalid.eventValue,25.075);
});

test('chart explanations preserve their source, capture time and exact window after later samples',async t=>{
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({kind:'chart',answerText:'Testantwort'})}));
  const h=harness();
  h.run(`rt.mode='bridge';rt.backendReplay='reference';rt.connected=true;rt.elapsed=100;rt.window=10;rt.zeroOffset=25;rt.points=[{t:80,value:29},{t:90,value:25},{t:95,value:25.02},{t:100,value:25.1}];`);
  const response=await explainChart(h.run('assistantChartSummary()'),h.run('assistantContext()'));
  assert.equal(response.context.capturedAt,fixedTime);
  assert.equal(response.context.source,'replay');
  assert.deepEqual([response.summary.start,response.summary.end,response.summary.duration],[90,100,10]);
  assert.equal(response.summary.count,3);
  assert.ok(Math.abs(response.summary.max-.1)<1e-8);
  h.run('rt.elapsed=120;rt.points.push({t:120,value:27})');
  assert.deepEqual([response.summary.start,response.summary.end],[90,100]);
});

test('specification scaling includes both limits and all visible outliers',()=>{
  const h=harness(),chart=h.elements.get('#live-chart');
  for(const points of [[{t:0,value:25.001},{t:1,value:25.002}],[{t:0,value:24.5},{t:1,value:25.7}]]){
    h.context.givenPoints=points;
    h.run("drawChart(document.querySelector('#live-chart'),{points:givenPoints,profile:profile(),start:0,end:10,scaleMode:'spec'})");
    const plot=chart._plot;
    for(const value of [24.95,25.05,...points.map(p=>p.value)])assert.ok(plot.y(value)>=15&&plot.y(value)<=plot.h-31,`${value} remains inside the plot`);
  }
  assert.equal(h.run('rt.scaleMode'),'spec');
});

test('invalid current data masks the current slope while preserving the historical curve',()=>{
  const h=harness();
  h.run('rt.connected=true;rt.elapsed=10;rt.points=[{t:8,value:25},{t:8.2,value:25.01},{t:8.4,value:25.02}];drawCharts()');
  const previous=plain(h.elements.get('#slope-chart')._plot.data);
  assert.ok(previous.length>0);
  h.run('rt.invalidSignal=true;drawCharts()');
  assert.deepEqual(plain(h.elements.get('#slope-chart')._plot.data),previous);
  assert.equal(h.elements.get('#slope-value').textContent,'— mm/s');
  assert.equal(h.elements.get('#slope-empty').hidden,true);
  assert.match(h.run('chartStatus()'),/Historischer Stand/);
  h.run('rt.connected=false;drawCharts()');
  assert.deepEqual(plain(h.elements.get('#slope-chart')._plot.data),previous);
});

test('the production interruption marker deduplicates repeated invalid messages',()=>{
  const h=harness();
  h.run("rt.points=[{t:8,value:25}];rt.elapsed=8;markInterruption('Kein gültiger Messwert');markInterruption('Kein gültiger Messwert')");
  assert.deepEqual(plain(h.run('rt.breaks')),[{t:8,reason:'Kein gültiger Messwert'}]);
  assert.equal(h.run('rt.channelBreak'),true);
});

test('the values table stays frozen until its explicit refresh action',async()=>{
  const h=harness();
  h.run('rt.connected=true;rt.elapsed=10;rt.window=10;rt.zeroOffset=25;rt.points=[{t:8,value:25},{t:9,value:25.02}];captureChartData()');
  const snapshot=plain(h.run('rt.tableSnapshot')),markup=h.run('chartDataView()');
  assert.equal(snapshot.capturedAt,fixedTime);
  assert.equal(snapshot.unit,'mm');
  assert.equal(snapshot.offset,25);
  h.run('rt.points[1].value=29;rt.points.push({t:11,value:25.03});rt.elapsed=11;rt.zeroOffset=0');
  assert.deepEqual(plain(h.run('rt.tableSnapshot')),snapshot);
  assert.equal(h.run('chartDataView()'),markup);
  h.context.action={dataset:{action:'refresh-chart-data'}};
  await h.run('handleAction(action)');
  const refreshed=plain(h.run('rt.tableSnapshot'));
  assert.equal(refreshed.end,11);
  assert.equal(refreshed.offset,0);
  assert.equal(refreshed.points.at(-1).value,25.03);
  assert.ok(h.elements.get('#chart-data-content').innerHTML.includes('00:11'));
});

test('recording search reports matching and total counts and retains selected records',async()=>{
  const h=harness();
  h.run('rt.selected.add(state.recordings[0].id);rt.search="Referenz"');
  let html=h.run('recordingsView()');
  assert.match(html,/1 von 3 Aufzeichnungen/);
  assert.match(html,/1 Messung ausgewählt/);
  h.run('rt.search="NO SUCH RECORDING"');html=h.run('recordingsView()');
  assert.match(html,/0 von 3 Aufzeichnungen/);
  assert.match(html,/Keine passende Aufzeichnung/);
  assert.match(html,/Suche zurücksetzen/);
  assert.equal(h.run('rt.selected.size'),1);
  h.run('render=()=>effects.push({type:"render"})');
  h.context.action={dataset:{action:'clear-search'}};
  await h.run('handleAction(action)');
  assert.equal(h.run('rt.search'),'');
  assert.equal(h.effects.at(-1).type,'focus-search');
  h.run('state.recordings=[];rt.selected.clear()');html=h.run('recordingsView()');
  assert.match(html,/Noch keine Aufzeichnung/);
  assert.doesNotMatch(html,/Keine passende Aufzeichnung/);
});

test('opening and closing analysis moves keyboard focus between heading and opener',async()=>{
  const h=harness();
  h.run('rt.selected.add(state.recordings[0].id);render=()=>effects.push({type:"render"})');
  h.context.action={dataset:{action:'analysis',view:'replay'}};
  await h.run('handleAction(action)');
  assert.equal(h.run('rt.analysis'),'replay');
  assert.ok(h.effects.some(effect=>effect.type==='focus-heading'));
  assert.equal(h.effects.find(effect=>effect.type==='scroll-analysis').options.behavior,'instant');
  assert.match(h.run('analysisView([recording()])'),/id="analysis-heading" tabindex="-1"/);
  h.context.action={dataset:{action:'close-analysis'}};
  await h.run('handleAction(action)');
  assert.equal(h.run('rt.analysis'),null);
  assert.equal(h.effects.at(-1).type,'focus-opener');
});

test('connection questions reach the local model with the selected language',async t=>{
  const sent=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    sent.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({kind:'chat',answerText:'Model connection guidance'})};
  });
  const queries=['Wie verbinde ich den Sensor?','How do I connect the sensor?','Comment établir la connexion ?','¿Cómo conecto el sensor?','Come collego il sensore?','Jak připojit senzor?','如何连接传感器？','センサーを接続するには？','센서를 연결하려면?','How do I connect this sensor, matey?'];
  const languages=['de','en','fr','es','it','cs','zh','ja','ko','pirate'];
  const context=harness().run('assistantContext()');
  for(const [index,query] of queries.entries()) {
    assert.equal((await askQuestion(query,context,{language:languages[index]})).answerText,'Model connection guidance');
    assert.equal(sent.at(-1).language,languages[index]);
    assert.equal(sent.at(-1).text,query);
  }
});

test('the first live sample outside limits alarms once and new episodes sound during feedback cooldown', () => {
  const h = harness();
  h.run("playAlertSound=()=>effects.push('beep');refreshSuggest=()=>{};rt.connected=true;rt.mode='bridge'");
  h.run('addValue(profile().learnedUpper + .01, {elapsed:0});addValue(profile().learnedUpper + .02, {elapsed:.1})');
  assert.deepEqual(h.effects, ['beep']);
  assert.equal(h.run('rt.errorTotal'), 1);
  h.run('addValue(profile().target, {elapsed:.2});rt.cooldown=30;rt.deviation={ml:{id:"waiting"}};addValue(profile().learnedUpper + .02, {elapsed:.3})');
  assert.deepEqual(h.effects, ['beep', 'beep']);
  assert.equal(h.run('rt.deviation.ml.id'), 'waiting');
});

test('live ML errors and fresh alerts rearm after recovery, independently of the feedback card', () => {
  const h = harness();
  h.run("playAlertSound=()=>effects.push('beep');rt.deviation={ml:{id:'previous'}}");
  const frame = data => h.run(`mlFrame(${JSON.stringify(data)})`);
  const pending = {id:'new-event', reason:'mean', score:8};
  frame({state:'error', reason:'dropped_samples'});
  frame({state:'error', reason:'dropped_samples'});
  frame({state:'watching', pending:{id:'stale'}});
  assert.deepEqual(h.effects, ['beep']);
  frame({state:'alert', pending});
  frame({state:'alert', pending});
  frame({state:'watching', pending});
  frame({state:'alert', pending});
  assert.deepEqual(h.effects, ['beep', 'beep']);
  assert.equal(h.run('rt.deviation.ml.id'), 'previous');
  frame({state:'alert', known:{id:'known', reason:'intensity'}});
  assert.deepEqual(h.effects, ['beep', 'beep', 'beep']);
});
