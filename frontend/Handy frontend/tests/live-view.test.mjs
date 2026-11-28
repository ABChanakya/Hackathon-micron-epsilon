import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveView} from '../live-view.mjs';

function harness(t) {
  const original = Object.fromEntries(['document','fetch','ResizeObserver','setTimeout','clearTimeout','performance'].map(key=>[key,globalThis[key]]));
  const elements = new Map();
  for (const id of ['live-reading','live-unit','live-state','live-model','live-notice','live-history','connection-actions','live-chart','live-trace','live-plot','live-axis','live-chart-unit','live-gap'])
    elements.set(id,{textContent:'',hidden:false,dataset:{},children:[]});
  elements.get('live-axis').children = [{},{},{}];
  let nextPoll, now = 0, language = 'de-DE';
  const info = {model:'ILD1900-10',unit:'mm',serial:'42'};
  let status = {status:'streaming',source:'serial-ild1900',info};
  let frame = {status:'streaming',source:'serial-ild1900',info,t:10,current_valid:true,dist_from_face_mm:25.123};
  let painted = 0;
  globalThis.document = {getElementById:id=>elements.get(id)};
  globalThis.performance = {now:()=>now};
  globalThis.ResizeObserver = class {observe(){}};
  globalThis.setTimeout = callback => {nextPoll=callback;return 1;};
  globalThis.clearTimeout = () => {nextPoll=undefined;};
  globalThis.fetch = async path=>({ok:true,json:async()=>path==='/api/status'?status:frame});
  const seen=[];
  const view = createLiveView({paintChart(){painted++;},speakStatus(){},locale:()=>language,
    translate:(text,values={})=>(language==='en-GB'?'EN ':'')+text.replace(/\{(\w+)\}/g,(_,key)=>values[key]??''),
    onStatus:value=>seen.push(value)});
  t.after(()=>{view.stop();for(const [key,value] of Object.entries(original))globalThis[key]=value;});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {view,elements,seen,get painted(){return painted;},setLanguage(value){language=value;},
    async start(){view.start();await settle();},
    async next(changes={},statusChanges={}){now+=400;frame={...frame,...changes};status={...status,...statusChanges};nextPoll();await settle();}};
}

test('phone errors and disconnects mask current values but keep explicitly historical data and recovery actions', async t=>{
  const h=harness(t);await h.start();
  assert.equal(h.elements.get('live-reading').textContent,'25,123');
  assert.equal(h.elements.get('connection-actions').hidden,true);
  await h.next({t:10.4,current_valid:false,last_error:{code:4}});
  assert.equal(h.elements.get('live-reading').textContent,'—');
  assert.equal(h.elements.get('live-state').dataset.state,'invalid');
  assert.equal(h.elements.get('connection-actions').hidden,false);
  assert.equal(h.elements.get('live-chart').dataset.historical,'true');
  assert.equal(h.elements.get('live-history').hidden,false);
  await h.next({}, {status:'disconnected'});
  assert.equal(h.elements.get('live-reading').textContent,'—');
  assert.equal(h.elements.get('live-chart').hidden,false);
  assert.equal(h.elements.get('live-state').textContent,'Kein Sensor verbunden');
  assert.ok(h.painted>1);
});

test('phone display relocalizes a retained reading and rejects stalled frames as current',async t=>{
  const h=harness(t);await h.start();
  h.setLanguage('en-GB');h.view.refreshLanguage();
  assert.equal(h.elements.get('live-reading').textContent,'25.123');
  assert.equal(h.elements.get('live-state').textContent,'EN Liveanzeige');
  for(let i=0;i<6;i++)await h.next();
  assert.equal(h.elements.get('live-reading').textContent,'—');
  assert.equal(h.elements.get('live-state').dataset.state,'loading');
  assert.equal(h.elements.get('live-chart').dataset.historical,'true');
  assert.equal(h.elements.get('connection-actions').hidden,false);
});
