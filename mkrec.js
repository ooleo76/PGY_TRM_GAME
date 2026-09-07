/* 產生一場完整、大致做對的演練錄影 — 用來檢查報表、泳道圖與重播
   也是 batch.js 難度校準的行為腳本來源（固定行為、只換情境與種子） */
const A=require('./ihca-sim.js'),fs=require('fs');
const seed=Number(process.argv[2]||20260905);
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
/* 閉環三段：下令要指名，被指名的人複誦，做完回報 */
function order(txt,to){act('b','order',{txt,to});if(to){act(to,'ack');act(to,'doneReport');}}

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
until(near('e','cart'),20); act('e','grab',{k:'cath'}); until(idle('e'),10);
go('e','bedL',at('e','bedL')); act('e','iv'); until(()=>!P('e').busy,20);
until(()=>G.iv,25); act('e','fixIv'); until(()=>G.ivFixed,20);
until(()=>G.clues.length>0,25); act('f','cast',{src:'chart'});
act('a','ready',{txt:'我需要換手'});

/* 推電擊器過來、拿板、充電 */
until(near('d','defib'),20); act('d','push',{k:'defib'});
act('d','goto',{k:'bedR'}); until(at('d','bedR'),25);
act('d','release'); go('d','defib',near('d','defib'));
act('d','takePaddle'); act('d','setJ',{j:200}); act('d','charge');
until(()=>G.df.charged,15);

/* 心律檢查 → 判讀 → clear → 放電（不轉律就再來一次） */
for(let round=0;round<5&&!A.RH(G.rhythm).org;round++){
  act('b','rhythmCheck'); wait(2);            /* 看兩秒再宣告，不是零點幾秒亂按 */
  act('b','callRhythm',{v:A.RH(G.rhythm).shock?'shock':'noshock'});
  until(()=>G.check<=0,12);
  go('d','bedR',at('d','bedR'));
  act('d','clear'); wait(1.5); act('d','shock'); wait(1);
  act('a','cprStart');
  /* 可電擊節律：第一次電擊之後才給 Adrenaline（2025 指引） */
  if(round===0){
    go('e','cart',near('e','cart')); act('e','draw',{k:'epi'}); until(()=>P('e').hold==='epi',15);
    go('e','bedR',at('e','bedR')); act('e','give'); until(()=>!P('e').hold,10);
    act('a','cprStart');
  }
  /* 第 3 次電擊後仍是 VF/pVT 才給 Amiodarone */
  if(G.shocks>=3&&!G.amioLog.length&&A.RH(G.rhythm).shock){
    go('e','cart',near('e','cart')); act('e','draw',{k:'amio',dose:'300'});
    until(()=>P('e').hold==='amio',15);
    go('e','bedR',at('e','bedR')); act('e','give'); until(()=>!P('e').hold,10);
    act('a','cprStart');
  }
  if(!G.df.charged){go('d','defib',near('d','defib'));act('d','charge');until(()=>G.df.charged,15);
    go('d','bedR',at('d','bedR'));}
  wait(22);
}
act('d','drop');

/* 換手（照指引每兩分鐘換） */
go('c','bedL',at('c','bedL')); act('a','cprStop'); act('c','cprStart');
go('a','head',at('a','head'));
order('加強壓胸品質','c');

/* 超音波 */
go('f','echo',near('f','echo')); act('f','takeProbe'); act('f','push',{k:'echo'});
act('f','goto',{k:'bedR'}); until(at('f','bedR'),25); act('f','release');
act('f','scan'); until(()=>G.clues.length>1,25);
act('f','cast',{src:'echo'});
act('f','drop');

/* 問家屬 + 帶家屬出去 */
go('a','bedR',at('a','bedR'));
act('a','ask'); until(()=>G.clues.length>2,20);
act('a','cast',{src:'fam'});
act('a','escort'); until(()=>G.family.gone,20);
act('c','cprStart');

/* 正解：Ca gluconate */
go('e','cart',near('e','cart')); act('e','draw',{k:'calc'}); until(()=>P('e').hold==='calc',15);
go('e','bedR',at('e','bedR')); act('e','give'); until(()=>G.fixed,12);
act('c','cprStart');

/* 撐到起效 — A12 之後這段鬆懈會延後 ROSC */
until(()=>G.rosc,150);
act('b','rhythmCheck'); wait(2);
act('b','callRhythm',{v:'noshock'});
until(()=>G.check<=0,12);
act('c','checkPulse'); until(()=>P('c').recent.indexOf('我摸到脈搏了！')>=0,12);
act('c','ready',{txt:'我摸到脈搏了！'});
wait(1);
act('c','nibp'); until(()=>G.nibp.val,40);
act('c','ready',{txt:'我這邊好了'});
wait(4);
act('b','endCase');
wait(1);

const rec={v:4,engine:A.ENGINE,seed,setup,events:ev,cause:G.cause.n,over:G.over,dur:Math.round(G.t),
  endedAt:new Date().toISOString()};
try{fs.mkdirSync('recordings',{recursive:true});}catch(e){}
fs.writeFileSync('recordings/demo-good.json',JSON.stringify(rec));
console.log('engine=',A.ENGINE,'over=',G.over,'t=',A.mmt(G.t),'events=',ev.length,
  'bytes=',JSON.stringify(rec).length,'spans=',G.acts.length,'tl=',G.tl.length);
console.log(A.reportText(G).split('【現場管理】')[0]);
