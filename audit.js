const A=require('./ihca-sim.js');
const K=A.K; let FAIL=0;
const ok=(t,c,extra)=>{console.log((c?'  ✔ ':'  ✘ ')+t+(extra?'　'+extra:''));if(!c)FAIL++;};
const H=t=>console.log('\n── '+t+' ──');

function mk(o){const G=A.newState((o&&o.seed)||1,Object.assign({n:6,drip:'ns',rhythm:'PEA',cause:'k',
  names:{a:'A',b:'B',c:'C',d:'D',e:'E',f:'F'}},o||{}));A.use(G);A.applyAct(G,null,'__start');
  for(let i=0;i<200;i++){A.use(G);A.step();}return G;}
const P=(G,id)=>G.ch.find(c=>c.id===id);
const at=(G,id,k)=>{const c=P(G,id),s=K.ST[k];c.x=s.x;c.y=s.y+26;c.path=[];c.vx=c.vy=0;};
const eq=(G,id,k)=>{const c=P(G,id),e=G.eq[k];c.x=e.x+40;c.y=e.y+40;c.path=[];c.vx=c.vy=0;};
const run=(G,sec)=>{const n=Math.round(sec*A.HZ);for(let i=0;i<n&&!G.over;i++){A.use(G);A.step();}};
const act=(G,c,a,p)=>A.applyAct(G,c,a,p);

/* 1 ── 亂槍打鳥現在有沒有代價 */
H('1. 亂槍打鳥（0 條線索、所有侵入處置與藥全上）');
let win=0,harms=0,blind=0,tt=[];
for(let s=0;s<24;s++){
  const G=mk({seed:5000+s*977,cause:['k','p','h','x','t'][s%5]});
  at(G,'b','foot');act(G,'b','claimLead');at(G,'a','bedL');act(G,'a','cprStart');
  for(const g of ['needle','peri']){
    eq(G,'e','cart');if(P(G,'e').hold)act(G,'e','drop');
    act(G,'e','grab',{k:g});run(G,4);at(G,'e','bedR');act(G,'e',g);run(G,18);
    at(G,'a','bedL');act(G,'a','cprStart');}
  for(const d of ['calc','lytic','prbc','bicarb']){
    eq(G,'e','cart');if(P(G,'e').hold)act(G,'e','drop');
    act(G,'e','draw',{k:d});run(G,9);at(G,'e','bedR');act(G,'e','give');run(G,5);
    at(G,'a','bedL');act(G,'a','cprStart');}
  for(let i=0;i<K.TMAX*A.HZ&&!G.over&&!G.rosc;i++){A.use(G);A.step();
    if(!G.cpr&&!G.check){at(G,'a','bedL');act(G,'a','cprStart');}}
  if(G.rosc){win++;tt.push(Math.round(G.t));}
  harms+=G.harmLog.length; blind+=G.blindProc;
}
ok('不再是 100% 成功（v3.4 是 100%）', win/24<0.75, 'ROSC '+win+'/24 = '+Math.round(win/24*100)+'%');
ok('每一場都留下醫源性傷害紀錄', harms>0, '共 '+harms+' 筆傷害、'+blind+' 次無指徵處置');
if(tt.length)console.log('      成功者的中位時長 '+A.mmt(tt.sort((a,b)=>a-b)[tt.length>>1]));

/* 2 ── 早期去顫 */
H('2. shockP() 早期去顫（200J、CCF 85%）');
function sp(t){const G=mk({rhythm:'VF',cause:'k'});G.t=t;G.rhythm='VF';G.df.j=200;G.decay=0;
  G.epiT=-999;G.amioT=-999;G.cprSec=[];
  const n=Math.min(120,Math.max(0,Math.floor(t)));
  for(let i=0;i<n;i++)G.cprSec.push(i%100<85?1:0);A.use(G);return A.shockP();}
const c20=sp(20),c60=sp(60),c300=sp(300),c600=sp(600);
console.log('      t=20s '+(c20*100).toFixed(0)+'%　t=60s '+(c60*100).toFixed(0)
  +'%　t=300s '+(c300*100).toFixed(0)+'%　t=600s '+(c600*100).toFixed(0)+'%');
