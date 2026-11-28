import test from 'node:test';
import assert from 'node:assert/strict';
import runtime from '../dist/assistant-runtime-copy.js';
import {assistantMessages,assistantText} from '../dist/assistant-i18n.js';
const languages=['de','en','fr','es','it','cs','zh','ja','ko','pirate'];
const required=['runtimeReady','runtimeChecking','runtimeUnavailable','runtimeModelMissing','runtimeBusy','runtimeTimeout','runtimeInvalidResponse','runtimeCancelled','runtimeUnknown','cancelRequest','modelLabel','knowledgeSources','generatedNote'];
const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
test('local runtime states and controls have complete whole messages in all ten languages',()=>{
 assert.deepEqual(Object.keys(runtime),languages);const keys=Object.keys(runtime.de).sort();
 for(const key of required)assert.ok(keys.includes(key),key);
 for(const code of languages){
  assert.deepEqual(Object.keys(runtime[code]).sort(),keys,code);
  for(const key of keys){assert.ok(runtime[code][key].trim(),`${code}.${key}`);assert.deepEqual(placeholders(runtime[code][key]),placeholders(runtime.de[key]),`${code}.${key}`);assert.equal(assistantMessages[code][key],runtime[code][key],`${code}.${key} is active`)}
 }
});
test('the selected model is dynamic and its supplied name remains literal in every locale',()=>{
 const model='Local model 3B · <Q&A> {special-name}';const values={model};
 for(const code of languages){
  assert.equal(assistantText('runtimeReady',values,code),runtime[code].runtimeReady.replace('{model}',model));
  assert.ok(assistantText('runtimeReady',values,code).includes(model));
 }
 assert.deepEqual(values,{model});assert.equal(assistantText('runtimeReady',{},'de'),'Lokale KI bereit · {model}');
});
test('local AI introductions replace fixed-answer claims while commands remain explicitly simulated',()=>{
 assert.equal(assistantText('preview',{},'de'),'Experimentell');
 assert.equal(assistantText('previewNote',{},'de'),'Lokale KI · Parameterbefehle nur als Simulation');
 assert.doesNotMatch(assistantText('previewIntro',{},'de'),/Beispielantworten|ohne KI/);
 assert.match(assistantText('previewIntro',{},'de'),/Messkontext/);
 for(const code of languages){
  assert.equal(assistantText('commandHint',{},code),runtime[code].commandHint);
  assert.equal(assistantText('commandIntro',{},code),runtime[code].commandIntro);
  assert.ok(assistantMessages[code].simulationNote.trim());assert.ok(assistantMessages[code].confirm.trim());
 }
 assert.equal(assistantText('simulationNote',{},'de'),'Nur Simulation. Messprofil und Sensor bleiben unverändert.');
 assert.equal(assistantText('confirm',{},'de'),'Simulation bestätigen');
});
