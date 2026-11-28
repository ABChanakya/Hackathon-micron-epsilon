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
 const elements=Object.entries(values).map(([name,value])=>({name,value,type:'text'}));
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
