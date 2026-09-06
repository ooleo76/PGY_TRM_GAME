/* ══════════════════════════════════════════════════════════════
   IHCA 團隊復甦 — 共用模擬核心 v3
   伺服器與瀏覽器共用。完全不碰 DOM。
   固定步進 30Hz + 種子亂數 → 同樣的種子與操作序列會跑出完全一樣的一局，
   重播功能就是靠這個。
   ══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const HZ=30, DT=1/HZ;

/* ═══════════ 常數 ═══════════ */
const K={
W:900, H:780,
HZ, DT,
BED:{cx:450,cy:410,w:150,h:240},
BEDPAD:22,
ST:{
  head:{x:450,y:236,n:'床頭',        w:140,h:58, sx:450,sy:250},
  bedL:{x:318,y:404,n:'床左',        w:86, h:150,sx:326,sy:404},
  bedR:{x:582,y:404,n:'床右',        w:86, h:150,sx:574,sy:404},
  foot:{x:450,y:598,n:'床尾 · Leader',w:172,h:58, sx:450,sy:594},
  door:{x:140,y:730,n:'門口',        w:136,h:56, sx:140,sy:730}
},
EQ0:{
  cart :{n:'急救車',x:120,y:132,w:112,h:72,col:'#D4483F',dark:'#A2332C',cable:0},
  pc   :{n:'電腦車 · 紀錄',x:106,y:404,w:96, h:66,col:'#6F7C88',dark:'#545E68',cable:0},
  defib:{n:'電擊器',x:560,y:690,w:104,h:70,col:'#E0A32A',dark:'#AC7B18',cable:250},
  echo :{n:'超音波',x:790,y:150,w:100,h:68,col:'#5F6E7C',dark:'#46525D',cable:215}
},
SLOTS:[{id:'a',c:'#19B5B5'},{id:'b',c:'#F2704B'},{id:'c',c:'#E8A33D'},
       {id:'d',c:'#9B86EE'},{id:'e',c:'#EDF2F6',coat:1},{id:'f',c:'#4CAF6E'}],
ITEM:{
  epi:{n:'Adrenaline',s:'💉',k:'drug'}, amio:{n:'Amiodarone',s:'💉',k:'drug'},
  calc:{n:'Ca gluconate',s:'💉',k:'drug'}, bicarb:{n:'Bicarbonate',s:'💉',k:'drug'},
  lytic:{n:'血栓溶解劑',s:'💉',k:'drug'}, fluid:{n:'快速輸液',s:'💧',k:'drug'},
  cath:{n:'留置針',s:'🩸',k:'cath'}, io:{n:'骨內針 IO',s:'🦴',k:'io'},
  ett:{n:'插管器材',s:'🫁',k:'ett'}, needle:{n:'減壓針',s:'📍',k:'needle'},
  leads:{n:'EKG 貼片導線',s:'📈',k:'leads'},
  paddle:{n:'電擊板',s:'⚡',k:'paddle'}, probe:{n:'超音波探頭',s:'◗',k:'probe'}
},
DRUGS:['epi','amio','calc','bicarb','lytic','fluid'],
GEAR:['cath','io','ett','needle','leads'],
JOULES:[50,100,150,200],
RHY:{
 VF      :{n:'心室顫動 VF',        short:'VF',   shock:true,  org:false, rate:null},
 pVT     :{n:'無脈搏心室頻脈 pVT',  short:'pVT',  shock:true,  org:true,  rate:195},
 asystole:{n:'心搏停止 Asystole',  short:'ASYS', shock:false, org:false, rate:null},
 PEA     :{n:'無脈搏電氣活動 PEA',  short:'PEA',  shock:false, org:true,  rate:36},
 sinus   :{n:'竇性心搏過速',        short:'ST',   shock:false, org:true,  rate:112}
},
STARTRHY:['VF','pVT','asystole','PEA'],
AMIO:['150','300'],
CAUSES:[
 {id:'k',n:'高血鉀症',fix:['calc','bicarb'],delay:30,typical:['VF','PEA','asystole'],
  fixLabel:'Calcium gluconate 或 Sodium bicarbonate',
  chart:'長期血液透析，前天因故沒有透析，上次 K 5.8。',
  fam:'今天整天喊沒力氣、手腳發麻，沒特別喘。',
  echo:'心臟收縮微弱但心室不大，沒有心包積液。'},
 {id:'p',n:'肺栓塞',fix:['lytic'],delay:90,typical:['PEA'],
  fixLabel:'血栓溶解劑（起效比較慢）',
  chart:'兩週前髖關節置換術後長期臥床，沒有預防性抗凝。',
  fam:'下床上完廁所回來就一直喘，講一講就倒了。',
  echo:'右心室明顯擴大，心室中膈呈 D-shape。'},
 {id:'h',n:'低血容（消化道出血）',fix:['fluid'],delay:45,typical:['PEA','asystole'],
  fixLabel:'快速輸液／備血',
  chart:'肝硬化併食道靜脈瘤，今晨 Hb 6.2。',
  fam:'剛剛解了一大灘黑便，血壓量不到就叫人了。',
  echo:'左心室空虛、收縮激烈，IVC 完全塌陷。'},
 {id:'x',n:'張力性氣胸',fix:['needle'],delay:15,typical:['PEA'],
  fixLabel:'針刺減壓（減壓後很快就回來）',
  chart:'昨天剛放右側中心靜脈導管，之後沒有再照胸片。',
  fam:'突然說喘，血壓一下就掉，兩三分鐘就沒反應。',
  echo:'右側完全沒有 lung sliding，可見 lung point。'},
 {id:'o',n:'低血氧（痰液阻塞）',fix:['intubate'],delay:120,typical:['PEA','asystole'],
  fixLabel:'建立進階氣道後再撐一個循環',
  chart:'COPD 急性發作住院第三天，痰多黏稠。',
  fam:'血氧從 90 一路掉到 60，嘴唇發黑，來不及抽痰就停了。',
  echo:'心臟收縮微弱，雙側肺滑動存在，沒有心包積液。'}
],
PATIENTS:['78 歲男性 · 體格壯碩','64 歲女性 · 體格瘦小','56 歲男性 · 中等身材','71 歲女性 · 中等身材'],
ESCORTLINES:['我先帶您到外面坐一下','裡面同仁正在全力急救','我陪您過去，有消息馬上跟您說','您先深呼吸，我們沒有放棄'],
FAMLINES:['怎麼會這樣…','拜託救救他','我要怎麼辦','剛剛還好好的啊','醫生他會不會有事','是不是我沒注意到'],
FAMPULL:['家屬拉住你問話','家屬擋在旁邊','家屬一直拉著你的手'],
SRC:{chart:'病歷',fam:'家屬與護理師',echo:'床邊超音波'},
ORDERS:['開始壓胸','壓胸換手','加強壓胸品質','建立血管通路','給 Adrenaline 1mg',
        '準備插管','準備電擊','全部 CLEAR，手離開病人','有人去查病歷','有人做床邊超音波',
        '把家屬帶出去','停止按壓，檢查心律'],
DRIPS:[
 {id:'none',n:'沒有點滴',short:'—'},
 {id:'ns',  n:'生理食鹽水 500ml',short:'N/S'},
 {id:'d5w', n:'5% 葡萄糖',short:'D5W'},
 {id:'abx', n:'抗生素滴注中',short:'ABX'},
 {id:'prbc',n:'正在輸血',short:'PRBC'}
],
SCOPES:['Direct','Video'],
SCOPEN:{Direct:'直接喉頭鏡',Video:'影像喉頭鏡'},
BLADES:['3 號','4 號'],
TUBES:['7.0','7.5'],
READYFOR:{
 cpr  :['我需要換手','我手快沒力了','30 下到了，準備通氣','我繼續壓'],
 head :['通氣完成','氣道有阻力','管子備妥了','插管完成，有波形'],
 drug :['藥抽好了','劑量確認過了','我送過去'],
 cath :['我去上針','這針沒上到，再一根'],
 io   :['我改上骨內針','IO 我來'],
 ett  :['插管器材備妥','喉頭鏡和管子都拿了'],
 pad  :['電擊器就位','充電中','準備放電，大家 CLEAR'],
 probe:['超音波推來了','我來掃'],
 rec  :['兩分鐘到了','我記下來了','距離上次檢查已經兩分鐘'],
 pulse:['我摸到脈搏了！','病人有脈搏，停止壓胸','摸不到脈搏'],
 any  :['我這邊好了','我可以支援','我需要幫忙']
},
WALL:{h:22,m:11}
};
const RH=id=>K.RHY[id]||K.RHY.asystole;
const mmt=s=>{s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};

/* ═══════════ 種子亂數（重播的基礎） ═══════════ */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;};}

/* ═══════════ 狀態 ═══════════ */
let S=null;
const use=s=>{S=s;return S;};
const cur=()=>S;

