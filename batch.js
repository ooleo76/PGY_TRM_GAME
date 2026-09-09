/* ══════════════════════════════════════════════════════════════
   難度校準：固定一份行為腳本，只更換情境與種子，跑大量模擬看難度分布。
   實體演練做不到這件事 —— 這是論文方法段的賣點。

   v4.0 三檔行為水準（論文附錄要照抄這一段的參數）：
     optimal  近乎完美：壓胸幾乎不中斷、每 2 分鐘換手、第一循環就處理病因
     typical  臨床上常見：CCF 目標 ~70%、換手不規律、第 3 循環才處理病因
     poor     生疏：壓胸常中斷、不換手、很晚才處理病因、管路判讀會出錯

   用法：node batch.js [每格種子數] [optimal|typical|poor]
   ══════════════════════════════════════════════════════════════ */
const A=require('./ihca-sim.js');
const N=Number(process.argv[2]||300);
const QUAL=process.argv[3]||'typical';
const CAUSES=['k','p','h','x','o','t'], RHY=['VF','pVT','asystole','PEA'];
/* 每一種病因的正解。x 用減壓針、t 用心包穿刺、o 用插管，都不是「推一支藥」 */
const FIXDRUG={k:'calc',p:'lytic',h:'prbc'};

/* 行為參數表 —— 三檔的差別只在這裡，其餘腳本完全相同 */
const PROFILE={
  /* duty  = 目標壓胸分率（20 秒為一個週期，刻意讓地板空著 (1-duty)*20 秒）
     fixAt = 幾秒之後才把正確的處置做下去（診斷表現的替身變項）
     tubeErr = 判讀 EtCO₂ 波形出錯的機率 */
  optimal:{duty:0.92, swap:true,  swapEvery:120, fixAt:200, tubeErr:0,    pulseDuringCheck:true,  ventEvery:6},
  typical:{duty:0.72, swap:true,  swapEvery:200, fixAt:380, tubeErr:0.12, pulseDuringCheck:true,  ventEvery:10},
  poor:   {duty:0.52, swap:false, swapEvery:999, fixAt:560, tubeErr:0.35, pulseDuringCheck:false, ventEvery:22}
};

