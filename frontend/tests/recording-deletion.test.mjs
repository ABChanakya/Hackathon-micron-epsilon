import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as data from '../dist/data.js';
import * as settings from '../dist/settings-revisions.js';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const views=source.slice(0,source.indexOf("document.addEventListener('click'")).replace(/^import .*;\n/gm,'');
const storageKey='micro-epsilon-monitor-v1';
async function withStorage(run,raw=null){
 const old=globalThis.localStorage,values=new Map(raw===null?[]:[[storageKey,raw]]),writes=[];
 const storage={fail:false,getItem:key=>values.get(key)??null,setItem(key,value){if(this.fail)throw new Error('QA quota');writes.push({key,value});values.set(key,value)}};
 globalThis.localStorage=storage;
 try{return await run({storage,values,writes})}finally{if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old}
}
function harness(){
 data.useSensor('ild1900');
 const effects=[],listeners=new Map();
 const focusable=name=>({textContent:'',focus(){effects.push({focus:name})}});
 const error=focusable('delete-error');
 const form={dataset:{form:'delete-runs'},querySelector:selector=>selector==='[data-delete-error]'?error:null};
 const dialog={open:false,innerHTML:'',showModal(){this.open=true},close(){this.open=false},querySelector:()=>null};
 const nodes=new Map([['#dialog',dialog],['[data-action="undo-delete-runs"]',focusable('undo')],['#recording-undo-error',focusable('undo-error')],['#run-search',focusable('search')]]);
 const context=vm.createContext({...data,...settings,structuredClone,effects,
  getLocale:()=> 'de-DE',getLanguage:()=> 'de',applyTranslations:()=>{},performance:{now:()=>0},
  location:{protocol:'http:',hostname:'localhost',host:'localhost:8767',port:'8767'},
  document:{querySelector:selector=>nodes.get(selector)??null,querySelectorAll:()=>[],addEventListener:(name,handler)=>listeners.set(name,handler)},
  FormData:class{get(){return null}},fetch:()=>{throw new Error('Local deletion must not call the backend')},
 });
 vm.runInContext(views,context);
 context.notify=message=>effects.push({message});context.paint=()=>effects.push({render:true});
 vm.runInContext('toast=notify;render=paint',context);
 const submit=source.slice(source.indexOf("document.addEventListener('submit'"),source.indexOf("document.addEventListener('change',async"));
 vm.runInContext(submit,context);
 const change=source.slice(source.indexOf("document.addEventListener('change',async"),source.indexOf("document.addEventListener('input',event=>{const el=event.target;if(el.id==='run-search')"));
 vm.runInContext(change,context);
 const run=code=>vm.runInContext(code,context);
 return {run,context,effects,error,form,dialog,listeners,ids:()=>JSON.parse(run('JSON.stringify(state.recordings.map(record=>record.id))')),
  submit(){listeners.get('submit')({target:{closest:()=>form},preventDefault(){}})}};
}

test('row and bulk actions require a named, explicitly local confirmation; cancel does not write',()=>withStorage(async({writes})=>{
 const h=harness(),ids=h.ids();
 let html=h.run('recordingsView()');
 assert.equal((html.match(/data-action="delete-run"/g)||[]).length,ids.length);
 assert.match(html,/data-action="delete-selected-runs" disabled/);
 h.run('state.recordings[0].name="QA <Werkstück> & Notiz"');
 await h.run("handleAction({dataset:{action:'delete-run',id:state.recordings[0].id}})");
 assert.equal(h.dialog.open,true);assert.equal(writes.length,0);
 assert.match(h.dialog.innerHTML,/QA &lt;Werkstück&gt; &amp; Notiz/);
 assert.match(h.dialog.innerHTML,/1 Aufzeichnung wird aus diesem Browser gelöscht/);
 assert.match(h.dialog.innerHTML,/Messserver und gelernte Modelle bleiben erhalten/);
 assert.match(h.dialog.innerHTML,/Neuladen oder zur nächsten Löschung/);
 assert.match(h.dialog.innerHTML,/autofocus>Abbrechen/);
 h.run('closeDialog()');
 assert.equal(h.dialog.open,false);assert.deepEqual(h.ids(),ids);assert.equal(writes.length,0);
 assert.equal(h.run('recordingUndo'),null);
}));

