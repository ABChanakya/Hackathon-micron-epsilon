import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {cockpitUrl} from '../navigation.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
function harness(functions) {
  const elements = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent:'', dataset:{}, hidden:false,
      setAttribute(name,value){this[name]=value;},
      toggleAttribute(name,value){this[name]=value;},
    });
    return elements.get(id);
  };
  const sensor = {name:'Qualitätskontrolle',position:'Prüfstand',quantity:'Bauteilhöhe',unit:'mm'};
  const dataset = {id:'desktop-distance',name:'Desktop-Demo',unit:'mm'};
  const selected = {sensor,dataset,name:'optoNCDT ILD1900-10 · Messkopf A'};
  const calls = {draw:0,reset:0,start:0,stop:0,pause:0,language:0};
  const picker = {options:[{}],add(option){option.parentNode=this;}};
  const context = vm.createContext({
    byId, activeLive:false, pausedAt:null, wasSensorPlaying:false, backendPort:8765,
    sensorDemo:{selected,frame:()=>null,pause(){calls.pause++;}},
    liveStatus:{label:'Kein Sensor verbunden',state:'unavailable'},
    sensorOption:{value:'factory-sensor'}, picker, DEMO_DATASETS:[dataset],
    tr:text=>text, getLanguage:()=> 'en', setLanguage:async()=>{calls.language++;},
    liveView:{start(){calls.start++;},stop(){calls.stop++;},refreshLanguage(){}},
    drawChart(){calls.draw++;}, showDataset(){calls.reset++;}, cockpitUrl,
    location:{href:'http://localhost:4174/'},
  });
  for (const name of functions) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, `production function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return {context,byId,calls,selected,picker};
}

test('language refresh retains factory sensor identity, location and dataset selection', async()=>{
  const h=harness(['showSelectedSensor','updateCompactStatus','updateCockpitLinks','refreshLanguage']);
  await h.context.refreshLanguage();
  assert.equal(h.context.sensorDemo.selected,h.selected);
  assert.equal(h.calls.reset,0);
  assert.equal(h.calls.draw,1);
  assert.equal(h.byId('demo-title').textContent,h.selected.name);
  assert.equal(h.byId('demo-unit').textContent,'mm');
  assert.equal(h.byId('sensor-location').hidden,false);
  assert.equal(h.byId('sensor-location').textContent,'Qualitätskontrolle · Prüfstand · Bauteilhöhe');
  assert.equal(h.picker.value,'factory-sensor');
  assert.equal(h.byId('cockpit-link').href,'http://localhost:8765/?lang=en#monitor');
  assert.equal(h.byId('help-cockpit-link').href,'http://localhost:8765/?lang=en#advanced');
});

test('factory profile pause reaches the same compact status as the detail view',()=>{
  const h=harness(['updateCompactStatus','updatePauseButton']);
  h.context.updatePauseButton({playing:false});
  assert.equal(h.byId('demo-state').dataset.state,'paused');
  assert.equal(h.byId('compact-state').dataset.state,'paused');
  assert.equal(h.byId('compact-state').textContent,'Demo-Wiedergabe pausiert');
  assert.equal(h.byId('demo-pause-label').textContent,'Fortsetzen');
});

test('live navigation pauses factory playback and returning preserves the selected sensor',()=>{
  const h=harness(['updateCompactStatus','selectView']);
  h.context.selectView(true);
  assert.equal(h.calls.pause,1);
  assert.equal(h.calls.start,1);
  assert.equal(h.byId('recorded-view').hidden,true);
  assert.equal(h.byId('compact-state').textContent,'Kein Sensor verbunden');
  h.context.selectView(false);
  assert.equal(h.calls.stop,1);
  assert.equal(h.calls.draw,1);
  assert.equal(h.byId('recorded-view').hidden,false);
  assert.equal(h.byId('live-view').hidden,true);
  assert.equal(h.context.sensorDemo.selected,h.selected);
});

test('a factory sensor without a recording keeps an explicit empty reading and hides its chart',()=>{
  const h=harness(['updateCompactStatus','drawSensor']);
  h.context.sensorDemo.selected={...h.selected,dataset:null,status:'Keine passende Demo-Aufzeichnung vorhanden',statusType:'unavailable'};
  h.context.drawSensor();
  assert.equal(h.byId('demo-reading').textContent,'—');
  assert.equal(h.byId('chart').hidden,true);
  assert.equal(h.byId('demo-pause').hidden,true);
  assert.equal(h.byId('sensor-restart').hidden,true);
  assert.equal(h.byId('compact-state').textContent,'Keine passende Demo-Aufzeichnung vorhanden');
  assert.equal(h.byId('compact-state').dataset.state,'unavailable');
});
