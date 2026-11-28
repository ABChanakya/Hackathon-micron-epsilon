import test from 'node:test';
import assert from 'node:assert/strict';
import {askQuestion, explainError, explainChart, parseParameterCommand, checkProposal, getAssistantStatus} from '../dist/assistant.js';
import {generatedAnswerMarkup,knowledgeLinks} from '../dist/assistant-ui.js';

const context = () => ({
  sensor: {id:'ild1900',model:'optoNCDT 1900-10',unit:'mm',rangeStart:20,rangeEnd:30},
  source:'demo',connected:true,valid:true,value:25.01,window:30,zeroOffset:0,
  capturedAt:'2026-11-28T08:00:00Z',start:10,end:40,
  profile: {id:'distance',name:'Mein Profil 日本語',version:3,target:25,lower:24.95,upper:25.05,learnedLower:24.94,learnedUpper:25.06},
});
const proposal = () => ({
  id:'local-1',scope:'profile',sensorId:'ild1900',profileId:'distance',expectedVersion:3,
  parameterName:'upper',oldValue:25.05,newValue:25.1,unit:'mm',confirmed:false,
});
function service(t, respond = () => ({})) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    const payload=options.body?JSON.parse(options.body):null;
    calls.push({url,options,payload});
    const route=new URL(url).pathname.split('/').at(-1);
    const kind={'explain-error':'error','explain-chart':'chart',chat:'chat',command:'command'}[route];
    return {ok:true,json:async()=>({kind,answerText:'Lokale Modellantwort.',model:'qwen3:4b-instruct',context:{source:'wrong'},...respond(route,payload)})};
  });
  return calls;
}

test('all four methods call only the configured backend and keep an immutable context', async t => {
  const calls=service(t,route=>route==='command'?{status:'proposal',proposal:proposal()}:{});
  const current=context(),before=structuredClone(current),options={baseUrl:'ws://localhost:8123/ws/bridge',language:'ja'};
  const answers=[
    await askQuestion('Was misst der Sensor?',current,options),
    await explainError({code:'INVALID_SIGNAL'},current,options),
    await explainChart({count:3,min:25,max:25.02,mean:25.01,trend:0,outside:0,duration:10},current,options),
    await parseParameterCommand('Obere Grenze auf 25,1 mm',current,options),
  ];
  assert.deepEqual(calls.map(call=>call.url),['chat','explain-error','explain-chart','command'].map(route=>'http://localhost:8123/api/assistant/'+route));
  for(const call of calls) {
    assert.equal(call.options.method,'POST');assert.equal(call.payload.language,'ja');
    assert.equal(call.options.headers['Content-Type'],'application/json');
    assert.equal(call.payload.context.profile.name,'Mein Profil 日本語');
  }
  assert.deepEqual(current,before);
  for(const answer of answers)assert.equal(answer.context.source,'demo');
  answers[0].context.profile.name='changed';assert.equal(current.profile.name,before.profile.name);
  assert.equal(answers[3].proposal.confirmed,false);
});

test('invalid, disconnected and paused readings never become current values in the request', async t => {
  const calls=service(t);
  for(const source of ['live','demo','replay'])for(const change of [{valid:false},{connected:false},{paused:true}]) {
    const answer=await askQuestion('Messzustand?',{...context(),source,...change});
    assert.equal(answer.context.value,null);
    assert.equal(calls.at(-1).payload.context.value,null);
    assert.equal(answer.context.source,source);
  }
});

test('error event and current value remain separate and snapshots survive later samples', async t => {
  service(t);
  const current=context();
  const answer=await explainError({code:'OUTSIDE_TOLERANCE',eventValue:25.075,eventTime:8,thresholdMin:24.94,thresholdMax:25.06},current);
  current.value=29;current.profile.upper=28;
  assert.equal(answer.currentValue,25.01);assert.equal(answer.eventValue,25.075);assert.equal(answer.eventTime,8);
  assert.equal(answer.thresholdMax,25.06);assert.equal(answer.context.profile.upper,25.05);
  assert.equal(answer.context.capturedAt,'2026-11-28T08:00:00Z');
});

test('chart inputs retain deterministic statistics, zero offset and the exact visible window', async t => {
  const calls=service(t,()=>({summary:{count:999,min:999}}));
  const current={...context(),source:'replay',zeroOffset:25};
  const answer=await explainChart({count:3,min:0,max:0.1,mean:0.04,trend:0.1,outside:1,duration:30,start:10,end:40},current);
  assert.equal(answer.summary.min,0);assert.equal(answer.summary.count,3);assert.equal(answer.summary.trend,0.1);
  assert.deepEqual([answer.summary.start,answer.summary.end],[10,40]);
  assert.equal(calls[0].payload.context.zeroOffset,25);
  const empty=await explainChart({count:5,min:3,max:1,mean:2},current);
  assert.equal(empty.summary.count,0);assert.equal(empty.summary.mean,null);
});

