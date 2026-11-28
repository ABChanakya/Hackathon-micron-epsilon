import test from 'node:test';
import assert from 'node:assert/strict';

function browserPreferences(t, href, stored) {
  const original = Object.fromEntries(['location','history','localStorage'].map(key => [key, globalThis[key]]));
  const values = new Map([['landing-lang', stored]]);
  const replacements = [];
  globalThis.location = new URL(href);
  globalThis.localStorage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  globalThis.history = {state:{draft:'preserved'},replaceState(state,title,url){
    replacements.push({state,title,url:String(url)});
    globalThis.location = new URL(url);
  }};
  t.after(()=>{for(const [key,value] of Object.entries(original)){
    if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }});
  return {values,replacements};
}

test('a language handed over in the URL follows a later selection across reload without losing route or other query values',async t=>{
  const h=browserPreferences(t,'https://sensor.example/handy/?lang=fr&device=42#monitor','de');
  const first=await import('../dist/i18n.js?test=language-handoff-first');
  assert.equal(first.getLanguage(),'fr');
  assert.equal(h.values.get('landing-lang'),'fr');
  await first.setLanguage('ja');
  assert.equal(h.values.get('landing-lang'),'ja');
  assert.equal(globalThis.location.searchParams.get('lang'),'ja');
  assert.equal(globalThis.location.searchParams.get('device'),'42');
  assert.equal(globalThis.location.hash,'#monitor');
  assert.equal(h.replacements.at(-1).state.draft,'preserved');
  const reloaded=await import('../dist/i18n.js?test=language-handoff-reloaded');
  assert.equal(reloaded.getLanguage(),'ja');
  const before=globalThis.location.href;
  assert.equal(await reloaded.setLanguage('unsupported'),false);
  assert.equal(globalThis.location.href,before);
  assert.equal(h.values.get('landing-lang'),'ja');
});

test('changing a language without a handoff query stores the choice without adding URL parameters',async t=>{
  const h=browserPreferences(t,'https://sensor.example/#advanced','en');
  const language=await import('../dist/i18n.js?test=language-without-handoff');
  await language.setLanguage('cs');
  assert.equal(h.values.get('landing-lang'),'cs');
  assert.equal(globalThis.location.href,'https://sensor.example/#advanced');
  assert.equal(h.replacements.length,0);
});
