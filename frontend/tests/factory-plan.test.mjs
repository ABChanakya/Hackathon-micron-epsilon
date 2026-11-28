import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {mountFactoryPlan} from '../Handy frontend/fabrikplan/karte.mjs';
import {factoryText} from '../dist/factory-copy.js';
import {createDesktopFactoryPlan} from '../dist/factory-plan.js';

const sharedUrl = new URL('../Handy frontend/fabrikplan/karte.mjs', import.meta.url).href;
const hook = nodeModule.registerHooks?.({
  resolve(specifier, context, next) {
    if (/^http:\/\/127\.0\.0\.1:\d+\/handy\/fabrikplan\/karte\.mjs$/.test(specifier)) return {url:sharedUrl,shortCircuit:true};
    if (specifier.endsWith('/modellansicht.mjs') || specifier === './modellansicht.mjs') return {url:'factory-test:preview',shortCircuit:true};
    return next(specifier,context);
  },
  load(url,context,next) {
    if (url === 'factory-test:preview') return {format:'module',source:"export const sensorPreview=()=> 'data:,';",shortCircuit:true};
    return next(url,context);
  },
});

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.parentElement=null;this.dataset={};this.attributes=new Map();this.style={setProperty(name,value){this[name]=value}};this.listeners=new Map();this._text='';this.className='';this.value='';this.clientWidth=1000;this.clientHeight=360;this.focuses=0;this.classList={add:name=>{this.className+=' '+name},remove:name=>{this.className=this.className.split(' ').filter(item=>item!==name).join(' ')}}}
  get isConnected(){return Boolean(this.root||this.parentElement?.isConnected)}
  get firstElementChild(){return this.children[0]}
  get hidden(){return this.attributes.has('hidden')}
  set hidden(value){if(value)this.attributes.set('hidden','');else this.attributes.delete('hidden')}
  get src(){return this.getAttribute('src')||''}
  set src(value){this.setAttribute('src',String(value))}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  set textContent(value){this.children=[];this._text=String(value)}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=String(value);if(name==='id')this.id=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value)}
  getAttribute(name){return this.attributes.get(name)??null}
  append(...nodes){for(const node of nodes){if(typeof node==='string'){this._text+=node;continue}node.remove();node.parentElement=this;this.children.push(node);if(this.tagName==='head'&&node.tagName==='link')queueMicrotask(()=>node.onload?.())}}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...nodes)}
  focus(){this.focuses++}
  addEventListener(name,callback){const list=this.listeners.get(name)||[];list.push(callback);this.listeners.set(name,list)}
  emit(name,values={}){for(const callback of this.listeners.get(name)||[])callback({target:this,preventDefault(){},...values})}
  matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));const attribute=selector.match(/^(?:([\w-]+))?\[([^=\]]+)(?:="([^"]*)")?\]$/);if(attribute)return (!attribute[1]||this.tagName===attribute[1])&&this.attributes.has(attribute[2])&&(attribute[3]===undefined||this.getAttribute(attribute[2])===attribute[3]);return this.tagName===selector}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)])}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null}
  set innerHTML(html){
    this.replaceChildren();const stack=[this];
    for(const match of html.matchAll(/<\/?([a-z][\w:-]*)([^>]*)>|([^<]+)/gi)){
      if(match[3]){stack.at(-1)._text+=match[3];continue}
      if(match[0].startsWith('</')){stack.pop();continue}
      const node=new Element(match[1]);
      for(const attribute of match[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g))node.setAttribute(attribute[1],attribute[2]??'');
      stack.at(-1).append(node);
      if(!/\/$/.test(match[2].trim())&&!['img','input','br','link'].includes(node.tagName))stack.push(node);
    }
  }
}
async function withDom(run){
  const saved=Object.fromEntries(['document','ResizeObserver','setInterval','clearInterval','localStorage','location','performance'].map(key=>[key,globalThis[key]]));
  const body=new Element('body'),head=new Element('head'),observers=[],timers=new Map();body.root=head.root=true;
  const host=new Element('div');host.id='desktop-factory';body.append(host);let next=0;
  globalThis.document={head,body,documentElement:{lang:'de'},createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
  globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;this.active=false;observers.push(this)}observe(){this.active=true}disconnect(){this.active=false}};
  globalThis.setInterval=(callback,delay)=>{timers.set(++next,{callback,delay});return next};globalThis.clearInterval=id=>timers.delete(id);
  const clock={time:10};globalThis.performance={now:()=>clock.time*1000};
  globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.location={origin:'http://127.0.0.1:4173',href:'http://127.0.0.1:4173/'};
  try{return await run({host,body,head,timers,observers,clock})}finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
}

