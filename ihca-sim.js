/* ══════════════════════════════════════════════════════════════
   IHCA 團隊復甦 — 共用模擬核心 v3
   伺服器與瀏覽器共用。完全不碰 DOM。
   固定步進 30Hz + 種子亂數 → 同樣的種子與操作序列會跑出完全一樣的一局，
   重播功能就是靠這個。
   ══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const HZ=30, DT=1/HZ;

/* 引擎版本 — 只要改動任何會影響模擬結果的邏輯就要進版。
   錄影檔記錄產生它的引擎版本，版本不同就不能忠實重播。 */
const ENGINE='4.3.0';

/* ═══════════ 常數 ═══════════ */
const K={
W:900, H:780,
HZ, DT,
ENGINE,
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
  epi:{n:'Epinephrine',s:'💉',k:'drug'}, amio:{n:'Amiodarone',s:'💉',k:'drug'},
  calc:{n:'Ca gluconate',s:'💉',k:'drug'}, bicarb:{n:'Bicarbonate',s:'💉',k:'drug'},
  lytic:{n:'血栓溶解劑',s:'💉',k:'drug'},
  prbc:{n:'濃縮紅血球 pRBC',s:'🩸',k:'drug'}, ns:{n:'Normal saline 快速輸液',s:'💧',k:'drug'},
  cath:{n:'留置針',s:'🩸',k:'cath'}, io:{n:'骨內針 IO',s:'🦴',k:'io'},
  ett:{n:'插管器材',s:'🫁',k:'ett'}, needle:{n:'減壓針',s:'📍',k:'needle'},
  peri:{n:'心包穿刺套組',s:'🩺',k:'peri'},
  leads:{n:'監測貼片',s:'📈',k:'leads'},
  paddle:{n:'電擊板',s:'⚡',k:'paddle'}, probe:{n:'超音波探頭',s:'◗',k:'probe'}
},
DRUGS:['epi','amio','calc','bicarb','lytic'],      /* 急救車 →「藥物」 */
FLUIDS:['prbc','ns'],                              /* 急救車 →「點滴及輸血」 */
GEAR:['cath','io','ett','needle','peri','leads'],
JOULES:[120,150,200],

/* ── v3.3 新增的可調參數（codebook 要記錄的都放這裡） ── */
CHECKMAX:10,      /* 心律檢查最長停頓，指引要求 <10 秒 */
CHECKMIN:4,       /* 判讀所需最短時間，避免亂按把停頓壓成 0 */
CCFWIN:120,       /* ROSC 判定用的滾動窗長度（秒） */
/* 壓胸分率的兩個錨點（依現行指引）：60% 基本門檻、80% 理想目標。
   引擎不用硬開關，改成分級 —— CCF 越低，病因處置的起效時間拉得越長。 */
CCF_MIN:0.60,     /* 基本門檻：低於此，代價加速上升 */
CCF_IDEAL:0.80,   /* 理想目標：達到就沒有懲罰 */
CCF_FLOOR:0.40,   /* 生理底線：低於此完全不可能 ROSC */
CCF_K1:2.5,       /* 60–80% 之間的斜率 */
CCF_K2:7.5,       /* 40–60% 之間的斜率（陡） */
/* v4.0：起效改成「累積有效灌流時間」而不是拿當下 CCF 當門檻。
   同時加入不可逆的 no-flow 債 —— 沒有這一條，任何隊伍最後都救得回來。 */
/* 累積 no-flow 的兩個錨點。不是懸崖：超過 SOFT 之後代價線性上升，到 MAX 才完全不可能。
   指引內的心律檢查停頓只計 0.5 倍 —— 生理上一樣沒有灌流，但教學上不該懲罰
   照規矩做的停頓。這是刻意的模型選擇，論文的 Methods 要寫清楚。 */
NOFLOW_SOFT:180,
NOFLOW_MAX:420,
/* 灌流債的上限。沒有上限的話，長時間不壓胸會讓 decay 累積到幾百，
   等於多出一條沒有寫在文件裡的不可逆通道；有上限之後，
   「回不來」這件事只由 K.NOFLOW_MAX 一個參數決定，論文比較好交代。
   校準腳本的最長中斷只有十幾秒，加上限完全不影響既有的校準結果。 */
DECAYMAX:180,
/* 心律對「回得來的難度」的乘數。真實 IHCA 的方向是可電擊優於不可電擊
   （US NIS 1998–2018 出院存活：可電擊 29.8→39.7%、不可電擊 18.9→30.2%），
   v3.4 的引擎剛好相反 —— asystole 是最好打的一格。 */
RHYMULT:{VF:1.0,pVT:1.0,PEA:1.35,asystole:1.9,sinus:1.0},
TUBETEST:8,       /* 「確認管路位置」的觀察窗（秒），期間會自動擠球產生波形 */
/* v4.3 肺泡 CO₂ 存量模型（mmHg）：起始值／無灌流時的地板／上升與衰減時間常數（秒） */
CO2RES0:20, CO2RESMIN:4, CO2TAUUP:10, CO2TAUDN:45,
ROGERTTL:5,       /* 畫面下方「收到」提示存在幾秒 */
ORDERMAX:3,       /* 同時可以有幾則未結案的 order */
SWAPEVERY:120,    /* 報表判定換手頻率用（指引：每 2 分鐘） */
GAPMAX:120,       /* 兩次心律檢查的間隔上限 */
FIRSTCPR_OK:20,   /* 院內目擊 IHCA，開始壓胸的合理延遲 */
FATRISE:240,      /* 連續壓胸多久疲勞到 1.0（2 分鐘輪替時約 0.5） */
FATFALL:120,      /* 完全疲勞後多久恢復 */
FATWARN:0.6,      /* 超過此疲勞值仍在壓，計入「疲勞下未換手」 */
FATRATE:0.35,     /* 疲勞對壓胸速率的拖累係數 */
ORDERTTL:90,      /* Order 多久沒結案就歸檔 */
AMIOAFTER:3,      /* Amiodarone 的時機：第幾次電擊之後 */
TMAX:900,         /* 場次時限（秒） */
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
 {id:'k',n:'高血鉀症',fix:['calc'],partial:{bicarb:0.55},delay:30,typical:['VF','PEA','asystole'],
  fixLabel:'Calcium gluconate（Sodium bicarbonate 是輔助，單獨給只能縮短一部分）',
  chart:'長期血液透析，前天因故沒有透析，上次 K 5.8。',
  fam:'今天整天喊沒力氣、手腳發麻，沒特別喘。',
  echo:'心臟收縮微弱、心室不大；沒有心包積液、右心不擴大、IVC 不塌陷。'},
 {id:'p',n:'肺栓塞',fix:['lytic'],delay:90,typical:['PEA'],
  fixLabel:'血栓溶解劑（起效比較慢）',
  chart:'兩週前髖關節置換術後長期臥床，沒有預防性抗凝。',
  fam:'下床上完廁所回來就一直喘，講一講就倒了。',
  echo:'右心室明顯擴大，心室中膈呈 D-shape；沒有心包積液。'},
 {id:'h',n:'低血容（消化道出血）',fix:['prbc'],partial:{ns:0.6},delay:45,typical:['PEA','asystole'],
  fixLabel:'輸血（快速輸液只能撐，不是正解）',
  chart:'肝硬化併食道靜脈瘤，今晨 Hb 6.2。',
  fam:'剛剛解了一大灘黑便，血壓量不到就叫人了。',
  echo:'左心室空虛、收縮激烈，IVC 完全塌陷；沒有心包積液。'},
 {id:'x',n:'張力性氣胸',fix:['needle'],delay:15,typical:['PEA'],
  fixLabel:'針刺減壓（減壓後很快就回來）',
  chart:'昨天剛放右側中心靜脈導管，之後沒有再照胸片。',
  fam:'突然說喘，血壓一下就掉，兩三分鐘就沒反應。',
  echo:'右側完全沒有 lung sliding，看得到 lung point；心包沒有積液。'},
 {id:'o',n:'上呼吸道阻塞（異物）',fix:['intubate'],delay:90,typical:['PEA','asystole'],
  fixLabel:'解除阻塞並建立進階氣道',
  chart:'中風後吞嚥困難，一直沒有做吞嚥評估，今天家屬自己餵了晚餐。',
  fam:'吃到一半突然講不出話、抓著脖子，臉色一下就發黑了。',
  echo:'心臟收縮微弱，雙側肺滑動都在；沒有心包積液、右心不大、IVC 不塌陷。',
  /* 插管時喉頭鏡一放進去就看得到 —— 不需要有人「宣告」，全場都會知道 */
  laryngo:'喉頭鏡下看到口咽有大量食物殘渣堵住 —— 先抽吸清除再放管子。'},
 {id:'t',n:'心包填塞',fix:['peri'],delay:25,typical:['PEA'],
  fixLabel:'心包穿刺引流（引流後很快就回來）',
  chart:'昨天做完心導管，術後血壓一直偏低，沒有再追蹤心臟超音波。',
  fam:'這一兩個小時越來越喘、講話很費力，臉色發灰。',
  echo:'心包大量積液，右心房在舒張期塌陷。'}
],
PATIENTS:['78 歲男性 · 體格壯碩','64 歲女性 · 體格瘦小','56 歲男性 · 中等身材','71 歲女性 · 中等身材'],
ESCORTLINES:['我先帶您到外面坐一下','裡面同仁正在全力急救','我陪您過去，有消息馬上跟您說','您先深呼吸，我們沒有放棄'],
FAMLINES:['怎麼會這樣…','拜託救救他','我要怎麼辦','剛剛還好好的啊','醫生他會不會有事','是不是我沒注意到'],
FAMPULL:['家屬拉住你問話','家屬擋在旁邊','家屬一直拉著你的手'],
SRC:{chart:'病歷',fam:'家屬與護理師',echo:'床邊超音波'},
/* Order 依處置分類 —— 手機上先選類別再選句子，掃描成本比 12 條平鋪低很多 */
ORDERGRP:[
 {n:'壓胸與脈搏',o:['確認脈搏','開始壓胸','壓胸換手','加強壓胸品質']},
 {n:'監測',    o:['貼上監測貼片','量血壓 NIBP','檢查心律']},
 {n:'呼吸道',  o:['注意通氣時機','準備插管','確認管路位置']},
 {n:'藥物',    o:['Epinephrine 1 mg','Amiodarone 300 mg','Amiodarone 150 mg',
                  'Calcium gluconate','血栓溶解劑']},
 {n:'點滴/輸血',o:['建立血管通路','Normal saline 快速輸液','輸血 pRBC']},
 {n:'找原因',  o:['有人去查病歷','有人推超音波來做','詢問家屬發生什麼事']}
],
/* 可以被「做完了沒」自動查證的 order —— 回報完成不再只是按按鈕（CH-4）。
   沒有列在這裡的指令仍然可以回報，但報表會標成「未查證」。 */
ORDERCHECK:{
 '開始壓胸':      G=>!!G.cpr,
 '確認脈搏':      G=>G.pulseChecks>0,
 '貼上監測貼片':  G=>!!G.leads,
 '量血壓 NIBP':   G=>G.nibp.n>0,
 '檢查心律':      G=>G.round>0,
 '壓胸換手':      G=>G.swaps>0,
 '建立血管通路':  G=>!!G.ivFixed,
 '確認管路位置':  G=>G.airCalled!==null,
 'Epinephrine 1 mg':G=>G.epi>0,
 '輸血 pRBC':     G=>G.drugLog.some(d=>d.k==='prbc'),
 'Normal saline 快速輸液':G=>G.drugLog.some(d=>d.k==='ns'),
 'Calcium gluconate':G=>G.drugLog.some(d=>d.k==='calc'),
 '血栓溶解劑':    G=>G.drugLog.some(d=>d.k==='lytic'),
 'Amiodarone 300 mg':G=>G.amioLog.length>0,
 'Amiodarone 150 mg':G=>G.amioLog.length>0,
 '有人去查病歷':  G=>G.clues.some(q=>q.src==='chart'),
 '有人推超音波來做':G=>G.clues.some(q=>q.src==='echo'),
 '詢問家屬發生什麼事':G=>G.clues.some(q=>q.src==='fam')
},
DRIPS:[
 {id:'none',n:'沒有點滴',short:'—'},
 {id:'ns',  n:'生理食鹽水 500ml',short:'N/S'},
 {id:'d5w', n:'5% 葡萄糖',short:'D5W'},
 {id:'abx', n:'抗生素滴注中',short:'ABX'},
 {id:'prbc',n:'正在輸血',short:'PRBC'}
],
SCOPES:['Direct','Video'],
/* 學員登入時要填的兩個共變量。人事號不顯示在任何畫面上；
   參與次數雖然可以從人事號自動算，但學員可能在別的場次參加過，所以直接問。 */
PGYOPT:['UGY','PGY1','PGY2','R1','R2','R3 以上','護理師','主治醫師'],
VISITOPT:['第 1 次','第 2 次','第 3 次','4 次以上'],
SCOPEN:{Direct:'直接喉頭鏡',Video:'影像喉頭鏡'},
BLADES:['3 號','4 號'],
TUBES:['7.0','7.5'],
READYFOR:{
 cpr  :['我需要換手','我手快沒力了','30 下到了，準備通氣','我繼續壓'],
 head :['通氣完成','氣道有阻力','管子備妥了','管路位置正確','管路位置不對，我拔掉了'],
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
/* 熟悉環境用的假人：沒有正解、不會惡化、不會 ROSC。
   線索文字明講這是練習，避免學員把練習內容誤當成教案答案。 */
TRAIN_CAUSE:{id:'train',n:'練習假人',fix:[],delay:1e9,typical:['VF'],
  fixLabel:'（熟悉環境沒有正解，怎麼做都不會讓他活過來）',
  chart:'練習用的病歷 — 正式演練時這裡會是真正的線索。',
  fam :'練習用的家屬說法 — 正式演練時這裡會是真正的線索。',
  echo:'練習用的超音波所見 — 正式演練時這裡會是真正的線索。'},
/* 熟悉環境的核心互動檢核表：每個人各做過一次才算完成定向。
   完成時間會被記錄，可當作正式演練的共變量。 */
DRILL:[
  {k:'move',n:'走到一個站位'},
  {k:'hold',n:'拿起器材'},
  {k:'cpr' ,n:'開始壓胸'},
  {k:'proc',n:'做一項處置'},
  {k:'talk',n:'講一句話'},
  {k:'ack' ,n:'複誦一則 order'},
  {k:'cast',n:'喊出一條線索'}
],
/* 提出疑慮 — 對應 TeamSTEPPS 的 CUS 三階（Concerned / Uncomfortable / Safety issue）。
   任何人、任何時候都能說，包括正在執行處置的時候。 */
CONCERN:['我有疑慮，可以再確認一次嗎？','這樣我不太放心','停一下 — 這樣有安全問題'],
WALL:{h:22,m:11}
};
K.ORDERS=K.ORDERGRP.reduce((a,g)=>a.concat(g.o),[]);
/* Leader 要先「認出這是什麼節律」，再決定「電或不電」。
   兩者分開記 —— 認對了卻決策錯（例如認出 VF 卻說繼續 CPR）是最值得討論的那一格。 */
K.RECF=[
 {k:'rhythm',n:'心律',o:['VF','VT','PEA','Asystole','竇性心律']},
 {k:'shock', n:'電擊',o:['120 J','150 J','200 J']},
 {k:'drug',  n:'給藥',o:['Epinephrine 1 mg','Amiodarone 300 mg','Amiodarone 150 mg',
                         'Calcium gluconate','Sodium bicarbonate','血栓溶解劑',
                         'Normal saline','pRBC 輸血']},
 {k:'proc',  n:'處置',o:['開始壓胸','壓胸換手','貼監測貼片','建立 IV','打骨內針 IO',
                         '插管','確認管路位置','拔管重插','針刺減壓','心包穿刺','超音波',
                         '量 NIBP','摸脈搏','ROSC']}
];
/* v4.0：Leader 先講「螢幕上是什麼電氣活動」，不是直接講 PEA。
   臨床上 PEA 是「有組織的電氣活動 + 摸不到脈搏」，不能只看螢幕就下定論；
   同樣一條規則心律，摸得到脈搏就是 ROSC。所以判讀拆成三步：
     ① 電氣活動是什麼（VF / VT / 有組織 / 無電氣活動）
     ② 有組織 → 有沒有脈搏（要有人真的去摸並喊出來）
     ③ 電 / 不電 */
