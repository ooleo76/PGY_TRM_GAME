/* ══════════════════════════════════════════════════════════════
   難度校準：固定一份「稱職但不完美」的行為腳本，只更換情境與種子，
   跑大量模擬看難度分布。實體演練做不到這件事 —— 這是論文方法段的賣點。
   用法：node batch.js [每格種子數]
   ══════════════════════════════════════════════════════════════ */
const A=require('./ihca-sim.js');
const N=Number(process.argv[2]||300);
const QUAL=process.argv[3]||'good';
const CAUSES=['k','p','h','x','o','t'], RHY=['VF','pVT','asystole','PEA'];
const FIXDRUG={k:'calc',p:'lytic',h:'fluid'};      /* x 用減壓針、o 用插管 */

function run(seed,cause,rhythm,opt){
  opt=opt||{};
  const G=A.newState(seed,{drip:'none',rhythm,cause,n:6,
    names:{a:'A',b:'B',c:'C',d:'D',e:'E',f:'F'}});
  A.use(G);
  const P=id=>G.ch.find(c=>c.id===id);
  const act=(cid,a,p)=>A.applyAct(G,cid,a,p);
  const st=(id,k)=>{const c=P(id),s=A.K.ST[k];c.x=s.x;c.y=s.y+26;c.path=[];c.vx=c.vy=0;};
  const eqAt=(id,k)=>{const c=P(id),e=G.eq[k];c.x=e.x+40;c.y=e.y+40;c.path=[];c.vx=c.vy=0;};
  const free=id=>{const c=P(id);return !c.busy&&!c.down;};

  /* 壓胸輪替：a 與 c 每 120 秒換手，中間不讓地板空著 */
  const Q=opt.quality||'good';
  const GAP=(Q==='good')?0.5:25;     /* 心律檢查與電擊之後，多久才有人想到要恢復壓胸 */
  const SWAP=(Q==='good');           /* 生疏的隊伍不會主動換手 */
  const FIXR=(Q==='good')?1:3;       /* 生疏的隊伍比較晚才處理病因 */
  let cprMan='a', lastSwap=0;
  function keepCpr(){
    if(G.check>0||G.over||G.rosc)return;
    if(SWAP&&G.t-lastSwap>120&&free('a')&&free('c')){
      cprMan=(cprMan==='a')?'c':'a';lastSwap=G.t;
      st(cprMan,cprMan==='a'?'bedL':'bedR');act(cprMan,'cprStart');return;}
    if(G.cpr)return;
    for(const id of [cprMan,'a','c']) if(free(id)){
      st(id,id==='a'?'bedL':'bedR');if(act(id,'cprStart'))return;}
  }
  /* 生疏的隊伍做完事不會馬上想到要回去壓胸 */
  const kc=()=>{if(Q==='good')keepCpr();};
  let acc=0;
  function tick(){A.use(G);A.step();acc+=A.DT;
    if(acc>=GAP){acc-=GAP;keepCpr();}}
  function wait(sec){const n=Math.round(sec*A.HZ);for(let i=0;i<n&&!G.over;i++)tick();}
  function waitOr(sec,pred){const n=Math.round(sec*A.HZ);
    for(let i=0;i<n&&!G.over;i++){if(pred())return true;tick();}return pred();}
  function until(pred,max){const n=Math.round((max||30)*A.HZ);
    for(let i=0;i<n&&!G.over;i++){if(pred())return true;tick();}return pred();}

  act(null,'__start'); wait(5);
  st('a','bedL');st('b','foot');st('c','bedR');eqAt('d','defib');eqAt('e','cart');eqAt('f','pc');
  act('b','claimLead'); act('a','cprStart'); lastSwap=G.t;
  act('b','order',{txt:'開始壓胸',to:'a'}); act('a','ack'); act('a','doneReport');

  /* d：貼監測貼片 → 把電擊器推到床邊 → 拿板 */
  act('d','takeLeads'); until(()=>P('d').hold==='leads',10);
  st('d','bedR'); act('d','attachLeads'); until(()=>G.leads,20);
  eqAt('d','defib'); act('d','push',{k:'defib'});
  st('d','bedR'); wait(1); act('d','release');
  eqAt('d','defib'); act('d','takePaddle'); act('d','setJ',{j:opt.j||200});

  /* e：建立血管通路 */
  /* 稱職的團隊會把通路建起來：留置針用完就換骨內針，不會半途放棄 */
  for(let a2=0;a2<6&&!G.ivFixed;a2++){
    if(G.iv){st('e','bedL');act('e','fixIv');until(()=>G.ivFixed,18);continue;}
    eqAt('e','cart'); if(P('e').hold)act('e','drop');
    if(G.caths>0&&G.ivTry<2){act('e','grab',{k:'cath'});until(()=>P('e').hold==='cath',14);
      st('e','bedL');act('e','iv');until(()=>!P('e').busy,22);}
    else{act('e','grab',{k:'io'});until(()=>P('e').hold==='io',14);
      st('e','bedL');act('e','ioAccess');until(()=>!P('e').busy,22);}}

  /* f：查病歷並公開 */
  eqAt('f','pc'); act('f','chart'); until(()=>G.clues.length>0,25);
  act('f','cast',{src:'chart'});

  /* 主迴圈：每 2 分鐘一次心律檢查，該電就電，該給藥就給 */
  let epiGiven=0, amioGiven=0, echoDone=false, famDone=false, fixTried=false, ettDone=false;
  let firstShockConv=null, firstShockJ=null;
  for(let round=0;round<9&&!G.over&&!G.rosc;round++){
    waitOr(Math.max(0,118-(G.t-(G.checks.length?G.checks[G.checks.length-1].t:0))),()=>G.rosc);
    if(G.over||G.rosc)break;
    st('b','foot'); act('b','rhythmCheck'); wait(2);
    const shockable=A.RH(G.rhythm).shock;
    act('b','callRhythm',{v:shockable?'shock':'noshock'});
    until(()=>G.check<=0,12);
    if(shockable){
      st('d','bedR');
      if(!G.df.charged){act('d','charge');until(()=>G.df.charged,10);}
      act('d','clear'); wait(1); 
      const before=G.converted, sBefore=G.shocks, jNow=G.df.j;
      act('d','shock');
      if(G.shocks>sBefore&&firstShockConv===null){
        firstShockConv=(G.converted>before);firstShockJ=jNow;}
      wait(1); kc();
      act('d','charge');
    }
    /* Adrenaline：可電擊節律等第一次電擊之後；不可電擊節律盡早 */
    const wantEpi=(G.epi===0)?(shockable?G.shocks>=1:true):(G.t-G.epiT>=210);
    if(wantEpi&&G.ivFixed&&free('e')){
      eqAt('e','cart'); if(P('e').hold)act('e','drop');
      act('e','draw',{k:'epi'}); until(()=>P('e').hold==='epi',12);
      st('e','bedR'); act('e','give'); until(()=>!P('e').hold,8); epiGiven++; kc();}
    /* Amiodarone：第 3 次電擊之後仍是 VF/pVT */
    if(!amioGiven&&G.shocks>=3&&A.RH(G.rhythm).shock&&G.ivFixed&&free('e')){
      eqAt('e','cart'); if(P('e').hold)act('e','drop');
      act('e','draw',{k:'amio',dose:'300'});
      until(()=>P('e').hold==='amio',12);
      st('e','bedR'); act('e','give'); until(()=>!P('e').hold,8); amioGiven++; kc();}
    /* f：超音波 */
    if(!echoDone&&round>=1&&free('f')){
      eqAt('f','echo'); act('f','takeProbe'); act('f','push',{k:'echo'});
      st('f','bedR'); wait(1); act('f','release');
      act('f','scan'); until(()=>!P('f').busy,20);
      if(G.clues.some(q=>q.src==='echo'))act('f','cast',{src:'echo'});
      act('f','drop'); echoDone=true; kc();}
    /* b：問家屬（Leader 兼做，簡化） */
    if(!famDone&&round>=1&&free('f')){
      P('f').x=G.family.x+30;P('f').y=G.family.y+10;P('f').path=[];
      act('f','ask'); until(()=>!P('f').busy,18);
      if(G.clues.some(q=>q.src==='fam'))act('f','cast',{src:'fam'});
      act('f','escort'); until(()=>G.family.gone,15); famDone=true; kc();}
    /* 插管：低血氧病因才需要，其他情境也會做但不影響病因 */
    if(!ettDone&&round>=(cause==='o'?1:3)&&free('e')&&free('c')){
      eqAt('e','cart'); if(P('e').hold)act('e','drop');
      act('e','grab',{k:'ett',scope:'Video',blade:'3 號',tube:'7.5'});
      until(()=>P('e').hold==='ett',12);
      st('e','head'); const cm=(cprMan==='c')?'a':'c';
      st(cm,'head'); act(cm,'ett'); until(()=>!P(cm).busy,20);
      if(G.air==='bad'){eqAt('e','cart'); if(P('e').hold)act('e','drop');
        act('e','grab',{k:'ett',scope:'Video',blade:'3 號',tube:'7.5'});
        until(()=>P('e').hold==='ett',12);
        st('e','head');act(cm,'reett');until(()=>!P(cm).busy,20);}
      ettDone=(G.air==='ETT'); kc();}
    /* 病因處置：線索齊了就下手 */
    if(!G.fixed&&round>=FIXR&&free('e')&&(G.ivFixed||cause==='x'||cause==='t')){
      const d=FIXDRUG[cause];
      if(d){eqAt('e','cart'); if(P('e').hold)act('e','drop');
        act('e','draw',{k:d}); until(()=>P('e').hold===d,12);
        st('e','bedR'); act('e','give'); until(()=>!P('e').hold,8);}
      else if(cause==='x'){eqAt('e','cart'); act('e','grab',{k:'needle'});
        until(()=>P('e').hold==='needle',12);
        st('e','bedR'); act('e','needle'); until(()=>!P('e').busy,18);}
      else if(cause==='t'){eqAt('e','cart'); act('e','grab',{k:'peri'});
        until(()=>P('e').hold==='peri',12);
        st('e','bedR'); act('e','peri'); until(()=>!P('e').busy,20);}
      fixTried=G.fixed; kc();}
  }
  /* 撐到起效 */
  until(()=>G.rosc,180);
  if(G.rosc){st('b','foot');act('b','rhythmCheck');wait(2);
    act('b','callRhythm',{v:'noshock'});until(()=>G.check<=0,10);
    const cm=cprMan;st(cm,'bedL');act(cm,'checkPulse');until(()=>!P(cm).busy,10);
    act(cm,'ready',{txt:'我摸到脈搏了！'});wait(2);act('b','endCase');}
  else if(!G.over)A.applyAct(G,null,'__stop');

  return {rosc:!!G.rosc, over:G.over, t:G.t, ivFixed:G.ivFixed, air:G.air,
    clues:G.clues.length, ivTry:G.ivTry, ioTry:G.ioTry,
    ccf:G.den2?G.num2/G.den2:0, ccfAll:G.den?G.num/G.den:0, ccfPen:G.ccfPenFinal,
    shocks:G.shocks, conv:G.converted, firstShockConv, firstShockJ,
    epi:G.epi, decays:G.decays, fixed:G.fixed, tFixed:G.tFixed,
    maxPause:G.maxPauseAfterStart, swaps:G.swaps, rearrests:G.rearrests,
    ackRate:G.orders?G.ordersAck/G.orders:null};
}