test('the shared phone API stays callable, initially collapsed, and releases timer/observer on destroy',()=>withDom(({host,timers,observers})=>{
  const clear=mountFactoryPlan(host,{selectSensor(){}}),content=host.querySelector('.factory-content');
  assert.equal(typeof clear,'function');assert.equal(content.hidden,true);assert.equal(host.querySelector('.factory-floor').src,'');
  host.querySelector('.factory-toggle').emit('click');assert.equal(content.hidden,false);assert.match(host.querySelector('.factory-floor').src,/grundriss\.svg$/);
  const tick=[...timers.values()][0].callback;assert.equal(timers.size,1);assert.equal(observers[0].active,true);
  clear.destroy();clear.destroy();assert.equal(timers.size,0);assert.equal(observers[0].active,false);assert.equal(host.children.length,0);tick();
}));

test('an expanded plan selects only marked demo metadata inline and can refresh its language',()=>withDom(({host,timers,observers})=>{
  const selected=[];const clear=mountFactoryPlan(host,{expanded:true,controlsId:'inline-selection',language:'de',text:(key,values)=>factoryText(key,values,'de'),selectSensor:sensor=>selected.push(sensor)});
  assert.equal(host.querySelector('.factory-content').hidden,false);assert.equal(host.querySelector('.factory-map').focuses,0,'initial loading does not steal focus');
  const marker=host.querySelectorAll('.factory-marker').find(node=>node.getAttribute('aria-controls')==='inline-selection');marker.emit('click');
  assert.equal(selected[0].source,'demo');assert.equal(selected[0].simulated,true);assert.equal(selected[0].unit,'°C');assert.equal(selected[0].nameKey,'machiningStation');
  assert.equal(marker.getAttribute('aria-pressed'),'true');clear();assert.equal(marker.getAttribute('aria-pressed'),'false');
  clear.refresh({language:'en',text:(key,values)=>factoryText(key,values,'en')});
  assert.equal(host.querySelector('h2').textContent,'Building plan');assert.equal(host.querySelector('h3').textContent,'Material supply');
  assert.equal(host.querySelectorAll('dialog').length,0);
  clear.destroy();assert.equal(timers.size,0);assert.equal(observers[0].active,false);
}));

test('independent shared mounts receive unique accessible content IDs',()=>withDom(({host,body})=>{
  const second=new Element('div');body.append(second);const a=mountFactoryPlan(host),b=mountFactoryPlan(second);
  assert.notEqual(host.querySelector('.factory-content').id,second.querySelector('.factory-content').id);
  assert.equal(host.querySelector('.factory-toggle').getAttribute('aria-controls'),host.querySelector('.factory-content').id);
  a.destroy();b.destroy();
}));