function newState(seed,setup){
  setup=setup||{};
  const rng=mulberry32(seed>>>0);
  const cause=setup.cause&&setup.cause!=='rand'
    ? K.CAUSES.find(c=>c.id===setup.cause)||K.CAUSES[0]
    : K.CAUSES[Math.floor(rng()*K.CAUSES.length)];
  const rhythm=setup.rhythm&&setup.rhythm!=='rand'&&K.STARTRHY.includes(setup.rhythm)
    ? setup.rhythm : K.STARTRHY[Math.floor(rng()*K.STARTRHY.length)];
  const names=setup.names||{};
  const NP=Math.max(2,Math.min(6,setup.n||6));      /* 這場有幾個人 */
  return {
    seed:seed>>>0, _rng:rng, tick:0,
    t:0,anim:0,over:null,phase:'lobby',intro:0,paused:false,
    drip:setup.drip||'none', feed:[], rhythm, check:0,checkRec:null,round:0,
    cause, patient:K.PATIENTS[Math.floor(rng()*K.PATIENTS.length)],
    cpr:null,pauseVent:false,holdCpr:false,cnt:0,needPause:false,breaths:0,vents:0,
    overVent:0,badVent:0,wrongVent:0,noVentT:0,coach:0,coachUsed:0,lastVent:-99,beat:0,ventT:0,
    clearAt:-99, clearCalls:0, noClearShocks:0,
    df:{j:200,sync:false,charged:false,chargeT:0,holder:null},
    shocks:0,syncErr:0,converted:0,nonShock:0,shockLog:[],tShock:null,
    air:'BVM',iv:false,ivFixed:false,ivRoute:null,caths:3,ivTry:0,ioTry:0,
    ettTry:0,badEtt:0,ettSpec:null,tEtt:null,tIv:null,
    epi:0,tEpi:null,epiTimes:[],epiEarly:0,epiLate:0,epiT:-999,
    amioLog:[],amioT:-999,drugLog:[],
    fixed:false,tFixed:null,clues:[],
    decay:0,decays:0,
    rosc:false,roscAt:null,roscFelt:false,roscKnown:false,roscKnownAt:null,roscHint:0,
    cprAfterRosc:0,rearrests:0,roscHR:112,roscSp:88,roscCo:41,
    nibp:{r:0,val:null,n:0},
    leader:null,leaderName:null,handovers:0,noLeaderT:0,noLeaderWarn:0,
    order:null,orders:0,ordersAck:0,ackDelay:[],
    log:[],outbox:[],talk:[],tl:[],checks:[],acts:[],pts:[],
    num:0,den:0,pause:0,maxPause:0,sinceCheck:0,maxGap:0,lateWarn:0,
    pulseChecks:0,cprMoved:0,swaps:0,zapped:0,exhausted:0,leads:false,timeShown:0,
    tray:[],probeHolder:null,
    family:{x:640,y:330,line:0,lt:0,gone:false,pull:40*(6/Math.max(2,NP))},famOut:null,famDelays:0,
    eq:JSON.parse(JSON.stringify(K.EQ0)),
    np:NP,
    ch:K.SLOTS.map((c,i)=>({...c,active:i<NP,n:names[c.id]||c.id.toUpperCase(),
      x:250+i*36,y:752,vx:0,vy:0,path:[],hold:null,
      busy:null,bob:0,fat:0,push:null,down:0,zap:0,act:0,ettSpec:null,dose:null,
      recent:[],downWhy:null,bubble:null,online:false,moving:false,
      cprT:0,dist:0,jobs:0,said:0,slow:false,span:null}))};
}
const rnd=()=>S._rng();

/* ═══════════ 幾何 ═══════════ */
const P_=K.BEDPAD;
const BR=()=>({x1:K.BED.cx-K.BED.w/2-P_,y1:K.BED.cy-K.BED.h/2-P_,
               x2:K.BED.cx+K.BED.w/2+P_,y2:K.BED.cy+K.BED.h/2+P_});
const C=id=>S.ch.find(c=>c.id===id);
const AC=()=>S.ch.filter(c=>c.active);        /* 這場實際有人的角色 */
function nearSt(c){let b=null,d=1e9;for(const k in K.ST){const s=K.ST[k],dd=Math.hypot(c.x-s.x,c.y-s.y-26);
  if(dd<d){d=dd;b=k}}return d<88?b:null;}
function nearEq(c){let b=null,d=1e9;for(const k in S.eq){const e=S.eq[k],dd=Math.hypot(c.x-e.x,c.y-e.y);
  if(dd<d){d=dd;b=k}}return d<112?b:null;}
const bedside=c=>['head','bedL','bedR'].includes(nearSt(c));
const atSide=c=>['bedL','bedR'].includes(nearSt(c));
const inCable=(c,k)=>Math.hypot(c.x-S.eq[k].x,c.y-S.eq[k].y)<=S.eq[k].cable;
const active=c=>c.active&&!c.down&&!S.over&&!S.paused&&S.phase!=='lobby';
const compressing=()=>!!(S.cpr&&!S.pauseVent&&!S.holdCpr&&S.check<=0);
const clearOn=()=>S.t-S.clearAt<10;
const isLeader=c=>S.leader===c.id;
const nearFam=c=>S.family&&!S.family.gone&&Math.hypot(c.x-S.family.x,c.y-S.family.y)<150;
const ccfNow=()=>S.den?S.num/S.den:0;

/* ═══════════ 訊息 ═══════════ */
function say(m,who){const e={t:S.t,m,who:who||null};
  S.log.unshift(e);if(S.log.length>80)S.log.pop();S.outbox.push(e);}
function tl(txt,kind){S.tl.push({t:S.t,txt,kind:kind||''});}
/* 每個人的行為區段 — 報表的泳道圖用（第 9 項） */
function span(c,kind,label){
  endSpan(c);
  c.span={id:c.id,t0:S.t,t1:S.t,kind,label};
  S.acts.push(c.span);
}
function endSpan(c){if(c.span){c.span.t1=S.t;c.span=null;}}
/* 瞬間發生的事（講話、下令、放電…）— 泳道圖上畫成小記號 */
function pt(c,kind,label){S.pts.push({id:c.id,t:S.t,kind,label});}

function push2feed(c,txt,big){
  const e={n:c.n,col:c.c,txt,at:Math.round(S.t*10)/10,big:!!big};
  S.feed.unshift(e); c.said++;
  while(S.feed.length>10){
    let i=-1;
    for(let n=S.feed.length-1;n>=0;n--)if(!S.feed[n].big){i=n;break;}
    if(i<0){let cnt=0;for(const x of S.feed)if(x.big)cnt++;
      if(cnt<=4)break; i=S.feed.length-1;}
    S.feed.splice(i,1);}
  S.talk.push(e);
  if(txt.indexOf('已經 ')===0)S.timeShown=20;
}
function addClue(c,src){
  let x=S.clues.find(q=>q.src===src);
  if(!x){x={src,txt:S.cause[src],t:S.t,known:[c.id],cast:false};S.clues.push(x);}
  else if(!x.known.includes(c.id))x.known.push(c.id);
  say('查到了「'+K.SRC[src]+'」：'+S.cause[src]+'　（只有你知道，要喊出來別人才聽得到）',c.id);
  tl(c.n+' 取得線索：'+K.SRC[src]);
}

/* ═══════════ 移動 ═══════════ */
function blocked(ax,ay,bx,by){const R=BR();for(let i=0;i<=18;i++){const t=i/18,x=ax+(bx-ax)*t,y=ay+(by-ay)*t;
  if(x>R.x1&&x<R.x2&&y>R.y1&&y<R.y2)return true;}return false;}
function outOfBed(x,y){const R=BR();
  if(x>R.x1&&x<R.x2&&y>R.y1&&y<R.y2){
    const d=[x-R.x1,R.x2-x,y-R.y1,R.y2-y],m=Math.min.apply(null,d);
    if(m===d[0])x=R.x1-2;else if(m===d[1])x=R.x2+2;else if(m===d[2])y=R.y1-2;else y=R.y2+2;}
  return{x,y};}
const clampPt=p=>({x:Math.max(24,Math.min(K.W-24,p.x)),y:Math.max(94,Math.min(K.H-16,p.y))});
function route(ax,ay,bx,by){
  const t=clampPt(outOfBed(bx,by));bx=t.x;by=t.y;
  if(!blocked(ax,ay,bx,by))return[{x:bx,y:by}];
  const R=BR(),sx=(Math.abs(ax-R.x1)+Math.abs(bx-R.x1)<Math.abs(ax-R.x2)+Math.abs(bx-R.x2))?R.x1:R.x2;
  const c1={x:sx,y:R.y1},c2={x:sx,y:R.y2};
  const f=Math.hypot(ax-c1.x,ay-c1.y)<Math.hypot(ax-c2.x,ay-c2.y)?c1:c2,s=f===c1?c2:c1;
  const p=[f];if(blocked(f.x,f.y,bx,by))p.push(s);p.push({x:bx,y:by});return p;}
function collide(c){const R=BR();
  if(c.x>R.x1&&c.x<R.x2&&c.y>R.y1&&c.y<R.y2){const d=[c.x-R.x1,R.x2-c.x,c.y-R.y1,R.y2-c.y],m=Math.min.apply(null,d);
    if(m===d[0])c.x=R.x1;else if(m===d[1])c.x=R.x2;else if(m===d[2])c.y=R.y1;else c.y=R.y2;}
  c.x=Math.max(24,Math.min(K.W-24,c.x));c.y=Math.max(94,Math.min(K.H-16,c.y));}
function leaveCpr(c){if(S.cpr===c.id){S.cpr=null;S.cprMoved++;endSpan(c);say(c.n+' 離開床邊 — 壓胸中斷。');}}
function eqSeparate(){
  const ks=Object.keys(S.eq), R=BR();
  for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++){
    const a=S.eq[ks[i]],b=S.eq[ks[j]];
    const ra=(a.w+a.h)/4+8, rb=(b.w+b.h)/4+8;
    let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.01,ov=ra+rb-d;
    if(ov>0){dx/=d;dy/=d;a.x-=dx*ov/2;a.y-=dy*ov/2;b.x+=dx*ov/2;b.y+=dy*ov/2;}}
  for(const k in S.eq){const e=S.eq[k],r=(e.w+e.h)/4;
    if(e.x>R.x1-r&&e.x<R.x2+r&&e.y>R.y1-r&&e.y<R.y2+r){
      const d=[e.x-(R.x1-r),(R.x2+r)-e.x,e.y-(R.y1-r),(R.y2+r)-e.y],m=Math.min.apply(null,d);
      if(m===d[0])e.x=R.x1-r;else if(m===d[1])e.x=R.x2+r;else if(m===d[2])e.y=R.y1-r;else e.y=R.y2+r;}
    e.x=Math.max(60,Math.min(K.W-60,e.x));e.y=Math.max(110,Math.min(K.H-46,e.y));}}