K.RIDS=[{k:'VF',n:'VF'},{k:'VT',n:'VT'},
        {k:'ORG',n:'有組織的電氣活動'},{k:'ASYS',n:'無電氣活動 Asystole'}];
K.PERF=[{k:'nopulse',n:'摸不到脈搏 → PEA'},{k:'pulse',n:'摸得到脈搏 → ROSC'}];
const RIDOF=r=>({VF:'VF',pVT:'VT',PEA:'ORG',asystole:'ASYS',sinus:'ORG'})[r]||'ORG';
const RH=id=>K.RHY[id]||K.RHY.asystole;
const mmt=s=>{s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};

/* ═══════════ 種子亂數（重播的基礎） ═══════════ */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;};}

/* ═══════════ 狀態 ═══════════ */
let S=null;
const use=s=>{S=s;return S;};
/* 熟悉環境：勾掉某個人的一項核心互動 */
function drillMark(G,cid,key){
  if(!G.train||!cid)return;
  const d=G.drill[cid]||(G.drill[cid]={});
  if(d[key]!==undefined)return;
  d[key]=Math.round(G.t*10)/10;
  const item=K.DRILL.find(x=>x.k===key);
  if(item)G.feed.push({id:'d'+G.tick,cid,txt:'✔ '+item.n,t:G.t,me:1});
  const act=G.ch.filter(x=>x.active);
  const all=act.length&&act.every(x=>{const dd=G.drill[x.id];
    return dd&&K.DRILL.every(it=>dd[it.k]!==undefined);});
  if(all&&G.drillDone===null)G.drillDone=Math.round(G.t*10)/10;
}
/* 動作 → 檢核項目的對照 */
const DRILLMAP={goto:'move',gotoXY:'move',move:'move',
  grab:'hold',draw:'hold',takeLeads:'hold',takePaddle:'hold',takeProbe:'hold',
  cprStart:'cpr',
  iv:'proc',ioAccess:'proc',fixIv:'proc',attachLeads:'proc',ett:'proc',confirmTube:'proc',
  give:'proc',needle:'proc',peri:'proc',scan:'proc',chart:'proc',ask:'proc',
  nibp:'proc',checkPulse:'proc',bag:'proc',charge:'proc',shock:'proc',clear:'proc',
  cprHold:'cpr',resumeCpr:'cpr',
  ready:'talk',concern:'talk',timeCall:'talk',order:'talk',claimLead:'talk',
  callTube:'talk',answerEtt:'talk',askEtt:'talk',roger:'ack',respondConcern:'talk',
  ack:'ack',doneReport:'ack',
  cast:'cast'};
const cur=()=>S;
/* item 4：回報清單改成累加、不重複；用過的那一條會被移除 */
function addRecent(c,txt){c.recent=c.recent||[];
  if(c.recent.indexOf(txt)<0)c.recent.push(txt);
  while(c.recent.length>6)c.recent.shift();}

function newState(seed,setup){
  setup=setup||{};
  /* PA-3：每個子系統一條獨立的亂數流。
     v3.4 全部共用一條，所以一支隊伍多做幾個動作，之後的上針／插管／電擊
     運氣就整條平移 ——「同一顆種子＝同一個情境」成立，「＝同樣的運氣」不成立。
     分流之後，兩組跑在完全相同的隨機條件下這句話才是真的。 */
  const rng=mulberry32(seed>>>0);
  const R={iv:mulberry32((seed^0x9E3779B1)>>>0), ett:mulberry32((seed^0x85EBCA77)>>>0),
           shock:mulberry32((seed^0xC2B2AE3D)>>>0), cx:mulberry32((seed^0x27D4EB2F)>>>0),
           misc:mulberry32((seed^0x165667B1)>>>0)};
  const cause=setup.train ? K.TRAIN_CAUSE
    : (setup.cause&&setup.cause!=='rand'
       ? K.CAUSES.find(c=>c.id===setup.cause)||K.CAUSES[0]
       : K.CAUSES[Math.floor(rng()*K.CAUSES.length)]);
  const rhythm=setup.rhythm&&setup.rhythm!=='rand'&&K.STARTRHY.includes(setup.rhythm)
    ? setup.rhythm : K.STARTRHY[Math.floor(rng()*K.STARTRHY.length)];
  const names=setup.names||{};
  const NP=Math.max(2,Math.min(6,setup.n||6));      /* 這場有幾個人 */
  return {
    seed:seed>>>0, _rng:rng, _r:R, tick:0, engine:ENGINE,
    train:!!setup.train, drill:{}, drillDone:null, laryngoSaid:0, tubeBeat:0,
    t:0,anim:0,over:null,phase:'lobby',intro:0,paused:false,
    drip:setup.drip||'none', dripNow:setup.drip||'none', feed:[], rhythm, rhythm0:rhythm, check:0,checkRec:null,round:0,
    cause, patient:K.PATIENTS[Math.floor(rng()*K.PATIENTS.length)],
    cpr:null,pauseVent:false,holdCpr:false,cnt:0,needPause:false,breaths:0,vents:0,
    overVent:0,badVent:0,wrongVent:0,noVentT:0,coach:0,coachUsed:0,lastVent:-99,beat:0,ventT:0,
    clearAt:-99, clearCalls:0, noClearShocks:0,
    df:{j:200,sync:false,charged:false,chargeT:0,holder:null},
    shocks:0,syncErr:0,converted:0,nonShock:0,shockLog:[],tShock:null,
    air:'BVM',iv:false,ivFixed:false,ivRoute:null,caths:3,ivTry:0,ioTry:0,
    ettTry:0,badEtt:0,ettSpec:null,tEtt:null,tIv:null,
    /* v4.0 插管確認：插完之後系統不會告訴你對不對，要自己接 EtCO₂ 判讀 */
    airCalled:null, airCallLog:[], tubeTest:0, tubeTestAt:-99, tAirOk:null,
    /* v4.3 肺泡 CO₂ 存量：停止灌流之後 EtCO₂ 不會瞬間歸零，會在幾十秒內慢慢掉。
       擠球吐出來的方波高度看的是這個存量，壓胸造成的小振盪是另一回事。 */
    co2res:K.CO2RES0,
    pulledEtt:0, ettAsk:null, ettAskLog:[],
    epi:0,tEpi:null,epiTimes:[],epiEarly:0,epiLate:0,epiT:-999,
    epiTooEarly:0,epiTooLate:0,
    amioLog:[],amioT:-999,drugLog:[],
    fixed:false,tFixed:null,clues:[],fixQuality:0,
    /* v4.0 結局模型：累積有效灌流時間 + 不可逆的 no-flow 債 */
    roscProgress:0, roscNeed:null, noFlow:0, noFlowDead:false, nfMult:1, nfPen:0,
    ccfPen:0, rhyPen:0, harmPen:0,
    /* 醫源性併發症與無指徵處置 */
    iatroPtx:false, iatroPtxAt:null, iatroPtxFixed:false, iatroPeri:false,
    badCalc:0, badBicarb:0, badLytic:0, badFluidDrug:0, blindProc:0, harmMult:1, harmFlat:0,
    harmLog:[],
    decay:0,decays:0,
    rosc:false,roscAt:null,roscFelt:false,roscKnown:false,roscKnownAt:null,roscHint:0,
    cprAfterRosc:0,cprAfterRoscTotal:0,rearrests:0,rearrestLog:[],
    roscHR:112,roscSp:88,roscCo:41,ccfAtRosc:null,
    nibp:{r:0,val:null,n:0},
    leader:null,leaderName:null,handovers:0,noLeaderT:0,noLeaderWarn:0,
    /* v4.0：同時可以有多則 order（CH-3）。單一插槽會系統性低估指令密集的 Leader。 */
    orderQ:[], orderSeq:0,
    orders:0,ordersAck:0,ordersAckOther:0,ordersDone:0,ordersDoneVerified:0,ordersDoneFalse:0,
    ackDelay:[],ackDelayOther:[],doneDelay:[],orderLog:[],
    concerns:[], pings:[], pingSeq:0, rogers:[], rogerBy:{},
    peaNoPulse:0, falseRosc:0, perfCalls:[],
    log:[],outbox:[],talk:[],tl:[],checks:[],acts:[],pts:[],recs:[],procLog:[],
    num:0,den:0,pause:0,maxPause:0,sinceCheck:0,maxGap:0,lateWarn:0,
    tFirstCpr:null,num2:0,den2:0,maxPauseAfterStart:0,
    cprSec:[],secAcc:0,ccfPen:0,ccfPenFinal:null,ventAt:[],
    cprPaused:0,fatiguedCprT:0,noVentETT:0,ventsAfterEtt:0,
    pulseChecks:0,cprMoved:0,swaps:0,zapped:0,leads:false,timeShown:0,
    tray:[],probeHolder:null,
    family:{x:150,y:640,line:0,lt:0,gone:false,pull:40*(6/Math.max(2,NP))},famOut:null,famDelays:0,
    eq:JSON.parse(JSON.stringify(K.EQ0)),
    np:NP,
    ch:K.SLOTS.map((c,i)=>({...c,active:i<NP,n:names[c.id]||c.id.toUpperCase(),
      x:250+i*36,y:752,vx:0,vy:0,path:[],hold:null,recAt:null,
      busy:null,bob:0,fat:0,push:null,down:0,zap:0,act:0,ettSpec:null,dose:null,
      recent:[],said2:{},downWhy:null,bubble:null,online:false,moving:false,
      cprT:0,dist:0,jobs:0,said:0,slow:false,span:null}))};
}
const rnd=()=>S._rng();
/* 指定子系統的亂數；舊錄影檔不相容，所以這一版是 4.0.0 */
const rndOf=k=>(S._r&&S._r[k])?S._r[k]():S._rng();

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
/* A1：正在執行其他處置（busy）或倒下的人，不算在壓胸。
   ecgAt / physOf 吃的是傳入的 G 而非模組層的 S，所以抽成吃 G 的共用函式，
   避免計分與畫面兩邊各算各的。 */
const isCompressing=G=>{
  if(!G.cpr)return false;
  const c=G.ch.find(x=>x.id===G.cpr);
  return !!(c&&!c.busy&&!c.down&&!G.pauseVent&&!G.holdCpr&&G.check<=0);};
const compressing=()=>isCompressing(S);
/* A5：ROSC 判定用的近期灌流（滾動窗），與報表用的全場 CCF 是兩回事 */
const ccfRecent=()=>{const a=S.cprSec;if(a.length<10)return null;
  let s=0;for(let i=0;i<a.length;i++)s+=a[i];return s/a.length;};
/* 引擎判定要保守：資料還不夠時當成 0（等於還沒開始灌流） */
const ccfRecent0=()=>{const c=ccfRecent();return c===null?0:c;};
const rhyMult=()=>K.RHYMULT[S.rhythm]||1;
/* 壓胸分率對病因起效時間的分級懲罰。回傳倍率：1.0 代表沒有延遲。
   ≥80% ×1.0　│　60–80% 線性到 ×1.5　│　40–60% 陡升到 ×3.0　│　<40% 不可能 ROSC */
const ccfPenalty=cc=>{
  if(cc>=K.CCF_IDEAL)return 1;
  if(cc>=K.CCF_MIN)return 1+(K.CCF_IDEAL-cc)*K.CCF_K1;
  return 1+(K.CCF_IDEAL-K.CCF_MIN)*K.CCF_K1+(K.CCF_MIN-cc)*K.CCF_K2;};
const clearOn=()=>S.t-S.clearAt<10;
const isLeader=c=>S.leader===c.id;
const nearFam=c=>S.family&&!S.family.gone&&Math.hypot(c.x-S.family.x,c.y-S.family.y)<150;
const ccfNow=()=>S.den?S.num/S.den:0;

/* ═══════════ 訊息 ═══════════ */
/* v4.2：say() 沒有指定對象＝全場都聽得到的話，就一定要出現在右側訊息流。
   舊版只有一部分動作記得手動 push2feed，所以「喊 CLEAR」「放電」這種
   最該被看到的事反而不見了。改成統一由 say() 負責，就不會再漏。
   noFeed=true 給那些已經用 push2feed 帶名字推過一次的地方，避免重複。 */
function say(m,who,noFeed){const e={t:S.t,m,who:who||null};
  S.log.unshift(e);if(S.log.length>80)S.log.pop();S.outbox.push(e);
  if(!who&&!noFeed)push2feedSys(m);}
function tl(txt,kind){S.tl.push({t:S.t,txt,kind:kind||''});}
/* 可以拿來跟學員的紀錄逐筆比對的「實際處置」。名稱與 K.RECF 的 proc 選項一致。 */
function proc(n){if(!S.procLog.some(x=>x.n===n&&S.t-x.t<20))S.procLog.push({t:S.t,n});}
/* 每個人的行為區段 — 報表的泳道圖用（第 9 項） */
function span(c,kind,label){
  endSpan(c);
  c.span={id:c.id,t0:S.t,t1:S.t,kind,label};
  S.acts.push(c.span);
}
function endSpan(c){if(c.span){c.span.t1=S.t;c.span=null;}}
/* 瞬間發生的事（講話、下令、放電…）— 泳道圖上畫成小記號 */
function pt(c,kind,label){S.pts.push({id:c.id,t:S.t,kind,label});}

/* item 2：order 與對話一律走同一條右側訊息流，不再依重要性放大字級。
   kind 只用來決定左側色條（誰在說話 vs 系統 vs 指令），不代表輕重。 */
function push2feed(c,txt,kind){
  const e={n:c.n,col:c.c,txt,at:Math.round(S.t*10)/10,kind:kind||'say',by:c.id};
  S.feed.unshift(e); c.said++;
  while(S.feed.length>14)S.feed.pop();
  S.talk.push(e);
  if(txt.indexOf('已經 ')===0)S.timeShown=20;
}
/* item 9：畫面下方的「收到」提示。三秒內沒人按就消失，按了就記一筆。 */
function ping(c,txt,kind){
  S.pings.push({id:++S.pingSeq,t:S.t,by:c?c.id:null,n:c?c.n:'⚕',
    col:c?c.c:'#8FE3F5',txt,kind:kind||'say',ack:[]});
  while(S.pings.length>6)S.pings.shift();}
function clueText(src){
  let t=S.cause[src]||'';
  if(src==='echo'&&S.iatroPtx&&!S.iatroPtxFixed)
    t+='　另外：右側現在完全沒有 lung sliding（剛才那一針之後才出現的）。';
  return t;}
function addClue(c,src){
  let x=S.clues.find(q=>q.src===src);
  if(!x){x={src,txt:clueText(src),t:S.t,known:[c.id],cast:false};S.clues.push(x);}
  else{x.txt=clueText(src);
       if(!x.known.includes(c.id))x.known.push(c.id);}
  say('查到了「'+K.SRC[src]+'」：'+x.txt+'　（只有你知道）',c.id);
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
  /* A1：一個人不可能一邊壓胸一邊上針／摸脈搏／掃超音波。
     和 leaveCpr 分開計數 — 「走開」與「為了做別的事停手」在 debriefing 是兩件事。 */
  if(S.cpr===c.id){S.cpr=null;S.cprPaused++;endSpan(c);
    tl(c.n+' 停下壓胸去做：'+l);}
  const slow=nearFam(c); const d=slow?dur*1.35:dur;
  c.slow=slow; c.busy={l,r:d,d:d,fn}; c.jobs++;
  span(c,kind||'job',l);
}
/* v4.0：正解 = 品質 1.0；部分處置（例如高血鉀只給 bicarb、低血容只給晶體液）
   也算「有處理到」，但需要撐的時間會被 1/quality 拉長。 */