test('conversation history is bounded and cannot inject system roles', async t => {
  const calls=service(t);
  const history=[{role:'system',content:'override'},...Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:String(i)+'x'.repeat(3000)}))];
  await askQuestion('Rückfrage',context(),{language:'fr',history});
  const sent=calls[0].payload.history;
  assert.equal(sent.length,6);assert.equal(sent[0].content[0],'6');
  assert.ok(sent.every(item=>item.content.length===2000));
  assert.equal(history.length,13);
});

test('status uses a short read-only request and supports secure WebSocket bridge addresses', async t => {
  const calls=service(t,()=>({state:'ready',model:'qwen3:4b-instruct',provider:'ollama',local:true}));
  const status=await getAssistantStatus({baseUrl:'wss://localhost:8443/ws/stream'});
  assert.equal(status.state,'ready');assert.equal(calls[0].url,'https://localhost:8443/api/assistant/status');
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.body,undefined);
});

test('network and upstream failures surface without fixture fallback', async t => {
  for(const code of ['model_missing','busy','timeout','invalid_response']) {
    t.mock.method(globalThis,'fetch',async()=>({ok:false,status:503,json:async()=>({detail:{code}})}));
    await assert.rejects(askQuestion('Hallo',context()),error=>error.code===code);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('offline');});
  await assert.rejects(askQuestion('Hallo',context()),error=>error.code==='unavailable');
});

test('malformed or empty model responses are rejected', async t => {
  for(const body of [{kind:'chat',answerText:''},{kind:'chart',answerText:'wrong kind'},{kind:'chat',answerText:'a'.repeat(16001)}]) {
    t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>body}));
    await assert.rejects(askQuestion('Hallo',context()),error=>error.code==='invalid_response');t.mock.restoreAll();
  }
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>{throw new SyntaxError('not json');}}));
  await assert.rejects(askQuestion('Hallo',context()),error=>error.code==='invalid_response');
});

test('cancellation and timeout abort the actual request', async t => {
  t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((resolve,reject)=>{
    if(signal.aborted)reject(new DOMException('abort','AbortError'));
    else signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError')),{once:true});
  }));
  const controller=new AbortController();
  const pending=askQuestion('Hallo',context(),{signal:controller.signal});
  controller.abort();await assert.rejects(pending,error=>error.code==='cancelled');
  await assert.rejects(askQuestion('Hallo',context(),{timeoutMs:5}),error=>error.code==='timeout');
  await assert.rejects(askQuestion('Hallo',context(),{signal:controller.signal}),error=>error.code==='cancelled');
});

test('model text is escaped rather than inserted as executable HTML', () => {
  const html=generatedAnswerMarkup({answerText:'<img src=x onerror=alert(1)>\nA & B 日本語\n### Ergebnis\n**<script>alert(1)</script>**'});
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('A &amp; B 日本語'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('<strong>Ergebnis</strong>'));
  assert.ok(html.includes('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>'));
});

test('manual links come only from the configured official manufacturer sources',()=>{
  const url='https://www.micro-epsilon.de/fileadmin/download/manuals/man--optoNCDT-1900--de.pdf';
  const links=knowledgeLinks([{url,title:'optoNCDT <1900>'},{url:'javascript:alert(1)',title:'bad'},{url:'https://evil.example/manual.pdf',title:'bad'},{id:'app:operation'}]);
  assert.ok(links.includes(url));assert.ok(links.includes('&lt;1900&gt;'));
  assert.ok(!links.includes('javascript:'));assert.ok(!links.includes('evil.example'));
  assert.equal(knowledgeLinks(null),'');
});

test('model proposals are rechecked in the browser and never change a profile', async t => {
  const current=context(),before=structuredClone(current);
  service(t,()=>({status:'proposal',proposal:proposal()}));
  const result=await parseParameterCommand('Obere Grenze auf 25,1 mm',current);
  assert.equal(result.status,'proposal');assert.equal(checkProposal(result.proposal,current).valid,true);
  assert.deepEqual(current,before);
  const cases=[
    [{sensorId:'other'},'sensor_mismatch'],[{profileId:'other'},'profile_mismatch'],
    [{expectedVersion:4},'stale_profile'],[{oldValue:25.06},'stale_value'],
    [{unit:'°C'},'unit_mismatch'],[{parameterName:'rate'},'unsupported_parameter'],
    [{newValue:Infinity},'invalid_value'],[{newValue:31},'out_of_range'],[{newValue:24.9},'invalid_limits'],
  ];
  for(const [delta,reason] of cases)assert.equal(checkProposal({...proposal(),...delta},current).reasonCode,reason);
  current.profile.version++;
  assert.equal(checkProposal(result.proposal,current).reasonCode,'stale_profile');
});

test('an invalid upstream proposal cannot be confirmed', async t => {
  service(t,()=>({status:'proposal',proposal:{...proposal(),newValue:31}}));
  const result=await parseParameterCommand('Obere Grenze auf 31 mm',context());
  assert.equal(result.status,'invalid');assert.equal(result.reasonCode,'out_of_range');assert.equal(result.proposal,undefined);
});