/* ═══════════ 動作 ═══════════ */
function begin(c,l,dur,fn,kind){
  const slow=nearFam(c); const d=slow?dur*1.35:dur;
  c.slow=slow; c.busy={l,r:d,d:d,fn}; c.jobs++;
  span(c,kind||'job',l);
}
function solve(k){
  if(S.fixed)return;
  const fx=Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix];
  if(fx.indexOf(k)<0)return;
  S.fixed=true;S.tFixed=S.t;
  tl('病因處理完成（'+S.cause.n+'）','key');
}
/* 插管成功率提高到 90%（第 1 項）；鏡片與管徑不再影響成功率（第 5 項） */
function ettFail(sp){return sp&&sp.scope==='Video'?.05:.10;}
function shockP(){
  let p=.34;
  p+=({50:-.18,100:0,150:.06,200:.10})[S.df.j]||0;
  p+=(ccfNow()-.5)*.5;
  if(S.rhythm==='pVT')p+=.10;
  if(S.t-S.amioT<180)p+=.15;
  p-=Math.min(.20,(S.t/60)*.02);
  p-=(S.decay/105)*.15;
  return Math.max(.05,Math.min(.85,p));
}
function announceRosc(c){
  if(!S.rosc||S.roscKnown)return;
  S.roscKnown=true;S.roscKnownAt=S.t;S.phase='post';
  if(S.cpr){const cc=C(S.cpr);endSpan(cc);}
  S.cpr=null;S.check=0;S.checkRec=null;
  say('★ 團隊確認恢復自發循環 — 停止壓胸，進入 ROSC 後照護。');
  tl('團隊確認 ROSC','key');
}
const READYALL=(function(){const s={};
  for(const k in K.READYFOR)for(const t of K.READYFOR[k])s[t]=1;return s;})();