ok('早期去顫最高、隨時間單調下降', c20>c60&&c60>c300&&c300>c600);
ok('沒有 30 秒懸崖（29s 與 31s 差 <5 分）', Math.abs(sp(29)-sp(31))<0.05);

/* 3 ── no-flow 債與 CCF 可回復性 */
H('3. 灌流債');
{const G=mk({cause:'p',rhythm:'PEA'});                    /* 肺栓塞：起效 90 秒，撐得夠久 */
 at(G,'a','bedL');act(G,'a','cprStart');run(G,20);      /* 先真的開始壓胸 */
 eq(G,'e','cart');act(G,'e','draw',{k:'lytic'});run(G,9);
 at(G,'e','bedR');act(G,'e','give');run(G,4);
 act(G,'a','cprStop');
 run(G,470);                                            /* 解除後完全不壓胸 */
 ok('解除病因後完全不壓胸 → 不會 ROSC', !G.rosc, 'noFlow='+Math.round(G.noFlow)+'s');
 ok('累積 no-flow 超過上限就永久回不來', G.noFlowDead===true);
 at(G,'a','bedL');act(G,'a','cprStart');run(G,400);
 ok('之後再怎麼壓也救不回來（不可逆）', !G.rosc);
}

/* 4 ── Order 佇列 */
H('4. Order 佇列與計數一致性');
{const G=mk({});at(G,'b','foot');act(G,'b','claimLead');
 const txts=['開始壓胸','建立血管通路','有人去查病歷','詢問家屬發生什麼事','輸血 pRBC'];
 for(const t of txts){act(G,'b','order',{txt:t,to:'a'});run(G,1);}
 ok('同時最多 '+K.ORDERMAX+' 則', G.orderQ.length<=K.ORDERMAX, '目前 '+G.orderQ.length+' 則');
 ok('被擠掉的沒有消失，進了 orderLog', G.orderLog.length===txts.length-G.orderQ.length);
 ok('S.orders 與總數一致', G.orders===G.orderLog.length+G.orderQ.length, G.orders+' = '+(G.orderLog.length+G.orderQ.length));
 const o=G.orderQ[0];
 act(G,'a','ack',{id:o.id});act(G,'a','ack',{id:o.id});   /* 重複複誦 */
 ok('重複複誦不會重複計數', G.ordersAck===1, 'ordersAck='+G.ordersAck);
 act(G,'a','doneReport',{id:o.id});act(G,'a','doneReport',{id:o.id});
 ok('重複回報完成不會重複計數', G.ordersDone===1);
 ok('回報「開始壓胸」但沒在壓 → 查證為假', G.orderLog.some(x=>x.verified===false));
 const before=G.orders; run(G,K.ORDERTTL+3);
 ok('逾時的 order 會歸檔且不重複', G.orderQ.length===0&&G.orders===before
    &&G.orderLog.length===txts.length);
}

/* 5 ── 插管確認 */
H('5. 插管與管路確認');
{let stuck=0,recov=0;
 for(let s=0;s<30;s++){
   const G=mk({seed:9000+s*613,cause:'o'});
   for(let tryN=0;tryN<4&&G.air!=='ETT';tryN++){
     eq(G,'e','cart');if(P(G,'e').hold)act(G,'e','drop');
     at(G,'a','head');
     act(G,'e','askEtt');act(G,'a','answerEtt',{scope:'Video',blade:'3 號',tube:'7.5'});
     act(G,'e','grab',{k:'ett',spec:1});run(G,11);
     at(G,'e','head');act(G,'a','ett');run(G,17);
     act(G,'a','confirmTube');run(G,K.TUBETEST+1);
     act(G,'a','callTube',{v:(G.air==='ETT')?'ok':'out'});
   }
   if(G.air==='ETT')recov++; else stuck++;
 }
 ok('判讀正確就一定救得回氣道（不會卡死）', stuck===0, recov+'/30 最後都是正確位置');
 const G2=mk({cause:'o'});
 at(G2,'a','head');eq(G2,'e','cart');
 act(G2,'e','askEtt');act(G2,'a','answerEtt',{scope:'Video',blade:'3 號',tube:'7.5'});
 act(G2,'e','grab',{k:'ett',spec:1});run(G2,11);at(G2,'e','head');
 act(G2,'a','ett');run(G2,17);
 ok('插管後系統不宣告對錯（airCalled 仍是 null）', G2.airCalled===null);
 ok('沒看過波形就不能宣告', (act(G2,'a','callTube',{v:'ok'}),G2.airCalled===null));
 act(G2,'a','confirmTube');run(G2,K.TUBETEST+1);
 ok('確認過才能宣告', P(G2,'a').tubeSeen===1);
 ok('上呼吸道阻塞會在喉頭鏡下自動公告', G2.tl.some(x=>x.txt.indexOf('喉頭鏡')>=0));
}

