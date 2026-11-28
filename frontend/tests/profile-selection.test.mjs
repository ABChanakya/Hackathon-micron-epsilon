import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as data from '../dist/data.js';
import * as settings from '../dist/settings-revisions.js';
import {assistantText} from '../dist/assistant-i18n.js';
import {LANGUAGES} from '../dist/i18n.js';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const views=source.slice(0,source.indexOf("document.addEventListener('click'")).replace(/^import .*;\n/gm,'');
function harness(){
 data.useSensor('ild1900');
 const writes=[],messages=[],listeners=new Map();
 const dialog={open:false,innerHTML:'',showModal(){this.open=true},close(){this.open=false},querySelector:selector=>selector==='video'?null:({elements:[]})};
 const context=vm.createContext({...data,...settings,loadState:data.createInitialState,structuredClone,assistantText,LANGUAGES,
  getLocale:()=> 'de-DE',getLanguage:()=> 'de',applyTranslations:()=>{},performance:{now:()=>0},
  saveState:state=>writes.push(structuredClone(state)),notify:message=>messages.push(message),
  location:{protocol:'http:',hostname:'localhost',host:'localhost:8767',port:'8767'},
  document:{documentElement:{dataset:{theme:'light'}},querySelector:selector=>selector==='#dialog'?dialog:null,querySelectorAll:()=>[],addEventListener:(name,handler)=>listeners.set(name,handler)},
 });
 vm.runInContext(views,context);vm.runInContext('toast=notify;render=()=>{}',context);
 const change=source.slice(source.indexOf("document.addEventListener('change',async"),source.indexOf("document.addEventListener('input',event=>{const el=event.target;if(el.id==='run-search')"));
 vm.runInContext(change,context);
 return {run:code=>vm.runInContext(code,context),dialog,writes,messages,change:listeners.get('change')};
}

test('profile selection previews without committing, supports cancel and applies only the confirmed profile',async()=>{
 const h=harness(),original=h.run('profile().id'),target=h.run('state.profiles.find(profile=>profile.id!==state.activeProfileId).id');
 const select={dataset:{field:'profile'},value:target};
 await h.change({target:select});
 assert.equal(h.dialog.open,true);assert.equal(h.run('profile().id'),original);assert.equal(h.writes.length,0);
 assert.equal(select.value,original,'the live selection still represents the active profile until confirmation');
 assert.match(h.dialog.innerHTML,/Messprofil wechseln/);assert.match(h.dialog.innerHTML,/data-action="apply-profile"/);
 assert.ok(h.dialog.innerHTML.includes(`data-id="${target}"`));
 h.run('closeDialog()');assert.equal(h.run('profile().id'),original);assert.equal(h.writes.length,0);
 select.value=target;await h.change({target:select});
 h.run('rt.zeroOffset=25;rt.markers=[{id:"old-marker"}]');
 await h.run(`handleAction({dataset:{action:'apply-profile',id:${JSON.stringify(target)}}})`);
 assert.equal(h.run('profile().id'),target);assert.equal(h.writes.length,1);
 assert.equal(h.writes[0].activeProfileId,target);assert.equal(h.run('rt.window'),h.run('profile().window'));
 assert.equal(h.run('rt.zeroOffset'),0);assert.equal(h.run('rt.markers.length'),0);assert.equal(h.dialog.open,false);
});

test('the cockpit exposes profile selection and the settings editor remains reachable and blocked during recording',async()=>{
 const h=harness(),cockpit=h.run('monitor()'),settingsView=h.run('advancedView()');
 assert.equal((cockpit.match(/id="profile-select"/g)||[]).length,1);
 assert.doesNotMatch(cockpit,/data-action="edit-profile"/);
 assert.match(settingsView,/data-action="edit-profile"[^>]*>[\s\S]*?Profil bearbeiten/);
 const before=h.run('JSON.stringify(state)');
 await h.run("handleAction({dataset:{action:'edit-profile'}})");
 assert.equal(h.dialog.open,true);assert.match(h.dialog.innerHTML,/Messprofil bearbeiten/);
 for(const id of ['profile-name','profile-target','profile-lower','profile-upper'])assert.ok(h.dialog.innerHTML.includes(`id="${id}"`));
 assert.equal(h.run('JSON.stringify(state)'),before);assert.equal(h.writes.length,0);
 h.run('closeDialog();rt.record={id:"active-recording"}');
 assert.match(h.run('monitor()'),/id="profile-select"[^>]*disabled/);
 assert.match(h.run('advancedView()'),/data-action="edit-profile" disabled/);
 await h.run("handleAction({dataset:{action:'edit-profile'}})");
 assert.equal(h.dialog.open,false);assert.equal(h.writes.length,0);assert.match(h.messages.at(-1),/Stoppe die Aufnahme/);
});