function solve(k){
  const fx=Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix];
  const pa=S.cause.partial||{};
  const q=(fx.indexOf(k)>=0)?1:(pa[k]||0);
  if(q<=0||q<=S.fixQuality)return;
  const upgrade=S.fixed;
  S.fixQuality=q;
  if(!S.fixed){S.fixed=true;S.tFixed=S.t;}
  tl(upgrade?'病因處置升級為正解（'+S.cause.n+'）'
            :(q>=1?'病因處理完成（'+S.cause.n+'）'
                  :'病因只做了部分處置（'+S.cause.n+'）— 會撐比較久'),'key');
}
/* ══ v4.0：錯誤的藥有代價（CH-1 / item 14）══
   經驗性 calcium 在未分化的心跳停止有實證的傷害：
     · COCA RCT（OHCA, n=391, 因安全性提前中止）：sustained ROSC 19% vs 27%（RR 0.72）
     · 單中心 IHCA 世代（n=599, 2011–2024）：校正後 ROSC OR 0.46、出院存活 OR 0.36、
       良好神經預後 OR 0.20
   所以「反正給看看」在這個模擬器裡不再是免費的。指引明訂的適應症
   （高血鉀、鈣離子阻斷劑中毒）當然不受影響。 */
function drugConsequence(k,rec,c){
  if(S.train)return;                     /* 熟悉環境沒有正解，也不該有懲罰 */
  const fx=Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix];
  const pa=S.cause.partial||{};
  const wanted=(fx.indexOf(k)>=0)||(pa[k]!==undefined);
  if(k==='epi'||k==='amio')return;
  if(wanted)return;
  /* 沒有任何線索就給對因藥物 = 亂槍打鳥 */
  if(!S.clues.length)S.blindProc++;
  if(k==='calc'){
    S.badCalc++;
    harm('calc','未分化的心跳停止經驗性給 Calcium — 實證上與較低的 ROSC 與存活相關',
      1.35,0.10,120);
    rec.note='✗ 非高血鉀情境的經驗性 calcium（COCA RCT：ROSC 19% vs 27%）';
  }else if(k==='bicarb'){
    S.badBicarb++;
    harm('bicarb','常規給 Sodium bicarbonate — 沒有證據支持，還會加重細胞內酸血',1.15,0,0);
    rec.note='✗ 常規使用 bicarbonate，指引不建議';
  }else if(k==='lytic'){
    S.badLytic++;
    if(S.cause.id==='h'){
      harm('lytic','在肝硬化併食道靜脈瘤、正在消化道出血的病人給血栓溶解劑 — 大出血',
        2.2,0.35,null);
      rec.note='✗✗ 活動性出血病人給溶栓劑 — 致命性錯誤';
    }else{
      harm('lytic','沒有肺栓塞證據就給血栓溶解劑 — 出血風險',1.5,0.15,180);
      rec.note='✗ 沒有肺栓塞證據的經驗性溶栓';
    }
  }else if(k==='prbc'||k==='ns'){
    S.badFluidDrug++;
    rec.note='與本次病因無關（沒有額外傷害，但佔了一個人的手）';
  }else rec.note=rec.note||'與本次病因無關';
}

/* 插管成功率提高到 90%（第 1 項）；鏡片與管徑不再影響成功率（第 5 項） */
function ettFail(sp){return sp&&sp.scope==='Video'?.05:.10;}
/* 醫源性傷害登記 —— 報表與論文都用這一份。
   mult：把「還要撐多久才回得來」整體拉長的倍率（上限 ×2.6）
   dRate：額外的灌流債速率（每秒），until=null 代表不會消失 */
function harm(kind,txt,mult,dRate,secs,flat){
  S.harmLog.push({t:S.t,kind,txt,mult:mult||1,dRate:dRate||0,flat:flat===undefined?25:flat,
    until:(secs===undefined||secs===null)?null:S.t+secs});
  if(mult&&mult>1)S.harmMult=Math.min(2.6,S.harmMult*mult);
  S.harmFlat=Math.min(150,(S.harmFlat||0)+(flat===undefined?25:flat));
  say('⚠ '+txt);tl(txt,'key');
}
const harmDecay=()=>{let d=0;
  for(const h of S.harmLog)if(h.dRate&&(h.until===null||S.t<h.until))d+=h.dRate;
  return d;};
/* 系統訊息也進訊息流 —— v4.0 起 order／回報／系統提示全部走同一條右側訊息流 */
function push2feedSys(txt,kind){
  S.feed.unshift({n:'⚕',col:'#8FE3F5',txt,at:Math.round(S.t*10)/10,kind:kind||'sys'});
  while(S.feed.length>14)S.feed.pop();}
/* v4.0 CL-2／CL-3：
   ① 舊版 ccfRecent() 在滾動窗不足 30 格時回傳 0，等於把開場 30 秒內的電擊
      機率硬扣 0.42、夾到下限 5% —— 早期去顫反而被懲罰，方向完全相反。
   ② 新增早期去顫加成：監測中的 VF 越早電越好，這是 ACLS 的核心訊息。
   ③ 各係數列在這裡，論文附錄要整表照抄。 */
