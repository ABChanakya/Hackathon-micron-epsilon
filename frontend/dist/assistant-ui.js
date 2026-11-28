import {askQuestion, explainError, explainChart, parseParameterCommand, checkProposal, getAssistantStatus} from './assistant.js?v=local-ai-1';
import {assistantText} from './assistant-i18n.js?v=local-ai-1';
import {getLanguage, getLocale} from './i18n.js?v=phone-live-1';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
  chat: 'M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5',
  chart: 'M3 20h18 M4 16l5-6 4 3 7-9',
  error: 'm12 3 10 18H2z M12 9v5m0 3v.01',
  command: 'M5 3v5m0 4v9 M2 8h6 M12 3v10m0 4v4 M9 13h6 M19 3v3m0 4v11 M16 6h6',
  close: 'm6 6 12 12M6 18 18 6',
  send: 'm5 12 7-7 7 7 M12 5v15',
  reset: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6',
  check: 'm5 12 4 4L19 6',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.chat}"/></svg>`;
const t = (key, values) => assistantText(key, values, getLanguage());
const fmt = (value, unit = 'mm') => Number(value).toLocaleString(getLocale(), {maximumFractionDigits: unit === '°C' ? 2 : 3, minimumFractionDigits: unit === '°C' ? 2 : 3});
const p = text => `<p>${escape(text)}</p>`;

