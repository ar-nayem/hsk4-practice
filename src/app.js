'use strict';
/* ================= helpers ================= */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rnd=n=>Math.floor(Math.random()*n);
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=rnd(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=a=>a[rnd(a.length)];
const pct=(c,a)=>a?Math.round(c/a*100):0;
const mmss=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
function day(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function addDays(ds,n){const d=new Date(ds+'T12:00:00');d.setDate(d.getDate()+n);return day(d);}
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2800);}
const hanOnly=s=>(String(s).match(/[\u3400-\u9fff]/g)||[]).join('');

/* ================= data ================= */
const WORDS=DATA.words.map(w=>{const m=/^([a-z][a-z .\/]*?):\s*(.*)$/i.exec(w.en);return{no:w.no,level:+w.level,zh:w.zh,py:w.py,en:w.en,pos:m?m[1].split('/')[0].trim().toLowerCase():'',mean:m?m[2]:w.en,parts:w.zh.split(/…+|\.{2,}/).filter(Boolean)};});
const BYNO=new Map(WORDS.map(w=>[w.no,w]));
const disp=w=>w.zh.replace(/\.{2,}/g,'…');
const DICT=new Map();WORDS.forEach(w=>{if(w.parts.length===1){if(!DICT.has(w.zh))DICT.set(w.zh,[]);DICT.get(w.zh).push(w);}});
const SENTS=DATA.sentences.map((s,i)=>{const text=s[1].replace(/\//g,'');return{id:i,no:s[0],chunks:s[1].split('/'),text,en:s[2],dlg:/[AB]：/.test(text)};});
const SBY=new Map();SENTS.forEach(s=>{if(!SBY.has(s.no))SBY.set(s.no,[]);SBY.get(s.no).push(s);});
const PASS=DATA.passages.map((p,i)=>({id:i,t:p.t,tf:p.tf||[],q:p.q||[]}));
const DLGS=DATA.dialogues.map((d,i)=>({id:i,l:d.l,q:d.q}));
const ORDS=DATA.orders.map((s,i)=>({id:i,s}));
const PICS=DATA.pictures.map((p,i)=>({id:i,w:p[0],e:p[1],m:p.slice(2)}));
const lvOf=s=>BYNO.get(s.no).level;
const BUILD_POOL=SENTS.filter(s=>!s.dlg&&s.chunks.length>=3&&s.text.length<=28);
const W1_POOL=BUILD_POOL.filter(s=>lvOf(s)>=3);
const FILL_POOL=SENTS.filter(s=>lvOf(s)>=3&&BYNO.get(s.no).parts.length===1);

const PARTS={
  L1:{sec:'Listening',n:'Part 1',cn:'判断对错',zh:'True or False',en:'Listen to a short passage and decide whether the ★ statement is true or false.',range:'1–10'},
  L2:{sec:'Listening',n:'Part 2',cn:'短对话',zh:'Short dialogues',en:'Listen to a two-line dialogue and a question, then choose the answer.',range:'11–25'},
  L3:{sec:'Listening',n:'Part 3',cn:'长对话·短文',zh:'Dialogues & talks',en:'Longer dialogues and short talks, each followed by one or two questions.',range:'26–45'},
  R1:{sec:'Reading',n:'Part 1',cn:'选词填空',zh:'Fill in the blank',en:'Choose the right word from the word bank (A–F) for each blank.',range:'46–55'},
  R2:{sec:'Reading',n:'Part 2',cn:'排列顺序',zh:'Order the sentences',en:'Put three sentences A, B, C into the correct order.',range:'56–65'},
  R3:{sec:'Reading',n:'Part 3',cn:'阅读理解',zh:'Reading comprehension',en:'Read a short passage and choose the correct answer.',range:'66–85'},
  W1:{sec:'Writing',n:'Part 1',cn:'完成句子',zh:'Make a sentence',en:'Arrange the given words into one correct sentence.',range:'86–95'},
  W2:{sec:'Writing',n:'Part 2',cn:'看图造句',zh:'Picture sentence',en:'Look at the picture and write a sentence using the given word.',range:'96–100'},
};
const VMODES={
  'zh-en':{n:'Hanzi → English',d:'See the word, pick its meaning'},
  'en-zh':{n:'English → Hanzi',d:'See the meaning, pick the word'},
  'py-zh':{n:'Pinyin → Hanzi',d:'Read pinyin, pick the characters'},
  'zh-py':{n:'Hanzi → Pinyin',d:'Pick the right pinyin — tones matter'},
  'au-zh':{n:'🔊 Listen → Hanzi',d:'Hear the word, pick the characters'},
  'au-en':{n:'🔊 Listen → English',d:'Hear the word, pick its meaning'},
  'ty-py':{n:'Type pinyin',d:'Type pinyin with tones (ài or ai4)'},
  'ty-zh':{n:'Type Hanzi',d:'See pinyin + meaning, type the word'},
  'sp':{n:'🎤 Say it aloud',d:'Read the word out loud — checked against what your phone heard'},
  'mix':{n:'Mixed',d:'A random mix of all word modes'},
};
const SMODES={
  'fill':{n:'Fill the blank',d:'Pick the missing word in a real sentence'},
  'build':{n:'Build the sentence',d:'Put word chunks in the right order (Writing part 1 style)'},
  'zh-en':{n:'Read → English',d:'Read a Chinese sentence, pick its meaning'},
  'au-en':{n:'🔊 Listen → English',d:'Hear a sentence, pick its meaning'},
  'en-zh':{n:'English → Chinese',d:'Pick the Chinese sentence that matches'},
  'dict':{n:'Dictation',d:'Hear a sentence and type it in Chinese'},
  'sp':{n:'🎤 Read aloud',d:'Read a sentence out loud — scored like dictation, but by speaking'},
  'mix':{n:'Mixed',d:'A random mix of sentence modes'},
};
function partName(c){
  if(PARTS[c])return `${PARTS[c].sec} · ${PARTS[c].zh}`;
  if(c.startsWith('v:'))return 'Words · '+(VMODES[c.slice(2)]||{n:c}).n;
  if(c.startsWith('s:'))return 'Sentences · '+(SMODES[c.slice(2)]||{n:c}).n;
  if(c==='flash')return 'Flashcards';
  return c;
}

/* ================= storage ================= */
const DEF={words:{},parts:{},seen:{},mistakes:{},mocks:[],days:{},srs:{},srsNew:{},
  settings:{rate:0.9,voiceF:'',voiceM:'',plays:1,autoplay:true,timed:true,lookup:true,examDate:'',newPerDay:20}};
let AUTH=null; // {id,email,name} once signed in — history is saved to this account, not just this browser
const authKey=()=>'hsk4cache.'+(AUTH?AUTH.id:'anon');
function mergeState(s){const base=JSON.parse(JSON.stringify(DEF));if(s&&typeof s==='object')return Object.assign(base,s,{settings:Object.assign(base.settings,s.settings||{})});return base;}
function loadCached(){try{return mergeState(JSON.parse(localStorage.getItem(authKey())||'null'));}catch(e){return mergeState(null);}}
let S=mergeState(null);
let saveT=0,syncT=0,dirty=false;
function save(){
  clearTimeout(saveT);saveT=setTimeout(()=>{try{localStorage.setItem(authKey(),JSON.stringify(S));}catch(e){}},150);
  if(AUTH){dirty=true;clearTimeout(syncT);syncT=setTimeout(syncNow,1500);}
}
async function syncNow(){ // push the current state to the account; safe to call repeatedly
  clearTimeout(syncT);if(!AUTH||!dirty)return;dirty=false;
  try{const r=await fetch('/api/progress',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({state:S})});if(!r.ok)dirty=true;}
  catch(e){dirty=true;}
}
window.addEventListener('pagehide',()=>{
  try{localStorage.setItem(authKey(),JSON.stringify(S));}catch(e){}
  if(AUTH&&dirty){try{navigator.sendBeacon('/api/progress/beacon',new Blob([JSON.stringify({state:S})],{type:'application/json'}));}catch(e){}}
});

function recordWord(no,ok){const w=S.words[no]||(S.words[no]={s:0,c:0,m:0});w.s++;if(ok){w.c++;w.m=Math.min(5,w.m+1);}else w.m=Math.max(0,w.m-1);w.t=Date.now();}
function seenKey(sp){switch(sp.k){case 'L1':case 'L3p':case 'R3':return['p',sp.id];case 'L2':case 'L3':return['d',sp.id];case 'R2':return['o',sp.id];case 'W2':return['pic',sp.id];case 's':case 'R1':case 'W1':return['s',sp.sid];}return null;}
function recordResult(q,ok){
  const P=S.parts[q.part]||(S.parts[q.part]={a:0,c:0});P.a++;if(ok)P.c++;
  if(q.wno!=null)recordWord(q.wno,ok);
  const sk=seenKey(q.spec);if(sk){const o=S.seen[sk[0]]||(S.seen[sk[0]]={});o[sk[1]]=(o[sk[1]]||0)+1;}
  const d=day();S.days[d]=(S.days[d]||0)+1;
  const key=JSON.stringify(q.spec);
  if(!ok){const m=S.mistakes[key]||(S.mistakes[key]={spec:q.spec,n:0,ok:0,sum:q.sum,part:q.part});m.n++;m.ok=0;m.t=Date.now();trimMistakes();}
  else if(S.mistakes[key]&&RUN&&RUN.mist){const m=S.mistakes[key];m.ok++;if(m.ok>=2)delete S.mistakes[key];}
  save();
}
function trimMistakes(){const k=Object.keys(S.mistakes);if(k.length<=600)return;k.sort((a,b)=>S.mistakes[a].t-S.mistakes[b].t).slice(0,k.length-600).forEach(x=>delete S.mistakes[x]);}
function pickFresh(items,n,key){const seen=S.seen[key]||{};return items.map(x=>[(seen[x.id]||0)+Math.random()*0.9,x]).sort((a,b)=>a[0]-b[0]).slice(0,n).map(p=>p[1]);}
function smartPick(pool,n){return pool.map(w=>{const s=S.words[w.no];const pr=s?s.m+Math.min(s.s,6)*0.12:-0.6;return[pr+Math.random()*2.2,w];}).sort((a,b)=>a[0]-b[0]).slice(0,n).map(p=>p[1]);}
function streak(){let d=day(),n=0;if(!S.days[d])d=addDays(d,-1);while(S.days[d]){n++;d=addDays(d,-1);}return n;}

/* ================= pinyin ================= */
const TONEMAP={};'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'.split('').forEach((c,i)=>{TONEMAP[c]=['aeiouü'[Math.floor(i/4)],i%4+1];});
const MARKS={a:'āáǎà',e:'ēéěè',i:'īíǐì',o:'ōóǒò',u:'ūúǔù','ü':'ǖǘǚǜ'};
function pyBase(p){return p.toLowerCase().split('').map(c=>TONEMAP[c]?TONEMAP[c][0]:c).join('').replace(/ü/g,'v').replace(/[^a-zv]/g,'');}
function pyTones(p){return p.split('').filter(c=>TONEMAP[c]).map(c=>TONEMAP[c][1]).join('');}
function toneVariants(p,n){
  const idx=[];p.split('').forEach((c,i)=>{if(TONEMAP[c])idx.push(i);});if(!idx.length)return[];
  const out=new Set();let g=0;
  while(out.size<n&&g++<80){const a=p.split('');const k=idx.length===1?1:1+rnd(Math.min(2,idx.length));
    shuffle(idx).slice(0,k).forEach(i=>{const[b,t]=TONEMAP[a[i]];let nt;do{nt=1+rnd(4);}while(nt===t);a[i]=MARKS[b][nt-1];});
    const v=a.join('');if(v!==p)out.add(v);}
  return[...out];
}
function normPyInput(s){s=s.toLowerCase().replace(/u:/g,'v').replace(/ü/g,'v');const t=[];let b='';
  for(const c of s){if(TONEMAP[c]){b+=TONEMAP[c][0]==='ü'?'v':TONEMAP[c][0];t.push(TONEMAP[c][1]);}else if(/[1-4]/.test(c))t.push(+c);else if(/[a-z]/.test(c))b+=c;}
  return{base:b,tones:t.join('')};}

/* ================= speech ================= */
const MALE=/Reed|Eddy|Rocko|Grandpa|Li-?mu|Yu-?shu|Kangkang|Yunxi|Yunjian|Yunyang|Male|男/i;
// Android app: its WebView has no Web Speech voices, so speech goes through the phone's own
// text-to-speech engine via the HSKNative bridge (android/src/.../MainActivity.java).
const IN_APP=!!window.HSKNative;
const SPEECH=IN_APP?(()=>{const cbs={},ls=[];let seq=0;
  window.__hskTTS=(id,ev)=>{const u=cbs[id];if(!u)return;if(ev!=='start')delete cbs[id];const f=u['on'+ev];if(f)f({});};
  window.__hskVoices=()=>ls.forEach(f=>{try{f();}catch(e){}});
  return{getVoices(){try{return JSON.parse(HSKNative.voices());}catch(e){return[];}},
    speak(u){const id=++seq;cbs[id]=u;HSKNative.speak(id,String(u.text),u.voice?u.voice.name:'',u.lang||'zh-CN',+u.rate||1,+u.pitch||1);},
    cancel(){for(const k in cbs)delete cbs[k];HSKNative.stop();},
    addEventListener(t,f){if(t==='voiceschanged')ls.push(f);}};})():(window.speechSynthesis||null);
const Utterance=IN_APP?function(t){this.text=t;}:window.SpeechSynthesisUtterance;
const TTS={list:[],tok:0,q:null,
  init(){if(!SPEECH)return;const load=()=>{this.list=SPEECH.getVoices().filter(v=>/^(zh|cmn)/i.test(v.lang)&&!/(TW|HK|MO|yue|Hant)/i.test(v.lang));if(CUR==='set'&&!RUN)RENDER.set();};
    load();try{SPEECH.addEventListener('voiceschanged',load);}catch(e){SPEECH.onvoiceschanged=load;}},
  ok(){return this.list.length>0;},
  voice(role){const want=role==='M'?S.settings.voiceM:S.settings.voiceF;const v=want&&this.list.find(x=>x.name===want);if(v)return v;
    const loc=this.list.filter(x=>x.localService);const L=loc.length?loc:this.list;if(!L.length)return null;
    const male=L.filter(x=>MALE.test(x.name)),fem=L.filter(x=>!MALE.test(x.name));
    if(role==='M')return male.find(x=>/Reed|Eddy|Li-?mu|Yunxi/i.test(x.name))||male[0]||L[1]||L[0];
    return fem.find(x=>/Ting-?ting|Xiaoxiao|Flo|Sandy|Shelley|Huihui/i.test(x.name))||fem[0]||L[0];},
  speak(lines,onend){this.stop();const tok=this.tok;const vM=this.voice('M'),vF=this.voice('F');const same=!vM||!vF||vM===vF;let i=0;
    const next=()=>{if(tok!==this.tok)return;if(i>=lines.length){this.q=null;onend&&onend();return;}
      const[r,t]=lines[i++];const male=r==='男';const u=new Utterance(t);const v=male?vM:vF;
      if(v){u.voice=v;u.lang=v.lang;}else u.lang='zh-CN';u.rate=+S.settings.rate||0.9;if(same)u.pitch=male?0.7:1.1;
      u.onend=()=>setTimeout(next,i<lines.length?450:0);u.onerror=()=>setTimeout(next,60);this.u=u;SPEECH.speak(u);};
    setTimeout(next,90);},
  stop(){this.tok++;this.q=null;try{SPEECH.cancel();}catch(e){}},
  say(t){if(this.ok())this.speak([['N',t]]);else toast('No Chinese voice found on this device.');}
};
/* ================= speech recognition (speaking practice) ================= */
// Browser path: the Web Speech API (Chrome/Edge use Google's cloud engine — needs internet, blocked in
// mainland China without a VPN; Safari uses Apple's engine, often on-device). Android app path: native
// android.speech.SpeechRecognizer via the same HSKNative bridge used for text-to-speech (see MainActivity.java) —
// works with whatever voice-input service the phone has, offline if a language pack is downloaded.
const BrowserSTT=window.SpeechRecognition||window.webkitSpeechRecognition;
const STT={listening:false,q:null,_seq:0,_res:null,_done:null,_rec:null,
  available(){if(IN_APP)return !!(window.HSKNative&&(()=>{try{return HSKNative.sttAvailable();}catch(e){return false;}})());return !!BrowserSTT;},
  start(onResult,onDone){
    if(IN_APP){
      const id=++this._seq;this._res=onResult;this._done=onDone;
      try{HSKNative.listen(id);}catch(e){onDone('error');}
      return;
    }
    if(!BrowserSTT){onDone('unavailable');return;}
    if(this._rec){try{this._rec.abort();}catch(e){}}
    const r=new BrowserSTT();r.lang='zh-CN';r.interimResults=false;r.maxAlternatives=1;
    let finished=false,err=null;
    const finish=e=>{if(finished)return;finished=true;onDone(e||err);};
    r.onresult=e=>{const t=e.results[0]&&e.results[0][0]&&e.results[0][0].transcript;if(t)onResult(t.trim());};
    r.onerror=e=>{err=e.error||'error';};
    r.onend=()=>finish();
    this._rec=r;
    try{r.start();}catch(e){finish('error');}
  },
  stop(){if(IN_APP){try{HSKNative.stopListening();}catch(e){}return;}if(this._rec)try{this._rec.stop();}catch(e){}},
};
window.__hskSTT=(id,type,text)=>{ // Android bridge: called by MainActivity.Bridge#speech(...)
  if(id!==STT._seq)return; // a stale callback from a cancelled/earlier listen
  if(type==='result'&&STT._res)STT._res(text);
  else if(type==='end'){const d=STT._done;STT._done=null;if(d)d(text||null);}
};
function sttErrMsg(err){
  if(!err)return null; // no error — recognition succeeded (or was cleanly stopped)
  const M={'not-allowed':'Microphone access was denied. Allow it for this site (or app) in your browser/phone settings and try again.',
    'permission-denied':'Microphone permission is needed — enable it in Android Settings → Apps → HSK 4 Prep → Permissions → Microphone.',
    'no-speech':'Didn’t catch that — try again a bit louder or closer to the mic.',
    'audio-capture':'No microphone found on this device.',
    'network':'Speech recognition needs an internet connection — if you’re in mainland China, try turning your VPN on.',
    'unavailable':'Speaking practice isn’t available here. Try Chrome or Safari, or check Settings for what the Android app needs.',
    'aborted':null};
  return err in M?M[err]:'Could not recognize your speech. Please try again.';
}
function speakInputHTML(q,locked){
  let h=`<div class="speak"><button class="btn ghost sm" data-act="say" data-t="${esc(q.expect)}">🔊 Hear it</button>`;
  if(!STT.available()){
    h+='<div class="warnbox" style="margin-top:10px">Speaking practice isn’t available in this browser/app. Try Chrome or Safari, or the HSK 4 Prep Android app (see Settings). You can still tap Skip.</div>';
  }else{
    const listening=STT.listening&&STT.q===q;
    h+=`<button class="mic ${listening?'rec':''}" data-act="mic" ${locked?'disabled':''}>${listening?'⏹ Listening… tap to stop':(q.user?'🎤 Record again':'🎤 Tap and speak')}</button>`;
  }
  if(q.user)h+=`<div class="heard"><span class="lab">You said</span><div class="zh" style="font-size:20px">${esc(q.user)}</div></div>`;
  return h+'</div>';
}

/* ================= distractors ================= */
function mc(correct,wrongs){const seen=new Set([correct]);const o=[{t:correct,ok:true}];for(const t of wrongs){if(o.length>=4)break;if(t&&!seen.has(t)){seen.add(t);o.push({t,ok:false});}}return shuffle(o);}
const mcList=l=>mc(l[0],l.slice(1));
const STOP=new Set('used with that this something someone somebody have which from very more other thing things time make take give into about when what your their there them they been being also only just like such each much many most well person people indicate indicating express expressing show showing kind usually often before after classifier measure word words sentence end particle'.split(' '));
function mkeys(w){if(!w._k)w._k=new Set(w.mean.toLowerCase().replace(/\([^)]*\)/g,' ').split(/[^a-z]+/).filter(x=>x.length>=4&&!STOP.has(x)));return w._k;}
function overlap(a,b){const B=mkeys(b);for(const k of mkeys(a))if(B.has(k))return true;return false;}
function distract(w,n,how){
  const wb=pyBase(w.py),wp=w.py.replace(/\s/g,'');
  let pool=WORDS.filter(x=>x.zh!==w.zh&&x.parts.length===w.parts.length&&x.mean!==w.mean&&!overlap(w,x));
  if(how!=='pos')pool=pool.filter(x=>x.py.replace(/\s/g,'')!==wp);
  const sc=x=>{let s=Math.random()*2;
    if(how==='pos'||how==='fill'){if(w.pos&&x.pos===w.pos)s+=3;if(Math.abs(x.level-w.level)<=1)s+=1;if(how==='fill'&&x.zh.length===w.zh.length)s+=1.5;}
    else if(how==='sound'){if(pyBase(x.py)===wb)s+=4;if([...x.zh].some(c=>w.zh.includes(c)))s+=2;if(x.zh.length===w.zh.length)s+=1;}
    else if(how==='look'){if([...x.zh].some(c=>w.zh.includes(c)))s+=3;if(x.zh.length===w.zh.length)s+=1;if(w.pos&&x.pos===w.pos)s+=1;}
    return s;};
  return shuffle(pool.map(x=>[sc(x),x]).sort((a,b)=>b[0]-a[0]).slice(0,Math.max(n*3,10)).map(p=>p[1])).slice(0,n);
}
function similarSents(s,n){let c=SENTS.filter(x=>x.no!==s.no&&x.dlg===s.dlg&&Math.abs(x.text.length-s.text.length)<=6);if(c.length<n)c=SENTS.filter(x=>x.no!==s.no);return shuffle(c).slice(0,n);}

/* ================= question makers ================= */
function blankOf(s,w){let t=s.text;for(const p of w.parts)t=t.replace(p,'\u0000');return t;}
function sentAudio(s){if(!s.dlg)return[['N',s.text]];return s.text.split(/(?=[AB]：)/).filter(Boolean).map(l=>[l[0]==='B'?'男':'女',l.replace(/^[AB]：/,'')]);}
function makeVocabQ(no,m){
  const w=BYNO.get(no);const q={spec:{k:'v',no,m},part:'v:'+m,wno:no,kind:'mc',sum:`${disp(w)} · ${VMODES[m].n}`};
  switch(m){
    case 'zh-en':q.big=disp(w);q.bigCls='zh';q.label='What does this word mean?';q.opts=mc(w.mean,distract(w,6,'pos').map(x=>x.mean));break;
    case 'en-zh':q.big=w.mean;q.sub=w.pos;q.label='Choose the word';q.optCls='zh';q.opts=mc(disp(w),distract(w,6,'look').map(disp));break;
    case 'py-zh':q.big=w.py;q.label='Choose the characters';q.optCls='zh';q.opts=mc(disp(w),distract(w,6,'sound').map(disp));break;
    case 'zh-py':{q.big=disp(w);q.bigCls='zh';q.label='Pick the right pinyin (watch the tones)';const tv=toneVariants(w.py,3);const ot=distract(w,4,'sound').map(x=>x.py);q.opts=mc(w.py,tv.slice(0,2).concat(ot,tv.slice(2)));break;}
    case 'au-zh':q.audio=[['N',w.parts.join('')]];q.label='Listen, then choose the word';q.optCls='zh';q.opts=mc(disp(w),distract(w,6,'sound').map(disp));break;
    case 'au-en':q.audio=[['N',w.parts.join('')]];q.label='Listen, then choose the meaning';q.opts=mc(w.mean,distract(w,6,'pos').map(x=>x.mean));break;
    case 'ty-py':q.kind='type';q.big=disp(w);q.bigCls='zh';q.label='Type the pinyin — tone marks (àihào) or numbers (ai4hao4)';q.expect=w.py;q.check='py';q.ph='e.g. ai4hao4';break;
    case 'ty-zh':q.kind='type';q.big=w.py;q.sub=w.mean;q.label='Type the word in Chinese';q.expect=w.parts.join('');q.check='zh';q.ph='Use a Chinese keyboard';break;
    case 'sp':q.kind='type';q.input='speech';q.big=disp(w);q.bigCls='zh';q.sub=`${w.py} · ${w.mean}`;q.label='Read this word out loud';q.expect=w.parts.join('');q.check='zh';break;
  }
  return q;
}
function buildOf(s){
  let ch=s.chunks.map(c=>c.trim()).filter(Boolean);let tail='';
  const last=ch[ch.length-1];const m=/[。？！?!]+$/.exec(last);
  if(m){tail=m[0];ch[ch.length-1]=last.slice(0,-tail.length);if(!ch[ch.length-1])ch.pop();}
  while(ch.length>6){const i=rnd(ch.length-1);ch.splice(i,2,ch[i]+ch[i+1]);}
  const ans=ch.join('');let order=shuffle(ch.map((_,i)=>i));
  for(let g=0;g<12&&order.map(i=>ch[i]).join('')===ans;g++)order=shuffle(order);
  return{tiles:order.map(i=>ch[i]),ansText:ans,tail};
}
function makeSentQ(sid,m,part){
  const s=SENTS[sid],w=BYNO.get(s.no);
  const q={spec:part?{k:part,sid}:{k:'s',sid,m},part:part||'s:'+m,wno:s.no,sent:sid,kind:'mc',sum:`${s.text.length>26?s.text.slice(0,26)+'…':s.text} · ${SMODES[m].n}`};
  switch(m){
    case 'fill':q.label='Choose the word that fits the blank';q.blank=blankOf(s,w);q.optCls='zh';q.opts=mc(disp(w),distract(w,8,'fill').filter(x=>!x.parts.some(p=>s.text.includes(p))).map(disp));break;
    case 'build':Object.assign(q,buildOf(s));q.kind='build';q.label='Put the words in order to make a sentence';break;
    case 'zh-en':q.bigZh=s.text;q.label='What does this sentence mean?';q.opts=mc(s.en,similarSents(s,6).map(x=>x.en));q.optsOne=true;break;
    case 'au-en':q.audio=sentAudio(s);q.label='Listen, then choose the meaning';q.opts=mc(s.en,similarSents(s,6).map(x=>x.en));q.optsOne=true;break;
    case 'en-zh':q.big=s.en;q.bigCls='en';q.label='Choose the matching Chinese';q.optCls='zh';q.opts=mc(s.text,similarSents(s,6).map(x=>x.text));q.optsOne=true;break;
    case 'dict':q.kind='type';q.audio=sentAudio(s);q.label='Listen and type what you hear (Chinese input)';q.expect=s.text;q.check='dict';q.ph='Type what you hear';break;
    case 'sp':q.kind='type';q.input='speech';q.bigZh=s.text;q.label='Read this sentence out loud';q.expect=s.text;q.check='dict';break;
  }
  return q;
}
function qL1(id,i){const p=PASS[id];return{spec:{k:'L1',id,i},part:'L1',kind:'tf',audio:[['N',p.t]],stmt:p.tf[i][0],ans:!!p.tf[i][1],sum:'★ '+p.tf[i][0]};}
function qDlg(id,part){const d=DLGS[id];return{spec:{k:part,id},part,kind:'mc',audio:d.l.concat([['Q','问：'+d.q[0]]]),opts:mcList(d.q[1]),optCls:'zh',sum:'Q: '+d.q[0]};}
function qL3p(id,i){const p=PASS[id];return{spec:{k:'L3p',id,i},part:'L3',kind:'mc',audio:[['N',p.t],['Q','问：'+p.q[i][0]]],opts:mcList(p.q[i][1]),optCls:'zh',sum:'Q: '+p.q[i][0]};}
function qR3(id,i){const p=PASS[id];return{spec:{k:'R3',id,i},part:'R3',kind:'mc',passage:p.t,question:p.q[i][0],opts:mcList(p.q[i][1]),optCls:'zh',sum:p.q[i][0]};}
function qOrder(id){const o=ORDS[id];let idx=shuffle([0,1,2]);if(idx.join('')==='012')idx=[1,2,0];
  const items=idx.map((orig,k)=>({L:'ABC'[k],t:o.s[orig],orig}));
  return{spec:{k:'R2',id},part:'R2',kind:'order',items,ans:[0,1,2].map(g=>items.find(it=>it.orig===g).L).join(''),label:'Put A, B, C in the correct order',sum:o.s[0].slice(0,28)};}
function qPic(id){const p=PICS[id];const w=WORDS.find(x=>x.zh===p.w);return{spec:{k:'W2',id},part:'W2',kind:'write',pw:p.w,emoji:p.e,models:p.m,wno:w?w.no:null,sum:'Picture sentence: '+p.w};}
function r1Group(used,dlg){
  let pool=FILL_POOL.filter(s=>!used.has(s.id)&&s.dlg===dlg);
  if(pool.length<15)pool=FILL_POOL.filter(s=>!used.has(s.id));
  const cand=pickFresh(pool,80,'s');const chosen=[],pc={};
  for(const s of cand){const w=BYNO.get(s.no);
    if(chosen.some(c=>{const cw=BYNO.get(c.no);return cw.zh.includes(w.zh)||w.zh.includes(cw.zh)||c.text.includes(w.zh)||s.text.includes(cw.zh);}))continue;
    if((pc[w.pos]||0)>=2)continue;chosen.push(s);pc[w.pos]=(pc[w.pos]||0)+1;if(chosen.length===5)break;}
  chosen.forEach(s=>used.add(s.id));
  const ws=chosen.map(s=>BYNO.get(s.no));if(!ws.length)return[];
  const extra=distract(ws[0],40,'fill').find(x=>!ws.some(w=>w.zh.includes(x.zh)||x.zh.includes(w.zh))&&!chosen.some(s=>s.text.includes(x.zh)));
  const bank=shuffle(extra?ws.concat([extra]):ws).map((w,i)=>({L:'ABCDEF'[i],zh:w.zh}));
  const group=chosen.map((s,i)=>({spec:{k:'R1',sid:s.id},part:'R1',kind:'bank',bank,ans:bank.find(b=>b.zh===ws[i].zh).L,blank:blankOf(s,ws[i]),sent:s.id,wno:s.no,sum:'Fill in the blank · '+s.text.slice(0,24)}));
  group.forEach(g=>g.group=group);return group;
}
function makeQ(sp){switch(sp.k){
  case 'v':return makeVocabQ(sp.no,sp.m);
  case 's':return makeSentQ(sp.sid,sp.m);
  case 'R1':return makeSentQ(sp.sid,'fill','R1');
  case 'W1':return makeSentQ(sp.sid,'build','W1');
  case 'L1':return qL1(sp.id,sp.i);
  case 'L2':case 'L3':return qDlg(sp.id,sp.k);
  case 'L3p':return qL3p(sp.id,sp.i);
  case 'R2':return qOrder(sp.id);
  case 'R3':return qR3(sp.id,sp.i);
  case 'W2':return qPic(sp.id);}
  return null;}

/* ================= generators ================= */
function genPart(code,n){
  switch(code){
    case 'L1':return pickFresh(PASS.filter(p=>p.tf.length),n,'p').map(p=>qL1(p.id,rnd(p.tf.length)));
    case 'L2':return pickFresh(DLGS.filter(d=>d.l.length<=2),n,'d').map(d=>qDlg(d.id,'L2'));
    case 'L3':{const ds=pickFresh(DLGS.filter(d=>d.l.length>2),Math.ceil(n*0.5),'d').map(d=>qDlg(d.id,'L3'));
      const ps=pickFresh(PASS.filter(p=>p.q.length>=2),Math.ceil((n-ds.length)/2),'p').flatMap(p=>[qL3p(p.id,0),qL3p(p.id,1)]);return ds.concat(ps).slice(0,n);}
    case 'R1':{const used=new Set(),out=[];for(let i=0;i<Math.max(1,Math.round(n/5));i++)out.push(...r1Group(used,i%2===1));return out;}
    case 'R2':return pickFresh(ORDS,n,'o').map(o=>qOrder(o.id));
    case 'R3':{const out=[];for(const p of pickFresh(PASS.filter(p=>p.q.length),n,'p')){if(out.length>=n)break;if(p.q.length>=2&&n-out.length>=2&&Math.random()<0.35)out.push(qR3(p.id,0),qR3(p.id,1));else out.push(qR3(p.id,rnd(p.q.length)));}return out;}
    case 'W1':return pickFresh(W1_POOL,n,'s').map(s=>makeSentQ(s.id,'build','W1'));
    case 'W2':return pickFresh(PICS,n,'pic').map(p=>qPic(p.id));
  }return[];
}
function genMock(size){
  const c=size==='full'?{L1:10,L2:15,L3d:10,L3p:5,R1:2,R2:10,R3a:14,R3b:3,W1:10,W2:5,tL:35,tR:40,tW:25}
                       :{L1:5,L2:8,L3d:5,L3p:2,R1:1,R2:5,R3a:7,R3b:1,W1:5,W2:3,tL:18,tR:20,tW:14};
  const used=new Set();
  const pf=(f,n)=>{const r=pickFresh(PASS.filter(p=>!used.has(p.id)&&f(p)),n,'p');r.forEach(p=>used.add(p.id));return r;};
  const l3p=pf(p=>p.q.length>=2,c.L3p),r3b=pf(p=>p.q.length>=2,c.R3b),r3a=pf(p=>p.q.length>=1,c.R3a),l1=pf(p=>p.tf.length>0,c.L1);
  const L=[...l1.map(p=>qL1(p.id,rnd(p.tf.length))),
    ...pickFresh(DLGS.filter(d=>d.l.length<=2),c.L2,'d').map(d=>qDlg(d.id,'L2')),
    ...pickFresh(DLGS.filter(d=>d.l.length>2),c.L3d,'d').map(d=>qDlg(d.id,'L3')),
    ...l3p.flatMap(p=>[qL3p(p.id,0),qL3p(p.id,1)])];
  const su=new Set();const R1=[];for(let i=0;i<c.R1;i++)R1.push(...r1Group(su,i===1));
  const R=[...R1,...pickFresh(ORDS,c.R2,'o').map(o=>qOrder(o.id)),
    ...r3a.map(p=>qR3(p.id,rnd(p.q.length))),...r3b.flatMap(p=>[qR3(p.id,0),qR3(p.id,1)])];
  const W=[...pickFresh(W1_POOL.filter(s=>!su.has(s.id)),c.W1,'s').map(s=>makeSentQ(s.id,'build','W1')),...pickFresh(PICS,c.W2,'pic').map(p=>qPic(p.id))];
  return[{name:'Listening',code:'L',time:c.tL,qs:L},{name:'Reading',code:'R',time:c.tR,qs:R},{name:'Writing',code:'W',time:c.tW,qs:W}];
}

/* ================= grading ================= */
function writeCheck(q){const t=(q.user||'').trim();const han=hanOnly(t).length;const notes=[];
  const hasW=t.includes(q.pw);if(!hasW)notes.push(`Missing the word ${q.pw} — the sentence must use it.`);
  if(han<7)notes.push('Too short — write a complete sentence (at least 7 characters).');
  if(t&&!/[。！？!?]$/.test(t))notes.push('Add end punctuation — 。？or！');
  const auto=hasW&&han>=7;return{ok:q.override!=null?q.override:auto,auto,notes};}
function lcs(a,b){const m=a.length,n=b.length,d=Array.from({length:m+1},()=>new Array(n+1).fill(0));for(let i=m-1;i>=0;i--)for(let j=n-1;j>=0;j--)d[i][j]=a[i]===b[j]?d[i+1][j+1]+1:Math.max(d[i+1][j],d[i][j+1]);
  const keep=new Set();let i=0,j=0;while(i<m&&j<n){if(a[i]===b[j]){keep.add(i);i++;j++;}else if(d[i+1][j]>=d[i][j+1])i++;else j++;}return{len:d[0][0],keep};}
function typeCheck(q){const u=(q.user||'').trim();
  if(q.check==='py'){const a=normPyInput(u),b={base:pyBase(q.expect),tones:pyTones(q.expect)};return{ok:!!u&&a.base===b.base&&a.tones===b.tones,baseOk:a.base===b.base};}
  if(q.check==='zh')return{ok:!!u&&hanOnly(u)===hanOnly(q.expect)};
  const e=hanOnly(q.expect),g=hanOnly(u);const r=lcs(e,g);return{ok:!!g&&e===g,score:pct(r.len,Math.max(e.length,g.length)),keep:r.keep,e};}
function grade(q){switch(q.kind){
  case 'mc':return q.user!=null&&!!q.opts[q.user].ok;
  case 'tf':return q.user!=null&&q.user===q.ans;
  case 'bank':return q.user===q.ans;
  case 'order':return q.user.join('')===q.ans;
  case 'build':return q.user.length===q.tiles.length&&q.user.map(i=>q.tiles[i]).join('')===q.ansText;
  case 'write':return writeCheck(q).ok;
  case 'type':return typeCheck(q).ok;}return false;}
function answered(q){switch(q.kind){case 'order':return q.user.length===3;case 'build':return q.user.length>0;case 'write':case 'type':return !!(q.user||'').trim();default:return q.user!=null;}}

/* ================= rendering helpers ================= */
function lk(t){let out='',i=0,buf='';while(i<t.length){let m=null;for(let L=5;L>=1;L--){const s=t.substr(i,L);if(s.length===L&&DICT.has(s)){m=s;break;}}
  if(m){if(buf){out+=esc(buf);buf='';}out+=`<span class="lk" data-z="${esc(m)}">${esc(m)}</span>`;i+=m.length;}else{buf+=t[i];i++;}}return out+esc(buf);}
function zhHTML(text,look,blank){const lines=/[AB]：/.test(text)?text.split(/(?=[AB]：)/):[text];
  return lines.map(l=>l.split('\u0000').map(seg=>look?lk(seg):esc(seg)).join(blank||'（　　）')).join('<br>');}
function transcriptHTML(q,look){return q.audio.map(([r,t])=>`<div>${r==='男'||r==='女'?`<span class="sp">${r}：</span>`:''}${look?lk(t):esc(t)}</div>`).join('');}
function exListHTML(no,max){return (SBY.get(no)||[]).slice(0,max||3).map(s=>`<div class="exi"><div class="zh">${zhHTML(s.text,true)} <button class="icon" data-act="say" data-t="${esc(s.text.replace(/[AB]：/g,''))}">🔊</button></div><div class="muted small">${esc(s.en)}</div></div>`).join('');}
function wordCardHTML(w){if(!w)return'';
  return `<div class="wcard"><span class="zh">${esc(disp(w))}</span><span class="py">${esc(w.py)}</span><button class="icon" data-act="say" data-t="${esc(w.parts.join(''))}" title="Listen">🔊</button><span class="tag">HSK ${w.level}</span><span class="en">${esc(w.en)}</span><div class="exs">${exListHTML(w.no,3)}</div></div>`;}
function showPop(el){const ws=DICT.get(el.dataset.z)||[];const pop=$('#pop');
  pop.innerHTML=ws.map(w=>`<div class="pw"><span class="zh">${esc(w.zh)}</span><span class="py">${esc(w.py)}</span><button class="icon" data-act="say" data-t="${esc(w.zh)}">🔊</button><span class="tag">HSK ${w.level}</span><span class="en">${esc(w.en)}</span>${(SBY.get(w.no)||[]).slice(0,2).map(s=>`<div class="pex zh">${esc(s.text)}<div class="muted small">${esc(s.en)}</div></div>`).join('')}</div>`).join('');
  pop.hidden=false;const r=el.getBoundingClientRect(),pw=pop.offsetWidth;
  pop.style.left=Math.max(8,Math.min(window.innerWidth-pw-8,r.left+r.width/2-pw/2))+window.scrollX+'px';
  const below=r.bottom+8+pop.offsetHeight<window.innerHeight;pop.style.top=(below?r.bottom+6:r.top-pop.offsetHeight-6)+window.scrollY+'px';}

/* ================= session engine ================= */
let RUN=null,CUR='home',LASTVIEW='home';
const curQ=()=>RUN&&!RUN.flash&&RUN.sections[RUN.si]?RUN.sections[RUN.si].qs[RUN.qi]:null;
const isLocked=q=>RUN.state!=='doing'||(RUN.mode==='practice'&&q.done);
function startRun(o){
  TTS.stop();const secs=o.sections.filter(s=>s.qs&&s.qs.length);
  if(!secs.length){toast('Not enough questions for this selection yet.');return;}
  let n=0;secs.forEach(s=>s.qs.forEach(q=>{q.num=++n;q.plays=0;if(q.user===undefined)q.user=(q.kind==='order'||q.kind==='build')?[]:(q.kind==='write'||q.kind==='type')?'':null;}));
  RUN=Object.assign({},o,{sections:secs,si:0,qi:0,state:'doing',t0:Date.now(),total:n});
  enterRunView();startTimer();renderRun();
}
function enterRunView(){if(CUR!=='run')LASTVIEW=CUR;CUR='run';document.body.classList.add('running');$$('.view').forEach(v=>v.hidden=v.id!=='v-run');window.scrollTo(0,0);}
function exitRun(){
  if(RUN&&RUN.state==='doing'&&RUN.mode==='exam'&&!confirm('Leave this exam? Your answers in it will be lost.'))return;
  if(RUN){clearInterval(RUN.tick);if(RUN.state==='doing'&&RUN.mode==='practice'&&!RUN.flash)RUN.sections.forEach(s=>s.qs.forEach(q=>{}));}
  TTS.stop();RUN=null;document.body.classList.remove('running');show(LASTVIEW||'home');
}
function startTimer(){clearInterval(RUN.tick);const sec=RUN.sections[RUN.si];RUN.left=(RUN.mode==='exam'&&S.settings.timed&&sec.time)?sec.time*60:null;RUN.secT0=Date.now();const R=RUN;RUN.tick=setInterval(()=>tick(R),1000);tick(R);}
function tick(R){if(R!==RUN||R.state!=='doing'){clearInterval(R.tick);return;}const el=$('#timer');
  if(R.left!=null){const left=R.left-Math.floor((Date.now()-R.secT0)/1000);if(el){el.textContent='⏱ '+mmss(Math.max(0,left));el.classList.toggle('warn',left<=300);}
    if(left<=0){toast('Time is up — section submitted.');submitSection(true);}}
  else if(el)el.textContent='⏱ '+mmss(Math.floor((Date.now()-R.t0)/1000));}
function allQs(){return RUN.sections.flatMap(s=>s.qs);}
function locate(num){RUN.sections.forEach((s,si)=>s.qs.forEach((q,qi)=>{if(q.num===num){RUN.si=si;RUN.qi=qi;}}));}

function runbarHTML(){const R=RUN,sec=R.sections[R.si];const st=R.state==='review'?' · Review':R.state==='results'?' · Results':'';
  return `<div class="runbar"><button class="btn ghost sm" data-act="exit">✕ ${R.state==='doing'?'Exit':'Close'}</button><div class="rt"><b>${esc(R.title)}</b><span>${esc(R.state==='results'?'':sec.name)}${st}</span></div>${R.state==='doing'?'<div class="timer" id="timer">⏱</div>':''}</div>`;}

function renderRun(){
  if(!RUN)return;if(RUN.state==='results')return renderResults();
  const R=RUN,sec=R.sections[R.si],q=sec.qs[R.qi];const exam=R.mode==='exam'&&R.state==='doing';const locked=isLocked(q);
  const P=PARTS[q.part];
  const done=R.mode==='exam'?sec.qs.filter(answered).length/sec.qs.length:(R.state==='review'?1:(q.num-1+(q.done?1:0))/R.total);
  let h=runbarHTML()+`<div class="prog"><i style="width:${Math.round(done*100)}%"></i></div>`;
  if(P)h+=`<div class="partinfo"><b>${P.sec} · ${P.n} ${P.zh}</b>${esc(P.en)}</div>`;
  const correct=allQs().filter(x=>x.done&&x.ok).length,did=allQs().filter(x=>x.done).length;
  h+=`<div class="card qcard"><div class="qhead"><span class="qno">${q.num}</span><span>/ ${R.total}</span>${R.mode==='practice'&&R.state==='doing'?`<span style="margin-left:auto">✓ ${correct} / ${did}</span>`:''}${R.state==='review'?`<span style="margin-left:auto" class="tag ${q.ok?'':'red'}">${q.ok?'✓ Correct':'✗ Wrong'}</span>`:''}</div>`;
  h+=bodyHTML(q,locked,exam);
  if(locked)h+=feedbackHTML(q);
  h+='</div>';
  // nav
  h+='<div class="qnav">';
  const lastInSec=R.qi===sec.qs.length-1,lastAll=lastInSec&&R.si===R.sections.length-1;
  if(R.state==='review'){h+=`<button class="btn ghost" data-act="prev" ${q.num===1?'disabled':''}>‹ Prev</button><button class="btn ghost" data-act="toresults">Results</button><button class="btn" data-act="next" ${q.num===R.total?'disabled':''}>下一题 ›</button>`;}
  else if(exam){h+=`<button class="btn ghost" data-act="prev" ${R.qi===0?'disabled':''}>‹ Prev</button>${lastInSec?'':'<button class="btn" data-act="next">Next ›</button>'}<button class="btn ${lastInSec?'':'ghost'}" data-act="submit">Submit ${esc(sec.name)}</button>`;}
  else{const needCheck=['order','build','write','type'].includes(q.kind);
    if(!q.done){if(needCheck)h+=`<button class="btn" data-act="check" ${answered(q)?'':'disabled'} id="checkbtn">Check</button>`;h+=`<button class="btn ghost" data-act="skip">Skip</button>`;}
    else h+=lastAll?`<button class="btn" data-act="finish">Finish</button>`:`<button class="btn" data-act="next">Next ›</button>`;}
  h+='</div>';
  if(exam||R.state==='review'){const qs=R.state==='review'?allQs():sec.qs;
    h+=`<div class="navgrid">${qs.map(x=>`<button data-act="goto" data-n="${x.num}" class="${x===q?'cur':''} ${R.state==='review'?(x.ok?'ok':'bad'):(answered(x)?'done':'')}">${x.num}</button>`).join('')}</div>`;}
  if(R.state==='doing')h+=`<div class="kbd">Keys: <kbd>1</kbd>–<kbd>4</kbd> choose · <kbd>Enter</kbd> next${q.audio?' · <kbd>Space</kbd> play':''}</div>`;
  $('#v-run').innerHTML=h;
  tick(R);
  const inp=$('#v-run [data-in="type"]');if(inp&&!locked)setTimeout(()=>inp.focus(),30);
  if(q.audio&&!q.plays&&R.state==='doing'&&!locked&&TTS.ok()&&S.settings.autoplay){setTimeout(()=>{if(curQ()===q&&!q.plays)playQ(q);},350);}
}
function playLimit(){return RUN&&RUN.mode==='exam'&&RUN.state==='doing'&&S.settings.plays>0?+S.settings.plays:0;}
function bodyHTML(q,locked,exam){
  let h='';const look=(!exam&&S.settings.lookup)||RUN.state==='review';
  if(q.audio){const lim=playLimit(),left=lim?lim-q.plays:null,dis=lim&&left<=0;const playing=TTS.q===q;
    h+=`<div class="audio"><button class="play" data-act="play" id="playbtn" ${dis||playing||!TTS.ok()?'disabled':''}>${!TTS.ok()?'🔇 No Chinese voice':playing?'🔊 Playing…':dis?'Played':q.plays?'↻ Replay':'▶ Play'}</button>${lim?`<span class="muted small">${Math.max(0,left)} play${left===1?'':'s'} left (exam rule)</span>`:''}${!exam&&!locked&&TTS.ok()&&!q.showTr?'<button class="link" data-act="tr">Show text</button>':''}</div>`;
    if(!locked&&(!TTS.ok()||q.showTr))h+=`<div class="tr">${transcriptHTML(q,look)}</div>`;}
  if(q.passage!=null)h+=`<div class="passage zh">${zhHTML(q.passage,look)}</div>`;
  if(q.stmt)h+=`<div class="stmt zh">★ ${look?lk(q.stmt):esc(q.stmt)}</div>`;
  if(q.question)h+=`<div class="qq zh">${look?lk(q.question):esc(q.question)}</div>`;
  if(q.kind==='write')h+=`<div class="pic">${esc(q.emoji)}</div><div class="picword">Write a sentence using <b>${esc(q.pw)}</b></div>`;
  if(q.label&&q.kind!=='write')h+=`<div class="label">${esc(q.label)}</div>`;
  if(q.big!=null)h+=`<div class="big ${q.bigCls||''}" ${q.bigCls==='en'?'style="font-size:22px;font-weight:600"':''}>${esc(q.big)}</div>`;
  if(q.sub)h+=`<div class="sub">${esc(q.sub)}</div>`;
  if(q.bigZh)h+=`<div class="bigzh zh">${zhHTML(q.bigZh,look)}</div>`;
  if(q.blank!=null&&q.kind==='mc'){const c=q.opts.find(o=>o.ok);const fill=q.user!=null?`<span class="blank fill ${locked?(q.opts[q.user].ok?'ok':'bad'):''}">${esc(q.opts[q.user].t)}</span>`:'<span class="blank">&nbsp;</span>';h+=`<div class="stem zh">${zhHTML(q.blank,look,fill)}</div>`;}
  switch(q.kind){
    case 'mc':h+=`<div class="opts ${q.optsOne?'one':''}">${q.opts.map((o,i)=>{let c='';if(locked){if(o.ok)c='ok';else if(q.user===i)c='bad';}else if(q.user===i)c='sel';
      return `<button class="opt ${c}" data-act="opt" data-i="${i}" ${locked?'disabled':''}><i>${'ABCD'[i]}</i><span class="${q.optCls||''}">${esc(o.t)}</span></button>`;}).join('')}</div>`;break;
    case 'tf':h+=`<div class="tf">${[[true,'✓ True'],[false,'✗ False']].map(([v,l])=>{let c='';if(locked){if(v===q.ans)c='ok';else if(q.user===v)c='bad';}else if(q.user===v)c='sel';return `<button class="opt ${c}" data-act="tf" data-v="${v?1:0}" ${locked?'disabled':''}>${l}</button>`;}).join('')}</div>`;break;
    case 'bank':{const usedBy={};q.group.forEach(g=>{if(g!==q&&g.user)usedBy[g.user]=1;});
      const fill=q.user?`<span class="blank fill ${locked?(q.user===q.ans?'ok':'bad'):''}">${q.user} ${esc(q.bank.find(b=>b.L===q.user).zh)}</span>`:'<span class="blank">&nbsp;</span>';
      h+=`<div class="bank">${q.bank.map(b=>`<span class="bk ${usedBy[b.L]&&!locked?'used':''}"><i>${b.L}</i><span class="zh">${esc(b.zh)}</span></span>`).join('')}</div>`;
      h+=`<div class="stem zh">${zhHTML(q.blank,look,fill)}</div>`;
      h+=`<div class="bankpick">${q.bank.map(b=>{let c='';if(locked){if(b.L===q.ans)c='ok';else if(q.user===b.L)c='bad';}else if(q.user===b.L)c='sel';return `<button class="opt sm ${c}" data-act="bank" data-l="${b.L}" ${locked?'disabled':''}><i>${b.L}</i><span class="zh">${esc(b.zh)}</span></button>`;}).join('')}</div>`;break;}
    case 'order':h+=`<div class="sents">${q.items.map(it=>{const p=q.user.indexOf(it.L);return `<button class="sent ${p>=0?'picked':''}" data-act="ord" data-l="${it.L}" ${locked?'disabled':''}><i>${it.L}</i><span class="zh">${look?lk(it.t):esc(it.t)}</span><span class="pos">${p>=0?p+1:''}</span></button>`;}).join('')}</div>
      <div class="seqline"><span class="muted small">Your order:</span>${[0,1,2].map(k=>`<span class="slot ${q.user[k]?'f':''}">${q.user[k]||''}</span>`).join('')}${!locked&&q.user.length?'<button class="link" data-act="ordreset">Reset</button>':''}</div>`;break;
    case 'build':h+=`<div class="ansline">${q.user.length?q.user.map((ti,k)=>`<button class="tl in" data-act="untile" data-k="${k}" ${locked?'disabled':''}>${esc(q.tiles[ti])}</button>`).join(''):'<span class="ph">Tap the words below in order</span>'}<span class="tail">${esc(q.tail)}</span></div>
      <div class="tilepool">${q.tiles.map((t,i)=>`<button class="tl" data-act="tile" data-i="${i}" ${locked||q.user.includes(i)?'disabled':''}>${esc(t)}</button>`).join('')}</div>${!locked&&q.user.length?'<div style="margin-top:8px"><button class="link" data-act="tilereset">Reset</button></div>':''}`;break;
    case 'write':h+=`<textarea class="zh" data-in="write" rows="3" style="font-size:20px" placeholder="Type your sentence here…" ${locked?'disabled':''}>${esc(q.user)}</textarea>`;break;
    case 'type':h+=q.input==='speech'?speakInputHTML(q,locked):`<input type="text" class="typein" data-in="type" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(q.ph||'')}" value="${esc(q.user)}" ${locked?'disabled':''}>`;break;
  }
  return h;
}
function feedbackHTML(q){
  const skipped=q.ok==null||(!q.done&&RUN.mode==='practice'&&RUN.state==='review'&&!answered(q));
  const ok=!skipped&&q.ok;
  let h=`<div class="fb ${skipped?'skip':ok?'good':'bad'}"><div class="v">${skipped?'— Not answered':ok?'✓ Correct':'✗ Not quite'}</div>`;
  switch(q.kind){
    case 'mc':if(!ok)h+=`<div>Answer: <b class="${q.optCls||''}">${esc(q.opts.find(o=>o.ok).t)}</b></div>`;break;
    case 'tf':h+=`<div>★ This statement is <b>${q.ans?'true':'false'}</b></div>`;break;
    case 'bank':if(!ok)h+=`<div>Answer: <b>${q.ans} <span class="zh">${esc(q.bank.find(b=>b.L===q.ans).zh)}</span></b></div>`;break;
    case 'order':h+=`<div>Correct order: <b>${q.ans.split('').join(' → ')}</b></div><div class="ex zh" style="font-size:18px;line-height:1.8">${lk(q.ans.split('').map(L=>q.items.find(i=>i.L===L).t).join(''))}</div>`;break;
    case 'build':if(!ok)h+=`<div>Correct sentence:</div>`;break;
    case 'write':{const r=writeCheck(q);
      if(r.notes.length)h+=`<ul class="small">${r.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`;
      h+=`<div class="lab" style="margin-top:8px">Model answers</div><ul class="models">${q.models.map(m=>`<li>${lk(m)} <button class="icon" data-act="say" data-t="${esc(m)}">🔊</button></li>`).join('')}</ul>
        <div class="small muted">Auto-check only confirms you used the word in a full sentence. Compare with the models and mark it yourself:</div>
        <div class="row" style="margin-top:8px"><button class="btn sm ${q.override===true?'':'ghost'}" data-act="override" data-v="1">✓ Mine is correct</button><button class="btn sm ${q.override===false?'':'ghost'}" data-act="override" data-v="0">✗ Has mistakes</button></div>`;break;}
    case 'type':{const r=typeCheck(q);const you=q.input==='speech'?'You said':'Yours';
      if(q.check==='dict'){const u=hanOnly(q.user);h+=`<div>Match: <b>${r.score}%</b></div><div class="zh" style="font-size:19px;line-height:1.9;margin-top:6px">Correct: ${lk(q.expect)}</div>${u?`<div class="zh" style="font-size:19px;line-height:1.9">${you}: ${[...u].map((c,i)=>esc(c)).join('')}</div>`:''}<div class="small muted">Characters you missed: <span class="zh" style="color:var(--bad);font-size:17px">${[...r.e].filter((c,i)=>!r.keep.has(i)).map(esc).join(' ')||'—'}</span></div>`;}
      else{h+=`<div>Answer: <b class="${q.check==='zh'?'zh':''}" style="font-size:20px">${esc(q.check==='py'?q.expect:disp(BYNO.get(q.wno)))}</b>${q.user?` · ${you}: <span>${esc(q.user)}</span>`:''}</div>${q.check==='py'&&!ok&&r.baseOk?'<div class="small">Letters right, tones wrong.</div>':''}`;}
      break;}
  }
  if(q.audio)h+=`<div class="lab" style="margin-top:10px">Transcript</div><div class="tr">${transcriptHTML(q,true)}</div>`;
  if(q.sent!=null&&q.kind!=='type'||q.check==='dict'){const s=SENTS[q.sent];if(s&&!(q.check==='dict'))h+=`<div class="ex"><div class="zh">${zhHTML(s.text,true)} <button class="icon" data-act="say" data-t="${esc(s.text.replace(/[AB]：/g,''))}">🔊</button></div><div class="muted">${esc(s.en)}</div></div>`;else if(s)h+=`<div class="muted" style="margin-top:6px">${esc(s.en)}</div>`;}
  if(q.wno!=null&&q.part!=='W2')h+=wordCardHTML(BYNO.get(q.wno));
  return h+'</div>';
}
function playQ(q){if(!TTS.ok()||!q.audio)return;const lim=playLimit();if(lim&&q.plays>=lim)return;q.plays++;TTS.q=q;
  const b=$('#playbtn');if(b){b.disabled=true;b.textContent='🔊 Playing…';}
  TTS.speak(q.audio,()=>{if(RUN&&curQ()===q){const b=$('#playbtn');if(b){const dis=playLimit()&&q.plays>=playLimit();b.disabled=!!dis;b.textContent=dis?'Played':'↻ Replay';}}});TTS.q=q;}
function finalize(q){if(q.done)return;q.done=true;q.ok=grade(q);recordResult(q,q.ok);renderRun();}
function submitSection(force){
  const R=RUN,sec=R.sections[R.si];const un=sec.qs.filter(q=>!answered(q)).length;
  if(!force&&!confirm(un?`${un} question(s) in this section are unanswered. Submit anyway?`:`Submit the ${sec.name} section? You can't come back to it.`))return;
  TTS.stop();sec.qs.forEach(q=>{q.ok=grade(q);});sec.submitted=true;
  if(R.si<R.sections.length-1){R.si++;R.qi=0;startTimer();window.scrollTo(0,0);renderRun();toast(`Starting ${R.sections[R.si].name}`);}
  else finishExam();
}
function scores(){const R=RUN;const sc=R.sections.map(s=>{const c=s.qs.filter(q=>q.ok).length;return{name:s.name,code:s.code,c,n:s.qs.length,score:Math.round(c/s.qs.length*100)};});
  const total=sc.reduce((a,s)=>a+s.score,0)*(3/Math.max(1,sc.length));return{sc,total:Math.round(total)};}
function finishExam(){const R=RUN;clearInterval(R.tick);TTS.stop();allQs().forEach(q=>{q.done=true;recordResult(q,q.ok);});
  R.state='results';const{sc,total}=scores();
  S.mocks.push({d:day(),size:R.size,L:(sc.find(s=>s.code==='L')||{}).score,R:(sc.find(s=>s.code==='R')||{}).score,W:(sc.find(s=>s.code==='W')||{}).score,total,sec:Math.round((Date.now()-R.t0)/1000)});
  R.mockIdx=S.mocks.length-1;save();window.scrollTo(0,0);renderResults();}
function finishPractice(){const R=RUN;clearInterval(R.tick);TTS.stop();R.state='results';R.dur=Math.round((Date.now()-R.t0)/1000);window.scrollTo(0,0);renderResults();}
function partTable(qs){const g={};qs.forEach(q=>{const k=q.part;(g[k]||(g[k]={c:0,n:0})).n++;if(q.ok)g[k].c++;});
  return `<div class="tscroll"><table class="ptab"><tbody>${Object.entries(g).map(([k,v])=>`<tr><td class="zh">${esc(partName(k))}</td><td>${v.c} / ${v.n}</td><td><div class="meter ${pct(v.c,v.n)>=60?'ok':''}"><i style="width:${pct(v.c,v.n)}%"></i></div></td></tr>`).join('')}</tbody></table></div>`;}
function renderResults(){
  const R=RUN;let h=runbarHTML();const all=allQs();
  if(R.mode==='exam'){const{sc,total}=scores();const pass=total>=180;
    h+=`<div class="card"><div class="rs-top"><div class="ring ${pass?'pass':'fail'}"><b>${total}</b><span>/ 300</span></div><div><h2 class="zh">${pass?'Passed':'Not yet'}</h2><p class="muted" style="margin:0">HSK 4 pass mark: 180 / 300.${R.size==='mini'?' Mini mock scores are scaled to the full exam.':''} ${pass?'Keep practicing the weak parts below.':`You need ${180-total} more points — drill the weakest part below.`}</p></div></div>
      <div class="secbars">${sc.map(s=>`<div class="sb"><div class="sbh"><b>${esc(s.name)}</b><span>${s.score} / 100</span></div><div class="meter ${s.score>=60?'ok':''}"><i style="width:${s.score}%"></i></div><div class="muted small">${s.c} / ${s.n} correct</div></div>`).join('')}</div>
      <h3>By part</h3>${partTable(all)}<p class="note">Writing part 2 is auto-checked (word used + full sentence). Open it in the review to compare with model answers and mark it yourself — the score updates.</p>`;}
  else{const did=all.filter(q=>q.done),c=did.filter(q=>q.ok).length,p=pct(c,did.length);
    h+=`<div class="card"><div class="rs-top"><div class="ring ${p>=60?'pass':'fail'}"><b>${p}%</b><span>${c} / ${did.length}</span></div><div><h2 class="zh">${p>=90?'Excellent!':p>=70?'Good work!':p>=50?'Keep going':'Keep practicing'}</h2><p class="muted" style="margin:0">Time ${mmss(R.dur||0)} · ${all.length-did.length} skipped. Wrong answers were added to 错题本 (Mistakes).</p></div></div>${did.length?`<h3>By part</h3>${partTable(did)}`:''}`;}
  h+=`<div class="row" style="margin-top:14px"><button class="btn" data-act="review">Review answers</button>${R.again?'<button class="btn ghost" data-act="again">New set</button>':''}<button class="btn ghost" data-act="exit">Done</button></div></div>`;
  const wrong=all.filter(q=>(R.mode==='exam'||q.done)&&!q.ok);
  if(wrong.length)h+=`<div class="card"><h3 style="margin-top:0">Wrong (${wrong.length})</h3><ol class="wlist">${wrong.map(q=>`<li><button class="link" data-act="goto" data-n="${q.num}">${q.num}. ${esc(q.sum)}</button></li>`).join('')}</ol></div>`;
  $('#v-run').innerHTML=h;
}
function updateMockAfterOverride(){const R=RUN;if(R.mode!=='exam'||R.mockIdx==null)return;const{sc,total}=scores();const m=S.mocks[R.mockIdx];if(!m)return;m.W=(sc.find(s=>s.code==='W')||{}).score;m.total=total;save();}

/* ================= flashcards ================= */
const IV=[0,1,2,4,7,15,30,60];
function srsCounts(level){const d=day();let due=0;for(const[no,c]of Object.entries(S.srs)){const w=BYNO.get(+no);if(w&&c.due<=d&&(level==='all'||w.level==level))due++;}
  const left=Math.max(0,(+S.settings.newPerDay||20)-(S.srsNew[d]||0));const avail=WORDS.filter(w=>!S.srs[w.no]&&(level==='all'||w.level==level)).length;return{due,fresh:Math.min(left,avail)};}
function startFlash(level){const d=day();
  const due=shuffle(Object.entries(S.srs).filter(([no,c])=>{const w=BYNO.get(+no);return w&&c.due<=d&&(level==='all'||w.level==level);}).map(([no])=>+no));
  const{fresh}=srsCounts(level);const fr=WORDS.filter(w=>!S.srs[w.no]&&(level==='all'||w.level==level)).sort((a,b)=>a.level-b.level||Math.random()-.5).slice(0,fresh).map(w=>w.no);
  const queue=due.concat(fr);if(!queue.length){toast('Nothing due — come back tomorrow or raise “new cards per day”.');return;}
  RUN={flash:true,title:'Flashcards',queue,i:0,shown:false,done:0,state:'doing',sections:[],t0:Date.now()};enterRunView();renderFlash();}
function renderFlash(){const F=RUN;const no=F.queue[F.i];
  let h=`<div class="runbar"><button class="btn ghost sm" data-act="exit">✕ Close</button><div class="rt"><b>Flashcards</b><span>${Math.max(0,F.queue.length-F.i)} left · ${F.done} reviewed</span></div></div><div class="prog"><i style="width:${pct(F.i,F.queue.length)}%"></i></div>`;
  if(no==null){h+=`<div class="card flash"><h2 class="zh" style="margin-top:10px">Done for now</h2><p class="muted">You reviewed ${F.done} cards. Cards come back on a spaced schedule (1, 2, 4, 7, 15, 30 days).</p><button class="btn" data-act="exit">Done</button></div>`;$('#v-run').innerHTML=h;return;}
  const w=BYNO.get(no),c=S.srs[no],exn=(SBY.get(no)||[]).length;
  h+=`<div class="card flash"><div class="qhead" style="justify-content:center"><span class="tag">HSK ${w.level}</span>${c?`<span class="tag">box ${c.b}</span>`:'<span class="tag red">new</span>'}</div><div class="front">${esc(disp(w))}</div>`;
  if(!F.shown)h+=`<button class="btn" data-act="flshow" style="min-width:220px">Show answer <span class="small" style="opacity:.7">(Space)</span></button>`;
  else{h+=`<div class="back"><div class="py">${esc(w.py)} <button class="icon" data-act="say" data-t="${esc(w.parts.join(''))}">🔊</button></div><div class="en">${esc(w.en)}</div>${exn?`<div class="ex">${exListHTML(no,3)}</div>`:''}
    <div class="grades"><button data-act="flg" data-g="0">Again<small>key 1</small></button><button data-act="flg" data-g="1">Hard<small>key 2</small></button><button data-act="flg" data-g="2">Good<small>key 3</small></button><button data-act="flg" data-g="3">Easy<small>key 4</small></button></div></div>`;}
  $('#v-run').innerHTML=h+'</div>';
  if(F.shown&&TTS.ok()&&!F.spoke){F.spoke=true;TTS.say(w.parts.join(''));}}
function flashGrade(g){const F=RUN,no=F.queue[F.i],d=day();let c=S.srs[no];const isNew=!c;if(!c)c=S.srs[no]={b:0,due:d};
  if(g===0){c.b=0;c.due=d;F.queue.splice(Math.min(F.queue.length,F.i+4),0,no);}
  else if(g===1){c.b=Math.max(1,c.b);c.due=addDays(d,1);}
  else{c.b=Math.min(IV.length-1,c.b+(g===3?2:1));c.due=addDays(d,IV[c.b]);}
  if(isNew)S.srsNew[d]=(S.srsNew[d]||0)+1;
  recordWord(no,g>0);const P=S.parts.flash||(S.parts.flash={a:0,c:0});P.a++;if(g>0)P.c++;S.days[d]=(S.days[d]||0)+1;
  F.i++;F.done++;F.shown=false;F.spoke=false;save();renderFlash();}

/* ================= starters ================= */
function startMock(size){startRun({title:size==='full'?'HSK 4 · Full mock exam':'HSK 4 · Mini mock',mode:'exam',size,sections:genMock(size),again:()=>startMock(size)});}
function startPart(code,n){const P=PARTS[code];startRun({title:`${P.sec} · ${P.zh}`,mode:'practice',sections:[{name:P.sec+' · '+P.zh,qs:genPart(code,n)}],again:()=>startPart(code,n)});}
function startMixedParts(n){const codes=Object.keys(PARTS);const qs=[];codes.forEach(c=>qs.push(...genPart(c,Math.max(1,Math.round(n/codes.length)))));startRun({title:'Mixed practice',mode:'practice',sections:[{name:'Mixed',qs}],again:()=>startMixedParts(n)});}
function vocabPool(level,filter){let pool=WORDS.filter(w=>level==='all'||w.level==level);
  if(filter==='weak')pool=pool.filter(w=>{const s=S.words[w.no];return s&&s.s>0&&(s.m<3||s.c/s.s<0.7);});
  if(filter==='new')pool=pool.filter(w=>!S.words[w.no]);return pool;}
function startVocab(m,level,n,filter){const pool=vocabPool(level,filter);if(!pool.length){toast(filter==='weak'?'No weak words yet — practice some first.':'No words match.');return;}
  const modes=Object.keys(VMODES).filter(k=>k!=='mix'&&(TTS.ok()||!k.startsWith('au'))&&(STT.available()||k!=='sp'));
  const qs=smartPick(pool,n).map(w=>makeVocabQ(w.no,m==='mix'?pick(modes):m));
  startRun({title:'Words · '+VMODES[m].n,mode:'practice',sections:[{name:'Words',qs}],again:()=>startVocab(m,level,n,filter)});}
function startSent(m,level,n){const modes=Object.keys(SMODES).filter(k=>k!=='mix'&&(TTS.ok()||!['au-en','dict'].includes(k))&&(STT.available()||k!=='sp'));
  let base=(m==='build'?BUILD_POOL:m==='fill'?SENTS.filter(s=>BYNO.get(s.no).parts.every(p=>s.text.includes(p))):SENTS).filter(s=>level==='all'||lvOf(s)==level);
  if(m==='dict')base=base.filter(s=>!s.dlg&&s.text.length<=22);
  if(!base.length){toast('No sentences for this level yet.');return;}
  const qs=pickFresh(base,n,'s').map(s=>{let mm=m==='mix'?pick(modes):m;if(mm==='build'&&(s.dlg||s.chunks.length<3))mm='fill';if(mm==='dict'&&s.dlg)mm='au-en';return makeSentQ(s.id,mm);});
  startRun({title:'Sentences · '+SMODES[m].n,mode:'practice',sections:[{name:'Sentences',qs}],again:()=>startSent(m,level,n)});}
function startMistakes(part){let ms=Object.values(S.mistakes);if(part&&part!=='all')ms=ms.filter(m=>m.part===part||(part==='v'&&m.part.startsWith('v:'))||(part==='s'&&m.part.startsWith('s:')));
  if(!ms.length){toast('No mistakes here — nice!');return;}
  ms.sort((a,b)=>(b.n-b.ok)-(a.n-a.ok)||b.t-a.t);const qs=ms.slice(0,20).map(m=>makeQ(m.spec)).filter(Boolean);
  qs.forEach(q=>{if(q.kind==='bank')Object.assign(q,makeSentQ(q.sent,'fill','R1'));});
  startRun({title:'Mistake review',mode:'practice',mist:true,sections:[{name:'Mistakes',qs}],again:()=>startMistakes(part)});}

/* ================= views ================= */
const RENDER={};
function show(v){
  if((!AUTH||!AUTH.verified)&&v!=='auth')v='auth';
  if(v==='admin'&&(!AUTH||!AUTH.admin))v='home';
  if(RUN&&v!=='run'){exitRun();if(RUN)return;}
  CUR=v;$$('.view').forEach(x=>x.hidden=x.id!=='v-'+v);
  $$('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.go===v));
  const onBtn=$('#nav button.on');if(onBtn&&onBtn.scrollIntoView)onBtn.scrollIntoView({inline:'center',block:'nearest'}); // keep the active tab visible in the scrolling nav
  if(RENDER[v])RENDER[v]();
  window.scrollTo(0,0);
  if(v!=='auth'){try{localStorage.setItem(TABKEY,v);}catch(e){}}
}
function wordBands(ws){const g=w=>S.words[w.no];let m=0,al=0,lg=0;
  for(const w of ws){const s=g(w);if(!s||!s.s)continue;if(s.m>=4)m++;else if(s.m===3)al++;else lg++;}
  return{m,al,lg,nw:ws.length-m-al-lg};}
const MASTERY_HELP=`<details class="howm"><summary>How mastery works</summary><ul>
  <li>Every word has a score from <b>0 to 5</b>, shown as dots (<span class="dots"><b>●●●</b>●●</span>) in the Word list.</li>
  <li><b>+1</b> when you get it right: a word quiz, a sentence, fill-in-the-blank or build-the-sentence question using that word, or a flashcard marked Hard, Good or Easy.</li>
  <li><b>−1</b> when you get it wrong, or mark a flashcard <b>Again</b>.</li>
  <li><b>Mastered</b> = score 4–5 · <b>Almost</b> = score 3 · <b>Learning</b> = practiced, score 0–2 · <b>New</b> = not practiced yet.</li>
  <li>So a word needs about <b>4 correct answers</b> to be mastered. Flashcards bring words back after 1, 2, 4, 7… days, so scores rise over days, not in one session.</li>
  <li>Mock-exam listening and reading questions test whole passages, so they don't change word scores.</li></ul></details>`;
function statsBlock(){const P=Object.values(S.parts);const a=P.reduce((x,p)=>x+p.a,0),c=P.reduce((x,p)=>x+p.c,0);const B=wordBands(WORDS);
  return `<div class="stats"><div class="stat"><span>Answered</span><b>${a.toLocaleString()}</b></div><div class="stat"><span>Accuracy</span><b>${pct(c,a)}%</b></div><div class="stat"><span>Day streak</span><b>${streak()}</b></div><div class="stat"><span>Mastered</span><b>${B.m}<small class="muted" style="font-size:13px"> / 1200</small></b><em class="sub2">${B.al} almost · ${B.lg} learning</em></div></div>${MASTERY_HELP}`;}
function fmtTable(){return `<table class="fmt"><tbody>
  <tr><td>Listening (听力)</td><td>45 Q · ~30 min</td><td>True/False · Short dialogues · Dialogues &amp; talks</td></tr>
  <tr><td>Reading (阅读)</td><td>40 Q · 40 min</td><td>Fill in the blank · Order sentences · Comprehension</td></tr>
  <tr><td>Writing (书写)</td><td>15 Q · 25 min</td><td>Make a sentence · Picture sentence</td></tr>
  <tr><td>Pass mark</td><td>180 / 300</td><td>Each section is scored out of 100.</td></tr></tbody></table>`;}
RENDER.home=()=>{const{due,fresh}=srsCounts('all');const nm=Object.keys(S.mistakes).length;const last=S.mocks[S.mocks.length-1];
  let days=null;if(S.settings.examDate){days=Math.round((new Date(S.settings.examDate+'T12:00:00')-new Date(day()+'T12:00:00'))/864e5);}
  $('#v-home').innerHTML=`<div class="hero"><div><h1>Get ready for HSK 4, step by step.</h1><p>Full mock exams in the official format, part-by-part drills, 1,200-word training and sentence practice. Your progress is saved to your account — continue on any device.</p></div>
    ${days!=null&&days>=0?`<div class="count"><b>${days}</b><span>days to exam</span></div>`:'<button class="btn ghost sm" data-go="set">📅 Set exam date</button>'}</div>
  <div class="tiles">
    <button class="tile" data-act="mock" data-size="full"><span class="ch">考</span><b>Full mock exam</b><span>Full mock exam · 100 questions · 105 min, timed like the real test</span><span class="n">Start ›</span></button>
    <button class="tile" data-act="mock" data-size="mini"><span class="ch">试</span><b>Mini mock</b><span>Mini mock · ~50 questions · 52 min, same structure</span><span class="n">Start ›</span></button>
    <button class="tile" data-act="flash" data-level="all"><span class="ch">词</span><b>Flashcards</b><span>Spaced-repetition flashcards for all 1,200 words</span><span class="n">${due} due · ${fresh} new</span></button>
    <button class="tile" data-act="mist" data-part="all"><span class="ch">错</span><b>Mistake review</b><span>Redo questions you got wrong until you get them right twice</span><span class="n">${nm} to review</span></button>
  </div>
  <div id="lbhome"></div>
  <div class="grid2"><div class="card"><h2>Snapshot</h2>${statsBlock()}
    <p class="muted" style="margin:12px 0 0">${last?`Last mock (${last.d}): <b style="color:var(--ink)">${last.total}/300</b> — Listening ${last.L} · Reading ${last.R} · Writing ${last.W}`:'No mock exam yet — try the mini mock to get a baseline score.'}</p></div>
    <div class="card"><h2>HSK 4 exam format</h2>${fmtTable()}</div></div>
  <div class="card"><h2>How to prepare with this</h2><ol style="margin:0;padding-left:20px;line-height:1.9">
    <li><b>Baseline:</b> take a mini mock to see which section is weakest.</li>
    <li><b>Every day:</b> flashcards (~15 min) + one part drill for your weakest part.</li>
    <li><b>Twice a week:</b> a sentence session — sentence-building and word-bank drills build writing and reading accuracy.</li>
    <li><b>Every weekend:</b> a full timed mock, then redo your mistakes.</li>
    <li>Tap any Chinese word in answers and texts to see its pinyin and meaning.</li></ol></div>`;};
RENDER.mock=()=>{const H=S.mocks.slice(-14);
  $('#v-mock').innerHTML=`<div class="grid2"><div class="card pcard"><div class="ph"><b>Full mock</b><span class="tag red">100 Q</span></div><p>Listening 45 · Reading 40 · Writing 15. Timed per section (35 / 40 / 25 min). Every mock is freshly assembled from the question bank, preferring items you haven't seen.</p><div class="row"><button class="btn" data-act="mock" data-size="full">Start</button></div></div>
    <div class="card pcard"><div class="ph"><b>Mini mock</b><span class="tag">~50 Q</span></div><p>Same structure at half length (18 / 20 / 14 min). Good for weekdays. Score is scaled to /300.</p><div class="row"><button class="btn" data-act="mock" data-size="mini">Start</button></div></div></div>
  <div class="card"><h2>Exam rules</h2>
    <div class="set-row"><div class="d"><b>Timed sections</b><span>Auto-submit when a section's time runs out.</span></div><select data-set="timed"><option value="1" ${S.settings.timed?'selected':''}>On</option><option value="0" ${S.settings.timed?'':'selected'}>Off</option></select></div>
    <div class="set-row"><div class="d"><b>Listening plays</b><span>The real HSK 4 plays each recording once.</span></div><select data-set="plays"><option value="1" ${S.settings.plays==1?'selected':''}>1 (official)</option><option value="2" ${S.settings.plays==2?'selected':''}>2</option><option value="0" ${S.settings.plays==0?'selected':''}>Unlimited</option></select></div>
    ${TTS.ok()?'':'<div class="warnbox">No Chinese (zh-CN) voice found in this browser, so listening questions will show the transcript instead of audio. On Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → Chinese (China mainland).</div>'}</div>
  <div class="card"><h2>Score history</h2>${H.length?`<div class="hist"><div class="line" style="bottom:${180/300*100}%"><span>180 pass</span></div>${H.map(m=>`<div class="col ${m.total>=180?'pass':''}" title="${m.d} · ${m.total}"><span>${m.total}</span><i style="height:${Math.max(4,m.total/300*100)}%"></i></div>`).join('')}</div>
    <div class="tscroll"><table style="margin-top:10px"><thead><tr><th>Date</th><th>Type</th><th>Listen</th><th>Read</th><th>Write</th><th>Total</th></tr></thead><tbody>${S.mocks.slice().reverse().slice(0,20).map(m=>`<tr><td>${m.d}</td><td>${m.size==='full'?'Full':'Mini'}</td><td>${m.L??'—'}</td><td>${m.R??'—'}</td><td>${m.W??'—'}</td><td><b style="color:${m.total>=180?'var(--ok)':'var(--accent)'}">${m.total}</b></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No mock exams yet.</div>'}</div>`;};
RENDER.parts=()=>{const secs={'Listening':['L1','L2','L3'],'Reading':['R1','R2','R3'],'Writing':['W1','W2']};
  let h=`<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h2 style="margin:0">Practice by part</h2><span class="muted">Instant feedback, transcripts and explanations after every question.</span></div><div class="row"><select id="mixn"><option>16</option><option selected>24</option><option>40</option></select><button class="btn" data-act="mixparts">Mixed set</button></div></div>`;
  for(const[name,codes]of Object.entries(secs)){h+=`<div class="sechead"><h2>${name}</h2></div><div class="grid3">`;
    for(const c of codes){const P=PARTS[c],st=S.parts[c]||{a:0,c:0};h+=`<div class="card pcard"><div class="ph"><b>${P.zh}</b><span class="tag">Q ${P.range}</span></div><p>${esc(P.en)}</p>
      <div class="muted small">${st.a?`${st.c}/${st.a} correct · ${pct(st.c,st.a)}%`:'Not practiced yet'}</div><div class="meter ${pct(st.c,st.a)>=60?'ok':''}"><i style="width:${pct(st.c,st.a)}%"></i></div>
      <div class="row"><select id="n-${c}">${(c==='R1'?[5,10,20]:c==='W2'?[3,5,10]:[5,10,20]).map((n,i)=>`<option ${i===1?'selected':''}>${n}</option>`).join('')}</select><button class="btn sm" data-act="part" data-code="${c}">Practice</button></div></div>`;}
    h+='</div>';}
  $('#v-parts').innerHTML=h;};
let VSEL={m:'zh-en',level:'4',n:'20',filter:'smart'},SSEL={m:'fill',level:'4',n:'15'},FLV='all';
RENDER.vocab=()=>{const lvOpts=sel=>['all','1','2','3','4'].map(l=>`<option value="${l}" ${sel==l?'selected':''}>${l==='all'?'All levels':'HSK '+l}</option>`).join('');const{due,fresh}=srsCounts(FLV);
  $('#v-vocab').innerHTML=`<div class="card"><h2>Flashcards <span class="tag red">spaced repetition</span></h2><p class="muted" style="margin-top:0">Rate each card honestly — words you forget come back sooner, words you know come back later.</p>
    <div class="row"><div class="field"><label>Deck</label><select id="flv">${lvOpts(FLV)}</select></div><div class="field"><label>New cards / day (1–1200)</label><input type="number" data-set="newPerDay" min="1" max="1200" step="1" value="${S.settings.newPerDay}" style="width:120px"></div><div class="field"><label>Quick set</label><div class="chips">${[20,50,100,300,1200].map(n=>`<button class="chip ${S.settings.newPerDay==n?'on':''}" data-act="npd" data-n="${n}">${n===1200?'All 1200':n}</button>`).join('')}</div></div><button class="btn" data-act="flash">Review · ${due} due + ${fresh} new</button></div></div>
  <div class="card"><h2>Word quiz</h2><div class="chips" id="vmodes">${Object.entries(VMODES).map(([k,v])=>`<button class="chip ${VSEL.m===k?'on':''}" data-act="vm" data-m="${k}" title="${esc(v.d)}">${esc(v.n)}</button>`).join('')}</div>
    <p class="muted small">${esc(VMODES[VSEL.m].d)}</p>
    <div class="row"><div class="field"><label>Level</label><select id="vlv">${lvOpts(VSEL.level)}</select></div><div class="field"><label>Questions</label><select id="vn">${[10,20,30,50].map(n=>`<option ${VSEL.n==n?'selected':''}>${n}</option>`).join('')}</select></div>
    <div class="field"><label>Words</label><select id="vf"><option value="smart" ${VSEL.filter==='smart'?'selected':''}>Smart (new + weak first)</option><option value="weak" ${VSEL.filter==='weak'?'selected':''}>Only weak words</option><option value="new" ${VSEL.filter==='new'?'selected':''}>Only never practiced</option></select></div>
    <button class="btn" data-act="vstart">Start</button></div></div>
  <div class="card"><h2>Mastery by level</h2>${masteryBars()}</div>`;};
function masteryBars(help=true){
  const legend=`<div class="mlegend small muted"><span><i style="background:var(--ok)"></i>Mastered (4–5)</span><span><i style="background:var(--almost)"></i>Almost (3)</span><span><i style="background:var(--warn)"></i>Learning (0–2)</span><span><i style="background:var(--soft);box-shadow:inset 0 0 0 1px var(--line)"></i>New</span></div>`;
  return legend+[1,2,3,4].map(l=>{const ws=WORDS.filter(w=>w.level===l);const B=wordBands(ws);
  return `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap" class="small"><b>HSK ${l}</b><span class="muted">${B.m} mastered · ${B.al} almost · ${B.lg} learning · ${B.nw} new</span></div><div class="meter" style="display:flex"><i style="width:${B.m/ws.length*100}%;background:var(--ok);border-radius:0"></i><i style="width:${B.al/ws.length*100}%;background:var(--almost);border-radius:0"></i><i style="width:${B.lg/ws.length*100}%;background:var(--warn);border-radius:0"></i></div></div>`;}).join('')+(help?MASTERY_HELP:'');}
RENDER.sent=()=>{const lvOpts=sel=>['all','1','2','3','4'].map(l=>`<option value="${l}" ${sel==l?'selected':''}>${l==='all'?'All levels':'HSK '+l+' words'}</option>`).join('');
  $('#v-sent').innerHTML=`<div class="card"><h2>Sentence practice</h2><p class="muted" style="margin-top:0">${SENTS.length.toLocaleString()} example sentences — one or more for every HSK 1–4 word. Great for Reading part 1 and Writing part 1.</p>
    <div class="chips">${Object.entries(SMODES).map(([k,v])=>`<button class="chip ${SSEL.m===k?'on':''}" data-act="sm" data-m="${k}">${esc(v.n)}</button>`).join('')}</div><p class="muted small">${esc(SMODES[SSEL.m].d)}</p>
    <div class="row"><div class="field"><label>Level</label><select id="slv">${lvOpts(SSEL.level)}</select></div><div class="field"><label>Questions</label><select id="sn">${[10,15,20,30].map(n=>`<option ${SSEL.n==n?'selected':''}>${n}</option>`).join('')}</select></div><button class="btn" data-act="sstart">Start</button></div></div>
  <div class="card"><h2>By mode</h2>${Object.keys(SMODES).filter(k=>k!=='mix').map(k=>{const st=S.parts['s:'+k]||{a:0,c:0};return `<div style="margin:8px 0"><div class="small" style="display:flex;justify-content:space-between"><b>${esc(SMODES[k].n)}</b><span class="muted">${st.a?`${st.c}/${st.a} · ${pct(st.c,st.a)}%`:'—'}</span></div><div class="meter ${pct(st.c,st.a)>=60?'ok':''}"><i style="width:${pct(st.c,st.a)}%"></i></div></div>`;}).join('')}</div>`;};
RENDER.mist=()=>{const ms=Object.entries(S.mistakes).sort((a,b)=>b[1].t-a[1].t);const by={};ms.forEach(([k,m])=>{const g=m.part.startsWith('v:')?'v':m.part.startsWith('s:')?'s':m.part;by[g]=(by[g]||0)+1;});
  const names={v:'Words',s:'Sentences'};
  $('#v-mist').innerHTML=`<div class="card"><h2>Mistake notebook</h2><p class="muted" style="margin-top:0">Every wrong answer lands here. In review, a question leaves the notebook after you get it right twice in a row.</p>
    <div class="row"><button class="btn" data-act="mist" data-part="all" ${ms.length?'':'disabled'}>Review all (${ms.length})</button>${Object.entries(by).map(([g,n])=>`<button class="btn ghost sm" data-act="mist" data-part="${g}">${esc(PARTS[g]?PARTS[g].sec+PARTS[g].zh:names[g]||g)} · ${n}</button>`).join('')}</div></div>
  <div class="card">${ms.length?`<div class="tscroll"><table><thead><tr><th>Question</th><th>Part</th><th>Wrong</th><th></th></tr></thead><tbody>${ms.slice(0,150).map(([k,m])=>`<tr><td class="zh">${esc(m.sum||'')}</td><td class="small muted">${esc(partName(m.part))}</td><td>${m.n}×</td><td><button class="icon" data-act="mdel" data-k="${esc(k)}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table></div>${ms.length>150?`<p class="muted small">Showing 150 of ${ms.length}.</p>`:''}<div style="margin-top:12px"><button class="link" data-act="mclear">Clear all</button></div>`:'<div class="empty">错题本是空的 — nothing to review yet.</div>'}</div>`;};
let WQ={q:'',lv:'all',lim:120,open:null};
RENDER.words=()=>{
  $('#v-words').innerHTML=`<div class="card"><div class="row"><div class="field" style="flex:1"><label>Search</label><input type="search" id="wq" placeholder="Hanzi, pinyin (with or without tones), English, or number" value="${esc(WQ.q)}"></div><div class="field"><label>Level</label><select id="wlv">${['all','1','2','3','4'].map(l=>`<option value="${l}" ${WQ.lv==l?'selected':''}>${l==='all'?'All':'HSK '+l}</option>`).join('')}</select></div></div></div><div class="card" id="wlist"></div>`;
  renderWordList();};
function renderWordList(){const q=WQ.q.trim().toLowerCase(),qb=pyBase(q);
  const list=WORDS.filter(w=>(WQ.lv==='all'||w.level==WQ.lv)&&(!q||w.zh.includes(q)||String(w.no)===q||w.en.toLowerCase().includes(q)||w.py.toLowerCase().replace(/\s/g,'').includes(q.replace(/\s/g,''))||(qb&&/^[a-z]+$/.test(q)&&pyBase(w.py).startsWith(qb))));
  const dots=no=>{const m=(S.words[no]||{}).m||0;return `<span class="dots" title="Mastery score ${m}/5${m>=4?' — mastered':m===3?' — almost':''}">${'<b>●</b>'.repeat(m)}${'●'.repeat(5-m)}</span>`;};
  $('#wlist').innerHTML=`<div class="muted small" style="margin-bottom:8px">${list.length} words · tap a row for example sentences</div>${list.length?`<div class="tscroll"><table class="wtab"><thead><tr><th>#</th><th>HSK</th><th>汉字</th><th>拼音</th><th>English</th><th>掌握</th></tr></thead><tbody>${list.slice(0,WQ.lim).map(w=>{const ex=SBY.get(w.no)||[];
    return `<tr data-act="wrow" data-no="${w.no}"><td class="muted">${w.no}</td><td><span class="tag">${w.level}</span></td><td class="zh">${esc(disp(w))} <button class="icon" data-act="say" data-t="${esc(w.parts.join(''))}">🔊</button></td><td><b>${esc(w.py)}</b></td><td>${esc(w.en)}</td><td>${dots(w.no)}</td></tr>${WQ.open===w.no?`<tr class="x"><td></td><td colspan="5">${ex.length?ex.map(s=>`<div class="zh" style="font-size:17px">${zhHTML(s.text,true)} <button class="icon" data-act="say" data-t="${esc(s.text.replace(/[AB]：/g,''))}">🔊</button></div><div class="muted">${esc(s.en)}</div>`).join(''):'<span class="muted">No example sentence yet.</span>'}</td></tr>`:''}`;}).join('')}</tbody></table></div>${list.length>WQ.lim?`<div style="text-align:center;margin-top:12px"><button class="btn ghost" data-act="wmore">Show more (${list.length-WQ.lim})</button></div>`:''}`:'<div class="empty">No words found.</div>'}`;}
RENDER.prog=()=>{const H=S.mocks;const best=H.length?Math.max(...H.map(m=>m.total)):null;
  const rows=Object.keys(PARTS).map(c=>[c,S.parts[c]||{a:0,c:0}]);
  $('#v-prog').innerHTML=`<div class="card"><h2>Overview</h2>${statsBlock()}<p class="muted" style="margin:12px 0 0">${H.length?`Mocks taken: ${H.length} · best ${best}/300 · latest ${H[H.length-1].total}/300`:'No mock exam taken yet.'}</p></div>
  <div class="grid2"><div class="card"><h2>Exam parts</h2>${rows.map(([c,st])=>`<div style="margin:9px 0"><div class="small" style="display:flex;justify-content:space-between"><b class="zh">${esc(partName(c))}</b><span class="muted">${st.a?`${st.c}/${st.a} · ${pct(st.c,st.a)}%`:'—'}</span></div><div class="meter ${pct(st.c,st.a)>=60?'ok':''}"><i style="width:${pct(st.c,st.a)}%"></i></div></div>`).join('')}
    <p class="note">Weakest part: <b>${(()=>{const t=rows.filter(r=>r[1].a>=5).sort((a,b)=>a[1].c/a[1].a-b[1].c/b[1].a)[0];return t?esc(partName(t[0])):'practice more to find out';})()}</b></p></div>
    <div class="card"><h2>Word mastery</h2>${masteryBars(false)}<h3>Word quiz modes</h3>${Object.keys(VMODES).filter(k=>k!=='mix').map(k=>{const st=S.parts['v:'+k]||{a:0,c:0};return `<div class="small" style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line)"><span>${esc(VMODES[k].n)}</span><span class="muted">${st.a?`${st.c}/${st.a} · ${pct(st.c,st.a)}%`:'—'}</span></div>`;}).join('')}</div></div>
  <div class="card"><h2>Last 30 days</h2><div class="hist" style="height:110px">${Array.from({length:30},(_,i)=>{const d=addDays(day(),i-29),n=S.days[d]||0;return `<div class="col" style="flex:1 0 12px" title="${d}: ${n}"><i style="height:${Math.min(100,n/2)}%;min-height:${n?3:0}px;background:var(--sel)"></i></div>`;}).join('')}</div><p class="note">Bar height = questions answered that day.</p></div>`;};
RENDER.set=()=>{const vs=TTS.list;const vopt=sel=>`<option value="">Automatic</option>`+vs.map(v=>`<option value="${esc(v.name)}" ${v.name===sel?'selected':''}>${esc(v.name)} (${esc(v.lang)}${v.localService?', offline':''})</option>`).join('');
  $('#v-set').innerHTML=`<div class="card"><h2>Account</h2>
    <div class="set-row"><div class="d"><b>${esc(AUTH?AUTH.name:'')}</b><span>${esc(AUTH?AUTH.email:'')} · your history is saved to this account</span></div><button class="btn ghost sm" data-act="signout">Sign out</button></div>
    <div class="set-row"><div class="d"><b>Delete account</b><span>Permanently deletes your account and all practice history. This cannot be undone.</span></div>${DELOPEN?'':'<button class="btn ghost sm" data-act="delopen" style="color:var(--bad)">Delete account</button>'}</div>
    ${DELOPEN?`<form id="delform" class="authform" style="max-width:420px;margin-top:4px"><div class="field"><label>Enter your password to confirm</label><input type="password" id="del-pass" autocomplete="current-password" required></div>${DELERR?`<div class="autherr" style="margin:0">${esc(DELERR)}</div>`:''}<div class="row"><button class="btn" type="submit" id="delsubmit" style="background:var(--bad);color:#fff">Delete my account permanently</button><button class="btn ghost" type="button" data-act="delcancel">Cancel</button></div></form>`:''}</div>
  ${IN_APP?'':`<div class="card"><h2>Android app</h2><p class="muted" style="margin-top:0">Install HSK 4 Prep as an app on Android phones: it opens full-screen, stays signed in, and uses the phone's own Chinese voice for listening questions.</p>
    <a class="btn" href="/download/hsk4-prep.apk" style="text-decoration:none">Download for Android (APK)</a>
    <ol class="small muted" style="margin:12px 0 0;padding-left:18px;line-height:1.8"><li>Open this page on your Android phone and tap Download.</li><li>Open the downloaded file. When Android asks, allow “Install unknown apps” for your browser.</li><li>Huawei, Xiaomi, OPPO, vivo: if the install is blocked, turn off “Pure mode” (纯净模式) in Settings first.</li><li>Inside WeChat, tap ··· → “Open in browser” first. WeChat blocks APK downloads.</li></ol></div>`}
  <div class="card"><h2>Leaderboard</h2><p class="muted" style="margin-top:0">Other signed-in learners see your display name and points on the daily and weekly leaderboards — never your email.</p>
    <div class="row"><div class="field" style="flex:1;min-width:200px"><label>Display name</label><input type="text" id="lbname" maxlength="40" value="${esc(AUTH?AUTH.name:'')}" autocomplete="nickname"></div><button class="btn sm" data-act="savename">Save name</button></div>
    <div class="set-row"><div class="d"><b>Show me on the leaderboard</b><span>Turn off to hide yourself from everyone else’s list. Your points keep counting and come back if you turn it on again.</span></div><select id="lbvis"><option value="1" ${AUTH&&AUTH.leaderboard?'selected':''}>On</option><option value="0" ${AUTH&&AUTH.leaderboard?'':'selected'}>Off</option></select></div></div>
  <div class="card"><h2>Speaking practice</h2><p class="muted" style="margin-top:0">Reads a word or sentence back through your phone's speech recognition and compares it to the correct answer — it checks whether what you said was understood correctly, not your tones or accent directly.</p>
    ${STT.available()?'<div class="row"><button class="btn ghost sm" data-act="mictest">🎤 Test microphone</button><span id="mictestout" class="muted small"></span></div>':'<div class="warnbox">Not available in this browser/app. Works in Chrome and Safari (needs a microphone and, for Chrome, an internet connection — a VPN if you\'re in mainland China). In the Android app, it needs the phone\'s voice-typing service — see the note below if it\'s missing.</div>'}</div>
  <div class="card"><h2>Voice (listening)</h2>${vs.length?'':'<div class="warnbox">No Chinese (zh-CN) voice found. Listening questions will show text instead. Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → add a Chinese (China mainland) voice, then reload. iPhone: Settings → Accessibility → Spoken Content → Voices → Chinese. Android: open phone Settings, search “Text-to-speech”, and install Chinese voice data for your speech engine, then restart the app.</div>'}
    <div class="set-row"><div class="d"><b>Female / narrator voice</b><span>Reads passages, questions and female (女) lines.</span></div><select data-set="voiceF">${vopt(S.settings.voiceF)}</select><button class="btn ghost sm" data-act="vtest" data-r="女">▶ Test</button></div>
    <div class="set-row"><div class="d"><b>Male voice</b><span>Reads male (男) lines in dialogues. If you only have one voice, pitch is changed instead.</span></div><select data-set="voiceM">${vopt(S.settings.voiceM)}</select><button class="btn ghost sm" data-act="vtest" data-r="男">▶ Test</button></div>
    <div class="set-row"><div class="d"><b>Speed</b><span>HSK 4 recordings are at a normal, slightly careful pace (≈0.9).</span></div><select data-set="rate">${[0.7,0.8,0.9,1,1.1].map(r=>`<option ${S.settings.rate==r?'selected':''}>${r}</option>`).join('')}</select></div>
    <div class="set-row"><div class="d"><b>Autoplay</b><span>Play the recording as soon as a listening question opens.</span></div><select data-set="autoplay"><option value="1" ${S.settings.autoplay?'selected':''}>On</option><option value="0" ${S.settings.autoplay?'':'selected'}>Off</option></select></div></div>
  <div class="card"><h2>Exam</h2>
    <div class="set-row"><div class="d"><b>Exam date</b><span>Shows a countdown on the home page.</span></div><input type="date" data-set="examDate" value="${esc(S.settings.examDate)}"></div>
    <div class="set-row"><div class="d"><b>Timed mock sections</b></div><select data-set="timed"><option value="1" ${S.settings.timed?'selected':''}>On</option><option value="0" ${S.settings.timed?'':'selected'}>Off</option></select></div>
    <div class="set-row"><div class="d"><b>Listening plays in mocks</b></div><select data-set="plays"><option value="1" ${S.settings.plays==1?'selected':''}>1 (official)</option><option value="2" ${S.settings.plays==2?'selected':''}>2</option><option value="0" ${S.settings.plays==0?'selected':''}>Unlimited</option></select></div>
    <div class="set-row"><div class="d"><b>Tap-to-lookup in practice</b><span>Tap words in questions to see pinyin + meaning (always on in reviews, off during mocks).</span></div><select data-set="lookup"><option value="1" ${S.settings.lookup?'selected':''}>On</option><option value="0" ${S.settings.lookup?'':'selected'}>Off</option></select></div></div>
  <div class="card"><h2>Your data</h2><p class="muted" style="margin-top:0">Progress is saved to your account (synced automatically) and cached in this browser for instant loading. Read the <a class="link" href="/privacy">privacy policy</a>. Export it any time for an extra backup.</p>
    <div class="row"><button class="btn ghost sm" data-act="exp">Export</button><button class="btn ghost sm" data-act="imp">Import from box</button><button class="btn ghost sm" data-act="reset" style="color:var(--bad)">Reset all progress</button></div>
    <textarea id="iobox" rows="4" style="margin-top:10px;font:12px ui-monospace,monospace" placeholder="Exported data appears here. To import, paste data here and press Import."></textarea></div>`;};

/* ================= account ================= */
let AUTHTAB='login',AUTHERR='',AUTHMSG='',RESET_EMAIL='',DELOPEN=false,DELERR='';
async function api(url,body){
  const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},credentials:'same-origin',cache:'no-store',body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,j};
}
RENDER.auth=()=>{
  const t=AUTHTAB;
  if(t==='boot'){$('#v-auth').innerHTML=`<div class="authwrap"><div class="authhero"><span class="seal" style="display:inline-grid">考</span><h1>HSK 4 Prep</h1>${AUTHERR?`<div class="autherr" style="margin-top:14px">${esc(AUTHERR)}</div><button class="btn" data-act="bootretry">Try again</button>`:'<p>Loading your account…</p>'}</div></div>`;return;}
  const title={login:'HSK 4 Prep',signup:'HSK 4 Prep',forgot:'Reset your password',reset:'Reset your password',verify:'Check your email'}[t];
  const hero={login:'Sign in to continue your HSK 4 practice.',
    signup:'Create a free account to save your practice history and pick up where you left off on any device.',
    forgot:'Enter your account email and we will send you a 6-digit code.',
    reset:`Enter the code we sent to ${RESET_EMAIL} and choose a new password.`,
    verify:`We sent a 6-digit code to ${AUTH?AUTH.email:'your email'}. Enter it to activate your account.`}[t];
  const tabs=(t==='login'||t==='signup')?`<div class="authtabs"><button class="${t==='login'?'on':''}" data-authtab="login">Sign in</button><button class="${t==='signup'?'on':''}" data-authtab="signup">Create account</button></div>`:'';
  const codeField='<div class="field"><label>6-digit code</label><input type="text" id="a-code" class="codein" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>';
  let form='';
  if(t==='login'||t==='signup')form=`${t==='signup'?'<div class="field"><label>Name</label><input type="text" id="a-name" autocomplete="name" maxlength="40" placeholder="Shown on the leaderboard"></div>':''}
      <div class="field"><label>Email</label><input type="email" id="a-email" autocomplete="email" required value="${esc(RESET_EMAIL)}"></div>
      <div class="field"><label>Password</label><input type="password" id="a-pass" autocomplete="${t==='login'?'current-password':'new-password'}" minlength="8" required placeholder="${t==='login'?'':'At least 8 characters'}"></div>
      <button class="btn" type="submit" id="authsubmit">${t==='login'?'Sign in':'Create account'}</button>`;
  else if(t==='forgot')form=`<div class="field"><label>Email</label><input type="email" id="a-email" autocomplete="email" required value="${esc(RESET_EMAIL)}"></div><button class="btn" type="submit" id="authsubmit">Send reset code</button>`;
  else if(t==='reset')form=`${codeField}<div class="field"><label>New password</label><input type="password" id="a-pass" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></div><button class="btn" type="submit" id="authsubmit">Reset password</button>`;
  else if(t==='verify')form=`${codeField}<button class="btn" type="submit" id="authsubmit">Verify email</button>`;
  const foot={
    login:'<button class="link" data-authtab="forgot">Forgot password?</button><br>New here? <button class="link" data-authtab="signup">Create an account</button>',
    signup:'Already have an account? <button class="link" data-authtab="login">Sign in</button>',
    forgot:'<button class="link" data-authtab="login">‹ Back to sign in</button>',
    reset:'No email? Check your spam folder, or <button class="link" data-authtab="forgot">send a new code</button><br><button class="link" data-authtab="login">‹ Back to sign in</button>',
    verify:'No email? Check your spam folder, or <button class="link" data-act="resendverify">send a new code</button><br>Wrong email? <button class="link" data-act="signout">Sign out and start over</button>'}[t]
    +((t==='login'||t==='signup')?'<br><a class="link" href="/privacy">Privacy</a>'+(IN_APP?'':' · <a class="link" href="/download/hsk4-prep.apk">Android app</a>'):'');
  $('#v-auth').innerHTML=`<div class="authwrap">
    <div class="authhero"><span class="seal" style="display:inline-grid">考</span><h1>${title}</h1><p>${esc(hero)}</p></div>
    ${tabs}${AUTHERR?`<div class="autherr">${esc(AUTHERR)}</div>`:''}${AUTHMSG?`<div class="authmsg">${esc(AUTHMSG)}</div>`:''}
    <form class="authform" id="authform" autocomplete="on">${form}</form>
    <div class="authswitch">${foot}</div>
  </div>`;
  const first=$('#authform input');if(first)setTimeout(()=>first.focus(),20);
};
function authErrMsg(j){switch((j||{}).error){
  case 'invalid_email':return 'Enter a valid email address.';
  case 'weak_password':return (j&&j.message)||'Password must be at least 8 characters.';
  case 'email_taken':return 'An account with that email already exists — sign in, or use “Forgot password?”.';
  case 'invalid_credentials':return 'Incorrect email or password.';
  case 'too_many_attempts':return 'Too many attempts — wait a few minutes and try again.';
  case 'invalid_code':return 'That code is not right. Use the code from the newest email.';
  case 'expired_code':return 'That code has expired — request a new one.';
  case 'code_locked':return 'Too many wrong codes — request a new one.';
  case 'no_code':return 'There is no active code — request a new one.';
  case 'cooldown':return `Please wait ${(j&&j.wait)||60} seconds before asking for another code.`;
  case 'mail_failed':return 'We could not send the email right now. Please try again in a minute.';
  default:return 'Something went wrong. Please try again.';}}
async function submitAuth(){
  const t=AUTHTAB,btn=$('#authsubmit');const val=sel=>{const el=$(sel);return el?el.value.trim():'';};
  const pass=$('#a-pass')?$('#a-pass').value:'';
  const fail=msg=>{AUTHERR=msg;AUTHMSG='';RENDER.auth();};
  if((t==='signup'||t==='reset')&&pass.length<8)return fail('Password must be at least 8 characters.');
  if((t==='reset'||t==='verify')&&!/^\d{6}$/.test(val('#a-code')))return fail('Enter the 6-digit code from the email.');
  btn.disabled=true;btn.textContent='Please wait…';
  try{
    let res;
    if(t==='login')res=await api('/api/auth/login',{email:val('#a-email'),password:pass});
    else if(t==='signup')res=await api('/api/auth/signup',{email:val('#a-email'),password:pass,name:val('#a-name')});
    else if(t==='forgot'){
      RESET_EMAIL=val('#a-email');res=await api('/api/auth/forgot',{email:RESET_EMAIL});
      if(res.ok){AUTHTAB='reset';AUTHERR='';AUTHMSG=`If an account exists for ${RESET_EMAIL}, a code is on its way (valid 30 minutes).`;RENDER.auth();return;}
    }
    else if(t==='reset')res=await api('/api/auth/reset',{email:RESET_EMAIL,code:val('#a-code'),password:pass});
    else res=await api('/api/auth/verify',{code:val('#a-code')});
    if(!res.ok)return fail(authErrMsg(res.j));
    AUTHERR='';AUTHMSG='';
    await onAuthed(res.j.user);
    if(t==='signup'&&res.j.mailFailed){AUTHERR='We could not send the verification email just now — tap “send a new code” below.';RENDER.auth();}
  }catch(e){fail('Network error — check your connection and try again.');}
}
async function resendVerify(){
  let r=null;try{r=await api('/api/auth/resend-verification',{});}catch(e){}
  if(r&&r.ok){AUTHERR='';AUTHMSG=`New code sent to ${AUTH?AUTH.email:'your email'}.`;}else{AUTHERR=authErrMsg(r&&r.j);AUTHMSG='';}
  RENDER.auth();
}
function updateAcct(){
  const el=$('#acct');if(!el)return;const nb=$('#navAdmin');
  if(!AUTH||!AUTH.verified){el.hidden=true;el.innerHTML='';document.body.classList.add('guest');if(nb)nb.hidden=true;return;}
  document.body.classList.remove('guest');el.hidden=false;
  el.innerHTML=`<span class="av" title="${esc(AUTH.name)} · ${esc(AUTH.email)}">${esc(String(AUTH.name||'?').trim().charAt(0).toUpperCase())}</span><button data-act="signout">Sign out</button>`;
  if(nb)nb.hidden=!AUTH.admin;
}
async function onAuthed(user){
  AUTH=user;
  if(!user.verified){AUTHTAB='verify';updateAcct();show('auth');return;} // must confirm the email before practicing
  AUTHTAB='login';RESET_EMAIL='';updateAcct();
  S=loadCached(); // show cached progress instantly, then confirm/replace with the account's saved copy
  try{
    const r=await fetch('/api/progress',{credentials:'same-origin',cache:'no-store'});
    if(r.ok){const j=await r.json();S=mergeState(j.state);try{localStorage.setItem(authKey(),JSON.stringify(S));}catch(e){}}
  }catch(e){}
  let startTab='home';try{startTab=localStorage.getItem(TABKEY)||'home';}catch(e){}
  if(!RENDER[startTab]||startTab==='auth')startTab='home';
  show(startTab);
}

/* ================= admin (owner dashboard: who is using the app, as leads) ================= */
let ADMIN_USERS=null,ADMIN_NOW=0,ADMIN_ERR='',AQ='',ASORT='last',AOPEN=null;
RENDER.admin=()=>{$('#v-admin').innerHTML='<div class="card"><h2>Admin</h2><p class="muted">Loading…</p></div>';loadAdmin();};
async function loadAdmin(){
  try{
    const r=await fetch('/api/admin/users',{credentials:'same-origin',cache:'no-store'});
    if(!r.ok){ADMIN_ERR=r.status===403?'You do not have admin access on this account.':`Could not load admin data (HTTP ${r.status}).`;ADMIN_USERS=null;renderAdminView();return;}
    const j=await r.json();ADMIN_USERS=j.users;ADMIN_NOW=j.now;ADMIN_ERR='';renderAdminView();
  }catch(e){ADMIN_ERR='Network error — check your connection and try again.';ADMIN_USERS=null;renderAdminView();}
}
function relTime(ts,now){if(!ts)return'Never';const s=Math.max(0,Math.round((now-ts)/1000));if(s<60)return'Just now';const m=Math.round(s/60);if(m<60)return m+'m ago';const h=Math.round(m/60);if(h<24)return h+'h ago';const d=Math.round(h/24);if(d<30)return d+'d ago';return Math.round(d/30)+'mo ago';}
const ADMIN_SORTS={
  last:(a,b)=>(b.lastSeen||0)-(a.lastSeen||0),joined:(a,b)=>b.joined-a.joined,
  mastered:(a,b)=>b.wordsMastered-a.wordsMastered,acc:(a,b)=>b.accuracy-a.accuracy,
  mocks:(a,b)=>(b.bestMock??-1)-(a.bestMock??-1),name:(a,b)=>a.name.localeCompare(b.name),
};
function renderAdminView(){
  if(!$('#v-admin'))return;
  if(ADMIN_ERR){$('#v-admin').innerHTML=`<div class="card"><h2>Admin</h2><div class="autherr">${esc(ADMIN_ERR)}</div></div>`;return;}
  if(!ADMIN_USERS){$('#v-admin').innerHTML='<div class="card"><h2>Admin</h2><p class="muted">Loading…</p></div>';return;}
  const now=ADMIN_NOW||Date.now(),U=ADMIN_USERS,DAY=864e5,WEEK=7*DAY,ONLINE=5*60000;
  const online=U.filter(u=>u.lastSeen&&now-u.lastSeen<ONLINE).length;
  const today=U.filter(u=>u.lastSeen&&now-u.lastSeen<DAY).length;
  const week=U.filter(u=>u.lastSeen&&now-u.lastSeen<WEEK).length;
  const verified=U.filter(u=>u.verified).length;
  const avgAcc=U.length?Math.round(U.reduce((a,u)=>a+u.accuracy,0)/U.length):0;
  const q=AQ.trim().toLowerCase();
  const list=U.filter(u=>!q||(u.name+' '+u.email).toLowerCase().includes(q)).slice().sort(ADMIN_SORTS[ASORT]||ADMIN_SORTS.last);
  let h=`<div class="card"><h2>Admin</h2><p class="muted" style="margin-top:0">Who is using HSK 4 Prep, how far they've gotten, and their contact email for outreach. Visible only to admin accounts.</p>
    <div class="stats">
      <div class="stat"><span>Total users</span><b>${U.length}</b></div>
      <div class="stat"><span>Online now</span><b>${online}</b><em class="sub2">active in the last 5 min</em></div>
      <div class="stat"><span>Active today</span><b>${today}</b></div>
      <div class="stat"><span>Active this week</span><b>${week}</b></div>
    </div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><span>Verified</span><b>${verified}<small class="muted" style="font-size:13px"> / ${U.length}</small></b></div>
      <div class="stat"><span>Avg. accuracy</span><b>${avgAcc}%</b></div>
      <div class="stat"><span>New today</span><b>${U.filter(u=>now-u.joined<DAY).length}</b></div>
      <div class="stat"><span>New this week</span><b>${U.filter(u=>now-u.joined<WEEK).length}</b></div>
    </div></div>
  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div class="field" style="flex:1;min-width:200px"><label>Search</label><input type="search" id="aq" placeholder="Name or email" value="${esc(AQ)}"></div>
      <div class="field"><label>Sort by</label><select id="asort">
        <option value="last" ${ASORT==='last'?'selected':''}>Last active</option>
        <option value="joined" ${ASORT==='joined'?'selected':''}>Newest signup</option>
        <option value="mastered" ${ASORT==='mastered'?'selected':''}>Words mastered</option>
        <option value="acc" ${ASORT==='acc'?'selected':''}>Accuracy</option>
        <option value="mocks" ${ASORT==='mocks'?'selected':''}>Best mock score</option>
        <option value="name" ${ASORT==='name'?'selected':''}>Name</option></select></div>
      <a class="btn ghost sm" href="/api/admin/export.csv" style="text-decoration:none">⬇ Export CSV (leads)</a>
    </div>
    <div class="muted small" style="margin:10px 0 8px">${list.length} of ${U.length} user(s) · tap a row for more · <span style="color:var(--ok)">●</span> = online now</div>
    <div class="tscroll"><table class="wtab"><thead><tr><th></th><th>Name</th><th>Email</th><th>Joined</th><th>Last active</th><th>Mastered</th><th>Accuracy</th><th>Best mock</th></tr></thead><tbody>
    ${list.map(u=>{const isOn=u.lastSeen&&now-u.lastSeen<ONLINE;
      return `<tr data-act="arow" data-id="${u.id}"><td>${isOn?'<span style="color:var(--ok)" title="Online now">●</span>':''}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${new Date(u.joined).toLocaleDateString()}</td><td>${relTime(u.lastSeen,now)}</td><td>${u.wordsMastered} / 1200</td><td>${u.accuracy}%</td><td>${u.bestMock??'—'}</td></tr>`
      +(AOPEN===u.id?`<tr class="x"><td></td><td colspan="7">Words practiced: <b>${u.wordsPracticed}</b> · Questions answered: <b>${u.answered}</b> (${u.correct} correct) · Mocks taken: <b>${u.mocksTaken}</b>${u.lastMockDate?` (last: ${esc(u.lastMockDate)})`:''} · Days practiced: <b>${u.daysActive}</b> · Email verified: <b>${u.verified?'yes':'no'}</b>${!u.verified?' <span class="muted">(auto-deleted after 7 days if never confirmed)</span>':''}</td></tr>`:'');
    }).join('')}
    </tbody></table></div>${list.length?'':'<div class="empty">No users match.</div>'}
  </div>`;
  $('#v-admin').innerHTML=h;
}

/* ================= leaderboard (today / this week / last week, ranked by correct answers) ================= */
let LBP='today',LBDATA=null,LBERR='',LBTIMER=null,LBSKEW=0;
const LB_LABEL={today:'Today',week:'This week',lastweek:'Last week'};
async function loadLB(period,quiet){
  try{
    await syncNow(); // get the newest answers onto the server first, so your own row is current
    const r=await fetch('/api/leaderboard?period='+period,{credentials:'same-origin',cache:'no-store'});
    if(period!==LBP)return; // the user switched tabs while this was loading
    if(!r.ok){LBERR=r.status===429?'Too many refreshes — wait a moment and try again.':'Could not load the leaderboard.';if(!quiet)LBDATA=null;}
    else{LBDATA=await r.json();LBERR='';LBSKEW=LBDATA.now-Date.now();}
  }catch(e){if(period!==LBP)return;LBERR='Network error — check your connection and try again.';if(!quiet)LBDATA=null;}
  if(CUR==='lb')renderLB();
}
RENDER.lb=()=>{
  LBDATA=null;LBERR='';renderLB();loadLB(LBP);
  clearInterval(LBTIMER);
  LBTIMER=setInterval(()=>{if(CUR!=='lb'){clearInterval(LBTIMER);return;}if(!document.hidden)loadLB(LBP,true);},45000);
};
function lbLeft(ms){if(ms<=0)return'a moment';const m=Math.floor(ms/6e4),h=Math.floor(m/60),d=Math.floor(h/24);return d>=2?`${d}d ${h%24}h`:h>0?`${h}h ${m%60}m`:`${m}m`;}
function lbDate(ds){return new Date(ds+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});}
function lbBody(d){
  const range=d.from===d.to?lbDate(d.from):`${lbDate(d.from)} – ${lbDate(d.to)}`;
  const reset=d.resetsAt?`Resets in <b>${lbLeft(d.resetsAt-(Date.now()+LBSKEW))}</b> (${d.period==='week'?'Monday 00:00':'midnight'} China time, ${d.tz})`:'Final results';
  const m=d.me;let banner;
  if(m.banned)banner='You have been removed from the leaderboards.';
  else if(m.hidden)banner='You are hidden from the leaderboard. Your points still count — turn “Show me on the leaderboard” back on in <button class="link" data-go="set">Settings</button>.';
  else if(m.rank)banner=`You are <b>#${m.rank}</b> of ${d.participants} with <b>${m.points}</b> point${m.points===1?'':'s'} (${m.accuracy}% correct).`;
  else banner=d.period==='lastweek'?'You did not score last week.':'You have not scored yet — answer a few questions to get on the board.';
  const medal=r=>['🥇','🥈','🥉'][r-1]||r;
  const rows=d.entries.map(e=>`<tr class="${e.you?'me':''}"><td class="rk">${medal(e.rank)}</td><td>${esc(e.name)}${e.you?' <span class="tag red">you</span>':''}</td><td class="pts">${e.points}</td><td class="muted hs">${e.answered}</td><td class="muted">${e.accuracy}%</td></tr>`).join('');
  const meOutside=m.rank&&!m.hidden&&!d.entries.some(e=>e.you)?`<tr><td colspan="5" class="muted" style="text-align:center">⋯</td></tr><tr class="me"><td class="rk">${m.rank}</td><td>You</td><td class="pts">${m.points}</td><td class="muted hs">${m.answered}</td><td class="muted">${m.accuracy}%</td></tr>`:'';
  return `<p class="muted" style="margin:12px 0 0"><b style="color:var(--ink)">${LB_LABEL[d.period]}</b> · ${range}<br>${reset}</p>
    <div class="lbbanner">${banner}</div>
    ${d.entries.length?`<div class="tscroll"><table class="lbtable"><thead><tr><th></th><th>Name</th><th>Points</th><th class="hs">Answered</th><th>Accuracy</th></tr></thead><tbody>${rows}${meOutside}</tbody></table></div>
      ${d.participants>d.entries.length?`<p class="muted small" style="margin:8px 0 0">Showing the top ${d.entries.length} of ${d.participants}.</p>`:''}`
    :`<div class="empty">Nobody has scored ${d.period==='today'?'yet today':d.period==='week'?'yet this week':'last week'}${d.period==='lastweek'?'.':' — be the first!'}</div>`}
    <details class="howm"><summary>How points work</summary><ul>
      <li><b>1 point per correct answer</b> — in quizzes, sentence practice, speaking, mock exams and flashcards (Hard, Good and Easy count as correct). Wrong answers earn nothing and cost nothing.</li>
      <li>Ties are broken by accuracy (fewer answers for the same points ranks higher).</li>
      <li>“Today” runs from midnight to midnight <b>China time (UTC+8)</b>; weeks run Monday to Sunday in the same timezone.</li>
      <li>Points are counted by the server from your saved progress, so they can appear a few seconds after you answer. Answers faster than about one every 1.5 seconds are not counted, and there is a daily ceiling of 2,500 answers.</li>
      <li>You can change your display name or hide yourself in <button class="link" data-go="set">Settings</button>. Accounts caught cheating are removed from the boards.</li></ul></details>`;
}
function renderLB(){
  const el=$('#v-lb');if(!el)return;
  const chips=Object.entries(LB_LABEL).map(([k,v])=>`<button class="chip ${LBP===k?'on':''}" data-act="lbp" data-p="${k}">${v}</button>`).join('');
  const body=LBERR&&!LBDATA?`<div class="autherr" style="margin-top:12px">${esc(LBERR)}</div><button class="btn ghost sm" data-act="lbrefresh">Try again</button>`
    :!LBDATA?'<p class="muted" style="margin-top:12px">Loading…</p>':(LBERR?`<p class="small" style="margin:10px 0 0;color:var(--warn)">⚠ ${esc(LBERR)} Showing the last results.</p>`:'')+lbBody(LBDATA);
  el.innerHTML=`<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">🏆 Leaderboard</h2><button class="btn ghost sm" data-act="lbrefresh">↻ Refresh</button></div>
    <div class="chips" style="margin-top:12px">${chips}</div>${body}</div>`;
}
async function loadLbHome(){ // small "today" summary on the Home page
  if(!$('#lbhome'))return;
  try{
    await syncNow();
    const r=await fetch('/api/leaderboard?period=today&limit=3',{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)return;const d=await r.json();
    const box=$('#lbhome');if(!box||CUR!=='home')return;
    const medal=r=>['🥇','🥈','🥉'][r-1]||'#'+r;
    const top=d.entries.map(e=>`<span class="lbchip ${e.you?'me':''}">${medal(e.rank)} ${esc(e.name)} <b>${e.points}</b></span>`).join('');
    const me=d.me.banned?'':d.me.hidden?'You are hidden from the leaderboard.':d.me.rank?`You are <b>#${d.me.rank}</b> today with <b>${d.me.points}</b> point${d.me.points===1?'':'s'}.`:'You have not scored yet today — answer a few questions to join the board.';
    box.innerHTML=`<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">🏆 Today’s leaderboard</h2><button class="btn ghost sm" data-go="lb">Full leaderboard ›</button></div>
      <div class="lbchips">${top||'<span class="muted">Nobody has scored yet today — be the first!</span>'}</div>${me?`<p class="muted" style="margin:10px 0 0">${me}</p>`:''}</div>`;
  }catch(e){}
}
{const baseHome=RENDER.home;RENDER.home=()=>{baseHome();loadLbHome();};}
async function saveProfile(patch){
  let r=null;
  try{r=await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(patch)});}catch(e){}
  if(!r||!r.ok){toast(!r?'Network error — try again.':r.status===400?'Please enter a name.':'Could not save. Please try again.');if(CUR==='set')RENDER.set();return false;}
  const j=await r.json();AUTH=j.user;updateAcct();toast('Saved.');if(CUR==='set')RENDER.set();return true;
}

/* ================= actions ================= */
const ACT={
  exit:()=>exitRun(),
  mock:a=>startMock(a.dataset.size||'full'),
  flash:a=>startFlash(a.dataset.level||($('#flv')?$('#flv').value:'all')),
  mist:a=>startMistakes(a.dataset.part),
  part:a=>startPart(a.dataset.code,+$('#n-'+a.dataset.code).value),
  mixparts:()=>startMixedParts(+$('#mixn').value),
  vm:a=>{VSEL.m=a.dataset.m;RENDER.vocab();},
  vstart:()=>{VSEL.level=$('#vlv').value;VSEL.n=$('#vn').value;VSEL.filter=$('#vf').value;startVocab(VSEL.m,VSEL.level,+VSEL.n,VSEL.filter);},
  sm:a=>{SSEL.m=a.dataset.m;SSEL.level=$('#slv').value;SSEL.n=$('#sn').value;RENDER.sent();},
  sstart:()=>{SSEL.level=$('#slv').value;SSEL.n=$('#sn').value;startSent(SSEL.m,SSEL.level,+SSEL.n);},
  say:a=>TTS.say(a.dataset.t),
  vtest:a=>TTS.ok()?TTS.speak([[a.dataset.r,a.dataset.r==='男'?'你好，我是男声。明天下午三点我们在图书馆门口见面吧。':'你好，我是女声。请听下面一段对话，然后回答问题。']]):toast('No Chinese voice found.'),
  mic:()=>{
    const q=curQ();if(!q||isLocked(q))return;
    if(STT.listening&&STT.q===q){STT.stop();return;}
    STT.listening=true;STT.q=q;renderRun();
    STT.start(
      text=>{q.user=text;},
      err=>{STT.listening=false;renderRun();const m=sttErrMsg(err);if(m)toast(m);}
    );
  },
  mictest:async()=>{
    const out=$('#mictestout');if(out)out.textContent='Listening…';
    STT.start(
      text=>{if(out)out.textContent='Heard: “'+text+'” — the microphone works.';},
      err=>{if(!out)return;const m=sttErrMsg(err);out.textContent=m||(out.textContent.startsWith('Heard')?out.textContent:'');}
    );
  },
  wrow:(a,e)=>{if(e.target.closest('button'))return;const no=+a.dataset.no;WQ.open=WQ.open===no?null:no;renderWordList();},
  wmore:()=>{WQ.lim+=200;renderWordList();},
  mdel:a=>{delete S.mistakes[a.dataset.k];save();RENDER.mist();},
  mclear:()=>{if(confirm('Clear the whole mistake notebook?')){S.mistakes={};save();RENDER.mist();}},
  exp:()=>{const t=JSON.stringify(S);$('#iobox').value=t;try{const b=new Blob([t],{type:'application/json'});const u=URL.createObjectURL(b);const l=document.createElement('a');l.href=u;l.download='hsk4-progress-'+day()+'.json';document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);}catch(e){}toast('Exported — also copied into the box below.');},
  imp:()=>{try{const s=JSON.parse($('#iobox').value);if(!s||typeof s!=='object'||!s.words)throw 0;const base=JSON.parse(JSON.stringify(DEF));S=Object.assign(base,s,{settings:Object.assign(base.settings,s.settings||{})});save();toast('Imported.');RENDER.set();}catch(e){toast('That doesn’t look like exported progress data.');}},
  reset:()=>{if(confirm('Reset ALL progress, mock history, flashcards and mistakes? This cannot be undone.')){const st=S.settings;S=JSON.parse(JSON.stringify(DEF));S.settings=st;save();toast('Progress reset.');RENDER.set();}},
  // run
  opt:a=>{const q=curQ();if(!q||isLocked(q))return;q.user=+a.dataset.i;if(RUN.mode==='practice')finalize(q);else renderRun();},
  tf:a=>{const q=curQ();if(!q||isLocked(q))return;q.user=a.dataset.v==='1';if(RUN.mode==='practice')finalize(q);else renderRun();},
  bank:a=>{const q=curQ();if(!q||isLocked(q))return;q.user=a.dataset.l;if(RUN.mode==='practice')finalize(q);else renderRun();},
  ord:a=>{const q=curQ();if(!q||isLocked(q))return;const L=a.dataset.l,i=q.user.indexOf(L);if(i>=0)q.user=q.user.slice(0,i);else if(q.user.length<3)q.user.push(L);renderRun();},
  ordreset:()=>{const q=curQ();if(q&&!isLocked(q)){q.user=[];renderRun();}},
  tile:a=>{const q=curQ();if(!q||isLocked(q))return;const i=+a.dataset.i;if(!q.user.includes(i))q.user.push(i);renderRun();},
  untile:a=>{const q=curQ();if(!q||isLocked(q))return;q.user.splice(+a.dataset.k,1);renderRun();},
  tilereset:()=>{const q=curQ();if(q&&!isLocked(q)){q.user=[];renderRun();}},
  check:()=>{const q=curQ();if(q&&!q.done&&answered(q))finalize(q);},
  skip:()=>{const q=curQ();if(!q)return;TTS.stop();const R=RUN;if(R.qi<R.sections[R.si].qs.length-1)R.qi++;else if(R.si<R.sections.length-1){R.si++;R.qi=0;}else return finishPractice();renderRun();window.scrollTo(0,0);},
  next:()=>{const R=RUN;TTS.stop();if(R.state==='review'){const q=curQ();if(q.num<R.total){locate(q.num+1);renderRun();}return;}
    const sec=R.sections[R.si];if(R.qi<sec.qs.length-1){R.qi++;}else if(R.mode==='exam'){return submitSection(false);}else if(R.si<R.sections.length-1){R.si++;R.qi=0;}else return finishPractice();renderRun();window.scrollTo(0,0);},
  prev:()=>{const R=RUN;TTS.stop();if(R.state==='review'){const q=curQ();if(q.num>1){locate(q.num-1);renderRun();}return;}if(R.qi>0){R.qi--;renderRun();}},
  goto:a=>{const R=RUN;TTS.stop();const n=+a.dataset.n;if(R.state==='results')R.state='review';if(R.state==='doing'){const sec=R.sections[R.si];const i=sec.qs.findIndex(q=>q.num===n);if(i>=0)R.qi=i;}else locate(n);renderRun();window.scrollTo(0,0);},
  submit:()=>submitSection(false),
  finish:()=>finishPractice(),
  review:()=>{RUN.state='review';const first=allQs().find(q=>!q.ok)||allQs()[0];locate(first.num);renderRun();window.scrollTo(0,0);},
  toresults:()=>{RUN.state='results';renderResults();window.scrollTo(0,0);},
  again:()=>{const f=RUN.again;RUN=null;f();},
  play:()=>{const q=curQ();if(q)playQ(q);},
  tr:()=>{const q=curQ();if(q){q.showTr=true;renderRun();}},
  override:a=>{const q=curQ();if(!q)return;q.override=a.dataset.v==='1';const was=q.ok;q.ok=q.override;
    if(was!==q.ok){const P=S.parts[q.part]||(S.parts[q.part]={a:0,c:0});P.c+=q.ok?1:-1;P.c=Math.max(0,P.c);const key=JSON.stringify(q.spec);if(q.ok)delete S.mistakes[key];else{const m=S.mistakes[key]||(S.mistakes[key]={spec:q.spec,n:0,ok:0,sum:q.sum,part:q.part});m.n++;m.t=Date.now();}}
    updateMockAfterOverride();save();renderRun();},
  flshow:()=>{RUN.shown=true;renderFlash();},
  flg:a=>flashGrade(+a.dataset.g),
  arow:a=>{const id=+a.dataset.id;AOPEN=AOPEN===id?null:id;renderAdminView();},
  lbp:a=>{LBP=a.dataset.p;LBDATA=null;LBERR='';renderLB();loadLB(LBP);},
  lbrefresh:()=>{LBERR='';loadLB(LBP,!!LBDATA);},
  savename:()=>saveProfile({name:($('#lbname')||{}).value||''}),
  signout:async()=>{
    await syncNow(); // best-effort: flush any pending changes before ending the session
    try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});}catch(e){}
    AUTH=null;S=mergeState(null);AUTHTAB='login';AUTHERR='';AUTHMSG='';updateAcct();show('auth');
  },
};
document.addEventListener('click',e=>{
  const l=e.target.closest('.lk');if(l){showPop(l);return;}
  const at=e.target.closest('[data-authtab]');if(at){AUTHTAB=at.dataset.authtab;AUTHERR='';AUTHMSG='';RENDER.auth();return;}
  if(!e.target.closest('#pop'))$('#pop').hidden=true;
  const a=e.target.closest('[data-act],[data-go]');if(!a||a.disabled)return;
  if(a.dataset.go){show(a.dataset.go);return;}
  const f=ACT[a.dataset.act];if(f)f(a,e);
});
document.addEventListener('submit',e=>{if(e.target&&e.target.id==='authform'){e.preventDefault();submitAuth();}
  else if(e.target&&e.target.id==='delform'){e.preventDefault();deleteAccount();}});
