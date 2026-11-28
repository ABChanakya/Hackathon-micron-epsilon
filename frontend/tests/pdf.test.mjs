import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as engine from '../dist/data.js';
import {PDF_LANGUAGES,pdfMessages,pdfText,getPdfLocale} from '../dist/pdf-i18n.js';
import fontData from '../dist/pdf-font-data.js';
import {fontForCharacter,textRuns} from '../dist/pdf-fonts.js?v=pdf-1';

const vendor=await readFile(new URL('../dist/vendor/jspdf.umd.min.js',import.meta.url),'utf8');
const commonjs={exports:{}};
vm.runInNewContext(vendor,{module:commonjs,exports:commonjs.exports,require:createRequire(import.meta.url),console,process,Buffer,setTimeout,clearTimeout,atob,btoa,TextEncoder,TextDecoder,Blob});
const JsPDF=commonjs.exports.jsPDF;
const originalFetch=globalThis.fetch;
let downloads=[],fontRequests=[];
const localFonts=async url=>{assert.match(String(url),/\/assets\/pdf-fonts\/NotoSans(?:SC|JP|KR)?-(?:Regular|Bold)\.ttf$/);fontRequests.push(String(url));return new Response(await readFile(url));};
function install(){
  downloads=[];
  globalThis.fetch=localFonts;
  globalThis.jspdf={jsPDF:function(...args){
    const doc=new JsPDF(...args),text=doc.text.bind(doc),texts=[];
    doc.text=(value,...rest)=>{texts.push(String(value));return text(value,...rest);};
    doc.save=filename=>downloads.push({filename,bytes:Buffer.from(doc.output('arraybuffer')),texts,pages:doc.getNumberOfPages()});
    return doc;
  }};
}
function fixture(){engine.useSensor('ild1900');return structuredClone(engine.createInitialState().recordings[0]);}

async function artifact(name,download){
  if(!process.env.PDF_ARTIFACT_DIR)return;
  await mkdir(process.env.PDF_ARTIFACT_DIR,{recursive:true});
  await writeFile(new URL(name,new URL(`file://${process.env.PDF_ARTIFACT_DIR.replace(/\/$/,'')}/`)),download.bytes);
}

test('PDF dictionaries cover ten languages and preserve interpolation in every message',()=>{
  assert.equal(PDF_LANGUAGES.length,10);
  const keys=Object.keys(pdfMessages.de);
  for(const language of PDF_LANGUAGES){
    assert.deepEqual(Object.keys(pdfMessages[language]),keys);
    for(const key of keys){assert.equal(typeof pdfMessages[language][key],'string',`${language}.${key}`);assert.deepEqual([...pdfMessages[language][key].matchAll(/\{\w+\}/g)].map(x=>x[0]).sort(),[...pdfMessages.de[key].matchAll(/\{\w+\}/g)].map(x=>x[0]).sort());}
    assert.ok(getPdfLocale(language));
  }
  assert.equal(pdfText('evaluationCount',{count:2,version:7},'en'),'2 assessments · Parameter version 7');
});