function shockP(){
  let p=.42;                                /* 基準 */
  p+=({120:-.04,150:.02,200:.08})[S.df.j]||0;
  const cc=ccfRecent();
  if(cc!==null)p+=(cc-.70)*.5;              /* 近期灌流；資料不足就不套用 */
  p+=Math.max(0,(150-S.t)/150)*0.28;        /* 早期去顫加成（前 2.5 分鐘） */
  if(S.rhythm==='pVT')p+=.08;
  if(S.t-S.epiT<300)p+=.08;
  if(S.t-S.amioT<180)p+=.15;
  p-=Math.min(.22,(S.t/60)*.022);           /* 時間 */
  p-=(S.decay/105)*.15;                     /* 灌流債 */
  return Math.max(.04,Math.min(.92,p));
}
function announceRosc(c){
  if(!S.rosc||S.roscKnown)return;
  S.roscKnown=true;S.roscKnownAt=S.t;S.phase='post';proc('ROSC');
  if(S.cpr){const cc=C(S.cpr);endSpan(cc);}
  S.cpr=null;S.check=0;S.checkRec=null;
  say('★ 團隊確認恢復自發循環 — 停止壓胸，進入 ROSC 後照護。');
  tl('團隊確認 ROSC','key');
}
/* p.id 指定某一則；沒指定就挑最舊一則「這個人還能對它做事」的 */
function findOrder(c,p,what){
  if(p&&p.id)return S.orderQ.find(o=>o.id===p.id)||null;
  for(const o of S.orderQ){
    if(what==='ack'){if(o.by!==c.id&&o.ack.indexOf(c.id)<0)return o;}
    else{if(!o.done&&(o.ack.indexOf(c.id)>=0||o.to===c.id))return o;}}
  return null;}
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
   if(K.DRUGS.indexOf(p.k)<0&&K.FLUIDS.indexOf(p.k)<0)return;
   if(p.k==='amio'&&K.AMIO.indexOf(p.dose)<0)return;
   begin(c,'抽 '+K.ITEM[p.k].n+(p.dose?' '+p.dose+'mg':''),7,function(){
     c.hold=p.k;c.dose=p.dose||null;
     addRecent(c,K.ITEM[p.k].n+(p.dose?' '+p.dose+'mg':'')+' 已抽好');
     say(K.ITEM[p.k].n+(p.dose?' '+p.dose+'mg':'')+' 抽好了',c.id);},'prep');},
 grab(c,p){if(!active(c)||c.hold||c.push||nearEq(c)!=='cart')return;
   if(p.k==='leads')return;
   if(p.k==='cath'){if(S.caths<=0)return;c.hold='cath';say('拿了一根留置針',c.id);return;}
   if(p.k==='io'){c.hold='io';say('拿了骨內針',c.id);return;}
   if(p.k==='ett'){
     /* item 6：床頭已經指定過規格的話，可以一鍵照著備 */
     if(p.spec===1&&S.ettAsk&&S.ettAsk.spec)p=Object.assign({k:'ett'},S.ettAsk.spec);
     if(K.SCOPES.indexOf(p.scope)<0||K.BLADES.indexOf(p.blade)<0||K.TUBES.indexOf(p.tube)<0)return;
     begin(c,'備插管器材',9,function(){
       c.hold='ett';c.ettSpec={scope:p.scope,blade:p.blade,tube:p.tube};
       addRecent(c,'插管器材備妥（'+K.SCOPEN[p.scope]+'・'+p.blade+'・'+p.tube+'）');
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
   S.df.chargeT=3;push2feed(c,'電擊器充電 '+S.df.j+' J','say');
   say('電擊器開始充電 '+S.df.j+'J。',null,1);},
 clear(c){if(!active(c)||S.df.holder!==c.id)return;S.clearAt=S.t;S.clearCalls++;
   pt(c,'say','喊 CLEAR');
   push2feed(c,'【CLEAR】大家手離開！','concern');
   say('【CLEAR】'+c.n+' 喊了 clear。',null,1);tl(c.n+' 喊 CLEAR');},
 shock(c){if(!active(c)||S.df.holder!==c.id||!S.df.charged||!atSide(c)||!inCable(c,'defib'))return;
   S.df.charged=false;
   if(S.df.sync){S.syncErr++;say('設在同步模式 — 沒有可同步的 R 波，機器沒有放電。');return;}
   const R=RH(S.rhythm), calledClear=clearOn();
   pt(c,'shock','放電 '+S.df.j+'J');
   push2feed(c,'⚡ 放電 '+S.df.j+' J','concern');
   S.shocks++;if(S.tShock===null)S.tShock=S.t;
   if(!calledClear)S.noClearShocks++;
   const risky=AC().filter(o=>o!==c&&!o.down&&
     ((S.cpr===o.id&&!S.holdCpr&&!S.pauseVent)||(o.busy&&(atSide(o)||nearSt(o)==='head'))));
   /* A2：正確的 clear 程序（口頭宣告＋目視確認）在真實情境接近 100% 安全。
      只有正在執行侵入性處置、手離不開的人仍有機會被波及。 */
   const hit=calledClear?risky.filter(function(o){return o.busy?rndOf('cx')<0.20:false;}):risky;
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
     if(rndOf('shock')<p){
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
     begin(c,'超音波掃描',15,function(){addClue(c,'echo');proc('超音波');addRecent(c,'超音波掃完了');},'dx');},

 /* ── 線索 ── */
 chart(c){if(!active(c)||nearEq(c)!=='pc'||c.push)return;
   if(S.clues.some(q=>q.src==='chart'))return;      /* 病歷只要有人查過就不用再查 */
   begin(c,'查病歷',12,function(){addClue(c,'chart');},'dx');},
 ask(c){if(!active(c))return;
   if(S.clues.some(q=>q.src==='fam'))return;         /* 家屬的說法問過一次就夠 */
   const ok=S.family.gone?nearSt(c)==='door':Math.hypot(c.x-S.family.x,c.y-S.family.y)<140;
   if(!ok)return;
   begin(c,'問家屬與護理師',10,function(){addClue(c,'fam');},'dx');},
 cast(c,p){const x=S.clues.find(q=>q.src===p.src);
   if(!x||x.known.indexOf(c.id)<0)return;
   x.cast=true;x.known=AC().map(o=>o.id);
   pt(c,'say','喊出'+K.SRC[p.src]);
   push2feed(c,'【'+K.SRC[p.src]+'】'+x.txt,'clue');
   ping(c,'【'+K.SRC[p.src]+'】'+x.txt,'clue');
   say(c.n+' 大聲喊出：'+x.txt,null,1);tl(c.n+' 公開線索：'+K.SRC[p.src],'key');},
 ready(c,p){if(!active(c))return;
   const fromRecent=(c.recent||[]).indexOf(p.txt);
   if(!READYALL[p.txt]&&fromRecent<0)return;
   pt(c,'say',p.txt);
   push2feed(c,p.txt,'say');
   ping(c,p.txt,'say');
   say(c.n+' 回報：'+p.txt,null,1);
   /* item 4：剛做好的事回報過一次就從清單消失，不會一直掛在那裡 */
   if(fromRecent>=0)c.recent.splice(fromRecent,1);
   /* 心律檢查中回報脈搏 —— 這是 Leader 能不能判 PEA 的前提（item 13） */
   if(S.checkRec){
     if(p.txt==='摸不到脈搏')S.checkRec.pulseCalled='no';
     else if(p.txt==='我摸到脈搏了！'||p.txt==='病人有脈搏，停止壓胸')S.checkRec.pulseCalled='yes';}
   if(p.txt==='我摸到脈搏了！'||p.txt==='病人有脈搏，停止壓胸')announceRosc(c);
   if(p.txt==='管路位置正確')ACT.callTube(c,{v:'ok'});
   if(p.txt==='管路位置不對，我拔掉了')ACT.callTube(c,{v:'out'});},
 /* 按下「紀錄」的那一刻就把時間釘住 —— 填完表單才送出，時間才不會被填表拖慢 */
 recBegin(c){if(!active(c)||nearEq(c)!=='pc')return;c.recAt=S.t;},
 recSubmit(c,p){if(!active(c)||nearEq(c)!=='pc')return;
   p=p||{};
   const e={t:(c.recAt!==null&&c.recAt!==undefined)?c.recAt:S.t,by:c.id,n:c.n};
   let any=false;
   for(const f of K.RECF){const v=p[f.k];
     if(v&&f.o.indexOf(v)>=0){e[f.k]=v;any=true;}else e[f.k]=null;}
   c.recAt=null;
   if(!any)return;
   S.recs.push(e);
   const parts=K.RECF.filter(f=>e[f.k]).map(f=>f.n+'：'+e[f.k]);
   pt(c,'say','紀錄');
   say('【紀錄】'+mmt(e.t)+'　'+parts.join('　'));
   tl('紀錄：'+parts.join('／'));},
 timeCall(c){if(nearEq(c)!=='pc')return;
   push2feed(c,'已經 '+Math.floor(S.t/60)+' 分 '+Math.floor(S.t%60)+' 秒，距上次心律檢查 '
     +Math.floor(S.sinceCheck/60)+' 分 '+Math.floor(S.sinceCheck%60)+' 秒',1);
   pt(c,'say','報時');say('紀錄報時。',null,1);},

 /* ── Leader ── */
 claimLead(c){if(!active(c)||nearSt(c)!=='foot'||S.leader===c.id)return;
   const had=S.leader;
   if(had){S.handovers++;say('【Leader 交接】'+C(had).n+' → '+c.n);tl('Leader 交接：'+C(had).n+' → '+c.n,'key');}
   else{say('【Leader】'+c.n+' 宣告接下 Leader。');tl(c.n+' 宣告 Leader','key');}
   S.leader=c.id;S.leaderName=c.n;pt(c,'lead','接下 Leader');
   push2feed(c,'我接 Leader','order');},
 /* 閉環三段：下令（可指名）→ 被指派者複誦 → 執行完回報完成。
    v4.0（CH-3）：同時最多 K.ORDERMAX 則。單一插槽會讓指令下得快的 Leader
    複誦率被系統性低估 —— 那是量測假象，不是團隊表現。 */
 order(c,p){if(!isLeader(c)||nearSt(c)!=='foot'||K.ORDERS.indexOf(p.txt)<0)return;
   while(S.orderQ.length>=K.ORDERMAX){const o0=S.orderQ.shift();o0.dropped=1;S.orderLog.push(o0);}
   const to=(p.to&&C(p.to)&&C(p.to).active&&p.to!==c.id)?p.to:null;
   const o={id:++S.orderSeq,txt:p.txt,by:c.id,byN:c.n,at:S.t,to,toN:to?C(to).n:null,
     ack:[],ackAt:null,ackBy:null,done:false,doneAt:null,doneBy:null,verified:null};
   S.orderQ.push(o);S.orders++;
   pt(c,'order','下令：'+p.txt+(to?'（'+C(to).n+'）':''));
   say('【Order】'+c.n+'：'+p.txt+(to?' — '+C(to).n:''));
   ping(c,'Order：'+p.txt+(to?'（'+C(to).n+'）':''),'order');
   tl('Order：'+p.txt+(to?' → '+C(to).n:'（未指名）'));},
 ack(c,p){const o=findOrder(c,p,'ack');if(!o)return;
   if(o.by===c.id||o.ack.indexOf(c.id)>=0)return;
   const isTarget=!o.to||o.to===c.id;
   if(!o.ack.length){o.ackAt=S.t;o.ackBy=c.id;
     if(isTarget){S.ordersAck++;S.ackDelay.push(S.t-o.at);}
     else{S.ordersAckOther++;S.ackDelayOther.push(S.t-o.at);}}
   o.ack.push(c.id);pt(c,'ack','複誦');
   say(c.n+' 複誦收到：'+o.txt+(isTarget?'':'（不是被指名的人）'));
   if(o.txt==='加強壓胸品質'&&S.cpr===c.id){S.coach=60;S.coachUsed++;c.fat=Math.max(0,c.fat-.35);
     say(c.n+' 調整了手的位置與深度 — EtCO₂ 應該會上來。');}},
 /* CH-4：可以查證的指令會真的去查有沒有做，回報不再只是按按鈕 */
 doneReport(c,p){const o=findOrder(c,p,'done');if(!o||o.done)return;
   if(o.ack.indexOf(c.id)<0&&o.to!==c.id)return;
   o.done=true;o.doneAt=S.t;o.doneBy=c.id;o.doneByN=c.n;
   const chk=K.ORDERCHECK[o.txt];
   o.verified=chk?!!chk(S):null;
   S.ordersDone++;S.doneDelay.push(S.t-o.at);
   if(o.verified===true)S.ordersDoneVerified++;
   if(o.verified===false)S.ordersDoneFalse++;
   pt(c,'ack','回報完成');
   push2feed(c,'「'+o.txt+'」完成','ack');
   say(c.n+' 回報完成：'+o.txt+(o.verified===false?'（系統查證：這件事還沒做到）':''),null,1);
   ping(c,'「'+o.txt+'」完成','ack');
   S.orderQ=S.orderQ.filter(x=>x!==o);S.orderLog.push(o);},
 /* item 9：畫面下方的「收到」—— 不點就三秒後消失 */
 roger(c,p){const q=S.pings.find(x=>x.id===(p&&p.id));
   if(!q||q.by===c.id||q.ack.indexOf(c.id)>=0)return;
   if(S.t-q.t>K.ROGERTTL+1.5)return;
   q.ack.push(c.id);
   S.rogers.push({t:S.t,by:c.id,n:c.n,pid:q.id,txt:q.txt,delay:S.t-q.t});
   S.rogerBy[c.id]=(S.rogerBy[c.id]||0)+1;
   pt(c,'ack','收到');},
 /* 提出疑慮 — 任何人、任何時候都能說，包括正在執行處置時 */
 concern(c,p){if(!c.active||S.over||S.paused||S.phase==='lobby')return;
   if(K.CONCERN.indexOf(p.txt)<0)return;
   S.concerns.push({id:S.concerns.length+1,t:S.t,by:c.id,n:c.n,txt:p.txt,
     lvl:K.CONCERN.indexOf(p.txt)+1, leader:S.leader, rhythm:S.rhythm,
     resAt:null,resBy:null});
   pt(c,'say',p.txt);
   push2feed(c,p.txt,'concern');
   ping(c,'⚠ '+p.txt,'concern');
   say('【提出疑慮】'+c.n+'：'+p.txt,null,1);
   tl(c.n+' 提出疑慮：'+p.txt,'key');},
 /* CH-5：CUS 的重點在「被聽見」。沒有回應這個動作，就只量到敢不敢說。 */
 respondConcern(c,p){const q=S.concerns.find(x=>x.id===(p&&p.id)&&x.resAt===null)
     ||S.concerns.slice().reverse().find(x=>x.resAt===null);
   if(!q||q.by===c.id)return;
   q.resAt=S.t;q.resBy=c.id;q.resByN=c.n;q.resLeader=(S.leader===c.id);
   pt(c,'lead','回應疑慮');
   push2feed(c,'我聽到了：「'+q.txt+'」— 我們現在處理','ack');
   say('【回應疑慮】'+c.n+' 回應了 '+q.n+' 的疑慮。',null,1);
   ping(c,'回應 '+q.n+' 的疑慮','ack');
   tl(c.n+' 回應疑慮（延遲 '+Math.round(q.resAt-q.t)+' 秒）','key');},

 /* ── 壓胸 ── */
 cprStart(c){if(!active(c)||!atSide(c)||S.check>0||c.hold==='paddle')return;
   if(S.cpr===c.id)return;
   if(S.cpr){S.swaps++;const old=C(S.cpr);endSpan(old);
     push2feed(c,'接手壓胸（'+old.n+' → '+c.n+'）','say');say('換手：'+old.n+' → '+c.n,null,1);}
   else{push2feed(c,'開始壓胸','say');say(c.n+' 開始壓胸。',null,1);
     if(!S.tl.some(x=>x.txt==='開始壓胸'))tl('開始壓胸','key');}
   S.cpr=c.id;S.cnt=0;S.needPause=false;S.pauseVent=false;span(c,'cpr','壓胸');
   proc(S.swaps&&S.tFirstCpr!==null?'壓胸換手':'開始壓胸');},
 cprStop(c){if(S.cpr===c.id){S.cpr=null;endSpan(c);
   push2feed(c,'停止壓胸','say');say(c.n+' 停止壓胸。',null,1);}},
 /* v4.3：任何時候都能暫停壓胸（原本只有數到 30 下才點得下去）。
    暫停之後位置還是你的，按「繼續壓胸」就接回去。 */
 cprHold(c){if(S.cpr!==c.id||S.holdCpr||S.pauseVent)return;
   S.holdCpr=true;endSpan(c);
   push2feed(c,'暫停壓胸','say');say(c.n+' 暫停壓胸。',null,1);},
 callPause(c){if(S.cpr!==c.id||S.pauseVent)return;
   S.pauseVent=true;S.breaths=0;S.noVentT=0;say('壓到 30 下 — 停手，等床頭通氣。');},
 skipVent(c){if(S.cpr!==c.id||!S.pauseVent||S.noVentT<12)return;
   S.pauseVent=false;S.holdCpr=true;S.cnt=0;S.needPause=false;
   S.badVent++;say('放棄這輪通氣 — 床頭沒有及時配合。');},
 resumeCpr(c){if(S.cpr!==c.id||!S.holdCpr)return;S.holdCpr=false;
   span(c,'cpr','壓胸');push2feed(c,'繼續壓胸','say');say(c.n+' 繼續壓胸。',null,1);},
 bag(c){if(!active(c)||nearSt(c)!=='head')return;
   c.act=2.0;
   if(S.pauseVent){S.breaths++;S.vents++;
     S.ventAt.push(S.t);while(S.ventAt.length&&S.ventAt[0]<S.t-30)S.ventAt.shift();
     if(S.noVentT>10&&S.breaths===1){S.badVent++;}
     if(S.breaths>=2){S.pauseVent=false;S.holdCpr=true;S.cnt=0;S.needPause=false;
       say('兩次通氣完成。');}}
   else if(S.air==='ETT'){S.vents++;S.ventsAfterEtt++;S.ventT=0;
     S.ventAt.push(S.t);while(S.ventAt.length&&S.ventAt[0]<S.t-30)S.ventAt.shift();
     if(S.t-(S.lastVent||-99)<4)S.overVent++;   /* 次數照記，但不再出言提示 */
     S.lastVent=S.t;}
   else if(S.air==='bad'){say('擠得下去，但胸廓沒有起伏 — 氣沒進到肺裡。');}
   else{S.wrongVent++;S.vents++;}},

 /* ── 插管 ── */
 /* v4.0（item 8 / CL-5）：插完之後系統不會告訴你對不對。
    要自己接 EtCO₂、擠球、看波形，然後宣告「位置正確」或「拔管重來」。 */
 ett(c){if(!active(c)||nearSt(c)!=='head'||S.air!=='BVM'||c.hold)return;
   const helper=AC().find(o=>o!==c&&o.hold==='ett'&&Math.hypot(o.x-c.x,o.y-c.y)<165);
   if(!helper)return;
   const spec=helper.ettSpec;S.ettSpec=spec;
   const fail=ettFail(spec);
   /* item 12：喉頭鏡一放進去，全場都看得到口咽有東西 —— 不需要有人手動宣告 */
   if(S.cause.laryngo&&!S.laryngoSaid){S.laryngoSaid=1;
     say('【'+c.n+' 的喉頭鏡視野】'+S.cause.laryngo);
     ping(null,'喉頭鏡下：'+S.cause.laryngo,'sys');
     tl('喉頭鏡下發現：'+S.cause.laryngo,'key');}
   begin(c,'插管（'+K.SCOPEN[spec.scope]+'）',15,function(){S.ettTry++;
     helper.hold=null;helper.ettSpec=null;
     S.airCalled=null;proc('插管');
     for(const o of AC())o.tubeSeen=0;
     if(rndOf('ett')<fail){S.air='bad';S.badEtt++;}
     else{S.air='ETT';if(S.tEtt===null)S.tEtt=S.t;S.cnt=0;S.needPause=false;S.pauseVent=false;
       solve('intubate');}
     say(c.n+' 完成插管。');
     tl(c.n+' 完成插管（第 '+S.ettTry+' 次嘗試），尚未確認位置','key');},'air');},
 /* 接上 EtCO₂ 並擠球 —— 期間會自動產生通氣，所以波形會出現（或不出現） */
 confirmTube(c){if(!active(c)||nearSt(c)!=='head'||S.air==='BVM'||c.hold)return;
   if(S.tubeTest>0)return;
   S.tubeTest=K.TUBETEST;S.tubeTestAt=S.t;
   say(c.n+' 接上 EtCO₂，擠球看波形。');
   begin(c,'接 EtCO₂ 確認管路',K.TUBETEST,function(){
     c.tubeSeen=1;S.tubeTestAt=S.t;
     addRecent(c,'管路位置正確');addRecent(c,'管路位置不對，我拔掉了');
     },'air');},
 /* 判讀：對錯由學員自己承擔，系統只記錄 */
 callTube(c,p){if(!active(c)||nearSt(c)!=='head'||S.air==='BVM')return;
   if(!c.tubeSeen)return;
   if(p.v!=='ok'&&p.v!=='out')return;
   const truth=S.air;
   const correct=(p.v==='ok')===(truth==='ETT');
   S.airCallLog.push({t:S.t,by:c.n,said:p.v,truth,correct,
     wait:S.tEtt!==null?Math.round(S.t-S.tEtt):null});
   S.airCalled=p.v;proc('確認管路位置');
   /* v4.3（item 10）：宣告過之後，「回報」清單裡的這兩句就該收起來 ——
      要拔管改走甦醒球下面那顆紅色的「拔掉後重插」（需要再確認一次）。 */
   for(const o of AC())if(o.recent)o.recent=o.recent.filter(
     t=>t!=='管路位置正確'&&t!=='管路位置不對，我拔掉了');
   if(p.v==='ok'){
     if(correct&&S.tAirOk===null)S.tAirOk=S.t;
     say('【管路確認】'+c.n+'：位置正確。');
     ping(c,'管路位置正確','say');
     tl(c.n+' 宣告管路位置正確'+(correct?'':'（實際上位置不對）'),'key');
   }else{
     S.air='BVM';S.pulledEtt++;S.ettSpec=null;proc('拔管重插');
     for(const o of AC())o.tubeSeen=0;
     say('【拔管】'+c.n+' 把管子拔掉，改回甦醒球通氣。');
     ping(c,'我把管子拔掉了，改回甦醒球','say');
     tl(c.n+' 拔管改回 BVM'+(correct?'':'（其實原本位置是對的）'),'key');
   }},
 /* item 6：在急救車旁的人問床頭「器材要怎麼備」，床頭的人跳出選擇視窗 */
 askEtt(c){if(!active(c)||nearEq(c)!=='cart')return;
   const head=AC().find(o=>o!==c&&nearSt(o)==='head'&&!o.down);
   if(!head)return;
   S.ettAsk={by:c.id,byN:c.n,to:head.id,toN:head.n,at:S.t,spec:null};
   say('【詢問】'+c.n+' 問 '+head.n+'：插管器材要怎麼準備？');
   say('◆ '+c.n+' 在急救車旁問你插管器材要怎麼備 — 請指定。',head.id);
   tl(c.n+' 詢問 '+head.n+' 插管器材規格');},
 answerEtt(c,p){if(!active(c)||!S.ettAsk||S.ettAsk.spec)return;
   if(nearSt(c)!=='head')return;
   if(K.SCOPES.indexOf(p.scope)<0||K.BLADES.indexOf(p.blade)<0||K.TUBES.indexOf(p.tube)<0)return;
   S.ettAsk.spec={scope:p.scope,blade:p.blade,tube:p.tube};S.ettAsk.ansAt=S.t;S.ettAsk.ansBy=c.id;
   S.ettAskLog.push(Object.assign({},S.ettAsk));
   const txt=K.SCOPEN[p.scope]+'・'+p.blade+'鏡片・'+p.tube+' 號管';
   say('【指定器材】'+c.n+'：'+txt);
   ping(c,'插管器材：'+txt,'order');
   tl(c.n+' 指定插管器材：'+txt);},

 /* ── 血管通路 ── */
 iv(c){if(!active(c)||!atSide(c)||c.hold!=='cath')return;
   begin(c,'上針',10,function(){S.ivTry++;c.hold=null;S.caths--;
     if(rndOf('iv')<[.55,.45,.35][Math.min(S.ivTry-1,2)]){S.iv=true;S.ivRoute='IV';
       addRecent(c,'靜脈通路上好了');say('第 '+S.ivTry+' 針回血了 — 還要固定接輸液',c.id);}
     else{addRecent(c,'這一針沒上到，我再拿一根');
       say('第 '+S.ivTry+' 針失敗，針用掉了。剩 '+S.caths+' 根',c.id);}},'access');},
 fixIv(c){if(!active(c)||!atSide(c)||!S.iv||S.ivFixed)return;
   begin(c,'固定接輸液',6,function(){S.ivFixed=true;S.tIv=S.t;proc('建立 IV');
     addRecent(c,'通路固定好了，可以給藥');say('通路固定好了，可以給藥',c.id);
     tl('建立血管通路（IV，第 '+S.ivTry+' 針）','key');},'access');},
 ioAccess(c){if(!active(c)||!atSide(c)||c.hold!=='io')return;
   begin(c,'打骨內針 IO',12,function(){S.ioTry++;c.hold=null;
     if(rndOf('iv')<.95){S.iv=true;S.ivFixed=true;S.ivRoute='IO';S.tIv=S.t;proc('打骨內針 IO');
       addRecent(c,'骨內針上好了，可以給藥');say('骨內針進去了，回抽有骨髓 — 可以直接給藥',c.id);
       tl('建立血管通路（IO）','key');}
     else{addRecent(c,'骨內針沒進去，再一支');say('骨內針位置不對，要重來',c.id);}},'access');},

 /* ── 給藥 ── */
 give(c){if(!active(c)||!atSide(c)||!S.ivFixed)return;
   if(!c.hold||K.ITEM[c.hold].k!=='drug')return;
   begin(c,'推藥',2,function(){const k=c.hold,dz=c.dose;c.hold=null;c.dose=null;
     const rec={t:S.t,k,n:K.ITEM[k].n,dose:dz,by:c.n,rhythm:RH(S.rhythm).short,note:''};
     if(k==='epi'){
       S.epi++;if(S.tEpi===null)S.tEpi=S.t;
       const last=S.epiTimes.length?S.epiTimes[S.epiTimes.length-1]:null;
       if(last===null){
         /* A10：可電擊節律應在初始電擊失敗之後才給；不可電擊節律則越早越好 */
         const shockableNow=RH(S.rhythm).shock;
         if(shockableNow&&S.shocks<1){S.epiTooEarly++;
           rec.note='首劑 '+mmt(S.t)+' ✗（可電擊節律，尚未完成初始電擊就給藥）';}
         else if(!shockableNow&&S.t>300){S.epiTooLate++;
           rec.note='首劑 '+mmt(S.t)+' ✗（不可電擊節律，逾 5 分鐘才給）';}
         else rec.note='首劑 '+mmt(S.t)+' ✓';
       }
       else{const gap=S.t-last;
         if(gap<180){S.epiEarly++;rec.note='間隔僅 '+Math.round(gap)+' 秒（<3 分鐘）';}
         else if(gap>300){S.epiLate++;rec.note='間隔 '+Math.round(gap)+' 秒（>5 分鐘）';}
         else rec.note='間隔 '+Math.round(gap)+' 秒 ✓';}
       S.epiTimes.push(S.t);S.epiT=S.t;}
     if(k==='amio'){
       /* A9：指引的位置是「第 3 次電擊後仍持續的 VF/pVT」，不是一開場就給 */
       const n=S.amioLog.length+1, want=n===1?'300':'150', shockable=RH(S.rhythm).shock;
       const timely=S.shocks>=K.AMIOAFTER;
       const ok=(dz===want)&&shockable&&timely;
       rec.note=(dz===want?'第 '+n+' 劑 '+dz+'mg':'第 '+n+' 劑應為 '+want+'mg，給了 '+dz+'mg')
         +(shockable?'':'；當下不是可電擊節律')
         +(timely?'':'；只電擊了 '+S.shocks+' 次，還沒到難治性 VF/pVT 的用藥時機')
         +(ok?' ✓':' ✗');
       S.amioLog.push({t:S.t,dose:dz,ok,shockable,timely,shocks:S.shocks});
       if(ok)S.amioT=S.t;}
     /* 掛上去的東西要看得見：床邊點滴袋會換成現在正在給的那一包 */
     if(k==='prbc'||k==='ns')S.dripNow=k;
     drugConsequence(k,rec,c);
     S.drugLog.push(rec);
     addRecent(c,K.ITEM[k].n+(dz?' '+dz+'mg':'')+' 已給完');
     say(K.ITEM[k].n+(dz?' '+dz+'mg':'')+' 推完了',c.id);
     tl(c.n+' 給 '+K.ITEM[k].n+(dz?' '+dz+'mg':''));
     solve(k);},'drug');},

 peri(c){if(!active(c)||!atSide(c)||c.hold!=='peri')return;
   const blind=!S.clues.some(q=>q.known.indexOf(c.id)>=0||q.cast);
   begin(c,'心包穿刺引流',14,function(){c.hold=null;
     const isTamp=(Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix]).indexOf('peri')>=0;
     if(blind&&!S.train)S.blindProc++;
     proc('心包穿刺');
     if(isTamp){say('抽出一大管不凝固的血 — 對了，是心包填塞。');
       tl(c.n+' 心包穿刺：抽出大量積血','key');solve('peri');return;}
     say('針進去只抽到一點點液體，這不是填塞。');
     tl(c.n+' 心包穿刺：幾乎沒有液體');
     /* 沒有指徵的盲穿：30% 傷到心肌或冠狀動脈，而且無法回復 */
     if(!S.train&&rndOf('cx')<0.30){
       S.iatroPeri=true;
       harm('peri','沒有指徵的心包穿刺傷到心肌 — 心包內開始積血',1.6,0.15,null);
     }},'drug');},
 needle(c){if(!active(c)||!atSide(c)||c.hold!=='needle')return;
   const blind=!S.clues.some(q=>q.known.indexOf(c.id)>=0||q.cast);
   begin(c,'針刺減壓',12,function(){c.hold=null;
     const isPtx=(Array.isArray(S.cause.fix)?S.cause.fix:[S.cause.fix]).indexOf('needle')>=0;
     if(blind&&!S.train)S.blindProc++;
     proc('針刺減壓');
     if(isPtx){say('一大股氣噴出來 — 對了，是張力性氣胸。');
       tl(c.n+' 針刺減壓：有氣噴出','key');solve('needle');return;}
     if(S.iatroPtx&&!S.iatroPtxFixed){
       S.iatroPtxFixed=true;
       say('這次有氣噴出來了 — 剛才那一針造成的氣胸被引流掉了。');
       tl(c.n+' 針刺減壓：處理掉自己造成的氣胸','key');return;}
     say('刺進去沒有氣，這不是氣胸。');
     tl(c.n+' 針刺減壓：沒有氣');
     /* CH-1：沒有指徵的針刺減壓有 40% 造成醫源性氣胸。
        病人會慢慢變差，超音波重掃看得到 —— 學員要自己發現是自己造成的。 */
     if(!S.train&&rndOf('cx')<0.40){
       S.iatroPtx=true;S.iatroPtxAt=S.t;
       harm('ptx','沒有指徵的針刺減壓造成醫源性氣胸 — 這一側的肺開始塌',1.4,0.22,null);
     }},'drug');},

 /* ── EKG / 脈搏 / 血壓 ── */
 attachLeads(c){if(!active(c)||c.hold!=='leads'||!atSide(c)||S.leads)return;
   begin(c,'貼上 EKG lead',5,function(){S.leads=true;c.hold=null;proc('貼監測貼片');
     addRecent(c,'EKG lead 貼好了');say('EKG lead 貼上，螢幕上開始有波形。');tl('貼上 EKG lead','key');},'dx');},
 /* 第 4 項：摸脈搏的結果只有自己知道，一定要喊出來 */
 checkPulse(c){if(!active(c)||!atSide(c))return;
   begin(c,'摸脈搏',5,function(){S.pulseChecks++;proc('摸脈搏');
     if(S.checkRec)S.checkRec.pulse=true;
     tl(c.n+' 摸脈搏：'+(S.rosc?'有':'沒有'));
     if(S.rosc){S.roscFelt=true;addRecent(c,'我摸到脈搏了！');addRecent(c,'病人有脈搏，停止壓胸');
       say('◆ 摸到脈搏了 — 強而規則。',c.id);}
     else{addRecent(c,'摸不到脈搏');say('摸不到脈搏。',c.id);}},'dx');},
 /* 第 3、4 項：只要人在床邊，隨時都能量 NIBP；結果是客觀的，全隊都看得到 */
 nibp(c){if(!active(c)||!atSide(c)||S.nibp.r>0)return;
   S.nibp.r=30;S.nibp.val=null;S.nibp.n++;proc('量 NIBP');say(c.n+' 按下 NIBP，開始量測（30 秒）。');
   tl(c.n+' 量 NIBP');},

 /* ── 心律檢查 ── */
 rhythmCheck(c){if(!active(c)||S.checkRec||nearSt(c)!=='foot'||!isLeader(c))return;
   S.round++;S.check=K.CHECKMAX;
   if(S.cpr){const cc=C(S.cpr);endSpan(cc);}
   S.cpr=null;S.pauseVent=false;S.holdCpr=false;
   S.maxGap=Math.max(S.maxGap,S.sinceCheck);S.sinceCheck=0;
   S.checkRec={t:S.t,n:S.round,rhythm:S.rhythm,call:null,correct:null,pulse:false,dur:0,
     pulseCalled:null,perf:null,perfAt:null,perfCorrect:null};
   pt(c,'lead','喊停檢查心律');
   push2feed(c,'停止壓胸，檢查心律（第 '+S.round+' 次）','order');
   say('第 '+S.round+' 次心律檢查 — 全部停手。',null,1);
   tl('第 '+S.round+' 次心律檢查（'+RH(S.rhythm).short+'）','key');},
 /* 第一步：螢幕上是什麼「電氣活動」 —— 還不能叫 PEA。
    CL-8：用宣告當下的節律當答案，不用檢查開始時的（檢查途中可能已經惡化）。 */
 callRhythm(c,p){if(!isLeader(c)||!S.checkRec||S.checkRec.id)return;
   if(!K.RIDS.some(x=>x.k===p.r))return;
   S.checkRec.rhythmAtCall=S.rhythm;
   const truth=RIDOF(S.rhythm);
   S.checkRec.id=p.r;S.checkRec.idCorrect=(p.r===truth);S.checkRec.idAt=S.t-S.checkRec.t;
   const nm=(K.RIDS.find(x=>x.k===p.r)||{}).n||p.r;
   pt(c,'lead','辨識：'+nm);
   push2feed(c,'【判讀】'+nm,'order');say('【心律辨識】'+c.n+'：'+nm,null,1);
   if(p.r==='ORG')say('有組織的電氣活動 — 要有人摸脈搏才知道是 PEA 還是 ROSC。');},
 /* 第二步（只在「有組織的電氣活動」時出現）：摸得到脈搏嗎？
    item 13：PEA 的定義是「有電氣活動 + 摸不到脈搏」，不能只看螢幕就下定論。
    沒有人摸過並回報就直接宣告，系統不擋，但會記一筆。 */
 callPerf(c,p){if(!isLeader(c)||!S.checkRec)return;
   if(S.checkRec.id!=='ORG'||S.checkRec.perf)return;
   if(p.v!=='nopulse'&&p.v!=='pulse')return;
   const hadPulseCall=S.checkRec.pulseCalled!==null;
   S.checkRec.perf=p.v;S.checkRec.perfAt=S.t-S.checkRec.t;
   S.checkRec.hadPulseCall=hadPulseCall;
   S.checkRec.perfCorrect=((p.v==='pulse')===!!S.rosc);
   S.perfCalls.push({t:S.t,v:p.v,hadPulseCall,correct:S.checkRec.perfCorrect});
   if(!hadPulseCall)S.peaNoPulse++;
   pt(c,'lead',p.v==='nopulse'?'宣告 PEA':'宣告有脈搏');
   push2feed(c,p.v==='nopulse'?'【判定】摸不到脈搏 — PEA':'【判定】摸得到脈搏','order');
   if(p.v==='nopulse'){
     say('【判定】'+c.n+'：有電氣活動但摸不到脈搏 — PEA。'
       +(hadPulseCall?'':'（沒有人回報過脈搏，這是用看的）'));
     tl('宣告 PEA'+(hadPulseCall?'（有人確認過脈搏）':'（沒有人摸脈搏就宣告）'),'key');
   }else{
     if(S.rosc){say('【判定】'+c.n+'：摸得到脈搏 — 恢復自發循環。');announceRosc(c);}
     else{S.falseRosc++;
       say('【判定】'+c.n+' 宣告有脈搏 — 但實際上摸不到，繼續壓胸。');
       tl('錯誤宣告有脈搏（實際沒有）','key');}
   }},
 /* 第三步：那要怎麼做？ */
 callDecision(c,p){if(!isLeader(c)||!S.checkRec||!S.checkRec.id||S.checkRec.call)return;
   if(S.checkRec.id==='ORG'&&!S.checkRec.perf)return;   /* 先判定有沒有脈搏 */
   if(p.v!=='shock'&&p.v!=='noshock')return;
   const truth=RH(S.rhythm).shock?'shock':'noshock';
   const elapsed=S.t-S.checkRec.t;
   S.checkRec.call=p.v;S.checkRec.correct=(p.v===truth);
   S.checkRec.callAt=elapsed;
   S.checkRec.dur=Math.max(K.CHECKMIN,elapsed);
   S.checkRec.overrun=Math.max(0,elapsed-K.CHECKMAX);
   pt(c,'lead',(p.v==='shock'?'準備電擊':'繼續 CPR')+(S.checkRec.correct?' ✓':' ✗'));
   push2feed(c,'【決策】'+(p.v==='shock'?'準備電擊':'繼續 CPR'),'order');
   say('【決策】'+c.n+'：'+(p.v==='shock'?'準備電擊':'繼續 CPR'),null,1);
   tl('辨識 '+S.checkRec.id+(S.checkRec.idCorrect?' ✓':' ✗')
     +'　決策 '+(p.v==='shock'?'電擊':'繼續 CPR')+(S.checkRec.correct?' ✓':' ✗'),'key');
   S.checks.push(S.checkRec);S.checkRec=null;S.sinceCheck=0;
   S.check=Math.max(0,K.CHECKMIN-elapsed);},

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
  /* 沒做完決策的心律檢查也要留下來 —— 「Leader 喊停卻沒有宣告」本身就是資料 */
  if(S.checkRec){if(!S.checkRec.call){S.checkRec.call=null;S.checkRec.correct=null;
      S.checkRec.callAt=null;}
    S.checkRec.dur=S.t-S.checkRec.t;S.checks.push(S.checkRec);S.checkRec=null;}
  for(const c of S.ch)endSpan(c);
  for(const o of S.orderQ)S.orderLog.push(o);S.orderQ=[];
  if(S.rosc&&S.cprAfterRosc>0){S.cprAfterRoscTotal+=S.cprAfterRosc;S.cprAfterRosc=0;}
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
  /* C1：Utstein 的 CCF 是從第一次壓胸起算。全場分母（den）另外保留供對照。 */
  if(on&&S.tFirstCpr===null){S.tFirstCpr=S.t;tl('第一次壓胸','key');}
  if(S.tFirstCpr!==null){S.den2+=dt;if(on)S.num2+=dt;}
  /* A5：每秒記一格，供 ROSC 判定用的滾動窗 */
  S.secAcc+=dt;
  if(S.secAcc>=1){S.secAcc-=1;S.cprSec.push(on?1:0);
    if(S.cprSec.length>K.CCFWIN)S.cprSec.shift();}

  if(on){S.num+=dt;S.pause=0;const cc=C(S.cpr);
    cc.fat=Math.min(1,cc.fat+dt/K.FATRISE);cc.cprT+=dt;
    if(cc.fat>=K.FATWARN)S.fatiguedCprT+=dt;
    if(S.rosc)S.cprAfterRosc+=dt;
    /* A6：疲勞不再讓人倒地，而是讓壓胸整個節奏垮掉 —
       速率變慢、深度變淺（q），EtCO₂ 跟著掉。速率是投影幕上看得到的。 */
    const period=.545*(1+cc.fat*K.FATRATE);
    S.beat+=dt;if(S.beat>=period){S.beat=0;S.cnt++;
      if(S.air!=='ETT'&&S.cnt>=30&&!S.needPause){S.needPause=true;}
      }
    /* v4.2：拿掉「該換手了」這種指導。速率在投影幕上看得到，讓團隊自己觀察。 */
    if(cc.fat>=K.FATWARN&&!cc.fatWarn)cc.fatWarn=1;
    if(cc.fat<K.FATWARN&&cc.fatWarn)cc.fatWarn=0;}
  else{S.pause+=dt;S.maxPause=Math.max(S.maxPause,S.pause);
    if(S.tFirstCpr!==null)S.maxPauseAfterStart=Math.max(S.maxPauseAfterStart,S.pause);}
  if(S.pauseVent)S.noVentT+=dt;
  if(S.coach>0)S.coach-=dt;
  if(S.timeShown>0)S.timeShown-=dt;

  /* A12：灌流帳全程都在跑 —— 找到病因不等於贏了，還要撐到起效。
     A7：Epinephrine 提高冠狀動脈灌流壓，作用在「有壓胸的時候」而不是沒壓的時候。 */
  if(!S.rosc&&!S.over&&S.phase==='play'&&!S.train){
    const cc=S.cpr?C(S.cpr):null;
    const q=(on&&cc)?Math.max(.15,1-cc.fat*.62)*(S.air==='ETT'?1:.9):0;
    const epiBoost=(S.t-S.epiT<240)?1.20:1.0;
    /* 醫源性傷害會持續扣灌流（醫源性氣胸、心包積血、經驗性 calcium…） */
    S.decay=Math.min(K.DECAYMAX,
      Math.max(0,S.decay+dt*((on?-0.55*q*epiBoost:0.62)+harmDecay())));
    if(!S.fixed&&S.decay>=(S.rhythm==='pVT'?60:105)){
      const nx=S.rhythm==='pVT'?'VF':(S.rhythm==='VF'||S.rhythm==='PEA')?'asystole':null;
      if(nx){S.rhythm=nx;S.decays++;S.decay=30;
        tl('節律惡化 → '+RH(nx).short,'key');}
      else S.decay=60;}
  }

  /* CAL-2：不可逆的 no-flow 債。沒有這一條，任何隊伍最後都救得回來 ——
     v3.4 的實測是「稱職」與「生疏」腳本都 100% ROSC。 */
  if(!S.rosc&&!S.over&&S.phase==='play'&&!S.train&&S.tFirstCpr!==null&&!on)
    S.noFlow+=dt*(S.check>0?0.5:1);
  if(!S.noFlowDead&&S.noFlow>=K.NOFLOW_MAX&&!S.train){
    S.noFlowDead=true;
    tl('累積沒有壓胸的時間超過 '+K.NOFLOW_MAX+' 秒 — 灌流債已經還不回來','key');
    say('★ 累積中斷太久，就算之後處理對了也回不來了。');}

  /* CH-2：起效改成累積「有效灌流時間」，不是拿當下的 CCF 當門檻。
     舊寫法讓「先亂壓再補救」可以把已經流逝的時間全數認列。 */
  if(S.fixed&&!S.rosc&&!S.over&&!S.train){
    const cc=ccfRecent0();
    const pen=ccfPenalty(cc), rm=rhyMult();
    const blocked=(S.air==='bad')||RH(S.rhythm).shock||(S.iatroPtx&&!S.iatroPtxFixed);
    const base=(S.cause.delay||60)*(S.epi>=1?1:1.5)/Math.max(.25,S.fixQuality);
    /* 累積 no-flow 的代價：超過 SOFT 之後線性拉長要撐的時間，到 MAX 完全回不來 */
    const nf=Math.max(0,Math.min(1,(S.noFlow-K.NOFLOW_SOFT)/(K.NOFLOW_MAX-K.NOFLOW_SOFT)));
    S.nfMult=1+2*nf;
    S.roscNeed=base*S.harmMult*S.nfMult+S.harmFlat;
    S.harmPen=base*(S.harmMult-1)+S.harmFlat;
    S.nfPen=base*S.harmMult*(S.nfMult-1);
    if(!blocked&&cc>=K.CCF_FLOOR){
      S.roscProgress+=dt/(pen*rm);
      S.ccfPen+=dt-dt/pen;              /* 因壓胸品質多花的秒數 */
      S.rhyPen+=dt/pen-dt/(pen*rm);     /* 因為節律本身多花的秒數 */
    }
    if(S.roscProgress>=S.roscNeed&&!blocked&&cc>=K.CCF_FLOOR&&S.decay<60&&!S.noFlowDead){
      S.rosc=true;S.roscAt=S.t;S.rhythm='sinus';S.roscHR=104+Math.floor(rndOf('misc')*18);
      S.ccfAtRosc=Math.round(cc*100);
      S.ccfPenFinal=Math.round(S.ccfPen);
      say(S.air==='ETT'?'EtCO₂ 突然跳上來，螢幕出現規則心律 — 有人去摸脈搏。'
                       :'螢幕上突然變成規則的心律 — 有人去摸脈搏。');
      tl('生理上恢復自發循環（團隊尚未確認）','key');}
  }
  if(S.rosc&&!S.roscKnown&&S.cprAfterRosc>=45){
    /* A11：肇因的那段壓胸時間要累加保留，否則報表上會顯示 0 秒 */
    S.cprAfterRoscTotal+=S.cprAfterRosc;
    S.rearrestLog.push({t:S.t,cprSec:Math.round(S.cprAfterRosc),roscAt:S.roscAt});
    S.rosc=false;S.cprAfterRosc=0;S.rearrests++;S.rhythm='PEA';S.decay=40;
    S.fixed=true;S.tFixed=S.t;S.roscFelt=false;S.roscHint=0;
    say('在已經有脈搏的心臟上繼續壓胸 — 病人又停了。');tl('ROSC 後持續壓胸導致再停止','key');}
  /* v4.2：拿掉「有人該去摸脈搏」的提示。螢幕上本來就看得到規則心律與 EtCO₂，
     要不要去確認是團隊自己的判斷 —— 這正是要量的東西。 */
  if(S.phase==='post')S.roscSp=Math.min(97,S.roscSp+dt*0.8);

  for(const c of AC())if(c.act>0)c.act-=dt;

  for(const c of AC()){
    const px=c.x,py=c.y;
    if(c.down>0){c.down-=dt;if(c.down<=0){c.down=0;endSpan(c);say(c.n+' 爬起來了。');}
      c.vx=c.vy=0;c.path=[];continue;}
    if(c.zap>0)c.zap-=dt;
    if(S.cpr!==c.id)c.fat=Math.max(0,c.fat-dt/K.FATFALL);
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
    /* CAL-1：這裡原本寫 d=0.01，下面 dx/=d 會把單位向量放大 100 倍，
       兩個人完全重疊時一個 tick 就被推開 1,500 px、彈到地圖對角。 */
    if(d<0.01){const th=(i*2.4+j)*1.7;dx=Math.cos(th);dy=Math.sin(th);d=1;}
    if(d<30){const ov=(30-d)/2;dx/=d;dy/=d;
      a.x-=dx*ov;a.y-=dy*ov;b2.x+=dx*ov;b2.y+=dy*ov;collide(a);collide(b2);}}

  /* v4.3 肺泡 CO₂ 存量：有灌流就往「灌流決定的高度」爬（快），沒灌流就往地板掉（慢）。
     這一段讓「停壓胸 → 馬上擠球」還是看得到方波，但停久了就會愈來愈低 —— 臨床上就是這樣。 */
  {const onCC=isCompressing(S);
   const cc0=S.cpr?S.ch.find(x=>x.id===S.cpr):null;
   let q0=(onCC&&cc0)?Math.max(.15,1-cc0.fat*.62):0;
   if(S.coach>0)q0=Math.min(1,q0*1.30);
   const tgt=onCC?Math.max(K.CO2RESMIN,24*q0):K.CO2RESMIN;
   const tau=onCC?K.CO2TAUUP:K.CO2TAUDN;
   if(S.co2res===undefined)S.co2res=K.CO2RES0;
   S.co2res+=(tgt-S.co2res)*Math.min(1,dt/tau);}

  /* A8：插管後不會自己給氣。床頭沒有每 6 秒擠一次，就是真的沒有通氣。 */
  if(S.air==='ETT'&&!S.rosc&&S.tubeTest<=0){S.ventT+=dt;
    if(S.ventT>=10){S.ventT-=10;S.noVentETT+=10;}}
  if(S.nibp.r>0){S.nibp.r-=dt;if(S.nibp.r<=0){
    if(S.rosc){const sys=84+Math.floor(rnd()*26),dia=46+Math.floor(rnd()*16);
      S.nibp.val=sys+'/'+dia;say('NIBP：'+S.nibp.val+' — 有血壓了，但偏低，需要後續處理。');
      tl('NIBP '+S.nibp.val,'key');}
    else{S.nibp.val='量不到';say('NIBP：量不到 — 沒有可測量的血壓。');}}}
  /* 確認管路期間自動擠球 —— 學員接上 EtCO₂、擠幾下、自己看有沒有方波（item 8）。
     注意：沒有人在壓胸的時候，就算管子位置正確也不會有波形，這是真的。 */
  if(S.tubeTest>0){S.tubeTest=Math.max(0,S.tubeTest-dt);
    S.tubeBeat=(S.tubeBeat||0)+dt;
    if(S.tubeBeat>=2.4){S.tubeBeat-=2.4;
      if(S.air==='ETT'){S.ventAt.push(S.t);
        while(S.ventAt.length&&S.ventAt[0]<S.t-30)S.ventAt.shift();}}}
  /* 逾時的 order 要歸檔，不能直接丟掉 — 「沒有人回應的指令」本身就是資料 */
  if(S.orderQ.length)S.orderQ=S.orderQ.filter(function(o){
    if(S.t-o.at>K.ORDERTTL){o.expired=1;S.orderLog.push(o);return false;}return true;});
  while(S.pings.length&&S.t-S.pings[0].t>K.ROGERTTL+4)S.pings.shift();

  /* v4.2：判讀畫面不會自己消失 —— 要 Leader 真的做完決策才收起來。
     但壓胸不會被綁架：超過 K.CHECKMAX（10 秒）之後任何人都可以恢復壓胸，
     代價由 CCF 與「開始後最長中斷」自然反映，不需要用「選項消失」來逼人。 */
  if(S.check>0){S.check=Math.max(0,S.check-dt);}
  if(S.checkRec){S.checkRec.dur=S.t-S.checkRec.t;}
  else{S.sinceCheck+=dt;
    if(S.sinceCheck<=125)S.lateWarn=0;}
  S.maxGap=Math.max(S.maxGap,S.sinceCheck);

  if(S.df.chargeT>0){S.df.chargeT-=dt;
    if(S.df.chargeT<=0){S.df.chargeT=0;S.df.charged=true;say('電擊器充電完成。');}}

  if(!S.leader&&S.phase==='play'){S.noLeaderT+=dt;
    if(S.noLeaderT>S.noLeaderWarn+45){S.noLeaderWarn=S.noLeaderT;
      }}

  if(!S.family.gone&&!S.train){
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

  if(S.t>K.TMAX&&!S.train)finish(false);   /* 熟悉環境沒有時限 */
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
  const on=isCompressing(G);
  if(!clean&&on)v+=artAt(t);
  return v;
}
function physOf(G){
  const on=isCompressing(G),R=RH(G.rhythm);
  const hr0=R.org?R.rate:null;
  /* 沒有進階氣道就沒有 capnography —— 插管之前螢幕上不會有 EtCO₂ */
  if(G.air==='BVM')return{hr:G.rosc?G.roscHR:hr0,sp:G.rosc?Math.round(G.roscSp):null,co2:null};
  if(G.rosc)return{hr:G.roscHR,sp:Math.round(G.roscSp),co2:G.roscCo};
  if(G.air==='bad')return{hr:hr0,sp:null,co2:0};
  const cc=G.cpr?G.ch.find(x=>x.id===G.cpr):null;
  let q=(on&&cc)?Math.max(.15,1-cc.fat*.62):0;
  if(G.coach>0)q=Math.min(1,q*1.30);
  /* v4.2：剛插完管、接上 EtCO₂ 擠球確認的那幾口氣，肺裡還有殘留的 CO₂，
     所以就算灌流很差也看得到波形 —— 臨床上就是靠這個確認位置。
     過了確認窗之後，波形高度就完全由灌流（壓胸品質）決定。 */
  /* v4.3：沒有壓胸的時候不是 0 —— 肺裡還有殘留的 CO₂，擠球還是吐得出一點點，
     只是很低而且不會隨壓胸起伏。管子不在氣管裡（air==='bad'）才是真的 0。 */
  /* 擠球吐出來的高度＝肺泡裡現在有多少 CO₂（G.co2res，由 step() 更新）。
     壓胸壓得好 → 靜脈端把 CO₂ 帶回肺、存量往上；完全不壓 → 幾十秒內慢慢掉。 */
  const co2=Math.max(K.CO2RESMIN,Math.round(G.co2res!==undefined?G.co2res:K.CO2RES0));
  return{hr:hr0,sp:null,co2,perf:on?Math.round(24*q):0};
}
/* EtCO₂ 是「吐出來的氣」測到的 —— 沒有人給氣就沒有波形，
   壓胸壓得再好也一樣是平的。每一次真的擠下去才畫出一個方波。 */
/* v4.2 重寫。舊版只要當下沒有人在壓胸就回傳 0，所以插完管去確認位置時
   波形永遠是平的 —— 學員會以為管子放錯。新版分成兩層：

     ① 壓胸造成的小振盪：管子在氣管裡的時候，每一次按壓都會把一點氣擠出來，
        監視器上看得到跟著壓胸頻率起伏的低振幅波（真實存在的現象）。
     ② 每一次真的擠甦醒球：畫出一個完整的方波，高度看灌流（壓胸品質）。

   管子不在氣管裡（air==='bad'）就永遠是平的 —— 這是唯一的判讀依據。 */
function co2At(G,t){
  if(!G.air||G.air==='BVM'||G.air==='bad')return 0;
  const p=physOf(G);
  const on=isCompressing(G);
  let v=0;
  if(on){
    const cc=G.cpr?G.ch.find(x=>x.id===G.cpr):null;
    const fat=cc?cc.fat:0;
    const q=Math.max(.15,1-fat*.62);
    const period=.545*(1+fat*K.FATRATE);
    const ph=fract(t/period);
    /* 低振幅、跟著壓胸節奏；壓得越好振幅越大 */
    v=(0.035+0.075*q)*Math.max(0,Math.sin(ph*6.2832));
  }
  const V=G.ventAt||[];
  let last=null;
  for(let i=V.length-1;i>=0;i--){if(V[i]<=t){last=V[i];break;}}
  if(last!==null){
    const a=(p.co2||0)/50, x=t-last;
    let w=0;
    if(x<0.30)w=0;                        /* 吸氣期，還沒吐出來 */
    else if(x<0.60)w=(x-0.30)/0.30;       /* 上升支 */
    else if(x<2.40)w=0.97;                /* 平台 */
    else if(x<2.75)w=1-(x-2.40)/0.35;     /* 下降支 */
    v=Math.max(v,a*w);
  }
  return v;
}

/* ══ 學員的急救紀錄 vs 實際發生的事 ══
   紀錄員填的是「他以為發生了什麼、在什麼時候」，引擎知道「實際上」。
   兩邊逐筆對起來，就是一份真正的紀錄品質稽核 —— 這在實體演練幾乎做不到。
   配對規則：同一欄位、值相同、時間差在 TOL 秒以內。 */
const RECTOL=150;   /* 紀錄員常常是事後補記，兩分半內都算配得上 */
function recAudit(G){
  const ev=[];
  for(const x of G.shockLog)ev.push({t:x.t,f:'shock',v:x.j+' J'});
  for(const d of G.drugLog){
    const nm={epi:'Epinephrine 1 mg',amio:'Amiodarone '+(d.dose||'300')+' mg',
      calc:'Calcium gluconate',bicarb:'Sodium bicarbonate',lytic:'血栓溶解劑',
      ns:'Normal saline',prbc:'pRBC 輸血'}[d.k];
    if(nm)ev.push({t:d.t,f:'drug',v:nm});}
  for(const c of G.checks)ev.push({t:c.t,f:'rhythm',
    v:({VF:'VF',pVT:'VT',PEA:'PEA',asystole:'Asystole',sinus:'竇性心律'})[c.rhythm]||'PEA'});
  for(const q of G.procLog)ev.push({t:q.t,f:'proc',v:q.n});
  ev.sort((a,b)=>a.t-b.t);
  const used=new Set();
  const rows=ev.map(function(e){
    let best=-1,bd=1e9;
    G.recs.forEach(function(r,i){
      if(used.has(i)||r[e.f]!==e.v)return;
      const d=Math.abs(r.t-e.t);if(d<bd){bd=d;best=i;}});
    if(best>=0&&bd<=RECTOL){used.add(best);
      return{t:e.t,f:e.f,v:e.v,rec:true,recT:G.recs[best].t,by:G.recs[best].n,off:G.recs[best].t-e.t};}
    return{t:e.t,f:e.f,v:e.v,rec:false};});
  /* 記了但實際上沒有發生的（欄位有填、卻配不到任何事件） */
  const spur=[];
  G.recs.forEach(function(r,i){
    if(used.has(i))return;
    for(const f of ['rhythm','shock','drug','proc'])
      if(r[f])spur.push({t:r.t,f,v:r[f],by:r.n});});
  const offs=rows.filter(x=>x.rec).map(x=>Math.abs(x.off));
  offs.sort((a,b)=>a-b);
  return{rows,spur,
    n:rows.length, hit:rows.filter(x=>x.rec).length,
    medOff:offs.length?offs[offs.length>>1]:null};
}

/* ══ 一場演練壓成一列數字 ══
   之後要做統計，直接把每一場的這一列串起來就是分析用的資料表。 */
function metricsRow(G){
  const o=S;S=G;
  const r2=x=>(x===null||x===undefined||isNaN(x))?'':Math.round(x*10)/10;
  const med=a=>{if(!a||!a.length)return '';const b=a.slice().sort((x,y)=>x-y);
    return Math.round((b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2)*10)/10;};
  const ra=recAudit(G);
  const row={
    engine:G.engine, seed:G.seed, cause:G.cause.id, causeName:G.cause.n,
    rhythm0:G.rhythm0, n:G.np, drip:G.drip,
    outcome:G.over||'', rosc:G.rosc?1:0, roscKnown:G.roscKnown?1:0,
    durSec:r2(G.t), tFixed:r2(G.tFixed), fixQuality:G.fixQuality,
    tRosc:r2(G.roscAt), tRoscKnown:r2(G.roscKnownAt),
    roscRecogDelay:(G.roscKnown&&G.roscAt!==null)?r2(G.roscKnownAt-G.roscAt):'',
    ccfUtstein:G.den2?Math.round(G.num2/G.den2*1000)/10:'',
    ccfAll:G.den?Math.round(G.num/G.den*1000)/10:'',
    tFirstCpr:r2(G.tFirstCpr), maxPause:r2(G.maxPauseAfterStart), noFlow:r2(G.noFlow),
    swaps:G.swaps, cprMoved:G.cprMoved, cprPaused:G.cprPaused,
    fatiguedCprSec:r2(G.fatiguedCprT), cprAfterRosc:r2(G.cprAfterRoscTotal+G.cprAfterRosc),
    rearrests:G.rearrests, decays:G.decays,
    ccfPenSec:r2(G.ccfPen), rhyPenSec:r2(G.rhyPen), harmPenSec:r2(G.harmPen), nfPenSec:r2(G.nfPen),
    leader:G.leaderName||'', leaderHandovers:G.handovers, noLeaderSec:r2(G.noLeaderT),
    orders:G.orders, ordersNamed:G.orderLog.concat(G.orderQ).filter(x=>x.to).length,
    ordersAck:G.ordersAck, ordersAckOther:G.ordersAckOther,
    ordersDone:G.ordersDone, ordersDoneVerified:G.ordersDoneVerified,
    ordersDoneFalse:G.ordersDoneFalse,
    ackDelayMed:med(G.ackDelay), doneDelayMed:med(G.doneDelay),
    rogers:G.rogers.length, rogerDelayMed:med(G.rogers.map(x=>x.delay)),
    concerns:G.concerns.length, concernsAnswered:G.concerns.filter(x=>x.resAt!==null).length,
    concernRespMed:med(G.concerns.filter(x=>x.resAt!==null).map(x=>x.resAt-x.t)),
    checks:G.checks.length, idCorrect:G.checks.filter(x=>x.idCorrect).length,
    decisionCorrect:G.checks.filter(x=>x.correct===true).length,
    decisionWrong:G.checks.filter(x=>x.correct===false).length,
    decisionNone:G.checks.filter(x=>x.call===null).length,
    checkOverrun:G.checks.filter(x=>(x.overrun||0)>0).length,
    peaNoPulse:G.peaNoPulse, falseRosc:G.falseRosc,
    maxGap:r2(G.maxGap), pulseChecks:G.pulseChecks, nibp:G.nibp.n,
    leads:G.leads?1:0,
    airFinal:G.air, ettTry:G.ettTry, badEtt:G.badEtt, pulledEtt:G.pulledEtt,
    tEtt:r2(G.tEtt), airCalled:G.airCalled||'',
    airCallCorrect:G.airCallLog.filter(x=>x.correct).length,
    airCallWrong:G.airCallLog.filter(x=>!x.correct).length,
    noVentEttSec:r2(G.noVentETT), vents:G.vents, overVent:G.overVent, badVent:G.badVent,
    ivRoute:G.ivRoute||'', tIv:r2(G.tIv), ivTry:G.ivTry, ioTry:G.ioTry,
    epi:G.epi, tEpi:r2(G.tEpi), epiTooEarly:G.epiTooEarly, epiTooLate:G.epiTooLate,
    epiEarly:G.epiEarly, epiLate:G.epiLate,
    amio:G.amioLog.length, amioOk:G.amioLog.filter(x=>x.ok).length,
    shocks:G.shocks, converted:G.converted, noClearShocks:G.noClearShocks,
    zapped:G.zapped, nonShock:G.nonShock, syncErr:G.syncErr, clearCalls:G.clearCalls,
    clues:G.clues.length, cluesCast:G.clues.filter(q=>q.cast).length,
    blindProc:G.blindProc, harms:G.harmLog.length,
    badCalc:G.badCalc, badBicarb:G.badBicarb, badLytic:G.badLytic,
    iatroPtx:G.iatroPtx?1:0, iatroPtxFixed:G.iatroPtxFixed?1:0, iatroPeri:G.iatroPeri?1:0,
    recs:G.recs.length, recEvents:ra.n, recHit:ra.hit,
    recHitPct:ra.n?Math.round(ra.hit/ra.n*1000)/10:'',
    recSpurious:ra.spur.length, recOffsetMed:ra.medOff===null?'':Math.round(ra.medOff),
    famOut:r2(G.famOut), famDelays:G.famDelays, talk:G.talk.length
  };
  S=o;return row;
}

/* v4.3：螢幕上顯示的 EtCO₂ 數字要跟畫出來的波形一致 ——
   舊版顯示的是「如果現在擠一次球會到多高」的平台值，
   但畫面上可能只有壓胸造成的小振盪，兩個對不起來。改成取最近 5 秒的實際峰值。 */
function co2Peak(G){
  if(!G.air||G.air==='BVM'||G.air==='bad')return 0;
  let mx=0;const t=G.t;
  for(let i=0;i<=100;i++){const v=co2At(G,t-5+i*0.05);if(v>mx)mx=v;}
  return Math.round(mx*50);
}

/* ═══════════ 報表（第 5 項：結果區精簡） ═══════════ */
function report(G){
  const old=S;S=G;
  const ccf=Math.round(ccfNow()*100)||0;
  const mm=s=>(s===null||s===undefined)?'—':mmt(s);
  /* 時間長度一律寫成「幾分幾秒」，不要只丟一個大秒數 */
  const dur=x=>{
    if(x===null||x===undefined||isNaN(x))return '—';
    const v=Math.round(x*10)/10, w=Math.floor(v), r=Math.round((v-w)*10);
    if(w<60)return (r?(w+'.'+r):w)+' 秒';
    return Math.floor(w/60)+' 分 '+(w%60)+' 秒';};
  const pct=(a,b)=>b?Math.round(a/b*100)+'%':'—';
  const outcome=S.over==='ROSC'?'恢復自發循環，團隊確認並交班'
    :S.rosc&&!S.roscKnown?'⚠ 生理上已恢復循環，但團隊全程沒有察覺':'未恢復循環';
  const right=S.checks.filter(x=>x.correct===true).length;
  const wrong=S.checks.filter(x=>x.correct===false).length;
  const none =S.checks.filter(x=>x.call===null).length;
  const pulseInCheck=S.checks.filter(x=>x.pulse).length;
  /* 中位數比平均值抗離群值，也是論文該報的統計量 */
  const med=a=>{if(!a.length)return '—';const b=a.slice().sort((x,y)=>x-y),n=b.length;
    return dur(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2);};
  const ccf2=S.den2?Math.round(S.num2/S.den2*100):0;
  const called=S.checks.filter(x=>x.callAt!==null&&x.callAt!==undefined);
  const avgCallAt=called.length
    ?dur(called.reduce((a,x)=>a+x.callAt,0)/called.length):'—';
  const cprAfterAll=Math.round(S.cprAfterRoscTotal+S.cprAfterRosc);
  const ventRate=(S.tEtt!==null&&S.ventsAfterEtt)
    ?((S.t-S.tEtt)/S.ventsAfterEtt).toFixed(1)+' 秒/次':'—';
  const allOrders=S.orderLog.concat(S.orderQ);
  const orgChecks=S.checks.filter(x=>x.id==='ORG'&&x.perf);
  const G2=[];
  G2.push({g:'結果',rows:[
    ['結果',outcome,S.over==='ROSC'?'ok':'no'],
    ['真正的病因',S.cause.n],
    ['正確處置',S.cause.fixLabel||''],
    ['病因處理時間',S.fixed?(mm(S.tFixed)+(S.fixQuality>=1?'':'（只做到部分處置）')):'始終沒有找出來',
      S.fixed?(S.fixQuality>=1?'ok':'warn'):'no'],
    ['累積無灌流時間',dur(S.noFlow)+'（上限 '+K.NOFLOW_MAX+' 秒）',
      S.noFlowDead?'no':(S.noFlow>K.NOFLOW_MAX*0.6?'warn':'ok')],
    ['有效灌流進度',S.fixed?(Math.round(S.roscProgress)+' / '+Math.round(S.roscNeed||0)+' 秒'):'—',
      (S.fixed&&S.roscNeed&&S.roscProgress>=S.roscNeed)?'ok':''],
    ['生理 ROSC 時間',S.rosc?mm(S.roscAt):(S.noFlowDead?'未達成（灌流債已無法回復）':'未達成')],
    ['團隊確認 ROSC',S.roscKnown?mm(S.roscKnownAt)+'（延遲 '+Math.round(S.roscKnownAt-S.roscAt)+' 秒）':'未確認',
      S.roscKnown?'ok':(S.rosc?'no':'')],
    ['總時間',mm(S.t)]
  ]});
  G2.push({g:'閉環溝通與領導',rows:[
    ['Leader',S.leaderName?S.leaderName+'（交接 '+S.handovers+' 次）':'全程沒有人宣告',S.leaderName?'':'no'],
    ['沒有 Leader 的時間',dur(S.noLeaderT),S.noLeaderT>60?'no':'ok'],
    ['下達 Order',S.orders+' 次（同時最多 '+K.ORDERMAX+' 則）'],
    ['其中有指名對象',allOrders.filter(o=>o.to).length+' 次'],
    ['被指名者複誦',S.ordersAck+' 次（'+pct(S.ordersAck,S.orders)+'）',
      S.orders&&S.ordersAck/S.orders>=.8?'ok':(S.orders?'no':'')],
    ['旁人代為回應',S.ordersAckOther+' 次',S.ordersAckOther?'no':''],
    ['無人回應就逾時',allOrders.filter(o=>o.expired&&!o.ack.length).length+' 則',
      allOrders.some(o=>o.expired&&!o.ack.length)?'no':''],
    ['執行後回報完成',S.ordersDone+' 次（'+pct(S.ordersDone,S.orders)+'）',
      S.orders&&S.ordersDone/S.orders>=.6?'ok':(S.orders?'no':'')],
    ['其中系統可查證為真',S.ordersDoneVerified+' 次'
      +(S.ordersDoneFalse?'　✗ 回報了但沒做到 '+S.ordersDoneFalse+' 次':''),
      S.ordersDoneFalse?'no':(S.ordersDoneVerified?'ok':'')],
    ['複誦延遲（被指名者・中位）',med(S.ackDelay)],
    ['複誦延遲（旁人代答・中位）',med(S.ackDelayOther)],
    ['下令→完成（中位）',med(S.doneDelay)],
    ['口頭「收到」回應',S.rogers.length+' 次'
      +(S.rogers.length?'（中位延遲 '+med(S.rogers.map(r=>r.delay))+'）':''),
      S.rogers.length?'ok':''],
    ['提出疑慮',S.concerns.length?S.concerns.length+' 次（最高到第 '
      +Math.max.apply(null,S.concerns.map(x=>x.lvl))+' 階）':'全程沒有人提出'],
    ['疑慮被回應',S.concerns.length
      ?(S.concerns.filter(x=>x.resAt!==null).length+' / '+S.concerns.length
        +'　中位延遲 '+med(S.concerns.filter(x=>x.resAt!==null).map(x=>x.resAt-x.t)))
      :'—',
      S.concerns.length?(S.concerns.every(x=>x.resAt!==null)?'ok':'no'):''],
    ['Leader 要求加強壓胸',S.coachUsed+' 次'],
    ['線索公開給全隊',S.clues.filter(q=>q.cast).length+' / 3',
      S.clues.filter(q=>q.cast).length>=2?'ok':'no'],
    ['全隊回報次數',S.talk.length+' 則']
  ]});
  G2.push({g:'心律判讀',rows:[
    ['心律檢查',S.round+' 次'],
    ['心律辨識',(()=>{const a=S.checks.filter(x=>x.id);const k2=a.filter(x=>x.idCorrect).length;
      return k2+' 正確 / '+(a.length-k2)+' 錯誤 / '+(S.checks.length-a.length)+' 未辨識';})(),
      S.checks.length&&S.checks.every(x=>x.idCorrect)?'ok':(S.checks.length?'no':'')],
    ['認對卻決策錯',S.checks.filter(x=>x.idCorrect&&x.correct===false).length+' 次',
      S.checks.some(x=>x.idCorrect&&x.correct===false)?'no':''],
    ['處置決策',right+' 正確 / '+wrong+' 錯誤 / '+none+' 未宣告',wrong||none?'no':(right?'ok':'')],
    ['判 PEA 前先確認脈搏',orgChecks.length
      ?(orgChecks.filter(x=>x.hadPulseCall).length+' / '+orgChecks.length+' 次')
      :'（沒有遇到有組織的電氣活動）',
      orgChecks.length?(S.peaNoPulse?'no':'ok'):''],
    ['錯誤宣告有脈搏',S.falseRosc+' 次',S.falseRosc?'no':''],
    ['判讀超過 '+K.CHECKMAX+' 秒才宣告',
      S.checks.filter(x=>(x.overrun||0)>0).length+' 次'
      +(S.checks.some(x=>x.overrun>0)?'（最久 '+dur(Math.max.apply(null,S.checks.map(x=>x.overrun||0)))+'）':''),
      S.checks.some(x=>(x.overrun||0)>0)?'no':'ok'],
    ['平均宣告時點',avgCallAt+'（停頓上限 '+K.CHECKMAX+' 秒）',
      called.length&&called.reduce((a,x)=>a+x.callAt,0)/called.length<=7?'ok':(called.length?'no':'')],
    ['檢查時同時摸脈搏',pulseInCheck+' / '+S.checks.length+' 次'],
    ['最長未檢查心律間隔',dur(S.maxGap)+'（上限 '+K.GAPMAX+' 秒）',S.maxGap>K.GAPMAX?'no':'ok'],
    ['摸脈搏總次數',S.pulseChecks+' 次'],
    ['量 NIBP 次數',S.nibp.n+' 次']
  ]});
  G2.push({g:'壓胸品質',rows:[
    ['開始壓胸前的延遲',S.tFirstCpr!==null?mm(S.tFirstCpr):'從未開始',
      S.tFirstCpr===null?'no':(S.tFirstCpr<=K.FIRSTCPR_OK?'ok':(S.tFirstCpr<45?'warn':'no'))],
    ['CCF（自第一次壓胸起算）',ccf2+'%　基本門檻 60%、理想 80%',
      ccf2>=80?'ok':(ccf2>=60?'warn':'no')],
    ['CCF（全場含到場時間）',ccf+'%'],
    ['開始後最長中斷',dur(S.maxPauseAfterStart),
      S.maxPauseAfterStart>K.CHECKMAX?'no':'ok'],
    ['壓胸換手',S.swaps+' 次（指引：每 '+K.SWAPEVERY+' 秒）',
      S.t>K.SWAPEVERY+30?(S.swaps>=Math.floor(S.t/K.SWAPEVERY)?'ok':'no'):''],
    ['壓胸者中途離開',S.cprMoved+' 次',S.cprMoved?'no':'ok'],
    ['為了其他處置停手',S.cprPaused+' 次',S.cprPaused>2?'no':''],
    ['疲勞下仍未換手的壓胸',dur(S.fatiguedCprT),S.fatiguedCprT>60?'no':'ok'],
    ['ROSC 後仍持續壓胸',dur(cprAfterAll),cprAfterAll>5?'no':''],
    ['壓胸導致再停止',S.rearrests+' 次',S.rearrests?'no':''],
    ['節律因灌流不足而惡化',S.decays+' 次',S.decays?'no':'ok'],
    ['因壓胸品質而延長的起效時間','+'+dur(S.ccfPen)+(S.rosc?'':'（尚未起效）'),
      S.ccfPen>20?'no':(S.ccfPen<=5?'ok':'warn')],
    ['因為節律本身而延長',S.fixed?('+'+dur(S.rhyPen)+'（'+RH(S.rhythm0).short
      +' 起始，乘數 '+(K.RHYMULT[S.rhythm0]||1)+'）'):'—'],
    ['因醫源性傷害而延長',S.harmPen?('+'+dur(S.harmPen)):'沒有',S.harmPen?'no':'ok'],
    ['因累積無灌流而延長',S.nfPen?('+'+dur(S.nfPen)):'沒有',S.nfPen>20?'no':(S.nfPen?'warn':'ok')]
  ]});
  G2.push({g:'氣道與通氣',rows:[
    ['插管',S.air==='ETT'?'位置正確 · '+mm(S.tEtt)+'（嘗試 '+S.ettTry+' 次，放錯 '+S.badEtt+' 次）':
      S.air==='bad'?'管子位置不對，而且沒有拔掉':(S.ettTry?'嘗試過但目前是甦醒球':'未建立'),
      S.air==='ETT'?'ok':'no'],
    ['管路位置確認',S.airCallLog.length
      ?S.airCallLog.map(a=>mmt(a.t)+' '+a.by+'：'+(a.said==='ok'?'位置正確':'拔管重來')
          +(a.correct?' ✓':' ✗（實際上'+(a.truth==='ETT'?'是對的':'位置不對')+'）')).join('\n')
      :(S.ettTry?'插了管但全程沒有人確認位置':'—'),
      S.airCallLog.length?(S.airCallLog.every(a=>a.correct)?'ok':'no'):(S.ettTry?'no':'')],
    ['插管→確認的延遲',(S.tEtt!==null&&S.airCallLog.length)
      ?dur(S.airCallLog[0].t-S.tEtt):'—',
      (S.tEtt!==null&&S.airCallLog.length&&S.airCallLog[0].t-S.tEtt<=30)?'ok':''],
    ['辨識並拔除位置不正確的管路',S.pulledEtt+' 次'],
    ['插管器材規格由誰決定',S.ettAskLog.length
      ?S.ettAskLog.map(a=>a.byN+' 問 → '+a.toN+' 指定 '+K.SCOPEN[a.spec.scope]
        +'・'+a.spec.blade+'・'+a.spec.tube).join('\n')
      :'備器材的人自己決定','ok'],
    ['使用的喉頭鏡',S.ettSpec?K.SCOPEN[S.ettSpec.scope]+' · '+S.ettSpec.blade+' · '+S.ettSpec.tube+' 號管':'—'],
    ['通氣沒有及時配合',S.badVent+' 次',S.badVent?'no':'ok'],
    ['時機錯誤的通氣',S.wrongVent+' 次'],
    ['過度通氣',S.overVent+' 次',S.overVent>2?'no':''],
    ['通氣總次數',S.vents+' 次（人工）'],
    ['插管後無通氣時間',dur(S.noVentETT),S.noVentETT>30?'no':(S.tEtt!==null?'ok':'')],
    ['插管後通氣頻率',ventRate+(S.tEtt!==null?'（目標 6 秒/次）':'')]
  ]});
  G2.push({g:'血管通路與用藥',rows:[
    ['血管通路',S.ivFixed?S.ivRoute+' · '+mm(S.tIv):'始終沒有',S.ivFixed?'ok':'no'],
    ['留置針嘗試',S.ivTry+' 次（用掉 '+(3-S.caths)+' / 3）'],
    ['骨內針嘗試',S.ioTry?S.ioTry+' 次':'沒有使用'],
    ['Epinephrine',S.epi+' 劑'+(S.tEpi!==null?' · 首劑 '+mm(S.tEpi):''),S.epi>=1?'ok':'no'],
    ['Epinephrine 首劑時機',
      S.epi===0?'未給藥':
      S.epiTooEarly?'過早 — 可電擊節律尚未完成初始電擊':
      S.epiTooLate?'過晚 — 不可電擊節律逾 5 分鐘':'恰當',
      S.epi===0?'no':((S.epiTooEarly||S.epiTooLate)?'no':'ok')],
    ['Epinephrine 間隔',S.epi>1?('過密 '+S.epiEarly+' 次 / 過疏 '+S.epiLate+' 次'):'—',
      (S.epiEarly||S.epiLate)?'no':(S.epi>1?'ok':'')],
    ['Amiodarone',S.amioLog.length?S.amioLog.map((a,i)=>'第'+(i+1)+'劑 '+a.dose+'mg'+(a.ok?' ✓':' ✗')).join('\n'):'沒有使用',
      S.amioLog.length&&S.amioLog.every(a=>a.ok)?'ok':(S.amioLog.length?'no':'')],
    ['血品／輸液',(function(){
      const f=S.drugLog.filter(d=>d.k==='prbc'||d.k==='ns');
      return f.length?f.map(d=>mmt(d.t)+' '+d.n).join('\n'):'沒有使用';})(),
      (S.cause.id==='h')?(S.drugLog.some(d=>d.k==='prbc')?'ok':'no'):''],
    ['給藥總數',S.drugLog.length+' 劑']
  ]});
  /* v4.0 新增：沒有指徵就做的處置與藥物，以及它造成的後果 */
  G2.push({g:'鑑別診斷與醫源性傷害',rows:[
    ['取得線索 / 公開',S.clues.length+' / '+S.clues.filter(q=>q.cast).length+'（共 3）',
      S.clues.length>=2?'ok':'no'],
    ['沒有任何線索就做的侵入處置或對因給藥',S.blindProc+' 次',
      S.blindProc?'no':'ok'],
    ['經驗性 Calcium（非高血鉀情境）',S.badCalc+' 次'
      +(S.badCalc?'　COCA RCT：ROSC 19% vs 27%（RR 0.72）':''),S.badCalc?'no':'ok'],
    ['常規 Bicarbonate',S.badBicarb+' 次',S.badBicarb?'no':'ok'],
    ['沒有肺栓塞證據的溶栓',S.badLytic+' 次',S.badLytic?'no':'ok'],
    ['醫源性氣胸（無指徵針刺）',S.iatroPtx?(S.iatroPtxFixed?'發生過，後來自己處理掉了':'發生且全程沒有處理'):'沒有',
      S.iatroPtx?(S.iatroPtxFixed?'warn':'no'):'ok'],
    ['心包穿刺併發症',S.iatroPeri?'傷到心肌，心包內積血':'沒有',S.iatroPeri?'no':'ok'],
    ['醫源性傷害總計',S.harmLog.length?S.harmLog.map(h=>mmt(h.t)+'　'+h.txt).join('\n'):'沒有',
      S.harmLog.length?'no':'ok']
  ]});
  G2.push({g:'電擊與安全',rows:[
    ['電擊',S.shocks+' 次'+(S.tShock!==null?' · 首次 '+mm(S.tShock):'')],
    ['成功轉律',S.converted+' 次',S.converted?'ok':''],
    ['喊 CLEAR',S.clearCalls+' 次'],
    ['沒喊 CLEAR 就放電',S.noClearShocks+' 次',S.noClearShocks?'no':'ok'],
    ['被電到倒地',S.zapped+' 人次',S.noClearShocks?'no':''],
    ['對不可電擊節律放電',S.nonShock+' 次',S.nonShock?'no':'ok'],
    ['同步模式誤設',S.syncErr+' 次',S.syncErr?'no':'ok'],
    ['監測貼片',S.leads?'有貼上':'全程沒有貼',S.leads?'ok':'no']
  ]});
  const RA=recAudit(S);
  G2.push({g:'紀錄品質（學員寫的 vs 實際發生的）',rows:[
    ['紀錄筆數',S.recs.length+' 筆',S.recs.length>=4?'ok':(S.recs.length?'warn':'no')],
    ['第一筆紀錄',S.recs.length?mm(S.recs[0].t):'全程沒有人做紀錄',S.recs.length?'':'no'],
    ['實際發生的可記錄事件',RA.n+' 件'],
    ['其中有被記下來',RA.hit+' 件（'+pct(RA.hit,RA.n)+'）',
      RA.n?(RA.hit/RA.n>=.7?'ok':(RA.hit/RA.n>=.4?'warn':'no')):''],
    ['紀錄時間與實際的落差（中位）',RA.medOff===null?'—':dur(RA.medOff)],
    ['記了但沒發生的事',RA.spur.length+' 筆',RA.spur.length?'no':'ok'],
    ['漏掉的事件',(function(){const m=RA.rows.filter(x=>!x.rec);
      return m.length?m.slice(0,8).map(x=>mmt(x.t)+' '+x.v).join('\n')
        +(m.length>8?'\n…共 '+m.length+' 件':''):'沒有漏掉';})(),
      RA.rows.some(x=>!x.rec)?'warn':'ok']
  ]});
  G2.push({g:'現場管理',rows:[
    ['家屬帶離現場',S.famOut!==null?mm(S.famOut):'全程留在床邊',S.famOut!==null?'ok':'no'],
    ['家屬造成的中斷',S.famDelays+' 次',S.famDelays>2?'no':'']
  ]});
  /* FB-1：六十幾列全部平權，debriefing 十五分鐘用不完。
     依教學權重挑出最該講的三件事，放在報表最前面。 */
  const W={'累積無灌流時間':10,'CCF（自第一次壓胸起算）':10,'沒喊 CLEAR 就放電':10,
    '開始壓胸前的延遲':9,'開始後最長中斷':9,'沒有任何線索就做的侵入處置或對因給藥':9,
    '醫源性傷害總計':9,'沒有肺栓塞證據的溶栓':9,'管路位置確認':8,'心律辨識':8,'處置決策':8,
    '團隊確認 ROSC':8,'經驗性 Calcium（非高血鉀情境）':8,'血管通路':7,'被指名者複誦':7,
    '判 PEA 前先確認脈搏':7,'最長未檢查心律間隔':7,'因醫源性傷害而延長':7,
    '執行後回報完成':6,'疑慮被回應':6,'Epinephrine 首劑時機':6,'其中系統可查證為真':6,
    '插管':6,'錯誤宣告有脈搏':6,'壓胸換手':5,'節律因灌流不足而惡化':5,
    '疲勞下仍未換手的壓胸':4,'家屬帶離現場':3,'紀錄筆數':3};
  const WHY={
    '累積無灌流時間':'每一秒沒有壓胸都在還不回來的帳上',
    'CCF（自第一次壓胸起算）':'冠狀動脈灌流壓靠的是最近一兩分鐘的壓胸',
    '沒喊 CLEAR 就放電':'病人與團隊安全，沒有討論空間',
    '開始壓胸前的延遲':'院內目擊的停止，目標 20 秒內上手',
    '開始後最長中斷':'心律檢查停頓要壓在 10 秒以內',
    '沒有任何線索就做的侵入處置或對因給藥':'先做鑑別診斷，再動手',
    '管路位置確認':'放好管子不等於位置正確，要自己接 EtCO₂ 看',
    '判 PEA 前先確認脈搏':'PEA = 有電氣活動 + 摸不到脈搏，不能只看螢幕',
    '被指名者複誦':'指名 → 複誦 → 回報，三段缺一不可',
    '團隊確認 ROSC':'摸到脈搏要喊出來，不然沒有人會停手'};
  const hits=[];
  for(const g of G2)for(const r of g.rows){
    if(r[2]!=='no')continue;
    if(g.g==='結果'&&r[0]==='結果')continue;
    hits.push({w:W[r[0]]||2,g:g.g,k:r[0],v:String(r[1]).split('\n')[0],why:WHY[r[0]]||''});}
  hits.sort((a,b)=>b.w-a.w);
  if(hits.length)G2.unshift({g:'這一場最該改的三件事',top:true,
    rows:hits.slice(0,3).map((h,i)=>[(i+1)+'. '+h.k,h.v+(h.why?'　— '+h.why:''),'no'])});
  else G2.unshift({g:'這一場最該改的三件事',top:true,
    rows:[['沒有需要優先修正的項目','所有硬指標都在門檻內 — 可以直接進到細節討論','ok']]});
  S=old;return G2;
}
function perPerson(G){
  return G.ch.filter(c=>c.active).map(c=>({id:c.id,n:c.n,col:c.c,cpr:Math.round(c.cprT),dist:Math.round(c.dist/10),
    jobs:c.jobs,said:c.said,lead:G.leader===c.id}));
}
function reportText(G){
  let s='IHCA 團隊復甦 — 演練報表\n';
  s+='情境：'+G.cause.n+'　起始心律：'+RH(G.rhythm0||G.rhythm).short
    +'　引擎 '+(G.engine||'?')+'\n\n';
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
  s+='\n【Order 明細】\n';
  const AO=G.orderLog.concat(G.orderQ);
  if(!AO.length)s+='  （全程沒有人下過 order）\n';
  for(const o of AO)s+='  '+mmt(o.at)+'  '+o.txt+(o.toN?' → '+o.toN:'（未指名）')
    +'　'+(o.ack.length?'複誦 '+mmt(o.ackAt):'★ 沒有人複誦')
    +'　'+(o.done?'完成 '+mmt(o.doneAt)+(o.verified===false?'（查證：沒做到）':
        o.verified===true?'（已查證）':''):'★ 沒有回報完成')+'\n';
  s+='\n【醫源性傷害】\n';
  if(!G.harmLog.length)s+='  （沒有）\n';
  for(const h of G.harmLog)s+='  '+mmt(h.t)+'  '+h.txt+'\n';
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
    if(okAct&&G.train&&cid&&DRILLMAP[act])drillMark(G,cid,DRILLMAP[act]);
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
    np:G.np, patient:G.patient, drip:G.drip, dripNow:G.dripNow,
    rhythm:G.rhythm, decay:r1(G.decay), leads:G.leads, air:G.air,
    cpr:G.cpr, pauseVent:G.pauseVent, holdCpr:G.holdCpr, cnt:G.cnt, needPause:G.needPause,
    co2res:G.co2res,
    breaths:G.breaths, noVentT:r1(G.noVentT), coach:r1(G.coach), ventT:r1(G.ventT),
    check:r1(G.check), round:G.round, sinceCheck:r1(G.sinceCheck), timeShown:r1(G.timeShown),
    check_id:G.checkRec?(G.checkRec.id||null):null,
    checkOpen:!!G.checkRec,
    checkRec:G.checkRec?{pulse:G.checkRec.pulse,call:G.checkRec.call,n:G.checkRec.n,
      perf:G.checkRec.perf||null,pulseCalled:G.checkRec.pulseCalled||null,
      dur:Math.round((G.checkRec.dur||0)*10)/10}:null,
    clearAt:r1(G.clearAt), shocks:G.shocks,
    df:{j:G.df.j,sync:G.df.sync,charged:G.df.charged,chargeT:r1(G.df.chargeT),holder:G.df.holder},
    iv:G.iv, ivFixed:G.ivFixed, ivRoute:G.ivRoute, caths:G.caths,
    rosc:G.rosc, roscFelt:G.roscFelt, roscKnown:G.roscKnown, roscHR:G.roscHR, roscSp:r1(G.roscSp), roscCo:G.roscCo,
    nibp:{r:r1(G.nibp.r),val:G.nibp.val,n:G.nibp.n},
    leader:G.leader, probeHolder:G.probeHolder,
    /* CH-3：同時可能有多則未結案的 order */
    orderQ:G.orderQ.map(function(o){return {id:o.id,txt:o.txt,by:o.by,byN:o.byN,
      at:r1(o.at),to:o.to,toN:o.toN,ack:o.ack,done:o.done};}),
    /* item 9：畫面下方的「收到」提示 —— 只送還在有效期內的 */
    pings:G.pings.filter(function(q){return G.t-q.t<=K.ROGERTTL;})
      .map(function(q){return {id:q.id,t:r1(q.t),by:q.by,n:q.n,col:q.col,
        txt:q.txt,kind:q.kind,ack:q.ack};}),
    /* item 8：管路確認 */
    tubeTest:r1(G.tubeTest), tubeTestAt:r1(G.tubeTestAt), airCalled:G.airCalled,
    ettTry:G.ettTry, tEtt:G.tEtt===null?null:r1(G.tEtt),
    /* item 6：床頭指定插管器材 */
    ettAsk:G.ettAsk?{by:G.ettAsk.by,byN:G.ettAsk.byN,to:G.ettAsk.to,toN:G.ettAsk.toN,
      at:r1(G.ettAsk.at),spec:G.ettAsk.spec}:null,
    concerns:G.concerns.map(function(x){return {id:x.id,t:r1(x.t),by:x.by,n:x.n,
      txt:x.txt,lvl:x.lvl,resAt:x.resAt===null?null:r1(x.resAt)};}),
    train:G.train, drill:G.train?G.drill:null, drillDone:G.drillDone,
    recs:G.recs,
    ventAt:(G.ventAt||[]).map(r1),
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
      tubeSeen:c.tubeSeen?1:0,
      recent:(c.id===cid)?c.recent:null};});
  o.clues=G.clues.map(function(q){
    const seen=q.cast||q.known.indexOf(cid)>=0;
    return{src:q.src,t:r1(q.t),cast:q.cast,known:q.known,txt:seen?q.txt:null};});
  return o;
}
function history(G){return{talk:G.talk,tl:G.tl,acts:G.acts,pts:G.pts,checks:G.checks,
  drugLog:G.drugLog,shockLog:G.shockLog,perPerson:perPerson(G),report:report(G),text:reportText(G),
  metrics:metricsRow(G), audit:recAudit(G)};}

const API={K,RH,mmt,HZ,DT,mulberry32,newState,use,cur,step,applyAct,startGame,finish,
  co2Peak,recAudit,metricsRow,
  C,AC,nearSt,nearEq,bedside,atSide,inCable,active,compressing,isCompressing,ccfRecent,
  clearOn,isLeader,nearFam,ccfNow,ENGINE,
  route,collide,ACT,report,perPerson,reportText,history,snapshotFor,drillMark,
  ecgAt,co2At,physOf,shockP,ettFail,span,endSpan,pt};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
else if(typeof window!=='undefined')window.IHCA=API;
})();
