import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {LANGUAGES} from '../dist/i18n.js';

const source=await readFile(new URL('../dist/bootstrap.js',import.meta.url),'utf8');
const index=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const classic=new vm.Script(source);
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.textContent=''}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node)}}
 replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes)}
 contains(node){return node===this||this.children.some(child=>child.contains(node))}
 querySelector(selector){return this.children.find(child=>selector==='.boot'&&child.className?.split(' ').includes('boot'))??null}
 setAttribute(name,value){this.attributes[name]=value}
 addEventListener(name,listener){this.listeners.set(name,listener)}
}
function harness({protocol='file:',search='',stored=null,denyStorage=false}={}){
 const app=new Element('div'),boot=new Element('div'),head=new Element('head'),html=new Element('html');
 boot.className='boot';boot.textContent='Sensor Cockpit';app.append(boot);
 let reloads=0,writes=0;
 const document={head,documentElement:html,getElementById:id=>id==='app'?app:null,createElement:tag=>new Element(tag),querySelector:selector=>selector==='script[data-cockpit-entry]'?head.children.find(node=>node.tagName==='script'&&Object.hasOwn(node.dataset,'cockpitEntry'))??null:null};
 const context=vm.createContext({document,URLSearchParams,location:{protocol,search,reload(){reloads++}},localStorage:{getItem(){if(denyStorage)throw new Error('SecurityError');return stored},setItem(){writes++}}});
 const run=()=>classic.runInContext(context);run();
 const find=(tag,node=app)=>node.tagName===tag?node:node.children.map(child=>find(tag,child)).find(Boolean);
 return {app,boot,head,html,run,find,get reloads(){return reloads},get writes(){return writes}};
}

test('the classic bootstrap follows deferred jsPDF and replaces the direct module entry',()=>{
 const scripts=[...index.matchAll(/<script\b([^>]*)>/g)].map(match=>match[1]);
 assert.equal(scripts.length,2);
 assert.match(scripts[0],/src="vendor\/jspdf\.umd\.min\.js"/);assert.match(scripts[0],/\bdefer\b/);
 assert.match(scripts[1],/src="bootstrap\.js\?v=alarm-1"/);assert.match(scripts[1],/\bdefer\b/);
 assert.doesNotMatch(scripts[1],/type="module"/);assert.doesNotMatch(index,/<script[^>]*src="app\.js/);
});

test('a file URL shows an actionable start card without loading a module or writing data',()=>{
 const h=harness();
 assert.equal(h.head.children.length,0);assert.equal(h.app.contains(h.boot),false);
 assert.match(h.find('h1').textContent,/über den Server öffnen/);
 assert.ok(h.app.children[0].children.some(node=>node.textContent.includes('./start.sh')));
 assert.equal(h.find('a').href,'http://127.0.0.1:8000/#monitor');
 assert.equal(h.app.children[0].id,'main');assert.equal(h.reloads,0);assert.equal(h.writes,0);
});

test('all ten shared languages have file guidance and carry the preference into the server link',()=>{
 const headings=new Set();
 for(const {code} of LANGUAGES){
  const h=harness({stored:code});headings.add(h.find('h1').textContent);
  assert.equal(h.html.lang,code==='pirate'?'en':code);
  assert.equal(h.head.children.length,0);assert.equal(h.writes,0);
  const link=new URL(h.find('a').href);assert.equal(link.origin,'http://127.0.0.1:8000');assert.equal(link.hash,'#monitor');
  assert.equal(link.searchParams.get('lang'),code==='de'?null:code);
  assert.ok(h.app.children[0].children.some(node=>node.textContent.includes('./start.sh')));
 }
 assert.equal(headings.size,LANGUAGES.length,'each language has its own guidance');
});

test('valid URL language takes precedence and unavailable or invalid storage safely falls back',()=>{
 const french=harness({search:'?lang=fr',stored:'de',denyStorage:true});assert.equal(french.html.lang,'fr');
 assert.equal(new URL(french.find('a').href).searchParams.get('lang'),'fr');
 assert.equal(harness({denyStorage:true}).html.lang,'de');
 assert.equal(harness({search:'?lang=<script>',stored:'unknown'}).html.lang,'de');
});

test('HTTP and HTTPS start the one versioned module without replacing the boot placeholder',()=>{
 for(const protocol of ['http:','https:']){
  const h=harness({protocol});h.run();
  assert.equal(h.head.children.length,1);const entry=h.head.children[0];
  assert.equal(entry.type,'module');assert.equal(entry.src,'app.js?v=alarm-1');
  assert.equal(h.app.children[0],h.boot);assert.equal(h.find('a'),undefined);
  assert.equal(h.reloads,0);assert.equal(h.writes,0);
 }
});

test('a failed module load shows localized retry guidance instead of an endless boot',()=>{
 const titles=new Set();
 for(const {code} of LANGUAGES){
  const h=harness({protocol:'http:',stored:code});h.head.children[0].onerror();
  titles.add(h.find('h1').textContent);assert.equal(h.app.contains(h.boot),false);
  assert.equal(h.find('p').attributes.role,'alert');
  assert.equal(h.find('a'),undefined,'HTTP errors must not be described as directly opened files');
  assert.equal(h.reloads,0);h.find('button').listeners.get('click')();assert.equal(h.reloads,1);
 }
 assert.ok(titles.size>=9);
});

test('a late module error never replaces an application that has already rendered',()=>{
 const h=harness({protocol:'http:'}),running=new Element('section');running.id='running-cockpit';
  h.app.replaceChildren(running);h.head.children[0].onload();h.head.children[0].onerror();
 assert.equal(h.app.children[0],running);assert.equal(h.head.children.length,1);assert.equal(h.reloads,0);
});

test('a completed entry that failed before rendering cannot leave the original boot text forever',()=>{
 const h=harness({protocol:'http:'});h.head.children[0].onload();
 assert.equal(h.app.contains(h.boot),false);assert.match(h.find('h1').textContent,/konnte nicht geladen werden/);
 assert.equal(h.find('button').type,'button');
});