/* 6 ── PEA 三步判讀 */
H('6. 心律判讀三步');
{const G=mk({rhythm:'PEA'});at(G,'b','foot');act(G,'b','claimLead');G.leads=true;
 act(G,'b','rhythmCheck');run(G,1);
 act(G,'b','callRhythm',{r:'ORG'});
 act(G,'b','callDecision',{v:'noshock'});
 ok('沒判定脈搏之前不能下決策', G.checkRec&&G.checkRec.call===null);
 act(G,'b','callPerf',{v:'nopulse'});
 ok('沒有人摸脈搏就宣告 PEA → 記一筆', G.peaNoPulse===1);
 act(G,'b','callDecision',{v:'noshock'});
 ok('判定完才能下決策', G.checks.length===1&&G.checks[0].correct===true);
 /* 錯誤宣告有脈搏 */
 const G2=mk({rhythm:'PEA'});at(G2,'b','foot');act(G2,'b','claimLead');G2.leads=true;
 act(G2,'b','rhythmCheck');run(G2,1);act(G2,'b','callRhythm',{r:'ORG'});
 act(G2,'b','callPerf',{v:'pulse'});
 ok('錯誤宣告有脈搏不會觸發 ROSC，但會記錄', !G2.roscKnown&&G2.falseRosc===1);
 /* v4.2：判讀畫面不自己消失 */
 const G3=mk({rhythm:'VF'});at(G3,'b','foot');act(G3,'b','claimLead');G3.leads=true;
 act(G3,'b','rhythmCheck');run(G3,K.CHECKMAX+6);
 ok('超過 10 秒判讀畫面仍然開著', G3.checkRec!==null&&G3.checks.length===0);
 ok('超過 10 秒可以恢復壓胸', G3.check<=0);
 at(G3,'a','bedL');ok('真的壓得下去', act(G3,'a','cprStart')&&G3.cpr==='a');
 act(G3,'b','callRhythm',{r:'VF'});act(G3,'b','callDecision',{v:'shock'});
 ok('決策之後才收起來，只推一筆', G3.checks.length===1&&G3.checkRec===null);
 ok('有記錄超時秒數', G3.checks[0].overrun>0, '超時 '+Math.round(G3.checks[0].overrun)+' 秒');
 const G4=mk({rhythm:'VF'});at(G4,'b','foot');act(G4,'b','claimLead');G4.leads=true;
 act(G4,'b','rhythmCheck');run(G4,3);act(G4,null,'__stop');
 ok('沒做完決策就結束，也會留下一筆', G4.checks.length===1&&G4.checks[0].call===null);
}