export function generatedAnswerMarkup(response) {
  const content=escape(response.answerText)
    .replace(/\*\*([^\n*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/^#{1,4} (.+)$/gm,'<strong>$1</strong>');
  return '<div class="assistant-generated">' + content + '</div>';
}

export function knowledgeLinks(sources) {
  return (Array.isArray(sources)?sources:[]).flatMap(source=>{
    try {
      const url=new URL(source.url);
      if(url.protocol!=='https:'||!['www.micro-epsilon.de','www.micro-epsilon.com'].includes(url.hostname)||!url.pathname.startsWith('/fileadmin/download/manuals/'))return [];
      return ['<a href="'+escape(url.href)+'" target="_blank" rel="noopener noreferrer">'+escape(source.title)+'</a>'];
    } catch {return [];}
  }).join(' · ');
}

const runtimeErrorKey = code => ({
  unavailable:'runtimeUnavailable', model_missing:'runtimeModelMissing', busy:'runtimeBusy',
  timeout:'runtimeTimeout', invalid_response:'runtimeInvalidResponse', cancelled:'runtimeCancelled',
})[code] || 'runtimeUnknown';

/** A local model client; confirmations remain simulations and never write settings. */
export function createAssistantUI({getContext, getChartSummary, getError, getApiBase = () => globalThis.location?.origin}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'assistant-drawer';
  dialog.className = 'assistant-drawer';
  dialog.dataset.i18nSkip = '';
  dialog.setAttribute('aria-labelledby', 'assistant-title');
  dialog.setAttribute('aria-describedby', 'assistant-preview-note');
  document.body.append(dialog);
  let messages = [], draft = '', busy = false, intent = 'ask', generation = 0, opener=null;
  let activeRequest = null, statusRequest = null, statusGeneration = 0, statusTimer = null;
  let runtime = {state:'checking',model:''};

  function runtimeMarkup() {
    return escape(t(runtime.state === 'ready' ? 'runtimeReady' : runtime.state === 'checking' ? 'runtimeChecking' : runtimeErrorKey(runtime.state), {model:runtime.model}));
  }

  function setRuntime(next) {
    if(runtime.state===next.state&&runtime.model===next.model)return;
    runtime = next;
    const element = dialog.querySelector('#assistant-runtime');
    if (element) {element.innerHTML=runtimeMarkup();element.dataset.state=runtime.state;}
  }

  async function refreshStatus(silent=false) {
    const token=++statusGeneration, baseUrl=getApiBase();
    statusRequest?.abort();statusRequest=new AbortController();
    if(!silent)setRuntime({state:'checking',model:runtime.model});
    try {
      const status=await getAssistantStatus({baseUrl,signal:statusRequest.signal});
      if(token===statusGeneration&&baseUrl===getApiBase())setRuntime(status);
    } catch(error) {
      if(token===statusGeneration&&baseUrl===getApiBase()&&error.code!=='cancelled')setRuntime({state:error.code||'unavailable',model:runtime.model});
    }
  }

  function cancelPending() {activeRequest?.abort();}

  function chatHistory(context, language) {
    const history=[];
    for(let index=1;index<messages.length;index++) {
      const message=messages[index], previous=messages[index-1], snapshot=message.response?.context;
      if(message.response?.kind!=='chat'||previous.role!=='user'||!previous.text||message.language!==language)continue;
      if(snapshot?.sensor.id!==context.sensor.id||snapshot?.profile.id!==context.profile.id||snapshot?.profile.version!==context.profile.version||snapshot.source!==context.source||snapshot.zeroOffset!==context.zeroOffset)continue;
      history.push({role:'user',content:previous.text},{role:'assistant',content:message.response.answerText});
    }
    return history.slice(-8);
  }

  function exampleValue(context) {
    const {profile, sensor} = context;
    return fmt(Math.min(sensor.rangeEnd, profile.upper + (sensor.rangeEnd - sensor.rangeStart) * .005), sensor.unit);
  }

  function sourceName(context) {
    return t(context.source === 'replay' ? 'replay' : context.source === 'demo' ? 'demo' : 'live');
  }

  function contextMarkup(context) {
    const value = context.connected && context.valid && !context.paused && Number.isFinite(context.value)
      ? `${fmt(context.value - context.zeroOffset, context.sensor.unit)} ${context.sensor.unit}` : t('noReading');
    return `<div class="assistant-context" aria-label="${escape(t('currentContext'))}">
      <div class="assistant-context-main"><strong>${escape(context.sensor.model)}</strong><span class="assistant-source">${escape(sourceName(context))}</span></div>
      <div class="assistant-context-meta"><span>${escape(context.profile.name)}</span><span>${!context.connected?escape(t('disconnected'))+' · ':''}${escape(value)}</span></div>
    </div>`;
  }

  function shortcuts(context) {
    return `<div class="assistant-shortcuts ${messages.length?'compact-shortcuts':''}">${[['ask','chat'],['chart','chart'],['error','error'],['command','command']].map(([key, glyph]) =>
      `<button type="button" data-assistant-action="${key}" ${busy || (key==='chart' && context.route!=='monitor') ? 'disabled' : ''}>${icon(glyph)}<strong>${escape(t(key))}</strong><span>${escape(key==='chart' && context.route!=='monitor' ? 'Sensor Cockpit' : t(key+'Hint'))}</span></button>`).join('')}</div>`;
  }

  function responseMarkup(message, index) {
    const r = message.response, context = r.context || getContext(), unit = context.sensor.unit;
    if (['chat','chart','error'].includes(r.kind) && typeof r.answerText==='string') {
      let details='';
      if(r.kind==='chart' && r.summary?.count) {
        details='<dl class="assistant-metrics">'+[['minimum',r.summary.min],['maximum',r.summary.max],['mean',r.summary.mean]].map(([label,value])=>'<div><dt>'+escape(t(label))+'</dt><dd>'+fmt(value,unit)+'<small>'+escape(unit)+'</small></dd></div>').join('')+'</dl>';
        details+=p(t('samples',{count:r.summary.count,duration:Math.round(r.summary.duration)}))+(r.summary.outside?p(t('outside',{count:r.summary.outside})): '');
      }
      if(r.kind==='chart'&&!r.summary?.count)details=p(t('emptyChart'))+'<button type="button" class="btn compact" data-assistant-action="example-chart">'+escape(t('exampleChart'))+'</button>';
      if(r.kind==='error')details='<div class="assistant-error-code">'+escape(r.error?.code||'')+'</div>'+(Number.isFinite(r.eventValue)?p(t('eventValue',{time:sessionTime(r.eventTime),value:fmt(r.eventValue,unit),unit})):'');
      return (r.kind==='chat'?'':'<h3>'+escape(t(r.kind==='chart'?'chartTitle':'errorTitle'))+'</h3>')+
        (message.example?'<span class="badge">'+escape(t('sampleData'))+'</span>':'')+details+generatedAnswerMarkup(r)+
        (r.kind==='error'&&r.topic==='connection'?'<button type="button" class="btn compact" data-assistant-action="settings">'+escape(t('openSettings'))+'</button>':'')+
        (r.kind==='chat'&&!context.connected?'<button type="button" class="btn compact" data-assistant-action="setup">'+escape(t('openSetup'))+'</button>':'');
    }
    if (r.kind === 'command') {
      if (r.status !== 'proposal') return `<h3>${escape(t(r.status === 'clarify' ? 'clarify' : 'invalid'))}</h3>${generatedAnswerMarkup(r)}${r.reasonCode?p(t(r.reasonCode, {start:context.sensor.rangeStart,end:context.sensor.rangeEnd,unit})):''}`;
      const proposal = r.proposal, status = message.proposalStatus || 'pending';
      return `<div class="assistant-proposal" data-status="${escape(status)}"><div class="assistant-proposal-parameter"><h3>${escape(t('proposalTitle'))}</h3><span class="badge">${escape(t('profile'))}</span></div>
        ${generatedAnswerMarkup(r)}<p>${escape(t(proposal.parameterName))}</p><div class="assistant-proposal-values"><div class="assistant-old-value"><span>${escape(t('previous'))}</span><strong>${fmt(proposal.oldValue,unit)} <small>${escape(unit)}</small></strong></div><span aria-hidden="true">→</span><div class="assistant-new-value"><span>${escape(t('proposed'))}</span><strong>${fmt(proposal.newValue,unit)} <small>${escape(unit)}</small></strong></div></div>
        <p class="assistant-proposal-note">${escape(t('simulationNote'))}</p>
        ${status === 'pending' ? `<div class="assistant-proposal-actions"><button type="button" class="btn primary" data-assistant-action="confirm" data-message="${index}">${icon('check')}${escape(t('confirm'))}</button><button type="button" class="btn quiet" data-assistant-action="cancel" data-message="${index}">${escape(t('cancel'))}</button></div>` :
        `<p class="assistant-proposal-status" role="status">${status === 'confirmed' ? icon('check') : ''}${escape(t(status === 'confirmed' ? 'confirmed' : status === 'cancelled' ? 'cancelled' : 'contextChanged'))}</p>${status === 'confirmed' ? p(t('confirmedText')) : ''}`}</div>`;
    }
    if (r.kind === 'command-intro') return p(t('commandIntro')) + `<p class="assistant-answer-label">${escape(t('supported'))}</p><button type="button" class="assistant-example-command" data-assistant-action="fill-command">${escape(t('emptyCommandHint',{value:exampleValue(context),unit}))}</button>`;
    if (r.kind === 'no-error') return p(t('noActiveError')) + `<button type="button" class="btn compact" data-assistant-action="example-error">${escape(t('exampleErrorAction'))}</button>`;
    return p(t(runtimeErrorKey(r.code)));
  }

  function sessionTime(value){const seconds=Math.max(0,Math.floor(value||0));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
  function responseContext(message,index){
    const context=message.response?.context;
    if(!context?.capturedAt)return '';
    const response=message.response;
    const captured=new Date(context.capturedAt).toLocaleString(getLocale()),summary=message.response.summary;
    return `<footer class="assistant-response-context">${response.model?`<p>${escape(t('modelLabel'))}: ${escape(response.model)}${response.createdAt?' · '+escape(new Date(response.createdAt).toLocaleString(getLocale())):''}</p>${p(t('generatedNote'))}`:''}${response.knowledgeSources?.length?`<p>${escape(t('knowledgeSources'))}${knowledgeLinks(response.knowledgeSources)?': '+knowledgeLinks(response.knowledgeSources):''}</p>`:''}<p>${escape(sourceName(context))} · ${escape(context.sensor.model)} · ${escape(context.profile.name)}</p><p>${escape(t('captured',{time:captured}))}</p><p>${escape(t('windowRange',{start:sessionTime(summary?.start??context.start),end:sessionTime(summary?.end??context.end),version:context.profile.version}))}</p>${['chart','error'].includes(message.response.kind)&&!message.example?`<button type="button" class="text-button" data-assistant-action="reanalyze" data-message="${index}">${escape(t('reanalyze'))}</button>`:''}</footer>`;
  }

  function render({scroll = false, focus = ''} = {}) {
    const input = dialog.querySelector('textarea');
    const focusInput = document.activeElement === input;
    const cursor = input?.selectionStart;
    if (input) draft = input.value;
    const context = getContext();
    dialog.innerHTML = `<div class="assistant-layout"><div><header class="assistant-head"><div><h2 id="assistant-title">${escape(t('title'))}</h2><span class="badge">${escape(t('preview'))}</span></div><div class="row"><button type="button" class="icon-button" data-assistant-action="clear" aria-label="${escape(t('clear'))}" title="${escape(t('clear'))}" ${messages.length ? '' : 'disabled'}>${icon('reset')}</button><button type="button" class="icon-button" data-assistant-action="close" aria-label="${escape(t('close'))}">${icon('close')}</button></div></header>${contextMarkup(context)}<div id="assistant-runtime" class="assistant-runtime" role="status" data-state="${escape(runtime.state)}">${runtimeMarkup()}</div></div>
      <div class="assistant-body">${messages.length ? '' : `<div class="assistant-welcome"><h3>${escape(t('welcome'))}</h3>${p(t('previewIntro'))}</div>`}${shortcuts(context)}
      <div class="assistant-messages" role="log" aria-live="polite" aria-relevant="additions">${messages.map((message,index) => `<article class="assistant-message" data-role="${message.role}"><div class="assistant-answer-label">${escape(t(message.role === 'user' ? 'you' : 'answer'))}</div><div class="assistant-message-content">${message.role === 'user' ? p(message.key ? t(message.key) : message.text) : responseMarkup(message,index)+responseContext(message,index)}</div></article>`).join('')}</div>
      ${busy ? `<div class="assistant-pending" role="status"><span></span>${escape(t('working'))}<button type="button" class="btn quiet compact" data-assistant-action="stop">${escape(t('cancelRequest'))}</button></div>` : ''}</div>
      <form class="assistant-composer"><label class="sr-only" for="assistant-input">${escape(t('inputLabel'))}</label><textarea id="assistant-input" name="message" rows="2" maxlength="1000" placeholder="${escape(t('placeholder'))}">${escape(draft)}</textarea><div class="assistant-compose-footer"><span id="assistant-preview-note">${escape(t('previewNote'))}</span><button type="submit" class="btn primary" aria-label="${escape(t('send'))}" ${busy || !draft.trim() ? 'disabled' : ''}>${icon('send')}</button></div></form></div>`;
    if (focusInput||focus==='composer') {
      const nextInput = dialog.querySelector('textarea');
      nextInput.focus({preventScroll:true});
      if (Number.isInteger(cursor)) nextInput.setSelectionRange(cursor,cursor);
    }
    if (scroll) { const body=dialog.querySelector('.assistant-body');body.scrollTop=body.scrollHeight; }
  }

  async function run(type, text = '', example = false) {
    if (busy || (['ask','command'].includes(type) && !text.trim())) return;
    const token = ++generation, context = structuredClone(getContext()), language=getLanguage();
    const options={baseUrl:getApiBase(),language,history:chatHistory(context,language),signal:(activeRequest=new AbortController()).signal};
    // A status response begun before generation must not replace a newer success/error state.
    statusGeneration++;statusRequest?.abort();
    const focusAfter=['ask','command'].includes(type)?'composer':document.activeElement?.dataset?.assistantAction||type;
    const userKey = type === 'chart' ? (example ? 'sampleChartQuestion' : 'chartQuestion') : type === 'error' ? (example ? 'sampleErrorQuestion' : 'errorQuestion') : null;
    if (type === 'command' || type === 'ask') {
      draft = ''; const input=dialog.querySelector('textarea');if(input)input.value='';
      messages.push({role:'user',text:text.trim()});
      intent='ask';
    } else messages.push({role:'user',key:userKey});
    busy=true;render({scroll:true});
    try {
      let response;
      if (type === 'chart') {
        const width = context.sensor.rangeEnd-context.sensor.rangeStart;
        const center=context.profile.target-context.zeroOffset;
        const summary = example ? {count:150,min:center-width*.0015,max:center+width*.0015,mean:center,trend:0,outside:0,duration:30,start:0,end:30} : getChartSummary();
        response = await explainChart(summary, example?{...context,source:'demo',connected:true,valid:true,paused:false,value:context.profile.target,window:30,start:0,end:30}:context, options);
      } else if (type === 'error') {
        const error = example ? {code:'EXAMPLE_INVALID_SIGNAL',message:'',type:'signal'} : getError();
        response = error ? await explainError(error,example ? {...context,connected:true,valid:false,source:'demo'} : context, options) : {kind:'no-error',context};
      } else if (type === 'command') {
        response = await parseParameterCommand(text,context,options);
        if(response.status!=='proposal')intent='command';
      }
      else response = await askQuestion(text,context,options);
      if(token!==generation)return;
      messages.push({role:'assistant',response:{...response,context:response.context||context},example,language});
      if(response.model)setRuntime({state:'ready',model:response.model});
    } catch(error) {
      if(token===generation) {
        messages.push({role:'assistant',response:{kind:'failed',code:error.code||'unavailable'}});
        if(error.code!=='cancelled')setRuntime({state:error.code||'unavailable',model:runtime.model});
      }
    } finally {
      if(token===generation){activeRequest=null;busy=false;if(runtime.state==='checking')void refreshStatus();render({scroll:true,focus:focusAfter});if(focusAfter!=='composer')dialog.querySelector(`[data-assistant-action="${focusAfter}"]`)?.focus({preventScroll:true});}
    }
  }

  function focusComposer() {dialog.querySelector('textarea')?.focus({preventScroll:true});}

  function commandIntro() {
    intent='command';
    messages.push({role:'assistant',response:{kind:'command-intro',context:getContext()}});
    render({scroll:true});focusComposer();
  }

  function open(type='ask') {
    if(!dialog.open)opener=document.activeElement;
    intent=type==='command'?'command':'ask';
    render();
    if(!dialog.open)dialog.showModal();
    void refreshStatus();
    statusTimer ||= setInterval(()=>{if(dialog.open&&!busy)void refreshStatus(true);},10000);
    if(type==='chart'||type==='error')void run(type);
    else if(type==='command')commandIntro();
    else {intent='ask';focusComposer();}
  }

  dialog.addEventListener('input', event => {
    if(event.target.id!=='assistant-input')return;
    draft=event.target.value;
    dialog.querySelector('[type="submit"]').disabled=busy||!draft.trim();
  });
  dialog.addEventListener('submit', event => {
    event.preventDefault();
    const text=dialog.querySelector('textarea').value.trim();
    const isCommand=intent==='command'||/(?<!\p{L})(setze|stelle|ändere|set|change|update)(?!\p{L}).*(grenze|sollwert|limit|target|tolerance)/iu.test(text);
    void run(isCommand?'command':'ask',text);
  });
  dialog.addEventListener('keydown',event=>{
    if(event.target.id==='assistant-input'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();dialog.querySelector('form').requestSubmit();}
  });
  dialog.addEventListener('click', event => {
    if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();return;}
    const button=event.target.closest('[data-assistant-action]');if(!button||button.disabled)return;
    switch(button.dataset.assistantAction){
      case'close':dialog.close();break;
      case'stop':cancelPending();break;
      case'clear':cancelPending();generation++;messages=[];draft='';busy=false;intent='ask';{const input=dialog.querySelector('textarea');if(input)input.value='';}render();focusComposer();void refreshStatus();break;
      case'ask':intent='ask';focusComposer();break;
      case'chart':intent='ask';void run('chart');break;
      case'error':intent='ask';void run('error');break;
      case'command':commandIntro();break;
      case'example-chart':void run('chart','',true);break;
      case'example-error':void run('error','',true);break;
      case'fill-command':{const context=getContext();intent='command';draft=t('commandExample',{value:exampleValue(context),unit:context.sensor.unit});dialog.querySelector('textarea').value=draft;dialog.querySelector('[type="submit"]').disabled=busy;focusComposer();break;}
      case'settings':dialog.close();location.hash='advanced';break;
      case'setup':dialog.close();location.hash='setup';break;
      case'example-ask':void run('ask',t('askExample'));break;
      case'reanalyze':{const message=messages[Number(button.dataset.message)];if(message&&['chart','error'].includes(message.response.kind))void run(message.response.kind);break;}
      case'confirm':case'cancel':{
        const message=messages[Number(button.dataset.message)];
        if(!message?.response?.proposal||message.proposalStatus)break;
        intent='ask';
        message.proposalStatus=button.dataset.assistantAction==='cancel'?'cancelled':checkProposal(message.response.proposal,getContext()).valid?'confirmed':'expired';
        render({scroll:true,focus:'composer'});break;
      }
    }
  });
  dialog.addEventListener('close',()=>{cancelPending();statusGeneration++;statusRequest?.abort();clearInterval(statusTimer);statusTimer=null;if(opener?.isConnected)opener.focus({preventScroll:true});});
  window.addEventListener('storage', event=>{if(event.key==='landing-lang'&&dialog.open)render();});
  window.addEventListener('hashchange',()=>{if(dialog.open)dialog.close();});
  return {open,refresh:()=>{if(dialog.open)render();}};
}