function run(seed,cause,rhythm,opt){
  opt=opt||{};
  const P=PROFILE[opt.quality||'typical']||PROFILE.typical;
  const G=A.newState(seed,{drip:'none',rhythm,cause,n:6,
    names:{a:'A',b:'B',c:'C',d:'D',e:'E',f:'F'}});
  A.use(G);
  const Ch=id=>G.ch.find(c=>c.id===id);
  const act=(cid,a,p)=>A.applyAct(G,cid,a,p);
  const st=(id,k)=>{const c=Ch(id),s=A.K.ST[k];c.x=s.x;c.y=s.y+26;c.path=[];c.vx=c.vy=0;};
  const eqAt=(id,k)=>{const c=Ch(id),e=G.eq[k];c.x=e.x+40;c.y=e.y+40;c.path=[];c.vx=c.vy=0;};
  const free=id=>{const c=Ch(id);return !c.busy&&!c.down;};
  /* 校準腳本自己的亂數（判讀錯誤用），不去動引擎的四條流 */
  let rs=(seed^0x5bf03635)>>>0;
  const rr=()=>{rs^=rs<<13;rs>>>=0;rs^=rs>>17;rs^=rs<<5;rs>>>=0;return rs/4294967296;};

  let cprMan='a', lastSwap=0;
  function keepCpr(){
    if(G.check>0||G.over||G.rosc)return;
    if(P.swap&&G.t-lastSwap>P.swapEvery&&free('a')&&free('c')){
      cprMan=(cprMan==='a')?'c':'a';lastSwap=G.t;
      st(cprMan,cprMan==='a'?'bedL':'bedR');act(cprMan,'cprStart');return;}
    if(G.cpr)return;
    for(const id of [cprMan,'a','c']) if(free(id)){
      st(id,id==='a'?'bedL':'bedR');if(act(id,'cprStart'))return;}
  }
  const kc=()=>{if(P.duty>=0.8)keepCpr();};
  /* 插管之後要有人每 6 秒擠一次球；生疏的隊伍會忘記 */
  let ventAcc=0;
  function keepVent(dt){
    if(G.air!=='ETT'||G.rosc||G.over)return;
    ventAcc+=dt;
    if(ventAcc>=P.ventEvery){ventAcc=0;
      const h=['f','e','b'].find(id=>free(id));
      if(h){st(h,'head');act(h,'bag');}}
  }
  /* 壓胸的責任週期 —— 校準的主要旋鈕。20 秒一個循環，前 duty 段在壓、後段刻意空著。 */
  const CYC=20; let cyc=0;
  function tick(){A.use(G);A.step();keepVent(A.DT);
    cyc+=A.DT; if(cyc>=CYC)cyc-=CYC;
    if(G.check>0||G.over||G.rosc)return;
    if(cyc<CYC*P.duty)keepCpr();
    else if(G.cpr)act(G.cpr,'cprStop');}
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
  act('d','takeLeads'); until(()=>Ch('d').hold==='leads',10);
  st('d','bedR'); act('d','attachLeads'); until(()=>G.leads,20);
  eqAt('d','defib'); act('d','push',{k:'defib'});
  st('d','bedR'); wait(1); act('d','release');
  eqAt('d','defib'); act('d','takePaddle'); act('d','setJ',{j:opt.j||200});
  /* 可電擊節律：先充好電，才有機會早期去顫 */
  if(A.RH(G.rhythm).shock){act('d','charge');until(()=>G.df.charged,10);
    st('d','bedR');
    if(P.duty>=0.7){                    /* 好隊伍會在第一次心律檢查前就準備好放電 */
      act('b','rhythmCheck');wait(1.2);
      act('b','callRhythm',{r:G.rhythm==='pVT'?'VT':'VF'});
      act('b','callDecision',{v:'shock'});
      until(()=>G.check<=0,12);
      act('d','clear');wait(1);act('d','shock');wait(1);kc();
      act('d','charge');}}

  /* e：建立血管通路 */
  for(let a2=0;a2<6&&!G.ivFixed;a2++){
    if(G.iv){st('e','bedL');act('e','fixIv');until(()=>G.ivFixed,18);continue;}
    eqAt('e','cart'); if(Ch('e').hold)act('e','drop');
    if(G.caths>0&&G.ivTry<2){act('e','grab',{k:'cath'});until(()=>Ch('e').hold==='cath',14);
      st('e','bedL');act('e','iv');until(()=>!Ch('e').busy,22);}
    else{act('e','grab',{k:'io'});until(()=>Ch('e').hold==='io',14);
      st('e','bedL');act('e','ioAccess');until(()=>!Ch('e').busy,22);}}

  /* f：查病歷並公開 */
  eqAt('f','pc'); act('f','chart'); until(()=>G.clues.length>0,25);
  act('f','cast',{src:'chart'});

  /* ── 一次完整的心律檢查（v4.0 三步判讀）── */
  function doCheck(){
    st('b','foot'); if(!act('b','rhythmCheck'))return;
    /* 摸脈搏與看螢幕同時進行 —— 判 PEA 之前一定要有人真的摸過 */
    const pulseMan=(cprMan==='a')?'c':'a';
    if(P.pulseDuringCheck&&free(pulseMan)){
      st(pulseMan,'bedR');act(pulseMan,'checkPulse');}
    wait(1.4);
    const seen=A.RH(G.rhythm);
    const rid=G.rhythm==='VF'?'VF':G.rhythm==='pVT'?'VT':G.rhythm==='asystole'?'ASYS':'ORG';
    act('b','callRhythm',{r:rid});
    if(rid==='ORG'){
      if(P.pulseDuringCheck){
        until(()=>!Ch(pulseMan).busy,7);
        act(pulseMan,'ready',{txt:G.rosc?'我摸到脈搏了！':'摸不到脈搏'});}
      act('b','callPerf',{v:G.rosc?'pulse':'nopulse'});}
    act('b','callDecision',{v:seen.shock?'shock':'noshock'});
    until(()=>G.check<=0,12);
    return seen.shock;
  }

  /* ── 插管：放管 → 自己接 EtCO₂ 判讀 → 正確才留 ── */
  let ettDone=false;
  function doIntubate(){
    const cm=(cprMan==='c')?'a':'c';
    for(let tryN=0;tryN<3&&G.air!=='ETT';tryN++){
      if(G.air==='bad'){                       /* 上一次判讀成 out 才會回到 BVM */
        st(cm,'head');act(cm,'confirmTube');until(()=>Ch(cm).tubeSeen,12);
        const think=(G.air==='ETT')?'ok':'out';
        act(cm,'callTube',{v:(rr()<P.tubeErr)?(think==='ok'?'out':'ok'):think});
        continue;}
      eqAt('e','cart'); if(Ch('e').hold)act('e','drop');
      /* item 6：先問床頭要什麼規格，再照著備 */
      st(cm,'head');
      eqAt('e','cart');act('e','askEtt');
      act(cm,'answerEtt',{scope:'Video',blade:'3 號',tube:'7.5'});
      act('e','grab',{k:'ett',spec:1});
      until(()=>Ch('e').hold==='ett',14);
      st('e','head'); st(cm,'head');
      act(cm,'ett'); until(()=>!Ch(cm).busy,22);
      /* 系統不會說對不對 —— 要自己確認 */
      act(cm,'confirmTube'); until(()=>Ch(cm).tubeSeen,14);
      const truth=(G.air==='ETT')?'ok':'out';
      const said=(rr()<P.tubeErr)?(truth==='ok'?'out':'ok'):truth;
      act(cm,'callTube',{v:said});
      if(said==='ok')break;                    /* 說對了就留著（可能是誤判） */
    }
    ettDone=(G.air==='ETT'&&G.airCalled==='ok');
    kc();
  }

  let amioGiven=false, echoDone=false, famDone=false, ettTried=false;
  let firstShockConv=null, firstShockJ=null;
  for(let round=0;round<9&&!G.over&&!G.rosc;round++){
    waitOr(Math.max(0,112-(G.t-(G.checks.length?G.checks[G.checks.length-1].t:0))),()=>G.rosc);
    if(G.over||G.rosc)break;
    const shockable=doCheck();
    if(G.over||G.rosc)break;
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
      eqAt('e','cart'); if(Ch('e').hold)act('e','drop');
      act('e','draw',{k:'epi'}); until(()=>Ch('e').hold==='epi',12);
      st('e','bedR'); act('e','give'); until(()=>!Ch('e').hold,8); kc();}
    /* Amiodarone：第 3 次電擊之後仍是 VF/pVT */
    if(!amioGiven&&G.shocks>=3&&A.RH(G.rhythm).shock&&G.ivFixed&&free('e')){
      eqAt('e','cart'); if(Ch('e').hold)act('e','drop');
      act('e','draw',{k:'amio',dose:'300'});
      until(()=>Ch('e').hold==='amio',12);
      st('e','bedR'); act('e','give'); until(()=>!Ch('e').hold,8); amioGiven=true; kc();}
    /* f：超音波 —— 鑑別診斷的主要來源 */
    if(!echoDone&&round>=1&&free('f')){
      eqAt('f','echo'); act('f','takeProbe'); act('f','push',{k:'echo'});
      st('f','bedR'); wait(1); act('f','release');
      act('f','scan'); until(()=>!Ch('f').busy,20);
      if(G.clues.some(q=>q.src==='echo'))act('f','cast',{src:'echo'});
      act('f','drop'); echoDone=true; kc();}
    /* 問家屬 */
    if(!famDone&&round>=1&&free('f')){
      Ch('f').x=G.family.x+30;Ch('f').y=G.family.y+10;Ch('f').path=[];
      act('f','ask'); until(()=>!Ch('f').busy,18);
      if(G.clues.some(q=>q.src==='fam'))act('f','cast',{src:'fam'});
      act('f','escort'); until(()=>G.family.gone,15); famDone=true; kc();}
    /* 插管：上呼吸道阻塞是正解，其他情境也會做但不影響病因 */
    if(!ettTried&&round>=(cause==='o'?1:3)&&free('e')&&free('c')&&free('a')){
      ettTried=true; doIntubate();}
    /* 病因處置：線索齊了才動手（v4.0 亂做有代價） */
    if(!G.fixed&&G.t>=P.fixAt&&free('e')&&G.clues.length>=1&&
       (G.ivFixed||cause==='x'||cause==='t')){
      const d=FIXDRUG[cause];
      if(d){eqAt('e','cart'); if(Ch('e').hold)act('e','drop');
        act('e','draw',{k:d}); until(()=>Ch('e').hold===d,12);
        st('e','bedR'); act('e','give'); until(()=>!Ch('e').hold,8);}
      else if(cause==='x'){eqAt('e','cart'); act('e','grab',{k:'needle'});
        until(()=>Ch('e').hold==='needle',12);
        st('e','bedR'); act('e','needle'); until(()=>!Ch('e').busy,18);}
      else if(cause==='t'){eqAt('e','cart'); act('e','grab',{k:'peri'});
        until(()=>Ch('e').hold==='peri',12);
        st('e','bedR'); act('e','peri'); until(()=>!Ch('e').busy,20);}
      kc();}
  }
  /* 撐到起效 */
  until(()=>G.rosc,240);
  if(G.rosc){
    doCheck();
    const cm=cprMan;st(cm,'bedL');act(cm,'checkPulse');until(()=>!Ch(cm).busy,10);
    act(cm,'ready',{txt:'我摸到脈搏了！'});wait(2);act('b','endCase');
  }
  else if(!G.over)A.applyAct(G,null,'__stop');

  return {rosc:!!G.rosc, over:G.over, t:G.t, ivFixed:G.ivFixed, air:G.air,
    clues:G.clues.length, ivTry:G.ivTry, ioTry:G.ioTry,
    ccf:G.den2?G.num2/G.den2:0, ccfAll:G.den?G.num/G.den:0,
    ccfPen:G.ccfPen, rhyPen:G.rhyPen, harmPen:G.harmPen, noFlow:G.noFlow,
    shocks:G.shocks, conv:G.converted, firstShockConv, firstShockJ,
    epi:G.epi, decays:G.decays, fixed:G.fixed, tFixed:G.tFixed,
    maxPause:G.maxPauseAfterStart, swaps:G.swaps, rearrests:G.rearrests,
    blindProc:G.blindProc, harms:G.harmLog.length,
    ackRate:G.orders?G.ordersAck/G.orders:null};
}