/* ── 統計工具 ── */
const q=(a,p)=>{if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y);
  const i=(b.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i);
  return lo===hi?b[lo]:b[lo]+(b[hi]-b[lo])*(i-lo);};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
const ci=(k,n)=>{if(!n)return '—';const p=k/n,se=Math.sqrt(p*(1-p)/n);
  return (p*100).toFixed(1)+'% ['+Math.max(0,(p-1.96*se)*100).toFixed(1)+'–'
    +Math.min(100,(p+1.96*se)*100).toFixed(1)+']';};

console.log('引擎 '+A.ENGINE+'　每格 '+N+' 個種子　行為水準：'
  +(QUAL==='good'?'稱職（照指引）':'生疏（壓胸常中斷、不換手、較晚處理病因）')+'\n');
const rows=[]; const allFirst={};
for(const cause of CAUSES){
  for(const rhythm of RHY){
    const R=[];
    for(let i=0;i<N;i++)R.push(run(1000000+i*7919,cause,rhythm,{quality:QUAL}));
    const ros=R.filter(r=>r.rosc).length;
    const ccf=R.map(r=>r.ccf*100);
    const dur=R.filter(r=>r.rosc).map(r=>r.t);
    const fs=R.filter(r=>r.firstShockConv!==null);
    if(fs.length){allFirst[rhythm]=allFirst[rhythm]||[0,0];
      allFirst[rhythm][0]+=fs.filter(r=>r.firstShockConv).length;
      allFirst[rhythm][1]+=fs.length;}
    rows.push({cause,rhythm,n:N,ros,
      rosPct:ros/N*100,
      ccfMed:q(ccf,.5), ccfLo:q(ccf,.25), ccfHi:q(ccf,.75),
      durMed:dur.length?q(dur,.5):NaN,
      shocks:mean(R.map(r=>r.shocks)),
      firstShock:(()=>{const f=R.filter(r=>r.firstShockConv!==null);
        return f.length?f.filter(r=>r.firstShockConv).length/f.length*100:NaN;})(),
      decays:mean(R.map(r=>r.decays)),
      pause:q(R.map(r=>r.maxPause),.5),
      fixPct:R.filter(r=>r.fixed).length/N*100});
  }
}
const pad=(s,n)=>String(s).padEnd(n);
const padl=(s,n)=>String(s).padStart(n);
console.log(pad('病因',22)+pad('起始',7)+padl('ROSC%',7)+padl('CCF中位',9)
  +padl('(IQR)',13)+padl('時長中位',10)+padl('電擊',6)+padl('病因解除',7)+padl('最長中斷',10));
