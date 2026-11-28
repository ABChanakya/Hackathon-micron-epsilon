import test from 'node:test';
import assert from 'node:assert/strict';
import {factoryMessages, factorySourceCopy, factoryText} from '../dist/factory-copy.js';
import {LANGUAGES, setLanguage, translateText} from '../dist/i18n.js';

const languages = ['de','en','fr','es','it','cs','zh','ja','ko','pirate'];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();

test('building plan, alarms, empty states and inline notices cover all ten languages',()=>{
  assert.deepEqual(Object.keys(factoryMessages), languages);
  assert.deepEqual(LANGUAGES.map(language=>language.code), languages);
  const keys=Object.keys(factoryMessages.de).sort();
  assert.equal(factoryMessages.de.planNote, 'Fiktiver Gebäudeplan.');
  assert.equal(factoryMessages.de.planLoading, 'Gebäudeplan wird geladen …');
  for (const key of ['buildingPlan','planNote','planLoading','simulatedValues','showPlan','hidePlan','map','modules','zoomIn','zoomOut',
    'tileSize','simulateFault','acknowledgeAlarm','stateActive','stateLatched','selectedSensor','noRecording','loadError',
    'noticesTitle','noNotices','showNotices','currentNotices']) assert.ok(keys.includes(key),key);
  for (const language of languages) {
    assert.deepEqual(Object.keys(factoryMessages[language]).sort(), keys, language);
    for (const key of keys) {
      assert.ok(factoryMessages[language][key].trim(), `${language}.${key}`);
      assert.deepEqual(placeholders(factoryMessages[language][key]), placeholders(factoryMessages.de[key]), `${language}.${key}`);
      assert.equal(factoryText(key,{},language),factoryMessages[language][key]);
      assert.equal(factorySourceCopy[language][factoryMessages.de[key]],factoryMessages[language][key]);
    }
  }
});

test('factory templates preserve station names, user text, formatted values and units literally',()=>{
  const values={station:'Material Deutsch · <Q&A> {name}',count:2,sensor:'Sensor Alarm {model}',
    model:'optoNCDT ILD1900-10',head:'A',value:'25,123',lower:'24,950',upper:'25,050',unit:'mm'};
  const before=structuredClone(values);
  for (const language of languages) for (const key of Object.keys(factoryMessages.de)) {
    const result=factoryText(key,values,language);
    for (const name of placeholders(factoryMessages.de[key])) assert.ok(result.includes(String(values[name])), `${language}.${key}: ${name}`);
    assert.equal(result,factoryMessages[language][key].replace(/\{(\w+)\}/g,(_,name)=>String(values[name])));
  }
  assert.deepEqual(values,before);
  assert.equal(factoryText('buildingPlan',{},'unknown'),'Gebäudeplan');
  assert.equal(factoryText('missing-key'),'missing-key');
  assert.ok(factoryText('sensorGroup',{count:0},'en').includes('{station}'));
  assert.ok(factoryText('sensorGroup',{count:0},'en').includes('0'));
});

test('shared i18n applies whole building-plan and notice messages in all ten languages',async()=>{
  for (const language of languages) {
    await setLanguage(language);
    for (const [key,source] of Object.entries(factoryMessages.de)) {
      assert.equal(translateText(source),factoryMessages[language][key],`${language}.${key}`);
    }
    const values={station:'Qualität Deutsch <Bauteil> & 12,5 mm',count:2};
    const source=factoryText('sensorGroup',values,'de');
    assert.equal(translateText(source),factoryText('sensorGroup',values,language));
    assert.ok(translateText(source).includes(values.station));
  }
  await setLanguage('de');
});