test('zoom controls and keyboard switch views while tile selection stays a demo action',()=>withDom(({host})=>{
  const selected=[];const clear=mountFactoryPlan(host,{expanded:true,controlsId:'inline',selectSensor:sensor=>selected.push(sensor)});
  host.querySelector('[data-zoom="in"]').emit('click');
  assert.equal(host.querySelector('.factory-map').hidden,true);assert.equal(host.querySelector('.factory-grid').hidden,false);
  assert.equal(host.querySelector('[data-view="grid"]').getAttribute('aria-pressed'),'true');
  const tile=host.querySelector('.factory-tile');tile.emit('click');
  assert.equal(tile.getAttribute('aria-controls'),'inline');assert.equal(selected[0].unit,'mm');assert.equal(selected[0].simulated,true);
  host.querySelector('.factory-grid').emit('keydown',{key:'-'});assert.equal(host.querySelector('.factory-map').hidden,false);
  host.querySelector('.factory-map').emit('keydown',{key:'+'});assert.equal(host.querySelector('.factory-grid').hidden,false);
  clear.destroy();
}));

test('a simulated fault becomes active, stays latched and is acknowledged without selecting a live sensor',()=>withDom(({host,timers,clock})=>{
  const selected=[];const clear=mountFactoryPlan(host,{expanded:true,selectSensor:sensor=>selected.push(sensor)});
  const module=host.querySelector('.factory-module'),ack=module.querySelector('.factory-ack');
  host.querySelector('[data-fault]').emit('click');clock.time=12;[...timers.values()][0].callback();
  assert.equal(module.dataset.alarm,'active');assert.equal(ack.hidden,true);
  clock.time=20;[...timers.values()][0].callback();assert.equal(module.dataset.alarm,'latched');assert.equal(ack.hidden,false);
  ack.emit('click');assert.equal(module.dataset.alarm,'ok');assert.equal(ack.hidden,true);assert.deepEqual(selected,[]);
  clear.destroy();
}));

test('desktop loading reuses the shared map, normalizes the bridge origin and keeps selection local', {skip:!hook},()=>withDom(async({host,head,timers})=>{
  const selected=[];const view=createDesktopFactoryPlan(host,{language:'en',baseUrl:'ws://127.0.0.1:8767/ws/stream',onSelect:sensor=>selected.push(sensor)});
  assert.equal(await view.ready,true);assert.equal(host.querySelector('.factory-content').hidden,false);
  assert.equal(head.children[0].href,'http://127.0.0.1:8767/handy/fabrikplan/fabrikplan.css');
  const marker=host.querySelectorAll('.factory-marker').find(node=>node.getAttribute('aria-controls')==='desktop-factory-selection');marker.emit('click');
  assert.equal(selected[0].source,'demo');assert.equal(selected[0].simulated,true);assert.equal(host.querySelector('.factory-selection').hidden,false);
  assert.match(host.querySelector('.factory-selection').textContent,/Simulation only/);assert.match(host.querySelector('.factory-selection').textContent,/Machining/);
  view.refresh({language:'fr'});assert.equal(host.querySelector('h2').textContent,'Plan du bâtiment');
  view.destroy();assert.equal(timers.size,0);assert.equal(host.children.length,0);
}));

test('a malformed saved bridge address falls back to the current site without breaking the cockpit', {skip:!hook},()=>withDom(async({host,timers})=>{
  const view=createDesktopFactoryPlan(host,{baseUrl:'http://['});
  assert.equal(await view.ready,true);assert.equal(host.querySelector('.factory-content').hidden,false);
  view.destroy();assert.equal(timers.size,0);
}));

test('destroy during asset loading cannot mount a late map or leave timers behind', {skip:!hook},()=>withDom(async({host,timers,observers})=>{
  const view=createDesktopFactoryPlan(host,{baseUrl:'http://127.0.0.1:8001'});view.destroy();
  assert.equal(await view.ready,false);assert.equal(host.children.length,0);assert.equal(timers.size,0);assert.equal(observers.length,0);
}));

test('an unavailable shared module yields an inline message and explicit phone link',()=>withDom(async({host,timers})=>{
  const view=createDesktopFactoryPlan(host,{language:'de',baseUrl:'https://unavailable.invalid'});
  assert.equal(await view.ready,false);assert.match(host.textContent,/Gebäudeplan konnte nicht geladen/);
  assert.equal(host.querySelector('a').href,'https://unavailable.invalid/handy/');assert.equal(timers.size,0);
  view.destroy();
}));
