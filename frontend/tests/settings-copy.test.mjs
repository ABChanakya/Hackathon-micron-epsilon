import test from 'node:test';
import assert from 'node:assert/strict';
import copy from '../dist/locales/settings-copy.js';
import {setLanguage,translateText} from '../dist/i18n.js';
test('settings messages cover nine translated locales and preserve interpolation placeholders',()=>{
 const keys=Object.keys(copy.en).sort(),languages=['en','fr','es','it','cs','zh','ja','ko','pirate'];
 assert.deepEqual(Object.keys(copy),languages);assert.ok(keys.length>=90);
 const placeholders=value=>[...value.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
 for(const code of languages){assert.deepEqual(Object.keys(copy[code]).sort(),keys);for(const key of keys){assert.ok(copy[code][key].trim(),`${code}: ${key}`);assert.deepEqual(placeholders(copy[code][key]),placeholders(key))}}
});
test('settings runtime switches whole field errors and reset instructions through every language',async()=>{
 const source='Die untere Grenze muss kleiner als die obere Grenze sein.';
 for(const code of Object.keys(copy)){await setLanguage(code);assert.equal(translateText(source),copy[code][source]);assert.equal(translateText('Normalzustand und gelernte Beispiele zurücksetzen'),copy[code]['Normalzustand und gelernte Beispiele zurücksetzen']);const recovery='Die Originaldaten bleiben erhalten. Lokales Speichern ist gesperrt. Neue Aufnahmen kannst du als CSV sichern.';assert.equal(translateText(recovery),copy[code][recovery])}
 await setLanguage('en');assert.equal(translateText('Untere Grenze (°C)'),'Lower limit (°C)');
 await setLanguage('de');assert.equal(translateText(source),source);
});
test('label-matching explanations and statistics translate as whole messages in all ten languages',async()=>{
 const explanation='Diese Erkennung lernt Signalformen auf dem Messserver. Als Normalmuster akzeptierte Daten können die Auswertungsgrenzen erweitern. Die Sollgrenzen bleiben erhalten.';
 const obsolete='Diese Erkennung lernt Signalformen auf dem Messserver. Bewertungen als Normalmuster oder Anomalie verändern keine Soll- oder Auswertungsgrenzen.';
 for(const code of Object.keys(copy)){
  await setLanguage(code);assert.equal(translateText(explanation),copy[code][explanation]);assert.equal(Object.hasOwn(copy[code],obsolete),false);
  for(const key of ['Bei unbekannten Daten fragen','Trefferradius','Gelernter Wertebereich','An Trainingsdaten angepasst'])assert.equal(translateText(key),copy[code][key]);
  assert.equal(translateText('42 Fenster aus 2 Quellen'),copy[code]['{windows} Fenster aus {sources} Quellen'].replace('{windows}','42').replace('{sources}','2'));
  assert.equal(translateText('2,75 (aus den Daten berechnet)'),copy[code]['{radius} (aus den Daten berechnet)'].replace('{radius}','2,75'));
 }
 await setLanguage('de');assert.equal(translateText(explanation),explanation);
});