const ACT={
 /* ── 移動 ── */
 move(c,p){ if(!active(c)||c.busy)return; c.vx=p.dx||0;c.vy=p.dy||0;c.path=[];
   if(Math.hypot(c.vx,c.vy)>.25)leaveCpr(c); },
 gotoXY(c,p){ if(!active(c)||c.busy)return; c.vx=c.vy=0;
   c.path=route(c.x,c.y,p.x,p.y);leaveCpr(c);},
 goto(c,p){ if(!active(c)||c.busy)return; c.vx=c.vy=0;
   let tx,ty;
   if(K.ST[p.k]){const s=K.ST[p.k],occ=AC().find(o=>o!==c&&nearSt(o)===p.k);
     tx=s.x+(occ?(c.x<s.x?-36:36):0);ty=s.y+26;}
   else if(S.eq[p.k]){const q=S.eq[p.k];tx=q.x;ty=q.y+q.h/2+28;}
   else return;
   c.path=route(c.x,c.y,tx,ty);leaveCpr(c);},
 stop(c){c.vx=c.vy=0;c.path=[];},
 cancel(c){if(c.busy){c.busy=null;endSpan(c);}},
 push(c,p){if(!active(c)||c.hold||!S.eq[p.k])return;if(nearEq(c)!==p.k)return;
   c.push=p.k;span(c,'push','推 '+S.eq[p.k].n);},
 release(c){if(c.push){c.push=null;endSpan(c);}},

 /* ── 急救車 ── */
 draw(c,p){if(!active(c)||c.hold||c.push||nearEq(c)!=='cart')return;
   if(K.DRUGS.indexOf(p.k)<0)return;
   if(p.k==='amio'&&K.AMIO.indexOf(p.dose)<0)return;
   begin(c,'抽 '+K.ITEM[p.k].n+(p.dose?' '+p.dose+'mg':''),7,function(){
     c.hold=p.k;c.dose=p.dose||null;
     c.recent=[K.ITEM[p.k].n+(p.dose?' '+p.dose+'mg':'')+' 已抽好'];
     say(K.ITEM[p.k].n+(p.dose?' '+p.dose+'mg':'')+' 抽好了',c.id);},'prep');},
 grab(c,p){if(!active(c)||c.hold||c.push||nearEq(c)!=='cart')return;
   if(p.k==='leads')return;
   if(p.k==='cath'){if(S.caths<=0)return;c.hold='cath';say('拿了一根留置針',c.id);return;}
   if(p.k==='io'){c.hold='io';say('拿了骨內針',c.id);return;}
   if(p.k==='ett'){
     if(K.SCOPES.indexOf(p.scope)<0||K.BLADES.indexOf(p.blade)<0||K.TUBES.indexOf(p.tube)<0)return;
     begin(c,'備插管器材',9,function(){
       c.hold='ett';c.ettSpec={scope:p.scope,blade:p.blade,tube:p.tube};
       c.recent=['插管器材備妥（'+K.SCOPEN[p.scope]+'・'+p.blade+'・'+p.tube+'）'];
       say('備好了：'+K.SCOPEN[p.scope]+'、'+p.blade+'鏡片、'+p.tube+' 號管',c.id);},'prep');
     return;}
   if(K.GEAR.indexOf(p.k)<0)return;
   begin(c,'拿 '+K.ITEM[p.k].n,2.5,function(){c.hold=p.k;say('拿到 '+K.ITEM[p.k].n,c.id);},'prep');},
 takeTray(c,p){if(!active(c)||c.hold||c.push||nearEq(c)!=='cart')return;
   let i=-1;for(let n=0;n<S.tray.length;n++)if(S.tray[n].k===p.k){i=n;break;}
   if(i<0)return;
   const it=S.tray.splice(i,1)[0];c.hold=it.k;c.dose=it.dose;c.ettSpec=it.ettSpec||null;
   say('從檯子上拿回 '+K.ITEM[it.k].n,c.id);},
 drop(c){if(!c.hold)return;const k=c.hold;
   if(k==='paddle'){S.df.holder=null;c.hold=null;return;}
   if(k==='probe'){S.probeHolder=null;c.hold=null;return;}
   if(nearEq(c)!=='cart')return;
   S.tray.push({k,dose:c.dose||null,ettSpec:c.ettSpec||null});
   say('把 '+K.ITEM[k].n+' 放回急救車上',c.id);
   c.hold=null;c.ettSpec=null;c.dose=null;},

 /* ── 電擊器 ── */
 takeLeads(c){if(!active(c)||c.hold||c.push||nearEq(c)!=='defib'||S.leads)return;
   c.hold='leads';say('從電擊器上拿了 EKG 導線',c.id);},
 takePaddle(c){if(!active(c)||c.hold||c.push)return;if(nearEq(c)!=='defib')return;
   if(S.df.holder&&S.df.holder!==c.id)return;
   c.hold='paddle';S.df.holder=c.id;say(c.n+' 拿起電擊板。');},
 setJ(c,p){if(nearEq(c)!=='defib'&&S.df.holder!==c.id)return;
   if(K.JOULES.indexOf(p.j)>=0){S.df.j=p.j;say('電擊器設定 '+p.j+'J。');}},
 setSync(c){if(nearEq(c)!=='defib'&&S.df.holder!==c.id)return;
   S.df.sync=!S.df.sync;say('電擊器切換為'+(S.df.sync?'同步':'非同步')+'模式。');},
 charge(c){if(!active(c)||S.df.holder!==c.id||!inCable(c,'defib')||S.df.charged||S.df.chargeT>0)return;
   S.df.chargeT=3;say('電擊器開始充電 '+S.df.j+'J。');},
 clear(c){if(!active(c)||S.df.holder!==c.id)return;S.clearAt=S.t;S.clearCalls++;
   pt(c,'say','喊 CLEAR');say('【CLEAR】'+c.n+' 喊了 clear — 壓胸的人要放手。');tl(c.n+' 喊 CLEAR');},
 shock(c){if(!active(c)||S.df.holder!==c.id||!S.df.charged||!atSide(c)||!inCable(c,'defib'))return;
   S.df.charged=false;
   if(S.df.sync){S.syncErr++;say('設在同步模式 — 沒有可同步的 R 波，機器沒有放電。');return;}
   const R=RH(S.rhythm), calledClear=clearOn();
   pt(c,'shock','放電 '+S.df.j+'J');
   S.shocks++;if(S.tShock===null)S.tShock=S.t;
   if(!calledClear)S.noClearShocks++;
   const risky=AC().filter(o=>o!==c&&!o.down&&
     ((S.cpr===o.id&&!S.holdCpr&&!S.pauseVent)||(o.busy&&(atSide(o)||nearSt(o)==='head'))));
   const hit=calledClear?risky.filter(function(){return rnd()<0.30;}):risky;
   if(hit.length){for(const o of hit){o.down=9;o.downWhy='zap';o.zap=1.6;o.push=null;o.busy=null;
       endSpan(o);span(o,'down','被電到倒地');
       if(o.hold==='paddle')S.df.holder=null;if(o.hold==='probe')S.probeHolder=null;o.hold=null;
       if(S.cpr===o.id)S.cpr=null;}
     S.zapped+=hit.length;
     say((calledClear?'⚡ 喊了 clear，但 ':'⚡ 沒有喊 clear — ')
        +hit.map(o=>o.n).join('、')+' 手還在病人身上，被電到倒地。');
     tl('放電傷及 '+hit.map(o=>o.n).join('、'),'key');}
   else if(!calledClear)say('這次沒喊 clear，剛好沒有人碰到病人 — 但這是運氣，不是安全。');
   else say('全員 clear，'+S.df.j+'J 放電完成。');
   let conv=false,p=0;
   if(!R.shock){S.nonShock++;say('這個節律不需要電擊 — 放電沒有作用。');}
   else{
     p=shockP();
     if(rnd()<p){
       conv=true;S.converted++;
       if(S.fixed){S.rhythm='sinus';say('★ 電擊後出現規則心律。');}
       else{S.rhythm='PEA';S.decay=25;
         say('電擊成功轉律 — 但螢幕上是慢而寬的心律，摸不到脈搏（PEA）。病因還沒解除。');}
       tl('第 '+S.shocks+' 次電擊：轉律成功 → '+RH(S.rhythm).short,'key');
     }else{
       say('放電完成 — 節律沒有改變。');
       tl('第 '+S.shocks+' 次電擊：'+S.df.j+'J，未轉律');}
   }
   S.shockLog.push({t:S.t,j:S.df.j,by:c.n,rhythm:R.short,conv,p:Math.round(p*100),clear:calledClear});
   if(S.cpr){const cc=C(S.cpr);endSpan(cc);}
   S.cpr=null;},

 /* ── 超音波 ── */
 takeProbe(c){if(!active(c)||c.hold||c.push)return;if(nearEq(c)!=='echo')return;
   if(S.probeHolder&&S.probeHolder!==c.id)return;
   c.hold='probe';S.probeHolder=c.id;say(c.n+' 拿起超音波探頭。');},
 scan(c){if(!active(c)||c.hold!=='probe'||!bedside(c)||!inCable(c,'echo'))return;
   begin(c,'超音波掃描',15,function(){addClue(c,'echo');c.recent=['超音波掃完了'];},'dx');},

 /* ── 線索 ── */
 chart(c){if(!active(c)||nearEq(c)!=='pc'||c.push)return;
   begin(c,'查病歷',12,function(){addClue(c,'chart');},'dx');},
 ask(c){if(!active(c))return;
   const ok=S.family.gone?nearSt(c)==='door':Math.hypot(c.x-S.family.x,c.y-S.family.y)<140;
   if(!ok)return;
   begin(c,'問家屬與護理師',10,function(){addClue(c,'fam');},'dx');},
 cast(c,p){const x=S.clues.find(q=>q.src===p.src);
   if(!x||x.known.indexOf(c.id)<0)return;
   x.cast=true;x.known=AC().map(o=>o.id);
   pt(c,'say','喊出'+K.SRC[p.src]);
   push2feed(c,'【'+K.SRC[p.src]+'】'+x.txt,1);
   say(c.n+' 大聲喊出：'+x.txt);tl(c.n+' 公開線索：'+K.SRC[p.src],'key');},
 ready(c,p){if(!active(c))return;
   if(!READYALL[p.txt]&&(c.recent||[]).indexOf(p.txt)<0)return;
   pt(c,'say',p.txt);
   push2feed(c,p.txt);say(c.n+' 回報：'+p.txt);
   if(p.txt==='我摸到脈搏了！'||p.txt==='病人有脈搏，停止壓胸')announceRosc(c);},
 timeCall(c){if(nearEq(c)!=='pc')return;
   push2feed(c,'已經 '+Math.floor(S.t/60)+' 分 '+Math.floor(S.t%60)+' 秒，距上次心律檢查 '
     +Math.floor(S.sinceCheck/60)+' 分 '+Math.floor(S.sinceCheck%60)+' 秒',1);
   pt(c,'say','報時');say('紀錄報時。');},

 /* ── Leader ── */
 claimLead(c){if(!active(c)||nearSt(c)!=='foot'||S.leader===c.id)return;
   const had=S.leader;
   if(had){S.handovers++;say('【Leader 交接】'+C(had).n+' → '+c.n);tl('Leader 交接：'+C(had).n+' → '+c.n,'key');}
   else{say('【Leader】'+c.n+' 宣告接下 Leader。');tl(c.n+' 宣告 Leader','key');}
   S.leader=c.id;S.leaderName=c.n;pt(c,'lead','接下 Leader');},
 order(c,p){if(!isLeader(c)||nearSt(c)!=='foot'||K.ORDERS.indexOf(p.txt)<0)return;
   S.order={txt:p.txt,by:c.id,at:S.t,ack:[]};S.orders++;
   pt(c,'order','下令：'+p.txt);say('【Order】'+c.n+'：'+p.txt);tl('Order：'+p.txt);},
 ack(c){if(!S.order||S.order.by===c.id||S.order.ack.indexOf(c.id)>=0)return;
   if(!S.order.ack.length){S.ordersAck++;S.ackDelay.push(S.t-S.order.at);}
   S.order.ack.push(c.id);pt(c,'ack','複誦');say(c.n+' 複誦收到：'+S.order.txt);
   if(S.order.txt==='加強壓胸品質'&&S.cpr===c.id){S.coach=60;S.coachUsed++;c.fat=Math.max(0,c.fat-.35);
     say(c.n+' 調整了手的位置與深度 — EtCO₂ 應該會上來。');}},

 /* ── 壓胸 ── */
 cprStart(c){if(!active(c)||!atSide(c)||S.check>0||c.hold==='paddle')return;
   if(S.cpr===c.id)return;
   if(S.cpr){S.swaps++;const old=C(S.cpr);endSpan(old);say('換手：'+old.n+' → '+c.n);}
   else{say(c.n+' 開始壓胸。');if(!S.tl.some(x=>x.txt==='開始壓胸'))tl('開始壓胸','key');}
   S.cpr=c.id;S.cnt=0;S.needPause=false;S.pauseVent=false;span(c,'cpr','壓胸');},
 cprStop(c){if(S.cpr===c.id){S.cpr=null;endSpan(c);say(c.n+' 停止壓胸。');}},
 callPause(c){if(S.cpr!==c.id||!S.needPause||S.pauseVent)return;
   S.pauseVent=true;S.breaths=0;S.noVentT=0;say('壓到 30 下 — 停手，等床頭通氣。');},
 skipVent(c){if(S.cpr!==c.id||!S.pauseVent||S.noVentT<12)return;
   S.pauseVent=false;S.holdCpr=true;S.cnt=0;S.needPause=false;
   S.badVent++;say('放棄這輪通氣 — 床頭沒有及時配合。');},
 resumeCpr(c){if(S.cpr!==c.id||!S.holdCpr)return;S.holdCpr=false;say(c.n+' 繼續壓胸。');},
 bag(c){if(!active(c)||nearSt(c)!=='head')return;
   c.act=2.0;
   if(S.pauseVent){S.breaths++;S.vents++;
     if(S.noVentT>10&&S.breaths===1){S.badVent++;say('通氣慢了 '+Math.round(S.noVentT)+' 秒才來 — 壓胸一直停著。');}
     if(S.breaths>=2){S.pauseVent=false;S.holdCpr=true;S.cnt=0;S.needPause=false;
       say('兩次通氣完成 — 壓胸的人要自己按「繼續壓胸」。');}}
   else if(S.air==='ETT'){S.vents++;
     if(S.t-(S.lastVent||-99)<4){S.overVent++;say('通氣太快了 — 過度通氣會把靜脈回流壓掉。');}
     S.lastVent=S.t;}
   else if(S.air==='bad'){say('擠得下去，但胸廓沒有起伏 — 氣沒進到肺裡。');}
   else{S.wrongVent++;S.vents++;}},

 /* ── 插管 ── */
 ett(c){if(!active(c)||nearSt(c)!=='head'||S.air!=='BVM'||c.hold)return;
   const helper=AC().find(o=>o!==c&&o.hold==='ett'&&Math.hypot(o.x-c.x,o.y-c.y)<165);
   if(!helper)return;
   const spec=helper.ettSpec;S.ettSpec=spec;
   const fail=ettFail(spec);
   begin(c,'插管（'+K.SCOPEN[spec.scope]+'）',15,function(){S.ettTry++;
     helper.hold=null;helper.ettSpec=null;
     if(rnd()<fail){S.air='bad';S.badEtt++;
       say('管子放進去了，但 EtCO₂ 沒有波形 — 位置不對。');tl('插管失敗（位置不對）','key');}
     else{S.air='ETT';if(S.tEtt===null)S.tEtt=S.t;S.cnt=0;S.needPause=false;S.pauseVent=false;
       say('EtCO₂ 出現方波 — 位置正確，改連續壓胸。');tl('插管成功','key');solve('intubate');}},'air');},
 reett(c){if(!active(c)||nearSt(c)!=='head'||S.air!=='bad'||c.hold)return;
   const helper=AC().find(o=>o!==c&&o.hold==='ett'&&Math.hypot(o.x-c.x,o.y-c.y)<165);
   if(!helper)return;
   const spec=helper.ettSpec;S.ettSpec=spec;
   const fail=Math.max(.04,ettFail(spec)-.04);
   begin(c,'拔管重插',15,function(){S.ettTry++;
     helper.hold=null;helper.ettSpec=null;
     if(rnd()<fail){say('還是沒有波形，再來一次。');}
     else{S.air='ETT';if(S.tEtt===null)S.tEtt=S.t;S.cnt=0;S.needPause=false;S.pauseVent=false;
       say('這次有方波了 — 位置正確。');tl('重插成功','key');solve('intubate');}},'air');},

 /* ── 血管通路 ── */
 iv(c){if(!active(c)||!atSide(c)||c.hold!=='cath')return;
   begin(c,'上針',10,function(){S.ivTry++;c.hold=null;S.caths--;
     if(rnd()<[.55,.45,.35][Math.min(S.ivTry-1,2)]){S.iv=true;S.ivRoute='IV';
       c.recent=['靜脈通路上好了'];say('第 '+S.ivTry+' 針回血了 — 還要固定接輸液',c.id);}
     else{c.recent=['這一針沒上到，我再拿一根'];
       say('第 '+S.ivTry+' 針失敗，針用掉了。剩 '+S.caths+' 根',c.id);}},'access');},
 fixIv(c){if(!active(c)||!atSide(c)||!S.iv||S.ivFixed)return;
   begin(c,'固定接輸液',6,function(){S.ivFixed=true;S.tIv=S.t;
     c.recent=['通路固定好了，可以給藥'];say('通路固定好了，可以給藥',c.id);
     tl('建立血管通路（IV，第 '+S.ivTry+' 針）','key');},'access');},
 ioAccess(c){if(!active(c)||!atSide(c)||c.hold!=='io')return;
   begin(c,'打骨內針 IO',12,function(){S.ioTry++;c.hold=null;
     if(rnd()<.95){S.iv=true;S.ivFixed=true;S.ivRoute='IO';S.tIv=S.t;
       c.recent=['骨內針上好了，可以給藥'];say('骨內針進去了，回抽有骨髓 — 可以直接給藥',c.id);
       tl('建立血管通路（IO）','key');}
     else{c.recent=['骨內針沒進去，再一支'];say('骨內針位置不對，要重來',c.id);}},'access');},

 /* ── 給藥 ── */
 give(c){if(!active(c)||!atSide(c)||!S.ivFixed)return;
   if(!c.hold||K.ITEM[c.hold].k!=='drug')return;
   begin(c,'推藥',2,function(){const k=c.hold,dz=c.dose;c.hold=null;c.dose=null;
     const rec={t:S.t,k,n:K.ITEM[k].n,dose:dz,by:c.n,rhythm:RH(S.rhythm).short,note:''};
     if(k==='epi'){
       S.epi++;if(S.tEpi===null)S.tEpi=S.t;
       const last=S.epiTimes.length?S.epiTimes[S.epiTimes.length-1]:null;
       if(last===null)rec.note='首劑 '+mmt(S.t);
       else{const gap=S.t-last;
         if(gap<180){S.epiEarly++;rec.note='間隔僅 '+Math.round(gap)+' 秒（<3 分鐘）';}
         else if(gap>300){S.epiLate++;rec.note='間隔 '+Math.round(gap)+' 秒（>5 分鐘）';}
         else rec.note='間隔 '+Math.round(gap)+' 秒 ✓';}
       S.epiTimes.push(S.t);S.epiT=S.t;}
     if(k==='amio'){
       const n=S.amioLog.length+1, want=n===1?'300':'150', shockable=RH(S.rhythm).shock;
       rec.note=(dz===want?'第 '+n+' 劑 '+dz+'mg ✓':'第 '+n+' 劑應為 '+want+'mg，給了 '+dz+'mg ✗')
         +(shockable?'':'；當下不是可電擊節律');
       S.amioLog.push({t:S.t,dose:dz,ok:dz===want,shockable});
       if(shockable)S.amioT=S.t;}
     const fx=Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix];
     if(fx.indexOf(k)<0&&k!=='epi'&&k!=='amio')rec.note=rec.note||'與本次病因無關';
     S.drugLog.push(rec);
     c.recent=[K.ITEM[k].n+(dz?' '+dz+'mg':'')+' 已給完'];
     say(K.ITEM[k].n+(dz?' '+dz+'mg':'')+' 推完了',c.id);
     tl(c.n+' 給 '+K.ITEM[k].n+(dz?' '+dz+'mg':''));
     solve(k);},'drug');},

 needle(c){if(!active(c)||!atSide(c)||c.hold!=='needle')return;
   begin(c,'針刺減壓',12,function(){c.hold=null;
     const isPtx=(Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix]).indexOf('needle')>=0;
     say(isPtx?'一大股氣噴出來 — 對了，是張力性氣胸。':'刺進去沒有氣，這不是氣胸。');
     tl(c.n+' 針刺減壓：'+(isPtx?'有氣噴出':'沒有氣'),isPtx?'key':'');
     solve('needle');},'drug');},

 /* ── EKG / 脈搏 / 血壓 ── */
 attachLeads(c){if(!active(c)||c.hold!=='leads'||!atSide(c)||S.leads)return;
   begin(c,'貼上 EKG lead',5,function(){S.leads=true;c.hold=null;
     c.recent=['EKG lead 貼好了'];say('EKG lead 貼上，螢幕上開始有波形。');tl('貼上 EKG lead','key');},'dx');},
 /* 第 4 項：摸脈搏的結果只有自己知道，一定要喊出來 */
 checkPulse(c){if(!active(c)||!atSide(c))return;
   begin(c,'摸脈搏',5,function(){S.pulseChecks++;
     if(S.checkRec)S.checkRec.pulse=true;
     tl(c.n+' 摸脈搏：'+(S.rosc?'有':'沒有'));
     if(S.rosc){S.roscFelt=true;c.recent=['我摸到脈搏了！','病人有脈搏，停止壓胸'];
       say('◆ 摸到脈搏了！強而規則 — 快講出來讓大家停手',c.id);}
     else{c.recent=['摸不到脈搏'];say('摸不到脈搏。',c.id);}},'dx');},
 /* 第 3、4 項：只要人在床邊，隨時都能量 NIBP；結果是客觀的，全隊都看得到 */
 nibp(c){if(!active(c)||!atSide(c)||S.nibp.r>0)return;
   S.nibp.r=30;S.nibp.val=null;S.nibp.n++;say(c.n+' 按下 NIBP，開始量測（30 秒）。');
   tl(c.n+' 量 NIBP');},

 /* ── 心律檢查 ── */
 rhythmCheck(c){if(!active(c)||S.check>0||nearSt(c)!=='foot'||!isLeader(c))return;
   S.round++;S.check=15;
   if(S.cpr){const cc=C(S.cpr);endSpan(cc);}
   S.cpr=null;S.pauseVent=false;S.holdCpr=false;
   S.maxGap=Math.max(S.maxGap,S.sinceCheck);S.sinceCheck=0;
   S.checkRec={t:S.t,n:S.round,rhythm:S.rhythm,call:null,correct:null,pulse:false,dur:0};
   pt(c,'lead','喊停檢查心律');
   say('第 '+S.round+' 次心律檢查 — 全部停手，看螢幕。');
   tl('第 '+S.round+' 次心律檢查（'+RH(S.rhythm).short+'）','key');},
 callRhythm(c,p){if(!isLeader(c)||S.check<=0||!S.checkRec||S.checkRec.call)return;
   const truth=RH(S.checkRec.rhythm).shock?'shock':'noshock';
   S.checkRec.call=p.v;S.checkRec.correct=(p.v===truth);S.checkRec.dur=15-S.check;
   pt(c,'lead','判讀：'+(p.v==='shock'?'可電擊':'不可電擊')+(S.checkRec.correct?' ✓':' ✗'));
   say('【判讀】'+c.n+' 宣告：'+(p.v==='shock'?'可電擊 — 準備電擊':'不可電擊 — 繼續 CPR'));
   tl('判讀宣告：'+(p.v==='shock'?'可電擊':'不可電擊')+(S.checkRec.correct?' ✓':' ✗'),'key');
   S.checks.push(S.checkRec);S.checkRec=null;S.check=0;S.sinceCheck=0;
   say('停頓結束 — 立刻恢復壓胸。');},

 endCase(c){if(!isLeader(c)||S.phase!=='post')return;pt(c,'lead','宣告結束');finish(true);},

 /* ── 家屬 ── */
 escort(c){if(!active(c)||S.family.gone||Math.hypot(c.x-S.family.x,c.y-S.family.y)>140)return;
   c.bubble={lines:K.ESCORTLINES,i:0,t:0};
   begin(c,'帶家屬到門外',8,function(){S.family.gone=true;S.famOut=S.t;c.bubble=null;
     say(c.n+' 把家屬帶到門外，並說明現在的狀況。');tl(c.n+' 帶家屬離開現場','key');},'fam');}
};

