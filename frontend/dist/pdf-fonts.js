import fontData from './pdf-font-data.js?v=pdf-1';
import {pdfText} from './pdf-i18n.js?v=pdf-1';
const cached = new Map();
const supported = (font,point) => fontData[font]?.ranges.some(([start,end])=>point>=start&&point<=end);
const isHan = point => (point>=0x3400&&point<=0x9fff)||(point>=0x20000&&point<=0x323af);
const normalise = value => String(value??'').normalize('NFC').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
export const pdfPlainText = normalise;

export function fontForCharacter(character,language='de',bold=false) {
  const point=character.codePointAt(0),style=bold?'Bold':'Regular';
  // This jsPDF build encodes UTF-16 code units; supplementary glyphs would be silently lost.
  if(point>0xffff)throw new Error(pdfText('unsupportedCharacter',{character:`${character} (U+${point.toString(16).toUpperCase()})`},language));
  const region=language==='ja'?'JP':language==='ko'?'KR':'SC';
  let preferred='Latin';
  if ((point>=0x3040&&point<=0x30ff)||(point>=0x31f0&&point<=0x31ff)) preferred='JP';
  else if((point>=0x1100&&point<=0x11ff)||(point>=0x3130&&point<=0x318f)||(point>=0xac00&&point<=0xd7af))preferred='KR';
  else if(isHan(point)||(point>=0x3000&&point<=0x303f)||(point>=0xff00&&point<=0xffef))preferred=region;
  const names=[preferred,'Latin',region,'SC','JP','KR'];
  const family=names.find(name=>supported(`${name}-${style}`,point));
  if(!family)throw new Error(pdfText('unsupportedCharacter',{character:`${character} (U+${point.toString(16).toUpperCase()})`},language));
  return `${family}-${style}`;
}

export function textRuns(value,language='de',bold=false) {
  const runs=[];
  for(const character of normalise(value)) {
    if(character==='\n'){runs.push({font:null,text:'\n'});continue;}
    const font=fontForCharacter(character,language,bold),last=runs.at(-1);
    if(last?.font===font)last.text+=character;else runs.push({font,text:character});
  }
  return runs;
}

function base64(bytes) {
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
async function fontBytes(font,language) {
  if(!cached.has(font)) {
    const pending=(async()=>{
      const response=await fetch(new URL(`./assets/pdf-fonts/${fontData[font].file}`,import.meta.url),{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('font response');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length<12||bytes[0]!==0||bytes[1]!==1||bytes[2]!==0||bytes[3]!==0)throw new Error('invalid TrueType font');
      return base64(bytes);
    })();
    cached.set(font,pending);
    pending.catch(()=>{if(cached.get(font)===pending)cached.delete(font);});
  }
  try{return await cached.get(font);}catch{throw new Error(pdfText('fontLoadFailed',{},language));}
}

export async function installPdfFonts(doc,values,language='de') {
  const fonts=new Set(['Latin-Regular','Latin-Bold']);
  for(const value of values)for(const bold of [false,true])for(const run of textRuns(value,language,bold))if(run.font)fonts.add(run.font);
  const sources=await Promise.all([...fonts].map(async font=>[font,await fontBytes(font,language)]));
  for(const [font,data] of sources){const file=fontData[font].file;doc.addFileToVFS(file,data);doc.addFont(file,font,'normal');}
}
