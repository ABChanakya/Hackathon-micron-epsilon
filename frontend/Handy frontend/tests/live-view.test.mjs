import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveView} from '../live-view.mjs';
import {buildSlopeSeries} from '../../dist/measurement-series.js';

function harness(t, {openStream} = {}) {
  const original = Object.fromEntries(['document','fetch','ResizeObserver','setTimeout','clearTimeout','performance'].map(key=>[key,globalThis[key]]));
  const elements = new Map();
  for (const id of ['live-reading','live-unit','live-state','live-model','live-notice','live-history','connection-actions','live-chart','live-trace','live-plot','live-axis','live-chart-unit','live-gap','live-source','live-slope-chart','live-slope-trace','live-slope-plot','live-slope-axis','live-slope-value'])
    elements.set(id,{textContent:'',hidden:false,dataset:{},children:[]});
  for (const axis of ['live-axis', 'live-slope-axis']) elements.get(axis).children = [{},{},{}];
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
  const view = createLiveView({buildSlopeSeries,openStream,paintChart(){painted++;},speakStatus(){},locale:()=>language,
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
  assert.equal(h.elements.get('live-state').textContent,'EN Messung läuft');
  for(let i=0;i<6;i++)await h.next();
  assert.equal(h.elements.get('live-reading').textContent,'—');
  assert.equal(h.elements.get('live-state').dataset.state,'loading');
  assert.equal(h.elements.get('live-chart').dataset.historical,'true');
  assert.equal(h.elements.get('connection-actions').hidden,false);
});

test('PC frames take precedence over polling and sensor changes clear previous slopes and units', async t=>{
  const socket = {close(){this.closed=true;}};
  const h=harness(t,{openStream:()=>socket});
  await h.start();
  const base={t:10.4, source:'serial-ild1900', status:'streaming', current_valid:true, dist_from_face_mm:25.223,
    info:{model:'ILD1900-10',unit:'mm',serial:'42'}};
  const send = frame => socket.onmessage({data:JSON.stringify(frame)});
  send(base);
  assert.equal(h.elements.get('live-slope-value').textContent, '+0,250 mm/s');
  send({...base, t:10.44, dist_from_face_mm:25.233});
  await h.next({dist_from_face_mm:29});
  assert.equal(h.elements.get('live-reading').textContent,'25,233','fresh WebSocket frames win over cached HTTP');
  const temp={...base, t:11, source:'thermo-uc', info:{model:'UCSF22-S3',unit:'°C',serial:'99'}, raw_value:31.476};
  send(temp);
  assert.equal(h.elements.get('live-reading').textContent,'31,48');
  assert.equal(h.elements.get('live-unit').textContent,'°C');
  assert.equal(h.elements.get('live-slope-value').textContent,'— °C/s');
  send({...temp, t:11.04, current_valid:false});
  assert.equal(h.elements.get('live-reading').textContent,'—');
  send({...temp, t:11.08, raw_value:60});
  assert.equal(h.elements.get('live-slope-value').textContent,'— °C/s','no slope across the invalid frame');
  send({...base, t:11.12, source:'replay'});
  assert.equal(h.elements.get('live-source').textContent,'Wiedergabe');
  assert.equal(h.elements.get('live-state').textContent,'Wiedergabe läuft');
  h.view.stop();
  assert.equal(socket.closed,true);
  send({...base, t:11.16, dist_from_face_mm:26.888});
  assert.equal(h.elements.get('live-source').textContent,'Wiedergabe','late frames from a stopped session are ignored');
});

test('a pending HTTP snapshot cannot replace a newer WebSocket frame', async t => {
  const socket = {close(){}};
  const h = harness(t, {openStream:() => socket});
  const frame = {t:30, status:'streaming', source:'serial-ild1900', info:{model:'ILD1900-10', unit:'mm'}, current_valid:true, dist_from_face_mm:28};
  let complete;
  globalThis.fetch = async path => ({ok:true,json:() => path === '/api/latest'
    ? new Promise(resolve => {complete = resolve;}) : Promise.resolve(frame)});
  h.view.start();
  await new Promise(resolve => setImmediate(resolve));
  socket.onmessage({data:JSON.stringify(frame)});
  complete({...frame,t:29,dist_from_face_mm:23});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get('live-reading').textContent,'28,000');
  assert.equal(h.elements.get('live-source').textContent,'Sensor');
});

test('an HTTP fallback stays connected to the PC when the WebSocket closes', async t => {
  const socket = {close(){}};
  const h = harness(t,{openStream:() => socket});
  await h.start();
  socket.onclose();
  await h.next({t:10.4,dist_from_face_mm:25.4});
  assert.equal(h.elements.get('live-reading').textContent,'25,400');
  assert.equal(h.elements.get('live-state').dataset.state,'valid');
  await h.next({}, {status:'disconnected'});
  assert.equal(h.elements.get('live-reading').textContent,'—');
  await h.next({t:11.2,dist_from_face_mm:29}, {status:'streaming'});
  assert.equal(h.elements.get('live-slope-value').textContent,'— mm/s','no slope across a disconnection');
});