console.log('─'.repeat(90));
const CN={k:'高血鉀',p:'肺栓塞',h:'低血容',x:'張力性氣胸',o:'低血氧',t:'心包填塞'};
for(const r of rows){
  console.log(pad(CN[r.cause],22)+pad(r.rhythm,7)+padl(r.rosPct.toFixed(0),7)
    +padl(r.ccfMed.toFixed(0)+'%',9)
    +padl(r.ccfLo.toFixed(0)+'–'+r.ccfHi.toFixed(0),13)
    +padl(isNaN(r.durMed)?'—':A.mmt(r.durMed),10)
    +padl(r.shocks.toFixed(1),6)+padl(r.fixPct.toFixed(0)+'%',7)
    +padl(r.pause.toFixed(0)+'s',10));
}
console.log('\n── 依病因彙總（跨四種起始心律）──');
for(const c of CAUSES){
  const g=rows.filter(r=>r.cause===c);
  const k=g.reduce((a,r)=>a+r.ros,0), n=g.reduce((a,r)=>a+r.n,0);
  console.log('  '+pad(CN[c],14)+'ROSC '+ci(k,n)
    +'　CCF 中位 '+(mean(g.map(r=>r.ccfMed))).toFixed(0)+'%');
}
console.log('\n── 依起始心律彙總（跨五種病因）──');
for(const rh of RHY){
  const g=rows.filter(r=>r.rhythm===rh);
  const k=g.reduce((a,r)=>a+r.ros,0), n=g.reduce((a,r)=>a+r.n,0);
  const f=allFirst[rh];
  console.log('  '+pad(rh,8)+'ROSC '+ci(k,n)
    +(f?'　首次電擊轉律 '+ci(f[0],f[1]):''));
}
const K2=rows.reduce((a,r)=>a+r.ros,0), N2=rows.reduce((a,r)=>a+r.n,0);
console.log('\n整體 ROSC 率：'+ci(K2,N2)+'　（目標區間 55–70%）');
