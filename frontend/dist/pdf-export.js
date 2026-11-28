import {pdfText, pdfMessages, getPdfLocale, PDF_LANGUAGES} from './pdf-i18n.js?v=pdf-1';
import {installPdfFonts, textRuns, pdfPlainText} from './pdf-fonts.js?v=pdf-1';

/** The caller supplies an immutable snapshot before any lazy font request starts. */
export async function renderReportPDF(recording, options, helpers) {
  const language=PDF_LANGUAGES.includes(options.language)?options.language:'de';
  const t=(key,values={})=>pdfText(key,values,language), locale=getPdfLocale(language);
  const {start,end,unit,basename}=options;
  let points;
  try{points=helpers.slicePoints(recording,start,end);}catch{throw new Error(t('invalidWindow'));}
  if(!points.length)throw new Error(t('emptyWindow'));
  const PDF=globalThis.jspdf?.jsPDF;
  if(!PDF)throw new Error(t('noPdf'));
  const doc=new PDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  const p=recording.profileAtStart??recording.profile;
  const history=recording.parameterHistory??[];
  const markers=(recording.markers??[]).filter(item=>item.t>=start&&item.t<=end);
  const feedback=(recording.feedback??[]).filter(item=>item.t>=start&&item.t<=end);
  const changes=history.filter(item=>Number.isFinite(item.appliedT??item.t)&&(item.appliedT??item.t)>=start&&(item.appliedT??item.t)<=end);
  const created=new Date(recording.createdAt).toLocaleString(locale);
  await installPdfFonts(doc,[...Object.values(pdfMessages[language]),recording.name,recording.sensor,p.name,created,unit,
    ...markers.map(item=>item.note),...feedback.map(item=>item.note),...changes.map(item=>item.reason)],language);
  const ink=[17,21,26],muted=[79,90,102],accent=[196,20,31],rule=[207,213,219];
  const left=18,right=192,width=right-left,bottom=273;
  const digits=unit==='°C'?2:3;
  const decimal=value=>Number(value).toLocaleString(locale,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const measure=value=>`${decimal(value)} ${unit}`;
  const fmt=helpers.formatDuration;
  const source=t(recording.source==='demo'?'sourceDemo':recording.source==='replay'?'sourceReplay':'sourceSensor');
  const summary=helpers.statistics(points);
  const learningAt=time=>{
    const result={lower:p.learnedLower??p.lower,upper:p.learnedUpper??p.upper,version:p.version};
    for(const event of history){const at=event.appliedT??event.t;if(Number.isFinite(at)&&at<=time&&event.changed!==false){result.lower=event.nextLower;result.upper=event.nextUpper;result.version=event.version;}}
    return result;
  };
  const first=learningAt(start),last=learningAt(end);
  let cursor=18;
  function ensure(height){if(cursor+height>bottom){doc.addPage();cursor=23;}}
  function runWidth(runs,size){doc.setFontSize(size);return runs.reduce((sum,run)=>{if(!run.font)return sum;doc.setFont(run.font,'normal');return sum+doc.getTextWidth(run.text);},0);}
  function line(value,x,y,size=10,color=ink,bold=false,align='left'){
    const runs=textRuns(value,language,bold);doc.setFontSize(size);doc.setTextColor(...color);
    let xx=x-(align==='right'?runWidth(runs,size):align==='center'?runWidth(runs,size)/2:0);
    for(const run of runs){if(!run.font)continue;doc.setFont(run.font,'normal');doc.text(run.text,xx,y);xx+=doc.getTextWidth(run.text);}
  }
  const graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(locale,{granularity:'grapheme'}):null;
  function wrap(value,maxWidth,size=10,bold=false){
    const lines=[];
    for(const paragraph of pdfPlainText(value).split('\n')){
      let current='';
      const segments=graphemes?[...graphemes.segment(paragraph)].map(item=>item.segment):Array.from(paragraph);
      for(const segment of segments){
        if(current&&runWidth(textRuns(current+segment,language,bold),size)>maxWidth){
          // Prefer a word boundary for Latin prose. CJK and long identifiers may wrap between graphemes.
          const space=current.lastIndexOf(' ');
          if(space>current.length/2&&space>0){lines.push(current.slice(0,space));current=current.slice(space+1)+segment;}
          else{lines.push(current);current=segment===' '?'':segment;}
        }else current+=segment;
      }
      lines.push(current);
    }
    return lines;
  }
  function paragraph(value,{size=10,color=ink,bold=false,gap=3,maxWidth=width,x=left}={}){
    const leading=size*.42+1;
    for(const item of wrap(value,maxWidth,size,bold)){ensure(leading+2);line(item,x,cursor,size,color,bold);cursor+=leading;}
    cursor+=gap;
  }
  function section(title){ensure(19);doc.setDrawColor(...rule);doc.setLineWidth(.2);doc.line(left,cursor,right,cursor);cursor+=7;paragraph(title,{size:11,bold:true,gap:2});}
  function metric(label,value){
    const labelWidth=61,valueWidth=width-labelWidth-5;
    const labels=wrap(label,labelWidth,9),values=wrap(value,valueWidth,9);
    const count=Math.max(labels.length,values.length);
    ensure(count*5+3);
    for(let i=0;i<count;i++){if(labels[i]!==undefined)line(labels[i],left,cursor,9,muted);if(values[i]!==undefined)line(values[i],left+labelWidth+5,cursor,9);cursor+=5;}
    cursor+=2;
  }
  line('MICRO-EPSILON / SENSOR COCKPIT',left,cursor,9,muted,true);cursor+=5;
  doc.setDrawColor(...rule);doc.setLineWidth(.25);doc.line(left,cursor,right,cursor);
  doc.setDrawColor(...accent);doc.setLineWidth(.65);doc.line(left,cursor,left+24,cursor);cursor+=13;
  paragraph(t('reportTitle'),{size:23,bold:true,gap:3});
  paragraph(recording.name,{size:12,gap:3});
  paragraph(`${recording.sensor} | ${created}`,{size:9,color:muted,gap:2});
  paragraph(`${t('period')}: ${fmt(start)} - ${fmt(end)} | ${t('profile')}: ${p.name}`,{size:9,color:muted,gap:2});
  paragraph(`${t('source')}: ${source}`,{size:9,color:recording.source==='demo'?accent:muted,gap:4});

  ensure(84);
  const x=30,y=cursor+6,chartWidth=160,chartHeight=58;
  const low=Math.min(summary.min,p.lower,first.lower,last.lower),high=Math.max(summary.max,p.upper,first.upper,last.upper);
  const padding=Math.max((high-low)*.18,.01),ymin=low-padding,ymax=high+padding;
  const px=time=>x+(time-start)/(end-start)*chartWidth,py=value=>y+chartHeight-(value-ymin)/(ymax-ymin)*chartHeight;
  doc.setFillColor(238,240,242);doc.rect(x,y,chartWidth,chartHeight,'F');
  doc.setFillColor(227,231,235);doc.rect(x,py(p.upper),chartWidth,py(p.lower)-py(p.upper),'F');
  doc.setDrawColor(...rule);doc.setLineWidth(.2);
  for(let tick=0;tick<=4;tick++){const value=ymin+(ymax-ymin)*tick/4,yy=py(value);doc.line(x,yy,x+chartWidth,yy);line(decimal(value),x-2.5,yy+.8,7,muted,false,'right');}
  doc.setDrawColor(...muted);doc.setLineDashPattern([1,1],0);
  for(const value of[p.lower,p.target,p.upper])doc.line(x,py(value),x+chartWidth,py(value));
  doc.setLineDashPattern([],0);doc.setDrawColor(...accent);doc.setLineWidth(.45);
  if(points.length===1){doc.setFillColor(...accent);doc.circle(px(points[0].t),py(points[0].value),.6,'F');}
  for(let i=1;i<points.length;i++)if(!points[i].breakBefore)doc.line(px(points[i-1].t),py(points[i-1].value),px(points[i].t),py(points[i].value));
  line(fmt(start),x,y+chartHeight+6,8,muted);line(fmt(end),x+chartWidth,y+chartHeight+6,8,muted,false,'right');
  line(`${t(unit==='°C'?'quantityTemperature':'quantityDistance')} / ${unit}`,x,y-3,8,muted);
  line(t('measurement'),x+chartWidth,y-3,8,accent,false,'right');
  cursor=y+chartHeight+16;

  metric(t('specifications'),`${measure(p.target)} / ${measure(p.lower)} - ${measure(p.upper)}`);
  metric(t('initialLimits'),`${measure(first.lower)} - ${measure(first.upper)} (${t('version',{version:first.version})})`);
  if(last.version!==first.version)metric(t('finalLimits'),`${measure(last.lower)} - ${measure(last.upper)} (${t('version',{version:last.version})})`);
  metric(t('rateUnit'),`${p.rate} Hz / ${p.unit??unit}`);
  if(recording.zeroOffset)metric(t('zeroOffset'),`${measure(recording.zeroOffset)} (${t('absoluteReport')})`);
  metric(t('minMax'),`${measure(summary.min)} / ${measure(summary.max)}`);
  metric(t('meanSpan'),`${measure(summary.mean)} / ${measure(summary.span)}`);
  metric(t('sampleCount',{count:summary.count}),t('displaySamples',{count:summary.count,rate:recording.displayRate??helpers.displayRate}));
  section(t('notes'));
  if(markers.length)for(const item of markers)paragraph(`${fmt(item.t)} - ${item.note}`);else paragraph(t('noNotes'),{color:muted});
  section(t('evaluations'));
  if(feedback.length)for(const item of feedback)paragraph(`${fmt(item.t)} - ${measure(item.value)} - ${t(item.accepted?'accepted':'rejected')}${item.note?': '+item.note:''}`);else paragraph(t('noEvaluations'),{color:muted});
  section(t('parameterChanges'));
  if(changes.length)for(const item of changes)paragraph(t('changeLine',{time:fmt(item.appliedT??item.t),version:item.version,before:`${measure(item.previousLower)} / ${measure(item.previousUpper)}`,after:`${measure(item.nextLower)} / ${measure(item.nextUpper)}`,reason:item.reason??''}));else paragraph(t('noChanges'),{color:muted});
  const pages=doc.getNumberOfPages();
  for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor(...rule);doc.setLineWidth(.2);doc.line(left,282,right,282);line(`MICRO-EPSILON / ${t('footer')}`,left,287,8,muted);line(`${page} / ${pages}`,right,287,8,muted,false,'right');}
  doc.setProperties({title:t('reportTitle'),subject:recording.name,creator:'Micro-Epsilon Sensor Cockpit'});
  const filename=`${basename}-report-${language}.pdf`;
  doc.save(filename);
  return {filename};
}
