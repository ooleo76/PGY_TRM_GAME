/* 產生一場完整、大致做對的演練錄影 — 用來檢查報表、泳道圖與重播
   v4.0：含新的三步判讀、插管後自行確認管路、輸血、口頭「收到」 */
const A=require('./ihca-sim.js'),fs=require('fs');
const seed=Number(process.argv[2]||20260909);
const setup={drip:'none',rhythm:'VF',cause:'k',n:6,names:{a:'季',b:'恆',c:'明',d:'華',e:'安',f:'瑄'}};
const G=A.newState(seed,setup);const ev=[];
const P=id=>G.ch.find(c=>c.id===id);
function act(cid,a,p){if(A.applyAct(G,cid,a,p))ev.push({k:G.tick,c:cid,a,p:p||null});}
function tick(){A.use(G);A.step();}
function wait(sec){const n=Math.round(sec*A.HZ);for(let i=0;i<n&&!G.over;i++)tick();}
function until(pred,maxSec){const n=Math.round((maxSec||40)*A.HZ);
  for(let i=0;i<n&&!G.over;i++){if(pred())return true;tick();}return pred();}
const idle=id=>()=>!P(id).busy&&!P(id).path.length;
const at=(id,st)=>()=>{const c=P(id);let b=null,d=1e9;
  for(const k in A.K.ST){const s=A.K.ST[k],dd=Math.hypot(c.x-s.x,c.y-s.y-26);if(dd<d){d=dd;b=k;}}
  return d<88&&b===st&&!c.busy;};
const near=(id,eq)=>()=>{const c=P(id),e=G.eq[eq];return Math.hypot(c.x-e.x,c.y-e.y)<100&&!c.busy;};
function go(id,k,cond){act(id,'goto',{k});until(cond||idle(id),25);}
/* 閉環三段：下令要指名，被指名的人複誦，做完回報。旁邊的人按「收到」。 */
function order(txt,to){act('b','order',{txt,to});
  if(to){act(to,'ack');const q=G.pings[G.pings.length-1];
         if(q)act(to==='a'?'c':'a','roger',{id:q.id});
         act(to,'doneReport');}}

act(null,'__start'); wait(5.2);

/* 就位 */
act('a','goto',{k:'bedL'}); act('b','goto',{k:'foot'}); act('c','goto',{k:'head'});
act('d','goto',{k:'defib'}); act('e','goto',{k:'cart'}); act('f','goto',{k:'pc'});
until(()=>at('a','bedL')()&&at('b','foot')(),25);
act('b','claimLead'); act('a','cprStart');
order('開始壓胸','a');

/* 貼監測貼片 */
until(near('d','defib'),25); act('d','takeLeads');
go('d','bedR',at('d','bedR')); act('d','attachLeads'); until(()=>G.leads,20);

/* 查病歷 + 上針 */
until(near('f','pc'),20); act('f','chart');
/* 留置針只有三根，沒上到就換骨內針 —— 稱職的隊伍不會半途放棄 */
for(let a2=0;a2<5&&!G.ivFixed;a2++){
  if(G.iv){go('e','bedL',at('e','bedL'));act('e','fixIv');until(()=>G.ivFixed,20);continue;}
  go('e','cart',near('e','cart'));
  if(P('e').hold)act('e','drop');
  if(G.caths>0&&G.ivTry<2){act('e','grab',{k:'cath'});until(()=>P('e').hold==='cath',12);
    go('e','bedL',at('e','bedL'));act('e','iv');until(()=>!P('e').busy,24);}
  else{act('e','grab',{k:'io'});until(()=>P('e').hold==='io',12);
    go('e','bedL',at('e','bedL'));act('e','ioAccess');until(()=>!P('e').busy,24);}
}
until(()=>G.clues.length>0,25); act('f','cast',{src:'chart'});
act('a','ready',{txt:'我需要換手'});

/* 推電擊器過來、拿板、充電 */
until(near('d','defib'),20); act('d','push',{k:'defib'});
act('d','goto',{k:'bedR'}); until(at('d','bedR'),25);
act('d','release'); go('d','defib',near('d','defib'));
act('d','takePaddle'); act('d','setJ',{j:200}); act('d','charge');
until(()=>G.df.charged,15);