ACT.delopen=()=>{DELOPEN=true;DELERR='';RENDER.set();setTimeout(()=>{const p=$('#del-pass');if(p)p.focus();},30);};
ACT.delcancel=()=>{DELOPEN=false;DELERR='';RENDER.set();};
async function deleteAccount(){
  const b=$('#delsubmit');if(b){b.disabled=true;b.textContent='Deleting…';}
  let r=null;try{r=await api('/api/auth/delete-account',{password:$('#del-pass').value});}catch(e){}
  if(!r||!r.ok){DELERR=!r?'Network error — check your connection and try again.':r.j.error==='invalid_credentials'?'Incorrect password.':r.j.error==='too_many_attempts'?'Too many attempts — wait a few minutes and try again.':'Could not delete the account. Please try again.';RENDER.set();return;}
  clearTimeout(saveT);clearTimeout(syncT);dirty=false;try{localStorage.removeItem(authKey());}catch(e){}
  AUTH=null;S=mergeState(null);DELOPEN=false;DELERR='';AUTHTAB='login';AUTHERR='';AUTHMSG='Your account and all practice history were deleted.';updateAcct();show('auth');
}
document.addEventListener('input',e=>{const t=e.target;
  if(t.dataset.in==='write'||t.dataset.in==='type'){const q=curQ();if(!q||isLocked(q))return;q.user=t.value;const b=$('#checkbtn');if(b)b.disabled=!answered(q);
    if(RUN.mode==='exam'){const nb=$$('.navgrid button').find(x=>+x.dataset.n===q.num);if(nb)nb.classList.toggle('done',answered(q));}}
  if(t.id==='wq'){WQ.q=t.value;WQ.lim=120;renderWordList();}
  if(t.id==='aq'){AQ=t.value;renderAdminView();}
});
document.addEventListener('change',e=>{const t=e.target;
  if(t.dataset.set){const k=t.dataset.set;let v=t.value;if(['timed','autoplay','lookup'].includes(k))v=v==='1';else if(['plays','newPerDay'].includes(k))v=+v;if(k==='newPerDay')v=Math.max(1,Math.min(1200,Math.round(v)||20));else if(k==='rate')v=+v;S.settings[k]=v;save();if(k==='newPerDay'&&CUR==='vocab')RENDER.vocab();return;}
  if(t.id==='wlv'){WQ.lv=t.value;WQ.lim=120;renderWordList();}
  if(t.id==='flv'){FLV=t.value;RENDER.vocab();}
  if(t.id==='asort'){ASORT=t.value;renderAdminView();}
  if(t.id==='lbvis'){saveProfile({leaderboard:t.value==='1'});}
});
function primary(){const R=RUN,q=curQ();if(!q)return;
  if(R.state==='review')return ACT.next();
  if(R.mode==='practice'){if(!q.done){if(['order','build','write','type'].includes(q.kind)&&answered(q))finalize(q);}else{const sec=R.sections[R.si];(R.qi===sec.qs.length-1&&R.si===R.sections.length-1)?finishPractice():ACT.next();}}
  else ACT.next();}