test('bulk selection supports more than two recordings while analysis remains constrained',()=>withStorage(async()=>{
 const h=harness();
 for(const id of h.ids())await h.listeners.get('change')({target:{dataset:{field:'run'},value:id,checked:true}});
 assert.equal(h.run('rt.selected.size'),3);
 const html=h.run('recordingsView()');
 assert.match(html,/data-view="compare" disabled/);assert.match(html,/data-view="replay" disabled/);
 assert.doesNotMatch(html,/data-action="delete-selected-runs" disabled/);
 await h.run("handleAction({dataset:{action:'delete-selected-runs'}})");
 assert.match(h.dialog.innerHTML,/3 Aufzeichnungen werden aus diesem Browser gelöscht/);
 assert.equal(h.run('dialogContext.length'),3);
}));

test('confirmed deletion persists locally and clears only affected analysis/replay/lastSaved state',()=>withStorage(({values})=>{
 const h=harness(),ids=h.ids(),profiles=h.run('JSON.stringify(state.profiles)');
 h.run(`rt.selected=new Set([state.recordings[0].id,state.recordings[1].id]);rt.analysis='compare';rt.replayPlaying=true;rt.replayTime=4;rt.lastSaved=state.recordings[0];rt.unsaved={id:'other-unsaved'};rt.markers=[{id:'live-note'}]`);
 h.run('requestRecordingDeletion([state.recordings[0].id])');h.submit();
 assert.deepEqual(h.ids(),ids.slice(1));assert.equal(h.dialog.open,false);
 assert.deepEqual(JSON.parse(values.get(storageKey)).recordings.map(r=>r.id),ids.slice(1));
 assert.equal(h.run('JSON.stringify(state.profiles)'),profiles);
 assert.equal(h.run('rt.selected.size'),1);assert.equal(h.run('rt.analysis'),null);
 assert.equal(h.run('rt.replayPlaying'),false);assert.equal(h.run('rt.replayTime'),0);assert.equal(h.run('rt.lastSaved'),null);
 assert.equal(h.run('rt.unsaved.id'),'other-unsaved');assert.equal(h.run('rt.markers[0].id'),'live-note');
 assert.match(h.run('recordingUndoView()'),/Letzte Löschung rückgängig machen/);
 assert.ok(h.effects.some(effect=>effect.focus==='undo'));
 assert.ok(h.effects.some(effect=>effect.message==='1 Aufzeichnung lokal gelöscht.'));
}));

test('deleting an unrelated row leaves the current replay and lastSaved intact',()=>withStorage(()=>{
 const h=harness();h.run("rt.selected.add(state.recordings[0].id);rt.analysis='replay';rt.replayPlaying=true;rt.replayTime=4;rt.lastSaved=state.recordings[0]");
 h.run('requestRecordingDeletion([state.recordings[2].id]);confirmRecordingDeletion({querySelector:()=>null})');
 assert.equal(h.run('rt.analysis'),'replay');assert.equal(h.run('rt.replayPlaying'),true);assert.equal(h.run('rt.replayTime'),4);
 assert.equal(h.run('rt.lastSaved.id'),h.ids()[0]);
}));

test('confirmation freezes target IDs and ignores duplicate/unknown IDs and later selection changes',()=>withStorage(()=>{
 const h=harness(),ids=h.ids();
 h.run('requestRecordingDeletion([state.recordings[0].id,state.recordings[0].id,"missing"])');
 h.run('rt.selected.add(state.recordings[1].id);state.recordings.unshift({...structuredClone(state.recordings[1]),id:"later",name:"Later recording"})');
 h.submit();
 assert.deepEqual(h.ids(),['later',...ids.slice(1)]);
 assert.equal(h.run('recordingUndo.removed.length'),1);
}));

test('undo restores original records and order while preserving a newer recording and edited survivors',()=>withStorage(async({values})=>{
 const h=harness(),ids=h.ids(),deleted=h.run('JSON.stringify(state.recordings[1])');
 h.run('requestRecordingDeletion([state.recordings[1].id])');h.submit();
 h.run('state.recordings[0].name="Survivor renamed";state.recordings.unshift({...structuredClone(state.recordings[0]),id:"new",name:"New recording"})');
 await h.run("handleAction({dataset:{action:'undo-delete-runs'}})");
 assert.deepEqual(h.ids(),['new',...ids]);
 assert.equal(h.run('JSON.stringify(state.recordings.find(record=>record.id===recordingId))'.replace('recordingId',JSON.stringify(ids[1]))),deleted);
 assert.equal(h.run('state.recordings[1].name'),'Survivor renamed');
 assert.deepEqual(JSON.parse(values.get(storageKey)).recordings.map(r=>r.id),['new',...ids]);
 assert.equal(h.run('recordingUndo'),null);assert.equal(h.run('undoRecordingDeletion()'),false);
 assert.ok(h.effects.some(effect=>effect.focus==='search'));
}));

