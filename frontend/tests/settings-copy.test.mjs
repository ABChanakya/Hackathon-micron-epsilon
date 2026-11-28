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
