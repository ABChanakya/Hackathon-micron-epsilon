import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as data from '../dist/data.js';
import * as settings from '../dist/settings-revisions.js';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const views=source.slice(0,source.indexOf("document.addEventListener('click'")).replace(/^import .*;\n/gm,'');
function form(values,key='profile-editor'){
 const error={textContent:''};
 const elements=Object.entries(values).map(([name,value])=>({name,value,type:typeof value==='boolean'?'checkbox':'text',checked:typeof value==='boolean'?value:undefined}));
 elements.namedItem=name=>elements.find(input=>input.name===name);
 return {elements,dataset:{settingsKey:key},error,querySelectorAll:()=>[],querySelector:()=>error};
}
function harness(){
 data.useSensor('ild1900');
 const context=vm.createContext({...data,...settings,loadState:data.createInitialState,structuredClone,getLocale:()=> 'de-DE',getLanguage:()=> 'de',applyTranslations:()=>{},location:{protocol:'http:',hostname:'localhost',host:'localhost:8000',port:'8000'},performance:{now:()=>0},document:{querySelector:()=>null,querySelectorAll:()=>[]},CSS:{escape:value=>value},saveState:()=>{if(context.blocked)throw Error('storage blocked')}});
 vm.runInContext(views,context);vm.runInContext('toast=()=>{};render=()=>{};closeDialog=()=>{}',context);
 return {context,run:code=>vm.runInContext(code,context)};
}
const profileValues={name:'Updated',description:'Test',lower:'24.9',upper:'25.1',target:'25.01',rate:'4000',saveMode:'update'};
test('failed profile persistence rolls state back and keeps editable form values and dialog error',()=>{
 const h=harness();h.context.form=form(profileValues);h.context.blocked=true;
 const before=h.run('JSON.stringify(state)');h.run('saveProfileEditor(form)');
 assert.equal(h.run('JSON.stringify(state)'),before);
 assert.equal(h.context.form.elements.namedItem('name').value,'Updated');
 assert.equal(h.context.form.error.textContent,'Speichern fehlgeschlagen. Die Eingaben bleiben erhalten.');
 assert.equal(h.run('rt.points.length'),0,'display data is only reset after durable save');
});
test('successful profile persistence applies one version and preserves original specification history',()=>{
 const h=harness();h.context.form=form(profileValues);const version=h.run('profile().version');h.run('saveProfileEditor(form)');
 assert.equal(h.run('profile().target'),25.01);assert.equal(h.run('profile().version'),version+1);
 assert.equal(h.run('profile().history.at(-1).type'),'profile');assert.equal(h.run('profile().name'),'Updated');
});
test('failed section persistence does not alter saved profile or bridge runtime',()=>{
 const h=harness();h.context.form=form({rate:'1000',window:'60'},'profile');h.context.blocked=true;
 const before=h.run('JSON.stringify(state)');h.run("saveLocalSettings('profile',form)");
 assert.equal(h.run('JSON.stringify(state)'),before);assert.equal(h.run('rt.window'),30);
 h.context.form=form({bridgeUrl:'ws://other.test/ws/stream'},'connection');const address=h.run('rt.bridgeUrl');h.run("saveLocalSettings('connection',form)");
 assert.equal(h.run('rt.bridgeUrl'),address);assert.equal(h.run('JSON.stringify(state)'),before);
});
test('reset waits for confirmation and preserves the exact keep_labels contract',async()=>{
 const h=harness();const requests=[];
 h.context.captureConfirm=value=>h.context.confirmation=value;
 h.context.request=async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return {model:'sensor-1'}};
 h.run("confirmSettingsAction=opts=>captureConfirm(opts);backendRequest=request;loadMl=async()=>{};rt.mlStatus={model:'sensor-1'}");
 h.run('requestMlReset(true)');assert.equal(requests.length,0);await h.context.confirmation.onConfirm();assert.deepEqual(requests[0],{path:'/api/ml/reset',body:{keep_labels:true}});
 h.run('requestMlReset(false)');assert.equal(requests.length,1);assert.match(h.context.confirmation.message,/Ereignisverlauf und Fehlerdatei bleiben erhalten/);await h.context.confirmation.onConfirm();assert.deepEqual(requests[1],{path:'/api/ml/reset',body:{keep_labels:false}});
 h.run("requestMlReset(false);rt.mlStatus={model:'different'}");await h.context.confirmation.onConfirm();assert.equal(requests.length,2,'confirmation cannot reset a newly selected model');
});
test('reset confirmation names the sensor and a pending request cannot be duplicated',async()=>{
 const h=harness();let release;const requests=[];
 h.context.captureConfirm=value=>h.context.confirmation=value;
 h.context.request=(path,options)=>{requests.push({path,options});return new Promise(resolve=>{release=()=>resolve({model:'sensor-1',sensor:'Actual sensor'})})};
 h.run("confirmSettingsAction=opts=>captureConfirm(opts);backendRequest=request;loadMl=async()=>{};rt.mlStatus={model:'sensor-1',sensor:'Actual sensor'}");
 h.run('requestMlReset(false)');assert.equal(h.context.confirmation.context,'Actual sensor');
 const pending=h.context.confirmation.onConfirm();assert.equal(h.run('settingsSaving.size'),1);
 await h.context.confirmation.onConfirm();h.run('requestMlReset(true)');assert.equal(requests.length,1);
 release();await pending;assert.equal(h.run('settingsSaving.size'),0);
});
test('ML reset and its asynchronous status refresh keep the settings route and hash unchanged',async()=>{
 const h=harness();const calls=[];const status={model:'sensor-1',sensor:'Actual sensor',config:{enabled:true}};
 h.context.captureConfirm=value=>h.context.confirmation=value;
 h.context.request=async(path,options)=>{calls.push(path);return path==='/api/recordings'||path.startsWith('/api/ml/errors')?[]:status};
 h.run("confirmSettingsAction=opts=>captureConfirm(opts);backendRequest=request;rt.mlStatus={model:'sensor-1',sensor:'Actual sensor'};rt.route='advanced';location.hash='#advanced'");
 h.run('requestMlReset(true)');await h.context.confirmation.onConfirm();
 assert.equal(h.run('rt.route'),'advanced');assert.equal(h.run('location.hash'),'#advanced');
 assert.deepEqual(calls,['/api/ml/reset','/api/ml','/api/recordings','/api/ml/errors?limit=5']);
});
const mlConfig={enabled:true,learn_online:true,label_match:true,label_match_radius:null,sensitivity:6,consecutive:2,window_s:.5,warmup_s:10,cooldown_s:5,match_radius:3,error_fraction:.5,reject_z:null,hard_min:null,hard_max:null,error_file:'ml/errors.jsonl'};
test('ML panel presents unknown-data controls and calibrated training statistics without replacing settings drafts',()=>{
 const h=harness();h.context.config=mlConfig;
 h.run("rt.mlStatus={config,model:'sensor-1',sensor:'ILD1900',state:'watching',baseline_windows:7,normal_examples:3,anomaly_examples:1,labeled_windows:42,labeled_sources:['A','B'],match_radius:2.75,train_range:[24.9,25.1]}");
 const html=h.run('mlPanel()');
 assert.match(html,/name="label_match" checked/);
 assert.match(html,/name="label_match_radius"[^>]*min="0.5" max="500"/);
 assert.match(html,/42 Fenster aus 2 Quellen/);assert.match(html,/2,75 \(aus den Daten berechnet\)/);
 assert.match(html,/24,900–25,100 mm/);
 assert.match(html,/Als Normalmuster akzeptierte Daten können die Auswertungsgrenzen erweitern/);
 assert.doesNotMatch(html,/verändern keine Soll- oder Auswertungsgrenzen/);
 h.run("settingsStore().set(settingsKey('ml'),{...mlSettingsValues(config),label_match:false,label_match_radius:'12,5'});mlPanel()");
 assert.equal(h.run("settingsStore().value(settingsKey('ml')).label_match"),false);
 assert.equal(h.run("settingsStore().value(settingsKey('ml')).label_match_radius"),'12,5');
 h.run("settingsStore().discard(settingsKey('ml'))");
 assert.equal(h.run("settingsStore().value(settingsKey('ml')).label_match"),true);
 assert.equal(h.run("settingsStore().value(settingsKey('ml')).label_match_radius"),'');
});
test('new label-matching settings survive a failed save and submit explicit booleans and numeric radius',async()=>{
 const h=harness(),requests=[];h.context.config=mlConfig;
 h.run("rt.mlStatus={config,model:'sensor-1'};settingsStore().ensure(settingsKey('ml'),mlSettingsValues(config))");
 const key=h.run("settingsKey('ml')"),values={...settings.mlSettingsValues(mlConfig),label_match:false,label_match_radius:'12,5'};
 h.context.form=form(values,key);h.context.request=async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});if(h.context.fail)throw Error('offline')};h.context.fail=true;
 h.run("backendRequest=request;loadMl=async()=>{};captureSettingsDrafts=()=>{};restoreSettingsDrafts=()=>{};showSettingsErrors=(form,errors)=>Object.keys(errors).length===0;showSettingsFailure=()=>{};settingsStore().set(settingsKey('ml'),readSettingsForm(form))");
 await h.run('saveMlSettings(form)');
 assert.equal(h.run("settingsStore().value(settingsKey('ml')).label_match"),false);
 assert.equal(h.run("settingsStore().value(settingsKey('ml')).label_match_radius"),'12,5');
 assert.equal(h.run('rt.mlStatus.config.label_match'),true);assert.equal(h.run('rt.mlStatus.config.label_match_radius'),null);
 h.context.fail=false;await h.run('saveMlSettings(form)');
 assert.equal(requests.length,2);assert.equal(requests[1].path,'/api/ml/config');
 assert.equal(requests[1].body.label_match,false);assert.equal(requests[1].body.label_match_radius,12.5);
 assert.equal(h.run("settingsStore().dirty(settingsKey('ml'))"),false);
});
test('profile history identifies ranges fitted to training data',()=>{
 const h=harness();h.context.LANGUAGES=[{code:'de',name:'Deutsch'}];h.context.document={documentElement:{dataset:{theme:'light'}},querySelector:()=>null,querySelectorAll:()=>[]};
 h.run("liveConnectionPanel=()=>'';mlPanel=()=>'';profile().history=[{type:'training',at:Date.now(),changed:true,previousLower:24.9,previousUpper:25.1,nextLower:24.8,nextUpper:25.2}]");
 const html=h.run('advancedView()');assert.match(html,/An Trainingsdaten angepasst/);assert.doesNotMatch(html,/Grenzen zurückgesetzt/);
});