test('a new successful deletion replaces the single undo batch',()=>withStorage(()=>{
 const h=harness(),ids=h.ids();
 h.run('requestRecordingDeletion([state.recordings[0].id])');h.submit();
 h.run('requestRecordingDeletion([state.recordings[0].id])');h.submit();
 h.run('undoRecordingDeletion()');
 assert.deepEqual(h.ids(),ids.slice(1));
}));

test('quota failure rolls deletion back, keeps confirmation open and supports retry without false success',()=>withStorage(({storage,values})=>{
 const h=harness(),before=h.run('JSON.stringify(state)'),ids=h.ids();
 h.run('rt.selected.add(state.recordings[0].id);rt.analysis="replay";rt.replayPlaying=true;rt.lastSaved=state.recordings[0]');
 h.run('requestRecordingDeletion([state.recordings[0].id])');storage.fail=true;h.submit();
 assert.equal(h.run('JSON.stringify(state)'),before);assert.equal(h.dialog.open,true);assert.deepEqual(h.ids(),ids);
 assert.equal(h.run('rt.analysis'),'replay');assert.equal(h.run('rt.replayPlaying'),true);assert.equal(h.run('rt.lastSaved.id'),ids[0]);
 assert.equal(h.run('recordingUndo'),null);assert.equal(values.has(storageKey),false);
 assert.match(h.error.textContent,/Löschen fehlgeschlagen/);assert.ok(h.effects.some(effect=>effect.focus==='delete-error'));
 assert.ok(h.effects.every(effect=>!effect.message?.includes('lokal gelöscht.')));
 storage.fail=false;h.submit();assert.deepEqual(h.ids(),ids.slice(1));assert.equal(h.dialog.open,false);
}));

test('failed/cancelled later deletion retains the previous undo batch',()=>withStorage(({storage})=>{
 const h=harness(),ids=h.ids();
 h.run('requestRecordingDeletion([state.recordings[0].id])');h.submit();
 h.run('requestRecordingDeletion([state.recordings[0].id])');storage.fail=true;h.submit();
 assert.equal(h.run('recordingUndo.removed[0].id'),ids[0]);
 h.run('closeDialog()');storage.fail=false;h.run('undoRecordingDeletion()');
 assert.deepEqual(h.ids(),ids);
}));

test('undo persistence failure preserves both deleted state and the retryable undo batch',()=>withStorage(({storage,values})=>{
 const h=harness(),ids=h.ids();
 h.run('requestRecordingDeletion([state.recordings[0].id])');h.submit();const persisted=values.get(storageKey);
 storage.fail=true;assert.equal(h.run('undoRecordingDeletion()'),false);
 assert.deepEqual(h.ids(),ids.slice(1));assert.equal(values.get(storageKey),persisted);
 assert.equal(h.run('recordingUndo.removed[0].id'),ids[0]);assert.match(h.run('recordingUndoView()'),/Wiederherstellen fehlgeschlagen/);
 assert.ok(h.effects.some(effect=>effect.focus==='undo-error'));
 storage.fail=false;assert.equal(h.run('undoRecordingDeletion()'),true);assert.deepEqual(h.ids(),ids);
}));

test('malformed storage cannot be overwritten by deletion and never reports success',()=>withStorage(({values,writes})=>{
 const h=harness(),ids=h.ids();
 h.run('requestRecordingDeletion([state.recordings[0].id])');h.submit();
 assert.deepEqual(h.ids(),ids);assert.equal(values.get(storageKey),'{broken');assert.equal(writes.length,0);
 assert.equal(h.dialog.open,true);assert.match(h.error.textContent,/bleiben erhalten/);
 assert.ok(h.effects.every(effect=>!effect.message?.includes('lokal gelöscht.')));
},'{broken'));

test('stale or empty requests are harmless and cannot create an undo batch',()=>withStorage(({writes})=>{
 const h=harness(),ids=h.ids();
 assert.equal(h.run('requestRecordingDeletion([])'),false);
 assert.equal(h.run('requestRecordingDeletion(["missing"])'),false);
 assert.equal(h.run('undoRecordingDeletion()'),false);
 assert.deepEqual(h.ids(),ids);assert.equal(h.dialog.open,false);assert.equal(writes.length,0);
}));
