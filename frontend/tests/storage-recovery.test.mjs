import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as data from '../dist/data.js';
import * as settings from '../dist/settings-revisions.js';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const views=source.slice(0,source.indexOf("document.addEventListener('click'")).replace(/^import .*;\n/gm,'');
const key='micro-epsilon-monitor-v1';
function withStorage(raw,run){
 const previous=globalThis.localStorage,values=new Map([[key,raw]]),writes=[];
 globalThis.localStorage={getItem:name=>values.get(name)??null,setItem:(name,value)=>{writes.push({name,value});values.set(name,value)}};
 try{return run({values,writes})}finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
}
function appContext(){
 const callbacks=new Map(),messages=[],navigations=[];
 const context=vm.createContext({...data,...settings,structuredClone,URL,getLocale:()=> 'de-DE',getLanguage:()=> 'de',applyTranslations:()=>{},location:{protocol:'http:',hostname:'localhost',host:'localhost:8767',port:'8767',href:'http://localhost:8767/#advanced',hash:'#advanced',assign:url=>navigations.push(url)},performance:{now:()=>0},document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,callback)=>callbacks.set(name,callback)},window:{addEventListener:(name,callback)=>callbacks.set(name,callback)}});
 vm.runInContext(views,context);context.notify=message=>messages.push(message);vm.runInContext('toast=notify;render=()=>{}',context);
 return {context,callbacks,messages,navigations,run:code=>vm.runInContext(code,context)};
}
test('malformed storage boots a visible fallback and cannot be overwritten by a later persist call',()=>withStorage('{broken',({values,writes})=>{
 const h=appContext();assert.match(h.run('rt.storageError'),/nicht gelesen/);assert.ok(h.run('state.profiles.length')>0);
 assert.equal(h.run('persist()'),false);assert.equal(values.get(key),'{broken');assert.equal(writes.length,0);
 h.run("switchSensor('thermo_uc',{model:'UC-SF22-S3',range_min:-50,range_max:900})");assert.equal(values.get(key),'{broken');assert.equal(writes.length,0);data.useSensor('ild1900');
 assert.ok(h.messages.every(message=>!message.includes('gespeichert.')));
}));
test('a legacy state without settings loads defaults in memory without rewriting profiles or original storage',()=>{
 const saved=data.createInitialState();delete saved.settings;const raw=JSON.stringify(saved);
 withStorage(raw,({values,writes})=>{const loaded=data.loadState();assert.ok(loaded.settings);assert.deepEqual(loaded.profiles,saved.profiles);assert.deepEqual(loaded.recordings,saved.recordings);assert.equal(values.get(key),raw);assert.equal(writes.length,0)});
});
test('invalid settings shape is a read error and not a silently accepted boot crash',()=>{
 const saved=data.createInitialState();saved.settings='corrupted';withStorage(JSON.stringify(saved),()=>assert.throws(()=>data.loadState(),/nicht gelesen/));
});
test('a failed recording save keeps the unsaved recording and never reports successful persistence',()=>withStorage('{broken',()=>{
 const h=appContext(),before=h.run('state.recordings.length');h.context.candidateRun={id:'qa-unsaved',name:'QA unsaved'};h.run('saveRecording(candidateRun)');
 assert.equal(h.run('state.recordings.length'),before);assert.equal(h.run('rt.unsaved.id'),'qa-unsaved');assert.equal(h.run('rt.lastSaved'),null);
 assert.ok(h.messages.every(message=>!message.includes('Aufzeichnung lokal gespeichert.')));
}));
test('beforeunload protects a running recording, an unsaved recording, a section draft and a pending save',()=>withStorage(null,()=>{
 const h=appContext();const hook=source.split('\n').find(line=>line.startsWith("window.addEventListener('beforeunload'"));assert.ok(hook);h.run(hook);
 const listener=h.callbacks.get('beforeunload');
 for(const setup of ["rt.record={id:'active'}","rt.record=null;rt.unsaved={id:'unsaved'}","rt.unsaved=null;settingsStore().ensure('qa',{value:'a'});settingsStore().set('qa',{value:'b'})","settingsStore().clearAll();settingsSaving.add('qa')"]){h.run(setup);let blocked=false;const event={preventDefault(){blocked=true}};listener(event);assert.equal(blocked,true,setup);assert.equal(event.returnValue,'')}
 h.run('settingsSaving.clear()');let blocked=false;listener({preventDefault(){blocked=true}});assert.equal(blocked,false);
}));
test('dirty navigation waits for explicit discard; dismissing confirmation leaves the draft intact',()=>withStorage(null,()=>{
 const h=appContext();h.run("settingsStore().ensure('qa',{value:'a'});settingsStore().set('qa',{value:'b'});confirmSettingsAction=options=>{globalThis.confirmation=options}");
 const hook=source.split('\n').find(line=>line.startsWith("document.addEventListener('click',event=>{const link="));assert.ok(hook);h.run(hook);
 const listener=h.callbacks.get('click'),link={target:'',href:'http://localhost:8767/#monitor',getAttribute:()=> '#monitor'};
 let prevented=false;listener({target:{closest:()=>link},preventDefault(){prevented=true}});
 assert.equal(prevented,true);assert.equal(h.navigations.length,0);assert.equal(h.run("settingsStore().dirty('qa')"),true);
 h.context.confirmation.onConfirm();assert.deepEqual(h.navigations,['http://localhost:8767/#monitor']);assert.equal(h.run('settingsStore().anyDirty()'),false);
}));
