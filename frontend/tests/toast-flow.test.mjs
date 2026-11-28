import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as data from '../dist/data.js';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const views=source.slice(0,source.indexOf("document.addEventListener('click'")).replace(/^import .*;\n/gm,'');

class Element {
  constructor(id=''){
    this.id=id;this.children=[];this.parentElement=null;this.textContent='';
    this.attributes=new Map();const classes=new Set();
    this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
  }
  get firstChild(){return this.children[0]??null}
  append(child){this.insertBefore(child,null)}
  insertBefore(child,reference){
    if(child.parentElement)child.parentElement.children.splice(child.parentElement.children.indexOf(child),1);
    const index=reference?this.children.indexOf(reference):this.children.length;
    assert.ok(index>=0,'insertion reference belongs to its parent');
    this.children.splice(index,0,child);child.parentElement=this;
  }
  contains(child){return child===this||this.children.some(node=>node.contains(child))}
  addEventListener(){}
  set innerHTML(value){for(const child of this.children)child.parentElement=null;this.children=[];this.content=value}
}

function harness(){
  const body=new Element('body'),app=new Element('app'),toast=new Element('toast'),timers=new Map();let timerId=0;
  toast.attributes.set('role','status');toast.attributes.set('aria-live','polite');
  body.append(app);body.append(toast);
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  const document={body,activeElement:body,title:'',querySelector:selector=>selector.startsWith('#')?find(body,selector.slice(1)):null,querySelectorAll:()=>[]};
  Object.defineProperty(app,'innerHTML',{set(html){
    assert.equal(toast.parentElement,body,'the live region is preserved before replacing the app');
    for(const child of this.children)child.parentElement=null;this.children=[];
    const main=new Element('main');this.append(main);main.append(new Element('global-notice'));
    if(html.includes('id="monitor-notices"')){
      main.append(new Element('live-chart'));
      const activity=new Element('error-center');main.append(activity);
      activity.append(new Element('activity-status'));activity.append(new Element('monitor-notices'));
    }else main.append(new Element('page-content'));
  }});
  const context=vm.createContext({...data,loadState:data.createInitialState,structuredClone,document,
    location:{protocol:'http:',hostname:'localhost',host:'localhost:8000',port:'8000'},performance:{now:()=>0},
    getLocale:()=> 'de-DE',getLanguage:()=> 'de',applyTranslations:()=>{},
    createSensorViewer:()=>({dispose(){}}),
    setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId},
    clearTimeout:id=>timers.delete(id)});
  vm.runInContext(views,context);
  vm.runInContext(`captureSettingsDrafts=()=>{};restoreSettingsDrafts=()=>{};drawCharts=()=>{};updateLive=()=>{};
    header=()=>'';globalNotices=()=>'';monitor=()=>'<div id="monitor-notices"></div>';
    advancedView=()=>'<section id="page-content"></section>'`,context);
  return {toast,timers,document,run:code=>vm.runInContext(code,context)};
}

test('success messages stay below measurement cards through rerenders and notice refreshes',()=>{
  const h=harness();h.run("toast('Aufnahme gespeichert');rt.route='monitor';render()");
  const main=h.document.querySelector('#main'),notices=h.document.querySelector('#monitor-notices');
  assert.equal(h.toast.parentElement,h.document.querySelector('#activity-status'));
  assert.ok(main.children.indexOf(h.document.querySelector('#live-chart'))<main.children.indexOf(h.document.querySelector('#error-center')));
  notices.innerHTML='<p>Neuer Verbindungsstatus</p>';
  h.run('render()');
  assert.equal(h.document.querySelector('#toast'),h.toast);
  assert.equal(h.toast.parentElement,h.document.querySelector('#activity-status'));
  assert.equal(h.toast.textContent,'Aufnahme gespeichert');
  assert.equal(h.toast.attributes.get('aria-live'),'polite');
  assert.equal(h.toast.attributes.get('role'),'status');
  assert.ok(h.toast.classList.contains('show'));
  assert.equal(h.timers.size,1,'rerender preserves the original dismissal timer');
});

test('navigation puts the same message after page content and preserves replacement and dismissal',()=>{
  const h=harness();h.run("rt.route='monitor';render();toast('Erste Meldung');toast('Profil gespeichert');rt.route='advanced';render()");
  assert.equal(h.document.querySelector('#main').children.at(-1),h.toast);
  assert.equal(h.toast.textContent,'Profil gespeichert');
  assert.equal(h.timers.size,1,'the newer message replaces the previous timer');
  const timer=[...h.timers.values()][0];assert.equal(timer.delay,4500);timer.callback();
  assert.equal(h.toast.classList.contains('show'),false);
  assert.equal(h.document.querySelector('#toast'),h.toast);
});