/* ── 統計工具 ── */
const q=(a,p)=>{if(!a.length)return NaN;const b=a.slice().sort((x,y)=>x-y);
  const i=(b.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i);
  return lo===hi?b[lo]:b[lo]+(b[hi]-b[lo])*(i-lo);};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
/* PA-6：Wald 區間在比例接近 0 或 1 時會退化成 [100,100]。改用 Wilson score。 */
function wilson(k,n,z){
  if(!n)return null;
  z=z||1.959964;
  const p=k/n, z2=z*z, d=1+z2/n;
  const c=(p+z2/(2*n))/d;
  const h=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
const ci=(k,n)=>{const w=wilson(k,n);if(!w)return '—';
  return (k/n*100).toFixed(1)+'% ['+(w[0]*100).toFixed(1)+'–'+(w[1]*100).toFixed(1)+']';};

/* ══ 反應曲面：ROSC% 隨「壓胸品質」與「多久才處理病因」怎麼變 ══
   這一張表才是論文該放的東西 —— 單一個 ROSC 率沒有意義，
   因為模擬器裡每一場都有可逆病因，真實世界不是。
   用法：node batch.js sweep [每格種子數] */
if(process.argv[2]==='sweep'){
  const M=Number(process.argv[3]||8);
  const DUTY=[0.90,0.80,0.70,0.60,0.50,0.40];
  const FIX=[120,240,360,480,600,720,1e9];
  console.log('引擎 '+A.ENGINE+'　反應曲面　每格 '+(M*CAUSES.length*RHY.length)+' 場\n');
  console.log('　　　　　　　　　　多久才把正確處置做下去（秒）');
  console.log('CCF   '+FIX.map(f=>String(f>=1e9?'從未':f).padStart(7)).join(''));
  console.log('─'.repeat(6+7*FIX.length));
  for(const d of DUTY){
    let line=(Math.round(d*100)+'%').padEnd(6);
    for(const f of FIX){
      let k=0,n=0;
      PROFILE.__sw={duty:d,swap:d>=0.7,swapEvery:d>=0.7?150:999,fixAt:f,
        tubeErr:d>=0.8?0.05:0.25,pulseDuringCheck:d>=0.6,ventEvery:d>=0.7?8:18};
      for(const c of CAUSES)for(const rh of RHY)for(let i=0;i<M;i++){
        const r=run(1000000+i*7919,c,rh,{quality:'__sw'});n++;if(r.rosc)k++;}
      line+=(n?(k/n*100).toFixed(0)+'%':'—').padStart(7);
    }
    console.log(line);
  }
  console.log('\n每一格都是六種病因 × 四種起始心律 × '+M+' 顆種子。');
  console.log('「從未」那一欄是完全沒有針對病因下手。殘留的 ~17% 全部來自「上呼吸道阻塞」——');
  console.log('那一格的正解本來就是插管，而腳本不管幾分鐘都會去插管。其餘五種病因在該欄都是 0%。');
  process.exit(0);
}

const PN={optimal:'近乎完美（CCF 目標 92%、每 2 分鐘換手、3 分 20 秒內處理病因）',
  typical:'臨床上常見（CCF 目標 72%、換手不規律、6 分 20 秒才處理病因）',
  poor:'生疏（CCF 目標 52%、不換手、9 分 20 秒才處理病因、管路判讀會出錯）'};
console.log('引擎 '+A.ENGINE+'　每格 '+N+' 個種子　行為水準：'+(PN[QUAL]||QUAL));
console.log('（Wilson score 95% 信賴區間）\n');
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
      noFlow:q(R.map(r=>r.noFlow),.5),
      decays:mean(R.map(r=>r.decays)),
      pause:q(R.map(r=>r.maxPause),.5),
      fixPct:R.filter(r=>r.fixed).length/N*100});
  }
}
const pad=(s,n)=>String(s).padEnd(n);
const padl=(s,n)=>String(s).padStart(n);
console.log(pad('病因',22)+pad('起始',7)+padl('ROSC%',7)+padl('CCF中位',9)
  +padl('(IQR)',13)+padl('時長中位',10)+padl('電擊',6)+padl('病因解除',9)
  +padl('最長中斷',10)+padl('無灌流',8));
