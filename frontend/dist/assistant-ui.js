import {askQuestion, explainError, explainChart, parseParameterCommand, checkProposal} from './assistant.js?v=assistant-1';
import {assistantText} from './assistant-i18n.js?v=assistant-1';
import {getLanguage, getLocale} from './i18n.js?v=cockpit-1';

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

/** A replaceable mock client; this drawer never writes profile or hardware settings. */
export function createAssistantUI({getContext, getChartSummary, getError}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'assistant-drawer';
  dialog.className = 'assistant-drawer';
  dialog.dataset.i18nSkip = '';
  dialog.setAttribute('aria-labelledby', 'assistant-title');
  dialog.setAttribute('aria-describedby', 'assistant-preview-note');
  document.body.append(dialog);
  let messages = [], draft = '', busy = false, intent = 'ask', generation = 0;

  function exampleValue(context) {
    const {profile, sensor} = context;
    return fmt(Math.min(sensor.rangeEnd, profile.upper + (sensor.rangeEnd - sensor.rangeStart) * .005), sensor.unit);
  }

  function sourceName(context) {
    return t(!context.connected ? 'disconnected' : context.source === 'replay' ? 'replay' : context.source === 'demo' ? 'demo' : 'live');
  }

  function contextMarkup(context) {
    const value = context.connected && context.valid && Number.isFinite(context.value)
      ? `${fmt(context.value - context.zeroOffset, context.sensor.unit)} ${context.sensor.unit}` : t('noReading');
    return `<div class="assistant-context" aria-label="${escape(t('currentContext'))}">
      <div class="assistant-context-main"><strong>${escape(context.sensor.model)}</strong><span class="assistant-source">${escape(sourceName(context))}</span></div>
      <div class="assistant-context-meta"><span>${escape(context.profile.name)}</span><span>${escape(value)}</span></div>
    </div>`;
  }

  function shortcuts(context) {
    return `<div class="assistant-shortcuts">${[['ask','chat'],['chart','chart'],['error','error'],['command','command']].map(([key, glyph]) =>
      `<button type="button" data-assistant-action="${key}" ${busy || (key==='chart' && context.route!=='monitor') ? 'disabled' : ''}>${icon(glyph)}<strong>${escape(t(key))}</strong><span>${escape(key==='chart' && context.route!=='monitor' ? 'Sensor Cockpit' : t(key+'Hint'))}</span></button>`).join('')}</div>`;
  }

  function responseMarkup(message, index) {
    const r = message.response, context = r.context || getContext(), unit = context.sensor.unit;
    if (r.kind === 'chat') {
      const key = r.topic === 'led' && unit === '°C' ? 'temperatureLedAnswer' : `${r.topic}Answer`;
      return p(t(key, {model: context.sensor.model, start: context.sensor.rangeStart, end: context.sensor.rangeEnd, unit}));
    }
    if (r.kind === 'chart') {
      if (r.topic === 'empty') return p(t('emptyChart')) + `<button type="button" class="btn compact" data-assistant-action="example-chart">${escape(t('exampleChart'))}</button>`;
      const s = r.summary;
      return `<h3>${escape(t('chartTitle'))}</h3>${message.example ? `<span class="badge">${escape(t('sampleData'))}</span>` : ''}
        <dl class="assistant-metrics">${[['minimum',s.min],['maximum',s.max],['mean',s.mean]].map(([label, value]) => `<div><dt>${escape(t(label))}</dt><dd>${fmt(value, unit)}<small>${escape(unit)}</small></dd></div>`).join('')}</dl>
        ${p(t(r.topic === 'outside' ? 'outsideText' : ['rising','falling'].includes(r.topic) ? r.topic : 'stable'))}
        <p class="assistant-answer-label">${escape(t('samples', {count:s.count,duration:Math.round(s.duration)}))}${s.outside ? ' · '+escape(t('outside',{count:s.outside})) : ''}</p>`;
    }
    if (r.kind === 'error') {
      const topic = ['connection','signal','tolerance'].includes(r.topic) ? r.topic : 'signal';
      return `<h3>${escape(t('errorTitle'))}</h3><div class="assistant-error-code">${escape(message.example ? t('exampleError') : t('activeError'))} · <span class="mono">${escape(r.error?.code || '')}</span></div>
        <h4>${escape(t('cause'))}</h4>${p(t(topic+'Cause'))}<h4>${escape(t('impact'))}</h4>${p(t(topic+'Impact'))}
        <h4>${escape(t('nextSteps'))}</h4><ol class="assistant-steps"><li>${escape(t(topic+'Step1'))}</li><li>${escape(t(topic+'Step2'))}</li></ol>
        ${topic === 'connection' ? `<button type="button" class="btn compact" data-assistant-action="settings">${escape(t('openSettings'))}</button>` : ''}`;
    }
    if (r.kind === 'command') {
      if (r.status !== 'proposal') return `<h3>${escape(t(r.status === 'clarify' ? 'clarify' : 'invalid'))}</h3>${p(t(r.reasonCode, {start:context.sensor.rangeStart,end:context.sensor.rangeEnd,unit}))}`;
      const proposal = r.proposal, status = message.proposalStatus || 'pending';
      return `<div class="assistant-proposal" data-status="${escape(status)}"><div class="assistant-proposal-parameter"><h3>${escape(t('proposalTitle'))}</h3><span class="badge">${escape(t('profile'))}</span></div>
        <p>${escape(t(proposal.parameterName))}</p><div class="assistant-proposal-values"><div class="assistant-old-value"><span>${escape(t('previous'))}</span><strong>${fmt(proposal.oldValue,unit)} <small>${escape(unit)}</small></strong></div><span aria-hidden="true">→</span><div class="assistant-new-value"><span>${escape(t('proposed'))}</span><strong>${fmt(proposal.newValue,unit)} <small>${escape(unit)}</small></strong></div></div>
        <p class="assistant-proposal-note">${escape(t('simulationNote'))}</p>
        ${status === 'pending' ? `<div class="assistant-proposal-actions"><button type="button" class="btn primary" data-assistant-action="confirm" data-message="${index}">${icon('check')}${escape(t('confirm'))}</button><button type="button" class="btn quiet" data-assistant-action="cancel" data-message="${index}">${escape(t('cancel'))}</button></div>` :
        `<p class="assistant-proposal-status" role="status">${status === 'confirmed' ? icon('check') : ''}${escape(t(status === 'confirmed' ? 'confirmed' : status === 'cancelled' ? 'cancelled' : 'contextChanged'))}</p>${status === 'confirmed' ? p(t('confirmedText')) : ''}`}</div>`;
    }
    if (r.kind === 'command-intro') return p(t('commandIntro')) + `<p class="assistant-answer-label">${escape(t('supported'))}</p><button type="button" class="assistant-example-command" data-assistant-action="fill-command">${escape(t('emptyCommandHint',{value:exampleValue(context),unit}))}</button>`;
    if (r.kind === 'no-error') return p(t('noActiveError')) + `<button type="button" class="btn compact" data-assistant-action="example-error">${escape(t('exampleErrorAction'))}</button>`;
    return p(t('failed'));
  }

  function render({scroll = false} = {}) {
    const input = dialog.querySelector('textarea');
    const focusInput = document.activeElement === input;
    const cursor = input?.selectionStart;
    if (input) draft = input.value;
    const context = getContext();
    dialog.innerHTML = `<div class="assistant-layout"><div><header class="assistant-head"><div><h2 id="assistant-title">${escape(t('title'))}</h2><span class="badge">${escape(t('preview'))}</span></div><div class="row"><button type="button" class="icon-button" data-assistant-action="clear" aria-label="${escape(t('clear'))}" title="${escape(t('clear'))}" ${messages.length ? '' : 'disabled'}>${icon('reset')}</button><button type="button" class="icon-button" data-assistant-action="close" aria-label="${escape(t('close'))}">${icon('close')}</button></div></header>${contextMarkup(context)}</div>
      <div class="assistant-body">${messages.length ? '' : `<div class="assistant-welcome"><h3>${escape(t('welcome'))}</h3>${p(t('intro'))}</div>`}${shortcuts(context)}
      <div class="assistant-messages" role="log" aria-live="polite" aria-relevant="additions">${messages.map((message,index) => `<article class="assistant-message" data-role="${message.role}"><div class="assistant-answer-label">${escape(t(message.role === 'user' ? 'you' : 'answer'))}</div><div class="assistant-message-content">${message.role === 'user' ? p(message.key ? t(message.key) : message.text) : responseMarkup(message,index)}</div></article>`).join('')}</div>
      ${busy ? `<div class="assistant-pending" role="status"><span></span>${escape(t('working'))}</div>` : ''}</div>
      <form class="assistant-composer"><label class="sr-only" for="assistant-input">${escape(t('inputLabel'))}</label><textarea id="assistant-input" name="message" rows="2" maxlength="1000" placeholder="${escape(t('placeholder'))}">${escape(draft)}</textarea><div class="assistant-compose-footer"><span id="assistant-preview-note">${escape(t('previewNote'))}</span><button type="submit" class="btn primary" aria-label="${escape(t('send'))}" ${busy || !draft.trim() ? 'disabled' : ''}>${icon('send')}</button></div></form></div>`;
    if (focusInput) {
      const nextInput = dialog.querySelector('textarea');
      nextInput.focus({preventScroll:true});
      if (Number.isInteger(cursor)) nextInput.setSelectionRange(cursor,cursor);
    }
    if (scroll) { const body=dialog.querySelector('.assistant-body');body.scrollTop=body.scrollHeight; }
  }

  async function run(type, text = '', example = false) {
    if (busy) return;
    const token = ++generation, context = getContext();
    const userKey = type === 'chart' ? (example ? 'sampleChartQuestion' : 'chartQuestion') : type === 'error' ? (example ? 'sampleErrorQuestion' : 'errorQuestion') : null;
    if (type === 'command' || type === 'ask') {
      if (!text.trim()) return;
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
        const summary = example ? {count:150,min:center-width*.0015,max:center+width*.0015,mean:center,trend:0,outside:0,duration:30} : getChartSummary();
        response = await explainChart(summary, context);
      } else if (type === 'error') {
        const error = example ? {code:'EXAMPLE_INVALID_SIGNAL',message:'',type:'signal'} : getError();
        response = error ? await explainError(error,example ? {...context,connected:true,valid:false,source:'demo'} : context) : {kind:'no-error',context};
      } else if (type === 'command') {
        response = await parseParameterCommand(text,context);
        if(response.status!=='proposal')intent='command';
      }
      else response = await askQuestion(text,context);
      if(token!==generation)return;
      messages.push({role:'assistant',response:{...response,context:response.context||context},example});
    } catch {
      if(token===generation)messages.push({role:'assistant',response:{kind:'failed'}});
    } finally {
      if(token===generation){busy=false;render({scroll:true});}
    }
  }

  function focusComposer() {dialog.querySelector('textarea')?.focus({preventScroll:true});}

  function commandIntro() {
    intent='command';
    messages.push({role:'assistant',response:{kind:'command-intro',context:getContext()}});
    render({scroll:true});focusComposer();
  }

  function open(type='ask') {
    intent=type==='command'?'command':'ask';
    render();
    if(!dialog.open)dialog.showModal();
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
      case'clear':generation++;messages=[];draft='';busy=false;intent='ask';{const input=dialog.querySelector('textarea');if(input)input.value='';}render();focusComposer();break;
      case'ask':intent='ask';focusComposer();break;
      case'chart':intent='ask';void run('chart');break;
      case'error':intent='ask';void run('error');break;
      case'command':commandIntro();break;
      case'example-chart':void run('chart','',true);break;
      case'example-error':void run('error','',true);break;
      case'fill-command':{const context=getContext();intent='command';draft=t('commandExample',{value:exampleValue(context),unit:context.sensor.unit});dialog.querySelector('textarea').value=draft;dialog.querySelector('[type="submit"]').disabled=busy;focusComposer();break;}
      case'settings':dialog.close();location.hash='advanced';break;
      case'confirm':case'cancel':{
        const message=messages[Number(button.dataset.message)];
        if(!message?.response?.proposal||message.proposalStatus)break;
        intent='ask';
        message.proposalStatus=button.dataset.assistantAction==='cancel'?'cancelled':checkProposal(message.response.proposal,getContext()).valid?'confirmed':'expired';
        render({scroll:true});break;
      }
    }
  });
  window.addEventListener('storage', event=>{if(event.key==='landing-lang'&&dialog.open)render();});
  window.addEventListener('hashchange',()=>{if(dialog.open)dialog.close();});
  return {open,refresh:()=>{if(dialog.open)render();}};
}