/* ═══════════ 時間推進（固定步進） ═══════════ */
function startGame(){
  if(S.phase!=='lobby')return;
  if(S.drip!=='none'){S.iv=true;S.ivFixed=true;S.ivRoute='既有點滴';S.tIv=0;}
  S.phase='intro';S.intro=4.6;
  AC().forEach(function(c,i){c.x=K.ST.door.sx;c.y=K.ST.door.sy;c.path=[{x:250+i*36,y:752}];});
  say('22:11 護理師巡房發現病人沒有反應、沒有脈搏。');
  tl('到場','key');
}
function finish(ok){
  S.over=ok?'ROSC':'DEAD';
  for(const c of S.ch)endSpan(c);
  S.cpr=null;S.check=0;S.checkRec=null;
  say(ok?'★ 急救結束 — 恢復自發循環，交班。':'宣告停止急救。');
  tl(ok?'宣告結束（ROSC）':'宣告停止急救','key');
}
function step(){
  const dt=DT;
  S.tick++;
  if(S.over||S.phase==='lobby'||S.paused)return;
  if(S.phase==='intro'){
    S.intro-=dt;S.anim+=dt;
    for(const c of AC()){if(c.path.length){const p=c.path[0],dx=p.x-c.x,dy=p.y-c.y,
      d=Math.hypot(dx,dy),sp=210*dt;
      if(d<=sp){c.x=p.x;c.y=p.y;c.path.shift();c.bob=0;}else{c.x+=dx/d*sp;c.y+=dy/d*sp;c.bob+=dt*13;}}}
    if(S.intro<=0){S.phase='play';
      say(AC().length+' 個人到齊了。沒有人被指派任何事 — 先講話，先有人宣告 Leader。');}
    return;
  }
  S.t+=dt;S.den+=dt;S.anim+=dt;

  const on=compressing();
  if(on){S.num+=dt;S.pause=0;const cc=C(S.cpr);cc.fat=Math.min(1,cc.fat+dt/110);cc.cprT+=dt;
    if(S.rosc)S.cprAfterRosc+=dt;
    if(cc.fat>=1){cc.down=10;cc.downWhy='tired';cc.fat=.55;S.cpr=null;S.exhausted++;
      endSpan(cc);span(cc,'down','力竭倒地');
      say(cc.n+' 力氣用完了，整個人癱在旁邊 — 要十秒才起得來。');}
    S.beat+=dt;if(S.beat>=.545){S.beat=0;S.cnt++;
      if(S.air!=='ETT'&&S.cnt>=30&&!S.needPause){S.needPause=true;say('壓到 30 下 — 要喊停讓床頭通氣。');}
      if(S.air!=='ETT'&&S.cnt===38)say('超過 30 下還沒停 — 病人沒有得到通氣。');}}
  else{S.pause+=dt;S.maxPause=Math.max(S.maxPause,S.pause);}
  if(S.pauseVent)S.noVentT+=dt;
  if(S.coach>0)S.coach-=dt;
  if(S.timeShown>0)S.timeShown-=dt;

  if(!S.fixed&&!S.rosc&&!S.over&&S.phase==='play'){
    const cc=S.cpr?C(S.cpr):null;
    const q=(on&&cc)?Math.max(.15,1-cc.fat*.62)*(S.air==='ETT'?1:.9):0;
    const epiK=(S.t-S.epiT<120)?0.85:1;
    S.decay=Math.max(0,S.decay+dt*(on?-0.55*q:0.62*epiK));
    if(S.decay>=(S.rhythm==='pVT'?60:105)){
      const nx=S.rhythm==='pVT'?'VF':(S.rhythm==='VF'||S.rhythm==='PEA')?'asystole':null;
      if(nx){S.rhythm=nx;S.decays++;S.decay=30;
        say('灌流一直上不來 — 節律掉成 '+RH(nx).short+'。');tl('節律惡化 → '+RH(nx).short,'key');}
      else S.decay=60;}
  }

  if(S.fixed&&!S.rosc&&!S.over&&S.air!=='bad'&&!RH(S.rhythm).shock){
    if(S.t-S.tFixed>=(S.cause.delay||60)&&ccfNow()>=.5){
      S.rosc=true;S.roscAt=S.t;S.rhythm='sinus';S.roscHR=104+Math.floor(rnd()*18);
      say(S.air==='ETT'?'EtCO₂ 突然跳上來，螢幕出現規則心律 — 有人去摸脈搏。'
                       :'螢幕上突然變成規則的心律 — 有人去摸脈搏。');
      tl('生理上恢復自發循環（團隊尚未確認）','key');}
  }
  if(S.rosc&&!S.roscKnown&&S.cprAfterRosc>=45){
    S.rosc=false;S.cprAfterRosc=0;S.rearrests++;S.rhythm='PEA';S.decay=40;
    S.fixed=true;S.tFixed=S.t;S.roscFelt=false;S.roscHint=0;
    say('在已經有脈搏的心臟上繼續壓胸 — 病人又停了。');tl('ROSC 後持續壓胸導致再停止','key');}
  if(S.rosc&&!S.roscKnown&&S.cprAfterRosc>18&&!S.roscHint){S.roscHint=1;
    say(S.air==='ETT'?'EtCO₂ 一直維持在 40 上下、螢幕是規則心律 — 有人該去摸脈搏。'
                     :'螢幕上一直是規則的心律 — 有人該去摸脈搏。');}
  if(S.phase==='post')S.roscSp=Math.min(97,S.roscSp+dt*0.8);

  for(const c of AC())if(c.act>0)c.act-=dt;

  for(const c of AC()){
    const px=c.x,py=c.y;
    if(c.down>0){c.down-=dt;if(c.down<=0){c.down=0;endSpan(c);say(c.n+' 爬起來了。');}
      c.vx=c.vy=0;c.path=[];continue;}
    if(c.zap>0)c.zap-=dt;
    if(S.cpr!==c.id)c.fat=Math.max(0,c.fat-dt/240);
    if(c.path.length){const p=c.path[0],dx=p.x-c.x,dy=p.y-c.y,d=Math.hypot(dx,dy),sp=200*dt;
      if(d<=sp){c.x=p.x;c.y=p.y;c.path.shift();if(!c.path.length)c.bob=0;}
      else{c.x+=dx/d*sp;c.y+=dy/d*sp;c.bob+=dt*13;}}
    else if(c.vx||c.vy){c.x+=c.vx*200*dt;c.y+=c.vy*200*dt;c.bob+=dt*13;}
    collide(c);
    c.dist+=Math.hypot(c.x-px,c.y-py);
    c.moving=(c.path.length>0||Math.abs(c.vx)+Math.abs(c.vy)>.05);
    if(c.hold==='paddle'||c.hold==='probe'){
      const e=S.eq[c.hold==='paddle'?'defib':'echo'],r=e.cable;
      const dx=c.x-e.x,dy=c.y-e.y,d=Math.hypot(dx,dy);
      if(d>r){c.x=e.x+dx/d*r;c.y=e.y+dy/d*r;c.path=[];c.vx=c.vy=0;}}
    if(c.push){const e=S.eq[c.push],dx=e.x-c.x,dy=e.y-c.y,d=Math.hypot(dx,dy)||1;
      if(d>60){e.x=c.x+dx/d*60;e.y=c.y+dy/d*60;}}
    if(c.bubble){c.bubble.t+=dt;if(c.bubble.t>2.2){c.bubble.t=0;
      c.bubble.i=(c.bubble.i+1)%c.bubble.lines.length;}
      if(!c.busy)c.bubble=null;}
    if(c.busy){c.busy.r-=dt;if(c.busy.r<=0){const f=c.busy.fn;c.busy=null;endSpan(c);if(f)f();}}
    if(c.hold==='paddle'&&S.df.holder!==c.id)c.hold=null;
    if(c.span)c.span.t1=S.t;
  }
  eqSeparate();
  const AA=AC();
  for(let i=0;i<AA.length;i++)for(let j=i+1;j<AA.length;j++){
    const a=AA[i],b2=AA[j];
    if(a.down||b2.down)continue;
    let dx=b2.x-a.x,dy=b2.y-a.y,d=Math.hypot(dx,dy);
    if(d<0.01){const th=(i*2.4+j)*1.7;dx=Math.cos(th);dy=Math.sin(th);d=0.01;}
    if(d<30){const ov=(30-d)/2;dx/=d;dy/=d;
      a.x-=dx*ov;a.y-=dy*ov;b2.x+=dx*ov;b2.y+=dy*ov;collide(a);collide(b2);}}

  if(S.air==='ETT'&&!S.rosc){S.ventT+=dt;if(S.ventT>=6){S.ventT=0;S.vents++;}}
  if(S.nibp.r>0){S.nibp.r-=dt;if(S.nibp.r<=0){
    if(S.rosc){const sys=84+Math.floor(rnd()*26),dia=46+Math.floor(rnd()*16);
      S.nibp.val=sys+'/'+dia;say('NIBP：'+S.nibp.val+' — 有血壓了，但偏低，需要後續處理。');
      tl('NIBP '+S.nibp.val,'key');}
    else{S.nibp.val='量不到';say('NIBP：量不到 — 沒有可測量的血壓。');}}}
  if(S.order&&S.t-S.order.at>25)S.order=null;

  if(S.check>0){S.check-=dt;
    if(S.check<=0){
      if(S.checkRec){S.checkRec.call=null;S.checkRec.correct=null;S.checkRec.dur=15;
        S.checks.push(S.checkRec);S.checkRec=null;
        say('停頓 15 秒到了，Leader 沒有做出判讀宣告 — 恢復壓胸。');}
      S.sinceCheck=0;}}
  else{S.sinceCheck+=dt;
    if(S.sinceCheck>125&&!S.lateWarn){S.lateWarn=1;say('已經超過兩分鐘沒有檢查心律了。');}
    if(S.sinceCheck<=125)S.lateWarn=0;}
  S.maxGap=Math.max(S.maxGap,S.sinceCheck);

  if(S.df.chargeT>0){S.df.chargeT-=dt;
    if(S.df.chargeT<=0){S.df.chargeT=0;S.df.charged=true;say('充電完成 — 喊 clear！');}}

  if(!S.leader&&S.phase==='play'){S.noLeaderT+=dt;
    if(S.noLeaderT>S.noLeaderWarn+45){S.noLeaderWarn=S.noLeaderT;
      say('還沒有人宣告 Leader — 沒有人能下 order，也沒有人能喊停檢查心律。');}}

  if(!S.family.gone){
    S.family.lt+=dt;
    if(S.family.lt>4.5){S.family.lt=0;S.family.line=(S.family.line+1)%K.FAMLINES.length;}
    if(S.family.x>612)S.family.x-=dt*2.2;
    if(S.family.y<352)S.family.y+=dt*1.4;
    S.family.pull-=dt;
    if(S.family.pull<=0){S.family.pull=40*(6/Math.max(2,AC().length));
      const near=AC().filter(o=>!o.down&&!o.busy&&Math.hypot(o.x-S.family.x,o.y-S.family.y)<175);
      if(near.length){const o=near[0];
        o.busy={l:K.FAMPULL[Math.floor(rnd()*K.FAMPULL.length)],r:2.6,d:2.6,fn:null};
        span(o,'fam','被家屬拉住');
        S.famDelays++;
        if(S.cpr===o.id){S.cpr=null;say('家屬拉住 '+o.n+' — 壓胸中斷了。');}
        else say('家屬拉住 '+o.n+' 問話，'+o.n+' 手邊的事停了 2.6 秒。');}}}

  if(S.t>900)finish(false);
}