document.addEventListener('keydown',e=>{
  if(!RUN||e.metaKey||e.ctrlKey||e.altKey)return;const tag=(e.target.tagName||'').toLowerCase();
  if(tag==='textarea'||tag==='select')return;
  if(tag==='input'){if(e.key==='Enter'&&e.target.dataset.in==='type'&&!e.isComposing){e.preventDefault();primary();}return;}
  if(RUN.flash){if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!RUN.shown&&RUN.queue[RUN.i]!=null){RUN.shown=true;renderFlash();}}else if(RUN.shown&&/^[1-4]$/.test(e.key))flashGrade(+e.key-1);return;}
  if(RUN.state==='results')return;const q=curQ();if(!q)return;const k=e.key.toLowerCase();
  if(q.kind==='mc'&&/^[1-4]$/.test(k)){const i=+k-1;if(i<q.opts.length)ACT.opt({dataset:{i:String(i)}});}
  else if(q.kind==='tf'&&(k==='1'||k==='2')){ACT.tf({dataset:{v:k==='1'?'1':'0'}});}
  else if(q.kind==='bank'&&/^[a-f]$/.test(k)&&q.bank.some(b=>b.L===k.toUpperCase())){ACT.bank({dataset:{l:k.toUpperCase()}});}
  else if(e.key==='Enter'||e.key==='ArrowRight'){e.preventDefault();primary();}
  else if(e.key==='ArrowLeft'){ACT.prev();}
  else if(e.key===' '&&q.audio){e.preventDefault();ACT.play();}
});
window.addEventListener('beforeunload',e=>{if(RUN&&RUN.mode==='exam'&&RUN.state==='doing'){e.preventDefault();e.returnValue='';}});

ACT.resendverify=()=>resendVerify();
ACT.npd=a=>{S.settings.newPerDay=+a.dataset.n;save();RENDER.vocab();};

/* ================= boot ================= */
TTS.init();
const TABKEY='hsk4prep.tab';
AUTHTAB='boot';updateAcct();show('home'); // shows "Loading your account…" while AUTH is unset
async function checkSession(){
  AUTHERR='';if(AUTHTAB==='boot')RENDER.auth();
  let r;
  try{r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});}
  catch(e){r=null;}
  if(!r||!r.ok){ // network problem, not a logout: keep the session and offer a retry
    AUTHERR='Could not reach the server. Check your connection (or VPN) and try again.';RENDER.auth();return;}
  const j=await r.json().catch(()=>({}));
  if(j.user)await onAuthed(j.user);
  else{AUTHTAB='login';AUTHERR='';if(!AUTH)show('auth');}
}
ACT.bootretry=()=>checkSession();
checkSession();
