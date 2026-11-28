import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsDraftStore,readSettingsForm,restoreSettingsForm,validateProfileFields,validateProfileSettings,validateConnectionSettings,validateMlSettings,mlSettingsValues,mlOperatingState} from '../dist/settings-revisions.js';
const sensor={rangeStart:20,rangeEnd:30,rates:[250,500,1000,4000]};
const validProfile={name:'Test',description:'',target:'25',lower:'24.95',upper:'25.05',rate:'4000',saveMode:'update'};
const config={enabled:true,learn_online:true,sensitivity:6,consecutive:2,window_s:.5,warmup_s:10,cooldown_s:5,match_radius:3,error_fraction:.5,reject_z:null,hard_min:null,hard_max:null,error_file:'ml/errors.jsonl'};

test('independent section drafts survive fresh server values and discard returns only that section to its baseline',()=>{
 const store=createSettingsDraftStore();store.ensure('profile',{rate:'4000',window:'30'});store.ensure('ml',mlSettingsValues(config));
 store.set('profile',{window:'30',rate:'4000'});assert.equal(store.dirty('profile'),false,'field order cannot create changes');
 store.set('profile',{rate:'1000',window:'60'});store.set('ml',{...mlSettingsValues(config),enabled:false});
 assert.deepEqual(store.ensure('profile',{rate:'500',window:'10'}),{rate:'1000',window:'60'});
 store.discard('profile');assert.deepEqual(store.value('profile'),{rate:'4000',window:'30'});assert.equal(store.dirty('ml'),true);
 store.clear('ml');assert.equal(store.anyDirty(),false);
 assert.deepEqual(store.ensure('profile',{rate:'500',window:'10'}),{rate:'500',window:'10'});
});
test('form capture keeps user strings and checkboxes and restoration does not alter unchanged values',()=>{
 let assignments=0;
 const field={name:'rate',type:'number',get value(){return '4000'},set value(v){assignments++}};
 const checkbox={name:'enabled',type:'checkbox',checked:false};const form={elements:[field,checkbox,{name:'',type:'button'}]};
 assert.deepEqual(readSettingsForm(form),{rate:'4000',enabled:false});restoreSettingsForm(form,{rate:'4000',enabled:true});
 assert.equal(assignments,0);assert.equal(checkbox.checked,true);
});
test('profile validation identifies reversed limits, target, blanks and physical bounds independently',()=>{
 assert.deepEqual(validateProfileFields(validProfile,sensor).errors,{});
 assert.deepEqual(Object.keys(validateProfileFields({...validProfile,lower:'25.1'},sensor).errors),['lower','upper']);
 assert.equal(validateProfileFields({...validProfile,target:'26'},sensor).errors.target,'Der Sollwert muss zwischen den Sollgrenzen liegen.');
 const invalid=validateProfileFields({...validProfile,name:' ',lower:'',upper:'31',rate:'999'},sensor).errors;
 for(const name of ['name','lower','upper','rate'])assert.ok(invalid[name]);
 assert.equal(validateProfileFields({...validProfile,target:'25,01'},sensor).value.target,25.01);
 assert.ok(validateProfileSettings({rate:'4000',window:'90'},sensor).errors.window);
});
test('connection validation only accepts usable websocket addresses',()=>{
 for(const bridgeUrl of ['','http://localhost:8000','ws://','not a url'])assert.ok(validateConnectionSettings({bridgeUrl}).errors.bridgeUrl);
 assert.equal(validateConnectionSettings({bridgeUrl:' wss://example.test/ws/stream '}).value.bridgeUrl,'wss://example.test/ws/stream');
});
test('ML validation retains backend units, optional disabled values and backend numeric constraints',()=>{
 const valid=validateMlSettings(mlSettingsValues(config));assert.deepEqual(valid.errors,{});assert.deepEqual(valid.value,config);
 for(const [key,value]of Object.entries({consecutive:'1.5',window_s:'0',warmup_s:'601',error_fraction:'101',sensitivity:'NaN',cooldown_s:'-1',match_radius:'0'}))assert.ok(validateMlSettings({...mlSettingsValues(config),[key]:value}).errors[key],key);
 const cross=validateMlSettings({...mlSettingsValues(config),reject_z:'5',hard_min:'26',hard_max:'25',error_file:'bad.csv'}).errors;
 for(const key of ['reject_z','hard_min','hard_max','error_file'])assert.ok(cross[key]);
});
test('label matching validates optional calibrated/manual radii without extending legacy payloads',()=>{
 const legacy=validateMlSettings(mlSettingsValues(config));
 assert.equal(Object.hasOwn(legacy.value,'label_match'),false);
 assert.equal(Object.hasOwn(legacy.value,'label_match_radius'),false);
 const values=mlSettingsValues({...config,label_match:false,label_match_radius:null});
 assert.equal(values.label_match,false);assert.equal(values.label_match_radius,'');
 const automatic=validateMlSettings(values);assert.deepEqual(automatic.errors,{});
 assert.equal(automatic.value.label_match,false);assert.equal(automatic.value.label_match_radius,null);
 for(const [raw,expected]of [['0,5',.5],['12.5',12.5],['500',500]]){
  const result=validateMlSettings({...values,label_match:true,label_match_radius:raw});
  assert.deepEqual(result.errors,{});assert.equal(result.value.label_match,true);assert.equal(result.value.label_match_radius,expected);
 }
 for(const raw of ['0.49','500.1','NaN','Infinity'])assert.ok(validateMlSettings({...values,label_match_radius:raw}).errors.label_match_radius,raw);
});
test('ML operating status reflects runtime rather than configured checkboxes',()=>{
 assert.equal(mlOperatingState({state:'idle',config:{enabled:true}}),'Wartet auf Sensordaten');
 assert.equal(mlOperatingState({state:'off'}),'Erkennung ausgeschaltet');assert.equal(mlOperatingState(null),'Messserver nicht erreichbar');
});
test('ML event times only format declared ISO timestamps, never numeric sampling times',async()=>{
 const {mlEventTime}=await import('../dist/settings-revisions.js');
 assert.equal(mlEventTime(1800000000),'—');assert.equal(mlEventTime('12345'),'—');assert.equal(mlEventTime('2026-99-99T12:00:00Z'),'—');
 assert.notEqual(mlEventTime('2026-11-28T12:34:56Z','en-GB'),'—');
});