/* ═══════════ 生理與波形 ═══════════ */
const MORPH={
  sinus:{w:[{a:.11,t:.10,w:.026},{a:-.06,t:.185,w:.010},{a:1.00,t:.212,w:.013},
            {a:-.20,t:.246,w:.016},{a:.26,t:.40,w:.058}]},
  wide :{w:[{a:-.12,t:.14,w:.026},{a:.54,t:.215,w:.036},{a:-.32,t:.30,w:.044},
            {a:-.20,t:.50,w:.075}]},
  vt   :{w:[{a:.62,t:.055,w:.042},{a:-.48,t:.140,w:.048}]}
};
function beatVal(tt,m){let v=0;for(const g of m.w){const z=(tt-g.t)/g.w;v+=g.a*Math.exp(-z*z);}return v;}
const fract=x=>x-Math.floor(x);
const nzf=t=>fract(Math.sin(t*127.1)*43758.5453);
function vfAt(t,coarse){
  const a=coarse?.44:.17;
  const env=.72+.22*Math.sin(t*1.63)+.12*Math.sin(t*.57+1.2);
  const v=Math.sin(t*29.5)+.78*Math.sin(t*45.9+1.1)+.50*Math.sin(t*74.8+2.3)
         +.34*Math.sin(t*19.4+.6)+.22*Math.sin(t*103.2+3.1);
  return a*env*v/2.84;
}
function artAt(t){const p=.545,x=fract(t/p);
  return .24*Math.exp(-Math.pow((x-.28)/.11,2))-.11*Math.exp(-Math.pow((x-.58)/.14,2));}