test('a stalled font request times out and rejects without saving a partial PDF',async()=>{
  install();
  const timeout=AbortSignal.timeout,durations=[];
  AbortSignal.timeout=milliseconds=>{
    durations.push(milliseconds);
    const controller=new AbortController();
    queueMicrotask(()=>controller.abort(new DOMException('Font request timed out','TimeoutError')));
    return controller.signal;
  };
  globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>{
    if(signal.aborted)reject(signal.reason);
    else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
  try{
    await assert.rejects(engine.exportReportPDF(fixture(),{language:'en'}),/font could not be loaded/);
    assert.ok(durations.length>0);
    assert.ok(durations.every(value=>value===15000));
    assert.equal(downloads.length,0);
  }finally{AbortSignal.timeout=timeout;globalThis.fetch=localFonts;}
});

test('PDF export reports unavailable library, invalid period, and font fetch errors without saving',async()=>{
  const r=fixture();
  delete globalThis.jspdf;
  await assert.rejects(engine.exportReportPDF(r,{language:'en'}),/has not loaded/);
  install();
  await assert.rejects(engine.exportReportPDF(r,{start:20,end:10,language:'cs'}),/platné období/);
  globalThis.fetch=async()=>new Response(null,{status:404});
  await assert.rejects(engine.exportReportPDF(r,{language:'en'}),/font could not be loaded/);
  assert.equal(downloads.length,0);
  // A failed font promise is evicted: retry succeeds from the local assets.
  globalThis.fetch=localFonts;
  await engine.exportReportPDF(r,{language:'en'});
  assert.equal(downloads.length,1);
});

test('offline TrueType assets are static, match the pinned manifest, and cover mixed script runs',async()=>{
  for(const [id,entry] of Object.entries(fontData)){
    const bytes=await readFile(new URL('../dist/assets/pdf-fonts/'+entry.file,import.meta.url));
    assert.equal(bytes.readUInt32BE(0),0x00010000,id);
    const tags=Array.from({length:bytes.readUInt16BE(4)},(_,i)=>bytes.toString('ascii',12+i*16,16+i*16));
    assert.ok(!tags.includes('fvar'),`${id} is a static font`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    assert.match(entry.source,/raw\.githubusercontent\.com\/notofonts\/[^/]+\/[a-f0-9]{40}\//);
  }
  assert.equal(fontForCharacter('Č'),'Latin-Regular');
  assert.equal(fontForCharacter('あ','de'),'JP-Regular');
  assert.equal(fontForCharacter('한','de'),'KR-Regular');
  assert.equal(fontForCharacter('測','ja'),'JP-Regular');
  assert.equal(fontForCharacter('测','zh'),'SC-Regular');
  assert.equal(textRuns('Český 日本語 中文 한국어').map(x=>x.text).join(''),'Český 日本語 中文 한국어');
  assert.throws(()=>textRuns('not supported 🦄','en'),/not supported/);
  assert.throws(()=>textRuns('𠮷田','ja'),/U\+20BB7.*サポート/);
  assert.throws(()=>textRuns('𠮷田','en'),/U\+20BB7.*not supported/);
});

test('a supplementary CJK name fails visibly instead of losing its surrogate-pair character',async()=>{
  install();
  const r=fixture();r.name='𠮷田 sensor';
  await assert.rejects(engine.exportReportPDF(r,{language:'ja'}),/U\+20BB7.*サポート/);
  assert.equal(downloads.length,0);
});

test('real PDFs export in all ten languages with local fonts, localized provenance, and text',async()=>{
  install();
  const r=fixture();
  r.name='Prüfteil 25,050 mm';
  r.source='replay';
  for(const language of PDF_LANGUAGES){
    const result=await engine.exportReportPDF(r,{start:0,end:20,language});
    const download=downloads.at(-1);
    assert.equal(result.filename,download.filename);
    assert.match(result.filename,new RegExp(`-report-${language}\\.pdf$`));
    assert.equal(download.bytes.subarray(0,4).toString(),'%PDF');
    assert.ok(download.bytes.length>10000);
    const text=download.texts.join('');
    assert.ok(text.includes(pdfText('reportTitle',{},language)),language);
    assert.ok(text.includes(pdfText('sourceReplay',{},language)),language);
    assert.ok(text.includes(r.name),language);
    assert.ok(download.pages>=1);
    await artifact(`report-${language}.pdf`,download);
  }
});

test('mixed Latin, Chinese, Japanese and Korean notes survive in every report language',async()=>{
  install();
  const r=fixture(),mixed='Český Prüfteil – 日本語 – 中文 – 한국어 – 25,050 mm – 23,5 °C';
  r.name=mixed;
  r.markers=[{t:5,note:mixed}];
  for(const language of PDF_LANGUAGES){
    await engine.exportReportPDF(r,{start:0,end:20,language});
    assert.ok(downloads.at(-1).texts.join('').includes(mixed));
    if(['de','zh','ja','ko'].includes(language))await artifact(`mixed-${language}.pdf`,downloads.at(-1));
  }
  const previous=fontRequests.length;
  await engine.exportReportPDF(r,{language:'de'});
  assert.equal(fontRequests.length,previous,'font bytes are cached across exports');
});

test('long multilingual notes paginate and the report snapshot survives caller mutation',async()=>{
  install();
  const r=fixture();
  r.name='Snapshot of the original recording';
  r.zeroOffset=25;
  r.markers=Array.from({length:24},(_,i)=>({t:i/2,note:`${i+1}. `+'日本語 中文 한국어 Česky measurement note. '.repeat(9)}));
  const pending=engine.exportReportPDF(r,{start:0,end:20,language:'en'});
  r.name='MUTATED AFTER CALL';r.markers=[];r.profile.target=999;
  await pending;
  const download=downloads.at(-1),text=download.texts.join('');
  assert.ok(text.includes('Snapshot of the original recording'));
  assert.ok(!text.includes('MUTATED AFTER CALL'));
  assert.ok(text.includes('Report uses absolute values'));
  assert.ok(download.pages>2);
  for(let page=1;page<=download.pages;page++)assert.ok(text.includes(`${page} / ${download.pages}`));
  await artifact('long-mixed-notes.pdf',download);
});

test('long names and temperature reports keep their recorded units and page boundaries',async()=>{
  install();
  engine.useSensor('thermo_uc');
  const r=structuredClone(engine.createInitialState().recordings[0]);
  engine.useSensor('ild1900');
  r.name='温度測定検査'.repeat(26)+'Český';
  r.profile.name='Temperaturprofil '+ '日本語 '.repeat(24);
  r.zeroOffset=25;
  await engine.exportReportPDF(r,{language:'ja'});
  const download=downloads.at(-1),text=download.texts.join('');
  assert.ok(text.includes('°C'));
  assert.ok(text.includes('Český'));
  assert.ok(!text.includes(' Hz / mm'));
  assert.ok(text.includes(pdfText('absoluteReport',{},'ja')));
  await artifact('long-name-temperature-ja.pdf',download);
});

test('CSV quotes Unicode notes and confines multiline metadata to physical comment lines',async()=>{
  let csv;
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  globalThis.document={createElement(){return{click(){},remove(){}}},body:{append(){}}};
  URL.createObjectURL=blob=>{csv=blob;return'blob:test';};URL.revokeObjectURL=()=>{};
  try{
    const r=fixture();r.name='Teil "A"\r\n日本語, B';r.sensor='Sensor\nwith newline';r.markers=[{t:1,note:'Český "note", 中文\n한국어'}];
    engine.exportRecordingCSV(r);
    const content=await csv.text();
    assert.deepEqual([...new Uint8Array(await csv.arrayBuffer()).slice(0,3)],[239,187,191]);
    assert.equal(JSON.parse(content.split('\r\n')[0].replace(/^\uFEFF/,'').slice('# name: '.length)),r.name);
    const header=content.indexOf('"type","time_s"');
    assert.ok(content.slice(0,header).split('\r\n').filter(Boolean).every(row=>row.replace(/^\uFEFF/,'').startsWith('# ')));
    assert.ok(content.includes('"marker","1","","","Český ""note"", 中文\n한국어","",""'));
  }finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;delete globalThis.document;}
});

test.after(()=>{globalThis.fetch=originalFetch;delete globalThis.jspdf;engine.useSensor('ild1900');});