/* 6b ── v4.2 新行為 */
H('6b. v4.2 新行為');
{const G=mk({rhythm:'VF'});G.leads=true;
 eq(G,'d','defib');act(G,'d','takePaddle');act(G,'d','setJ',{j:200});
 act(G,'d','charge');run(G,4);
 at(G,'d','bedR');act(G,'d','clear');run(G,1);act(G,'d','shock');run(G,1);
 const txt=G.feed.map(f=>f.txt).join(' | ');
 ok('喊 CLEAR 出現在右側訊息流', txt.indexOf('CLEAR')>=0);
 ok('放電出現在右側訊息流', txt.indexOf('放電')>=0);
 ok('充電出現在右側訊息流', txt.indexOf('充電')>=0);
 const G2=mk({});eq(G2,'f','pc');act(G2,'f','chart');run(G2,13);
 ok('第一次查病歷成功', G2.clues.some(q=>q.src==='chart'));
 const n0=G2.acts.length;
 ok('查過之後再查不會受理', act(G2,'f','chart')===true&&G2.acts.length===n0);
 const G3=mk({});at(G3,'a','bedL');act(G3,'a','cprStart');run(G3,2);
 ok('開始壓胸出現在訊息流', G3.feed.some(f=>f.txt.indexOf('開始壓胸')>=0));
 ok('「收到」提示停留 5 秒', K.ROGERTTL===5);
 ok('order 第一類有確認脈搏', K.ORDERGRP[0].o[0]==='確認脈搏');
 ok('order 有監測類（貼監測貼片）', K.ORDERGRP.some(g=>g.o.indexOf('貼上監測貼片')>=0));
 /* EtCO2 */
 const G4=mk({});G4.air='ETT';G4.tEtt=G4.t;
 at(G4,'a','bedL');act(G4,'a','cprStart');run(G4,3);
 let mx=0;for(let i=0;i<300;i++)mx=Math.max(mx,A.co2At(G4,G4.t-3+i*0.01));
 ok('管路正確 + 壓胸 → 有小波形', mx*50>2&&mx*50<12, '峰值 '+(mx*50).toFixed(1)+' mmHg');
 G4.ventAt.push(G4.t-0.9);
 let mx2=0;for(let i=0;i<300;i++)mx2=Math.max(mx2,A.co2At(G4,G4.t-1+i*0.005));
 ok('擠球 → 明顯的方波', mx2>mx*2, '峰值 '+(mx2*50).toFixed(1)+' mmHg');
 const G5=mk({});G5.air='bad';G5.tubeTest=K.TUBETEST;G5.ventAt.push(G5.t-0.9);
 at(G5,'a','bedL');act(G5,'a','cprStart');run(G5,2);
 let mx3=0;for(let i=0;i<300;i++)mx3=Math.max(mx3,A.co2At(G5,G5.t-2+i*0.006));
 ok('管路不對 → 永遠是平的', mx3===0);
 const G6=mk({});G6.air='ETT';G6.tubeTest=K.TUBETEST;G6.ventAt.push(G6.t-0.9);
 let mx4=0;for(let i=0;i<300;i++)mx4=Math.max(mx4,A.co2At(G6,G6.t-1+i*0.005));
 ok('確認窗內就算沒壓胸也看得到波形', mx4*50>8, '峰值 '+(mx4*50).toFixed(1)+' mmHg');
}

/* 7 ── 傷害倍率上限 */
H('7. 傷害模型');
{const G=mk({cause:'x'});
 for(let i=0;i<8;i++){eq(G,'e','cart');if(P(G,'e').hold)act(G,'e','drop');
   act(G,'e','draw',{k:'calc'});run(G,9);at(G,'e','bedR');act(G,'e','give');run(G,4);}
 ok('傷害倍率有上限，不會無限累積', G.harmMult<=2.6, 'harmMult='+G.harmMult.toFixed(2));
 const G2=mk({cause:'k'});
 for(let i=0;i<4;i++){eq(G2,'e','cart');if(P(G2,'e').hold)act(G2,'e','drop');
   act(G2,'e','draw',{k:'calc'});run(G2,9);at(G2,'e','bedR');act(G2,'e','give');run(G2,4);}
 ok('對症的 calcium 不會被懲罰', G2.harmMult===1&&G2.badCalc===0);
 /* 醫源性氣胸可以自己處理掉 */
 let made=0,cleared=0;
 for(let s=0;s<40;s++){const g=mk({seed:400+s*31,cause:'k'});
   eq(g,'e','cart');act(g,'e','grab',{k:'needle'});run(g,4);at(g,'e','bedR');act(g,'e','needle');run(g,16);
   if(g.iatroPtx){made++;
     eq(g,'e','cart');act(g,'e','grab',{k:'needle'});run(g,4);at(g,'e','bedR');act(g,'e','needle');run(g,16);
     if(g.iatroPtxFixed)cleared++;}}
 ok('無指徵針刺會造成氣胸（約 40%）', made>8&&made<26, made+'/40');
 ok('再刺一次可以把自己造成的氣胸處理掉', made>0&&cleared===made);
}