/* 心律檢查 → 三步判讀 → clear → 放電 */
function fullCheck(){
  act('b','rhythmCheck'); 
  /* 摸脈搏跟看螢幕同時做 —— 判 PEA 之前一定要有人真的摸過 */
  const pm=(G.cpr==='a')?'c':'a';
  go(pm,'bedR',at(pm,'bedR')); act(pm,'checkPulse');
  wait(1.6);
  const rid={VF:'VF',pVT:'VT',asystole:'ASYS',PEA:'ORG',sinus:'ORG'}[G.rhythm];
  act('b','callRhythm',{r:rid});
  if(rid==='ORG'){
    until(()=>!P(pm).busy,7);
    act(pm,'ready',{txt:G.rosc?'我摸到脈搏了！':'摸不到脈搏'});
    act('b','callPerf',{v:G.rosc?'pulse':'nopulse'});}
  const sh=A.RH(G.rhythm).shock;
  act('b','callDecision',{v:sh?'shock':'noshock'});
  until(()=>G.check<=0,12);
  return sh;
}
for(let round=0;round<5&&!A.RH(G.rhythm).org;round++){
  fullCheck();
  go('d','bedR',at('d','bedR'));
  act('d','clear'); wait(1.5); act('d','shock'); wait(1);
  act('a','cprStart');
  if(round===0){
    go('e','cart',near('e','cart')); act('e','draw',{k:'epi'}); until(()=>P('e').hold==='epi',15);
    go('e','bedR',at('e','bedR')); act('e','give'); until(()=>!P('e').hold,10);
    act('a','cprStart');
  }
  if(G.shocks>=3&&!G.amioLog.length&&A.RH(G.rhythm).shock){
    go('e','cart',near('e','cart')); act('e','draw',{k:'amio',dose:'300'});
    until(()=>P('e').hold==='amio',15);
    go('e','bedR',at('e','bedR')); act('e','give'); until(()=>!P('e').hold,10);
    act('a','cprStart');
  }
  if(!G.df.charged){go('d','defib',near('d','defib'));act('d','charge');until(()=>G.df.charged,15);
    go('d','bedR',at('d','bedR'));}
  wait(20);
}
act('d','drop');

/* 換手（照指引每兩分鐘換） */
go('c','bedL',at('c','bedL')); act('a','cprStop'); act('c','cprStart');
go('a','head',at('a','head'));
order('加強壓胸品質','c');

/* 提出疑慮 → Leader 回應（CUS 的重點在被聽見） */
act('e','concern',{txt:'我有疑慮，可以再確認一次嗎？'});
wait(2); act('b','respondConcern',{});

/* 超音波 */
go('f','echo',near('f','echo')); act('f','takeProbe'); act('f','push',{k:'echo'});
act('f','goto',{k:'bedR'}); until(at('f','bedR'),25); act('f','release');
act('f','scan'); until(()=>G.clues.length>1,25);
act('f','cast',{src:'echo'});
act('f','drop');

/* 插管：急救車的人先問床頭要什麼規格 → 備 → 放管 → 自己接 EtCO₂ 確認 */
const SPEC={scope:'Video',blade:'3 號',tube:'7.5'};
go('a','head',at('a','head'));
for(let tryN=0;tryN<3&&G.air!=='ETT';tryN++){
  if(G.air==='BVM'){
    go('e','cart',near('e','cart'));
    if(P('e').hold)act('e','drop');
    act('e','askEtt');
    act('a','answerEtt',SPEC);
    act('e','grab',Object.assign({k:'ett'},SPEC));
    until(()=>P('e').hold==='ett',20);
    go('e','head',at('e','head'));
    act('a','ett'); until(()=>!P('a').busy,26);
  }
  act('a','confirmTube'); until(()=>P('a').tubeSeen,18);
  act('a','callTube',{v:(G.air==='ETT')?'ok':'out'});
}
act('c','cprStart');

/* 紀錄員補一筆 */
go('f','pc',near('f','pc')); act('f','recBegin'); wait(4);
act('f','recSubmit',{rhythm:'VF',shock:'200 J',drug:'Epinephrine 1 mg',proc:'貼監測貼片'});

/* 問家屬 + 帶家屬出去 */
go('f','bedR',at('f','bedR'));
P('f').x=G.family.x+30;P('f').y=G.family.y+10;P('f').path=[];
act('f','ask'); until(()=>G.clues.length>2,20);
act('f','cast',{src:'fam'});
act('f','escort'); until(()=>G.family.gone,20);
act('c','cprStart');

/* 正解：Ca gluconate */
go('e','cart',near('e','cart')); act('e','draw',{k:'calc'}); until(()=>P('e').hold==='calc',15);
go('e','bedR',at('e','bedR')); act('e','give'); until(()=>G.fixed,12);
act('c','cprStart');

/* 撐到起效 —— 中間照樣每兩分鐘檢查一次心律 */
for(let i=0;i<6&&!G.rosc&&!G.over;i++){
  until(()=>G.rosc,110);
  if(G.rosc||G.over)break;
  fullCheck(); act('c','cprStart');
}
if(G.rosc){
  fullCheck();                                   /* 這一次會判成「有脈搏 → ROSC」 */
  if(!G.roscKnown){
    go('c','bedL',at('c','bedL')); act('c','checkPulse'); until(()=>!P('c').busy,12);
    act('c','ready',{txt:'我摸到脈搏了！'});}
  wait(1);
  go('c','bedR',at('c','bedR')); act('c','nibp'); until(()=>G.nibp.val,40);
  act('c','ready',{txt:'我這邊好了'});
  wait(4);
  act('b','endCase');
}else act(null,'__stop');
wait(1);

const rec={v:5,engine:A.ENGINE,seed,setup,events:ev,cause:G.cause.n,over:G.over,dur:Math.round(G.t),
  endedAt:new Date().toISOString()};
try{fs.mkdirSync('recordings',{recursive:true});}catch(e){}
fs.writeFileSync('recordings/demo-good.json',JSON.stringify(rec));
console.log('engine=',A.ENGINE,'over=',G.over,'t=',A.mmt(G.t),'events=',ev.length,
  'bytes=',JSON.stringify(rec).length,'spans=',G.acts.length,'tl=',G.tl.length);
console.log(A.reportText(G).split('【心律判讀】')[0]);