function ecgAt(G,t,clean){
  if(!G.leads)return 0;
  const r=G.rhythm;let v=0;
  if(r==='VF')v=vfAt(t,G.decay<75);
  else if(r==='pVT')v=beatVal(fract(t/(60/195))*(60/195),MORPH.vt);
  else if(r==='asystole')v=.012*Math.sin(t*2.7)+.007*Math.sin(t*6.3)+(nzf(t)-.5)*.014;
  else if(r==='PEA'){const p=60/36;v=beatVal(fract(t/p)*p,MORPH.wide);}
  else if(r==='sinus'){const p=60/(G.roscHR||112);v=beatVal(fract(t/p)*p,MORPH.sinus);}
  const on=!!(G.cpr&&!G.pauseVent&&!G.holdCpr&&G.check<=0);
  if(!clean&&on)v+=artAt(t);
  return v;
}
function physOf(G){
  const on=!!(G.cpr&&!G.pauseVent&&!G.holdCpr&&G.check<=0),R=RH(G.rhythm);
  const hr0=R.org?R.rate:null;
  /* 沒有進階氣道就沒有 capnography —— 插管之前螢幕上不會有 EtCO₂ */
  if(G.air==='BVM')return{hr:G.rosc?G.roscHR:hr0,sp:G.rosc?Math.round(G.roscSp):null,co2:null};
  if(G.rosc)return{hr:G.roscHR,sp:Math.round(G.roscSp),co2:G.roscCo};
  if(G.air==='bad')return{hr:hr0,sp:null,co2:0};
  const cc=G.cpr?G.ch.find(x=>x.id===G.cpr):null;
  let q=(on&&cc)?Math.max(.15,1-cc.fat*.62):0;
  if(G.coach>0)q=Math.min(1,q*1.30);
  const co2=on?Math.max(3,Math.round(24*q)):0;
  return{hr:hr0,sp:null,co2};
}
function co2At(G,t){
  const p=physOf(G);if(!p.co2)return 0;
  const per=G.air==='ETT'?6:5,x=fract(t/per)*per,a=p.co2/50;
  return x<.45?a*(x/.45):x<per*.72?a*.97:x<per*.72+.45?a*(1-(x-per*.72)/.45):0;
}

/* ═══════════ 報表（第 5 項：結果區精簡） ═══════════ */
function report(G){
  const old=S;S=G;
  const ccf=Math.round(ccfNow()*100)||0;
  const mm=s=>(s===null||s===undefined)?'—':mmt(s);
  const pct=(a,b)=>b?Math.round(a/b*100)+'%':'—';
  const outcome=S.over==='ROSC'?'恢復自發循環，團隊確認並交班'
    :S.rosc&&!S.roscKnown?'⚠ 生理上已恢復循環，但團隊全程沒有察覺':'未恢復循環';
  const right=S.checks.filter(x=>x.correct===true).length;
  const wrong=S.checks.filter(x=>x.correct===false).length;
  const none =S.checks.filter(x=>x.call===null).length;
  const pulseInCheck=S.checks.filter(x=>x.pulse).length;
  const avgAck=S.ackDelay.length?(S.ackDelay.reduce((a,b)=>a+b,0)/S.ackDelay.length).toFixed(1)+' 秒':'—';
  const G2=[];
  G2.push({g:'結果',rows:[
    ['結果',outcome,S.over==='ROSC'?'ok':'no'],
    ['真正的病因',S.cause.n],
    ['正確處置',S.cause.fixLabel||''],
    ['病因處理時間',S.fixed?mm(S.tFixed):'始終沒有找出來',S.fixed?'ok':'no'],
    ['生理 ROSC 時間',S.rosc?mm(S.roscAt):'未達成'],
    ['團隊確認 ROSC',S.roscKnown?mm(S.roscKnownAt)+'（延遲 '+Math.round(S.roscKnownAt-S.roscAt)+' 秒）':'未確認',
      S.roscKnown?'ok':(S.rosc?'no':'')],
    ['總時間',mm(S.t)]
  ]});
  G2.push({g:'閉環溝通與領導',rows:[
    ['Leader',S.leaderName?S.leaderName+'（交接 '+S.handovers+' 次）':'全程沒有人宣告',S.leaderName?'':'no'],
    ['沒有 Leader 的時間',Math.round(S.noLeaderT)+' 秒',S.noLeaderT>60?'no':'ok'],
    ['下達 Order',S.orders+' 次'],
    ['有人複誦',S.ordersAck+' 次（'+pct(S.ordersAck,S.orders)+'）',
      S.orders&&S.ordersAck/S.orders>=.8?'ok':(S.orders?'no':'')],
    ['平均複誦延遲',avgAck],
    ['Leader 要求加強壓胸',S.coachUsed+' 次'],
    ['線索蒐集 / 公開',S.clues.length+' / '+S.clues.filter(q=>q.cast).length+'（共 3）',
      S.clues.filter(q=>q.cast).length>=2?'ok':'no'],
    ['全隊回報次數',S.talk.length+' 則']
  ]});
  G2.push({g:'心律判讀',rows:[
    ['心律檢查',S.round+' 次'],
    ['判讀宣告',right+' 正確 / '+wrong+' 錯誤 / '+none+' 未宣告',wrong||none?'no':(right?'ok':'')],
    ['檢查時同時摸脈搏',pulseInCheck+' / '+S.checks.length+' 次'],
    ['最長未檢查間隔',Math.round(S.maxGap)+' 秒',S.maxGap>140?'no':'ok'],
    ['摸脈搏總次數',S.pulseChecks+' 次'],
    ['量 NIBP 次數',S.nibp.n+' 次']
  ]});
  G2.push({g:'壓胸品質',rows:[
    ['CCF 壓胸分率',ccf+'%',ccf>=60?'ok':'no'],
    ['最長中斷',Math.round(S.maxPause)+' 秒',S.maxPause>10?'no':'ok'],
    ['壓胸換手',S.swaps+' 次'],
    ['壓胸者中途離開',S.cprMoved+' 次',S.cprMoved?'no':'ok'],
    ['壓到力竭倒下',S.exhausted+' 次',S.exhausted?'no':'ok'],
    ['ROSC 後仍持續壓胸',Math.round(S.cprAfterRosc)+' 秒',S.cprAfterRosc>5?'no':''],
    ['壓胸導致再停止',S.rearrests+' 次',S.rearrests?'no':''],
    ['節律因灌流不足而惡化',S.decays+' 次',S.decays?'no':'ok']
  ]});
  G2.push({g:'氣道與通氣',rows:[
    ['插管',S.air==='ETT'?'成功 · '+mm(S.tEtt)+'（'+S.ettTry+' 次，位置不對 '+S.badEtt+'）':
      S.air==='bad'?'管子位置一直不對':'未建立',S.air==='ETT'?'ok':'no'],
    ['使用的喉頭鏡',S.ettSpec?K.SCOPEN[S.ettSpec.scope]+' · '+S.ettSpec.blade+' · '+S.ettSpec.tube+' 號管':'—'],
    ['通氣沒有及時配合',S.badVent+' 次',S.badVent?'no':'ok'],
    ['時機錯誤的通氣',S.wrongVent+' 次'],
    ['過度通氣',S.overVent+' 次'],
    ['通氣總次數',S.vents+' 次']
  ]});
  G2.push({g:'血管通路與用藥',rows:[
    ['血管通路',S.ivFixed?S.ivRoute+' · '+mm(S.tIv):'始終沒有',S.ivFixed?'ok':'no'],
    ['留置針嘗試',S.ivTry+' 次（用掉 '+(3-S.caths)+' / 3）'],
    ['骨內針嘗試',S.ioTry?S.ioTry+' 次':'沒有使用'],
    ['Adrenaline',S.epi+' 劑'+(S.tEpi!==null?' · 首劑 '+mm(S.tEpi):'')],
    ['Adrenaline 間隔',S.epi>1?('過密 '+S.epiEarly+' 次 / 過疏 '+S.epiLate+' 次'):'—',
      (S.epiEarly||S.epiLate)?'no':(S.epi>1?'ok':'')],
    ['Amiodarone',S.amioLog.length?S.amioLog.map((a,i)=>'第'+(i+1)+'劑 '+a.dose+'mg'+(a.ok?' ✓':' ✗')).join('\n'):'沒有使用',
      S.amioLog.length&&S.amioLog.every(a=>a.ok)?'ok':(S.amioLog.length?'no':'')],
    ['給藥總數',S.drugLog.length+' 劑']
  ]});
  G2.push({g:'電擊與安全',rows:[
    ['電擊',S.shocks+' 次'+(S.tShock!==null?' · 首次 '+mm(S.tShock):'')],
    ['成功轉律',S.converted+' 次',S.converted?'ok':''],
    ['喊 CLEAR',S.clearCalls+' 次'],
    ['沒喊 CLEAR 就放電',S.noClearShocks+' 次',S.noClearShocks?'no':'ok'],
    ['被電到倒地',S.zapped+' 人次',S.zapped?'no':'ok'],
    ['對不可電擊節律放電',S.nonShock+' 次',S.nonShock?'no':'ok'],
    ['同步模式誤設',S.syncErr+' 次',S.syncErr?'no':'ok'],
    ['EKG lead',S.leads?'有貼上':'全程沒有貼',S.leads?'ok':'no']
  ]});
  G2.push({g:'現場管理',rows:[
    ['家屬帶離現場',S.famOut!==null?mm(S.famOut):'全程留在床邊',S.famOut!==null?'ok':'no'],
    ['家屬造成的中斷',S.famDelays+' 次',S.famDelays>2?'no':'']
  ]});
  S=old;return G2;
}
function perPerson(G){
  return G.ch.filter(c=>c.active).map(c=>({id:c.id,n:c.n,col:c.c,cpr:Math.round(c.cprT),dist:Math.round(c.dist/10),
    jobs:c.jobs,said:c.said,lead:G.leader===c.id}));
}
function reportText(G){
  let s='IHCA 團隊復甦 — 演練報表\n';
  s+='情境：'+G.cause.n+'　起始心律：'+RH(G.tl.length?(G.checks[0]?G.checks[0].rhythm:G.rhythm):G.rhythm).short+'\n\n';
  for(const g of report(G)){s+='【'+g.g+'】\n';
    for(const r of g.rows)s+='  '+r[0]+'：'+String(r[1]).replace(/\n/g,' / ')+'\n';s+='\n';}
  s+='【每個人做了什麼】\n';
  for(const p of perPerson(G))s+='  '+p.n+(p.lead?'（Leader）':'')+'：壓胸 '+p.cpr+' 秒 · 完成工作 '+p.jobs
    +' 項 · 發言 '+p.said+' 次 · 移動 '+p.dist+' 公尺\n';
  s+='\n【用藥紀錄】\n';
  if(!G.drugLog.length)s+='  （沒有給任何藥）\n';
  for(const d of G.drugLog)s+='  '+mmt(d.t)+'  '+d.n+(d.dose?' '+d.dose+'mg':'')+'　'+d.by
    +'　節律 '+d.rhythm+(d.note?'　— '+d.note:'')+'\n';
  s+='\n【電擊紀錄】\n';
  if(!G.shockLog.length)s+='  （沒有放電）\n';
  for(const x of G.shockLog)s+='  '+mmt(x.t)+'  '+x.j+'J　'+x.by+'　'+x.rhythm
    +'　'+(x.clear?'有喊 clear':'★沒喊 clear')+'　'+(x.conv?'轉律成功':'未轉律')+'（機率 '+x.p+'%）\n';
  s+='\n【時間軸】\n';
  for(const x of G.tl)s+='  '+mmt(x.t)+'  '+x.txt+'\n';
  s+='\n【全場對話】\n';
  for(const x of G.talk)s+='  '+mmt(x.at)+'  '+x.n+'：'+x.txt+'\n';
  return s;
}