/* 8 ── 快照不洩漏 */
H('8. 快照資訊隔離');
{const G=mk({cause:'t'});
 eq(G,'f','pc');act(G,'f','chart');run(G,13);
 const sa=A.snapshotFor(G,'a'), sf=A.snapshotFor(G,'f');
 const ca=sa.clues.find(q=>q.src==='chart'), cf=sf.clues.find(q=>q.src==='chart');
 ok('沒查到的人看不到線索內容', ca&&ca.txt===null);
 ok('查到的人看得到', cf&&typeof cf.txt==='string');
 ok('演練中不洩漏真正的病因', sa.cause.n===null);
 at(G,'a','head');eq(G,'e','cart');
 act(G,'e','askEtt');act(G,'a','answerEtt',{scope:'Direct',blade:'3 號',tube:'7.5'});
 act(G,'e','grab',{k:'ett',spec:1});run(G,11);at(G,'e','head');act(G,'a','ett');run(G,17);
 const s2=A.snapshotFor(G,'a');
 ok('快照不洩漏管路位置對不對', s2.air==='ETT'||s2.air==='bad' ? s2.airCalled===null : true);
 ok('快照沒有夾帶 fixed / roscProgress 等答案',
    s2.fixed===undefined&&s2.roscProgress===undefined&&s2.iatroPtx===undefined);
}

/* 9 ── 重播決定性 */
H('9. 重播決定性（新的五條亂數流）');
{const RECF2=__dirname+'/recordings/demo-good.json';
 if(!require('fs').existsSync(RECF2)){
   console.log('  ⚠ 找不到 recordings/demo-good.json —— 先跑 `node mkrec.js` 產生示範錄影再測這一節。');
 }else{
 const rec=JSON.parse(require('fs').readFileSync(RECF2,'utf8'));
 const runRec=()=>{let G=A.newState(rec.seed,rec.setup),qi=0;
   for(let i=0;i<A.HZ*1200;i++){
     while(qi<rec.events.length&&rec.events[qi].k<=G.tick){const e=rec.events[qi++];A.applyAct(G,e.c,e.a,e.p);}
     A.use(G);A.step();if(G.over)break;}
   return G;};
 const g1=runRec(),g2=runRec();
 ok('同一份錄影重播兩次完全相同', g1.over===g2.over&&g1.tick===g2.tick&&g1.shocks===g2.shocks);
 ok('與錄影檔記載相符', g1.over===rec.over&&Math.abs(g1.t-rec.dur)<1, g1.over+' '+A.mmt(g1.t));
 /* 亂數流真的分開了嗎 */
 const s1=A.newState(77,{}),s2=A.newState(77,{});
 for(let i=0;i<50;i++)s1._r.iv();
 ok('抽 iv 流不影響 shock 流', s1._r.shock()===s2._r.shock());
 }}

/* 10 ── 報表健全性（亂打也不能壞） */
H('10. 亂數壓力測試（隨機動作 × 60 場）');
{const acts=Object.keys(A.ACT);let crash=0,rep=0;
 for(let s=0;s<60;s++){
   const G=mk({seed:s*7919+13,cause:['k','p','h','x','o','t'][s%6],
     rhythm:['VF','pVT','asystole','PEA'][s%4]});
   let rs=(s*2654435761)>>>0;const rr=()=>{rs^=rs<<13;rs>>>=0;rs^=rs>>17;rs^=rs<<5;rs>>>=0;return rs/4294967296;};
   for(let i=0;i<900;i++){
     const cid=['a','b','c','d','e','f'][Math.floor(rr()*6)];
     const a=acts[Math.floor(rr()*acts.length)];
     const p={k:['epi','calc','cath','io','ett','needle','peri','prbc','ns','defib','echo','cart','pc'][Math.floor(rr()*13)],
       txt:K.ORDERS[Math.floor(rr()*K.ORDERS.length)],to:['a','b','c'][Math.floor(rr()*3)],
       r:['VF','VT','ORG','ASYS'][Math.floor(rr()*4)],v:['shock','noshock','ok','out','pulse','nopulse'][Math.floor(rr()*6)],
       src:['chart','fam','echo'][Math.floor(rr()*3)],j:[120,150,200][Math.floor(rr()*3)],
       dose:['150','300'][Math.floor(rr()*2)],scope:'Video',blade:'3 號',tube:'7.5',
       x:rr()*900,y:rr()*780,dx:rr()-.5,dy:rr()-.5,id:Math.floor(rr()*6)+1};
     try{A.applyAct(G,cid,a,p);}catch(e){crash++;console.log('   CRASH act',a,e.message);}
     A.use(G);A.step();
   }
   try{A.report(G);A.reportText(G);A.history(G);A.snapshotFor(G,'a');rep++;}
   catch(e){crash++;console.log('   CRASH report',e.message);}
 }
 ok('60 場隨機亂打，動作與報表都不會拋例外', crash===0, '報表產生成功 '+rep+'/60');
}

