import test from 'node:test';
import assert from 'node:assert/strict';
import copy from '../dist/locales/recordings-copy.js';
import {LANGUAGES,setLanguage,translateText} from '../dist/i18n.js';
const required=[
 'Aufnahme und Notizen','Aufzeichnung löschen','Ausgewählte löschen','{name} löschen','Aufzeichnungen löschen?',
 '{count} Aufzeichnung wird aus diesem Browser gelöscht.','{count} Aufzeichnungen werden aus diesem Browser gelöscht.',
 'Aufzeichnungen auf dem Messserver und gelernte Modelle bleiben erhalten.','Rückgängig ist bis zum Neuladen oder zur nächsten Löschung möglich.',
 'Nur hier löschen','Löschen fehlgeschlagen. Die Aufzeichnungen bleiben erhalten. Versuche es erneut.','Keine Aufzeichnungen zum Löschen ausgewählt.',
 '{count} Aufzeichnung lokal gelöscht.','{count} Aufzeichnungen lokal gelöscht.','Rückgängig','Letzte Löschung rückgängig machen',
 'Wiederherstellen fehlgeschlagen. Die Löschung bleibt rückgängig machbar.','{count} Aufzeichnung wiederhergestellt.','{count} Aufzeichnungen wiederhergestellt.','Ausgewählte Aufzeichnungen löschen',
];
const placeholders=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
test('recording deletion and undo have complete messages in all nine translated locales',()=>{
 assert.deepEqual(Object.keys(copy).sort(),LANGUAGES.filter(language=>language.code!=='de').map(language=>language.code).sort());
 for(const [code,messages] of Object.entries(copy)){
  assert.deepEqual(Object.keys(messages).sort(),[...required].sort(),code);
  for(const key of required){assert.ok(messages[key].trim(),`${code}: ${key}`);assert.deepEqual(placeholders(messages[key]),placeholders(key),`${code}: ${key}`)}
 }
});
test('all ten languages translate full recording messages and preserve a supplied user name verbatim',async()=>{
 const name='Sensor Deutsch löschen · <Werkstück> & 12,5 mm';
 for(const {code} of LANGUAGES){
  await setLanguage(code);
  const messages=code==='de'?Object.fromEntries(required.map(key=>[key,key])):copy[code];
  for(const key of required){
   const source=key.replace('{name}',name).replace('{count}','2');
   const expected=messages[key].replace('{name}',name).replace('{count}','2');
   assert.equal(translateText(source),expected,`${code}: ${key}`);
  }
  assert.ok(translateText(`${name} löschen`).includes(name),`${code}: user name preserved`);
 }
 await setLanguage('de');
});