/* ═══════════ 對外介面 ═══════════ */
/* 動作套用：伺服器與單機都走這裡，並負責錄影 */
function applyAct(G,cid,act,params){
  const old=S;S=G;
  let okAct=false;
  try{
    if(act==='__start'){startGame();okAct=true;}
    else if(act==='__pause'){S.paused=!!(params&&params.on);okAct=true;}
    else if(act==='__stop'){finish(false);okAct=true;}
    else if(ACT[act]){const c=C(cid);if(c&&c.active){ACT[act](c,params||{});okAct=true;}}
  }catch(e){ if(typeof console!=='undefined') console.error('act error',act,e); }
  S=old;return okAct;
}
/* 給某個玩家看的狀態：別人的線索內容要遮起來 */
function snapshotFor(G,cid){
  /* 快照要小 —— 手機是透過網路收的，每一個位元組都會變成延遲。
     只送畫面真的用得到的欄位，座標四捨五入到小數一位。 */
  const r1=v=>Math.round(v*10)/10, r2=v=>Math.round(v*100)/100;
  const o={
    tick:G.tick, t:r1(G.t), anim:r2(G.anim), over:G.over, phase:G.phase, paused:G.paused,
    np:G.np, patient:G.patient, drip:G.drip,
    rhythm:G.rhythm, decay:r1(G.decay), leads:G.leads, air:G.air,
    cpr:G.cpr, pauseVent:G.pauseVent, holdCpr:G.holdCpr, cnt:G.cnt, needPause:G.needPause,
    breaths:G.breaths, noVentT:r1(G.noVentT), coach:r1(G.coach),
    check:r1(G.check), round:G.round, sinceCheck:r1(G.sinceCheck), timeShown:r1(G.timeShown),
    checkRec:G.checkRec?{pulse:G.checkRec.pulse,call:G.checkRec.call}:null,
    clearAt:r1(G.clearAt), shocks:G.shocks,
    df:{j:G.df.j,sync:G.df.sync,charged:G.df.charged,chargeT:r1(G.df.chargeT),holder:G.df.holder},
    iv:G.iv, ivFixed:G.ivFixed, ivRoute:G.ivRoute, caths:G.caths,
    rosc:G.rosc, roscFelt:G.roscFelt, roscKnown:G.roscKnown, roscHR:G.roscHR, roscSp:r1(G.roscSp), roscCo:G.roscCo,
    nibp:{r:r1(G.nibp.r),val:G.nibp.val,n:G.nibp.n},
    leader:G.leader, probeHolder:G.probeHolder,
    order:G.order?{txt:G.order.txt,by:G.order.by,at:r1(G.order.at),ack:G.order.ack}:null,
    tray:G.tray, family:{x:r1(G.family.x),y:r1(G.family.y),line:G.family.line,gone:G.family.gone},
    feed:G.feed, nTalk:G.talk.length,
    cause:G.over?{id:G.cause.id,n:G.cause.n,fixLabel:G.cause.fixLabel,delay:G.cause.delay}
                :{id:null,n:null,fixLabel:null,delay:null},
    eq:{}
  };
  for(const k in G.eq){const e=G.eq[k];
    o.eq[k]={n:e.n,x:r1(e.x),y:r1(e.y),w:e.w,h:e.h,col:e.col,dark:e.dark,cable:e.cable};}
  o.ch=G.ch.filter(c=>c.active).map(function(c){
    return {id:c.id,c:c.c,coat:c.coat,n:c.n,online:c.online,active:true,
      x:r1(c.x),y:r1(c.y),bob:r2(c.bob),moving:c.moving,
      hold:c.hold,dose:c.dose,ettSpec:c.ettSpec,push:c.push,
      down:c.down>0?r1(c.down):0,downWhy:c.downWhy,zap:c.zap>0?r2(c.zap):0,
      act:c.act>0?r2(c.act):0,fat:r2(c.fat),slow:c.slow,
      busy:c.busy?{l:c.busy.l,r:r1(c.busy.r),d:c.busy.d}:null,
      bubble:(c.bubble&&c.bubble.lines)?{lines:[c.bubble.lines[c.bubble.i]],i:0}:null,
      recent:(c.id===cid)?c.recent:null};});
  o.clues=G.clues.map(function(q){
    const seen=q.cast||q.known.indexOf(cid)>=0;
    return{src:q.src,t:r1(q.t),cast:q.cast,known:q.known,txt:seen?q.txt:null};});
  return o;
}
function history(G){return{talk:G.talk,tl:G.tl,acts:G.acts,pts:G.pts,checks:G.checks,
  drugLog:G.drugLog,shockLog:G.shockLog,perPerson:perPerson(G),report:report(G),text:reportText(G)};}

const API={K,RH,mmt,HZ,DT,mulberry32,newState,use,cur,step,applyAct,startGame,finish,
  C,AC,nearSt,nearEq,bedside,atSide,inCable,active,compressing,clearOn,isLeader,nearFam,ccfNow,
  route,collide,ACT,report,perPerson,reportText,history,snapshotFor,
  ecgAt,co2At,physOf,shockP,ettFail,span,endSpan,pt};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
else if(typeof window!=='undefined')window.IHCA=API;
})();