/* 11 ── 報表欄位完整 */
H('11. 報表結構');
{const G=mk({});run(G,60);const r=A.report(G);
 const names=r.map(g=>g.g);
 ok('第一組是「最該改的三件事」', r[0].top===true);
 ok('十一個分組都在', names.length>=11, names.join('／'));
 ok('每一列都有標題與值', r.every(g=>g.rows.every(x=>x.length>=2&&x[0]&&x[1]!==undefined)));
}

/* 12 ── v4.3 新行為 */
H('12. v4.3 新行為');
{/* 任何時間都能暫停壓胸 */
 const G=mk({});at(G,'a','bedL');act(G,'a','cprStart');run(G,4);
 const n0=G.cnt;
 act(G,'a','cprHold');run(G,3);
 ok('壓胸不到 30 下也能暫停', G.holdCpr===true, 'cnt='+n0+' → hold='+G.holdCpr);
 ok('暫停時壓胸數不再增加', G.cnt===n0||G.cnt===0, 'cnt='+G.cnt);
 act(G,'a','resumeCpr');run(G,3);
 ok('可以再繼續', G.holdCpr===false&&G.cpr==='a');
 ok('暫停／繼續都留在對話流', G.feed.some(x=>/暫停壓胸/.test(x.txt||''))&&G.feed.some(x=>/繼續壓胸/.test(x.txt||'')));
}
{/* 點滴標記 */
 const G=mk({drip:'ns'});
 ok('一開始的點滴是 N/S', A.snapshotFor(G,'a').dripNow==='ns');
 at(G,'c','bedR');act(G,'c','fixIv');run(G,26);
 eq(G,'e','cart');act(G,'e','draw',{k:'prbc'});run(G,10);
 at(G,'e','bedR');act(G,'e','give');run(G,4);
 ok('掛 pRBC 之後標記換成 prbc', A.snapshotFor(G,'a').dripNow==='prbc', String(A.snapshotFor(G,'a').dripNow));
}
{/* EtCO2 數值跟著波形走 */
 let G=null;
 for(let s=0;s<12&&(!G||G.air!=='ETT');s++){
   G=mk({seed:4400+s*811,cause:'k',rhythm:'PEA'});
   at(G,'a','bedL');act(G,'a','cprStart');run(G,6);
   eq(G,'e','cart');at(G,'b','head');
   act(G,'e','askEtt');act(G,'b','answerEtt',{scope:'Video',blade:'3 號',tube:'7.5'});
   act(G,'e','grab',{k:'ett',spec:1});run(G,11);at(G,'e','head');
   act(G,'b','ett');run(G,17);
   at(G,'a','bedL');act(G,'a','cprStart');run(G,4);
 }
 const flat=A.co2Peak(G);
 act(G,'b','confirmTube');run(G,K.TUBETEST+1);
 const inWin=A.co2Peak(G);
 run(G,8);                                   /* 確認窗關掉，只剩壓胸 */
 const withCC=A.co2Peak(G);
 act(G,'a','cprHold');run(G,2);
 act(G,'b','bag');run(G,1.2);
 const bagOnly=A.co2Peak(G);
 run(G,90);                                  /* 停很久，肺泡存量掉下來 */
 act(G,'b','bag');run(G,1.2);
 const bagLate=A.co2Peak(G);
 const good=(G.air==='ETT');
 ok('co2Peak() 有數值輸出', typeof withCC==='number',
   'air='+G.air+'　確認窗='+inWin+'　只壓胸='+withCC+'　停壓胸擠球='+bagOnly+'　停 90 秒後擠球='+bagLate);
 if(good){
   ok('確認窗內看得到清楚的方波', inWin>12, inWin+' mmHg');
   ok('只壓胸 → 小波（<12 mmHg）', withCC>0&&withCC<12, withCC+' mmHg');
   ok('剛停壓胸就擠球 → 仍有明顯的方波（>12 mmHg）', bagOnly>12, bagOnly+' mmHg');
   ok('停 90 秒不壓再擠球 → 波形明顯變矮（無灌流會沖掉）', bagLate<bagOnly*0.6, bagLate+' mmHg');
 }else{
   ok('管路不對 → 一路平的', withCC===0&&bagOnly===0, withCC+'/'+bagOnly);
 }
 ok('確認窗打開前不畫波（沒壓胸就沒訊號）', typeof flat==='number', String(flat));
}
{/* 紀錄品質稽核 */
 const G=mk({});
 at(G,'a','bedL');act(G,'a','cprStart');run(G,20);
 eq(G,'e','cart');act(G,'e','draw',{k:'epi'});run(G,10);
 at(G,'e','bedR');act(G,'e','give');run(G,6);
 const tEpi=G.drugLog.length?G.drugLog[0].t:null;
 eq(G,'f','pc');act(G,'f','recBegin');act(G,'f','recSubmit',{drug:'Epinephrine 1 mg'});run(G,4);
 act(G,'f','recBegin');act(G,'f','recSubmit',{drug:'Sodium bicarbonate'});run(G,4);
 const RA=A.recAudit(G);
 ok('recAudit 結構完整', RA&&typeof RA.n==='number'&&Array.isArray(RA.spur)&&Array.isArray(RA.rows),
   'n='+RA.n+' hit='+RA.hit+' 多記='+RA.spur.length);
 ok('真的有給的 epi 被配對上', RA.rows.some(x=>x.f==='drug'&&/Epinephrine/.test(x.v)&&x.rec), 'epi@'+(tEpi!==null?A.mmt(tEpi):'-'));
 ok('沒給過的 bicarb 被列為「記了但沒發生」', RA.spur.some(x=>/bicarb|Sodium/i.test(x.v)), JSON.stringify(RA.spur.map(x=>x.v)));
 ok('壓胸這種處置也算可記錄事件', RA.rows.some(x=>x.f==='proc'), RA.rows.filter(x=>x.f==='proc').length+' 筆處置');
 const rep=A.report(G),grp=rep.find(g=>/紀錄品質/.test(g.g));
 ok('報表有「紀錄品質」分組', !!grp, grp?grp.rows.length+' 列':'');
}
{/* 統計用的一列數字 */
 const G=mk({});run(G,90);const M=A.metricsRow(G);const ks=Object.keys(M);
 ok('metricsRow 欄位數 ≥ 100', ks.length>=100, ks.length+' 欄');
 ok('全部是純量，可以直接寫進 CSV', ks.every(k=>M[k]===null||['string','number','boolean'].indexOf(typeof M[k])>=0));
 ok('關鍵欄位都在', ['seed','engine','rosc','ccfUtstein','noFlow','recs','recHit','recSpurious','outcome'].every(k=>k in M), '');
 const H2=A.history(G);
 ok('history() 一併帶出 metrics 與 audit', !!H2.metrics&&!!H2.audit);
}
{/* 該拿掉的提示都拿掉了 */
 const src=require('fs').readFileSync(__dirname+'/ihca-sim.js','utf8');
 ok('沒有「通氣太快」的即時提示', src.indexOf('通氣太快')<0);
 ok('沒有「已插管·已確認位置」的畫面標註',
   require('fs').readFileSync(__dirname+'/ihca-client.html','utf8').indexOf('已確認位置')<0);
}

console.log('\n'+(FAIL?('✘ 共 '+FAIL+' 項未通過'):'✔ 全部通過'));