console.log('─'.repeat(101));
const CN={k:'高血鉀',p:'肺栓塞',h:'低血容',x:'張力性氣胸',o:'上呼吸道阻塞',t:'心包填塞'};
for(const r of rows){
  console.log(pad(CN[r.cause],22)+pad(r.rhythm,7)+padl(r.rosPct.toFixed(0),7)
    +padl(r.ccfMed.toFixed(0)+'%',9)
    +padl(r.ccfLo.toFixed(0)+'–'+r.ccfHi.toFixed(0),13)
    +padl(isNaN(r.durMed)?'—':A.mmt(r.durMed),10)
    +padl(r.shocks.toFixed(1),6)+padl(r.fixPct.toFixed(0)+'%',9)
    +padl(r.pause.toFixed(0)+'s',10)+padl(r.noFlow.toFixed(0)+'s',8));
}
console.log('\n── 依病因彙總（跨四種起始心律）──');
for(const c of CAUSES){
  const g=rows.filter(r=>r.cause===c);
  const k=g.reduce((a,r)=>a+r.ros,0), n=g.reduce((a,r)=>a+r.n,0);
  console.log('  '+pad(CN[c],16)+'ROSC '+ci(k,n)
    +'　CCF 中位 '+(mean(g.map(r=>r.ccfMed))).toFixed(0)+'%');
}
console.log('\n── 依起始心律彙總（跨六種病因）──');
for(const rh of RHY){
  const g=rows.filter(r=>r.rhythm===rh);
  const k=g.reduce((a,r)=>a+r.ros,0), n=g.reduce((a,r)=>a+r.n,0);
  const f=allFirst[rh];
  console.log('  '+pad(rh,10)+'ROSC '+ci(k,n)
    +(f?'　首次電擊轉律 '+ci(f[0],f[1]):''));
}
const K2=rows.reduce((a,r)=>a+r.ros,0), N2=rows.reduce((a,r)=>a+r.n,0);
console.log('\n整體 ROSC 率：'+ci(K2,N2));
console.log('（真實院內心跳停止：可電擊節律的預後優於不可電擊節律 —— 這一版的引擎方向已經修正）');
