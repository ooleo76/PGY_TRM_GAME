#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   IHCA 團隊復甦 — 多人版伺服器
   零外部套件，只用 Node 內建模組。啟動：  node server.js
   ══════════════════════════════════════════════════════════════ */
'use strict';
const http=require('http'), fs=require('fs'), path=require('path'),
      crypto=require('crypto'), os=require('os');
const SIM=require('./ihca-sim.js');
const MAIL=require('./mailer.js');

const PORT=Number(process.env.PORT||8080);
/* 放到公開網路上時，用房間代碼擋住路人；不指定就每次隨機產生 */
const ROOM=String(process.env.ROOM||Math.floor(1000+Math.random()*9000));
const TKEY=String(process.env.TKEY||Math.random().toString(36).slice(2,8));
/* ══ v4.0 資訊安全（DP-1 / item 16）══
   ROOM 是固定的四位數，寫在投影幕上 —— 它只是擋路人，不是門禁。
   真正的門禁是 JOIN：每一場上課換一組，舊的 QR code 螢幕截圖就失效。
   教師控制台可以隨時「換一組入場代碼」與「鎖定入場」。 */
const newJoin=()=>crypto.randomBytes(4).toString('hex');
let JOIN=newJoin();
let JOINLOCK=false;
/* 匿名模式：設 ANON=1 之後，錄影檔與報表一律只留 P1…P6 與人事號的雜湊，
   不留姓名字。正式收資料（送過 IRB）請一定要打開。 */
const ANON=String(process.env.ANON||'')==='1';
const ANONSALT=String(process.env.ANON_SALT||crypto.randomBytes(16).toString('hex'));
const anonId=eid=>eid?crypto.createHmac('sha256',ANONSALT).update(String(eid)).digest('hex').slice(0,12):null;
/* 同一批人一天跑好幾場 —— 分析時要分得出來這是第幾場（PA-7） */
let SESSION_INDEX=0;
const USE_TUNNEL=process.argv.includes('--tunnel');
const ROOT=__dirname;
const RECDIR=path.join(ROOT,'recordings');
try{fs.mkdirSync(RECDIR,{recursive:true});}catch(e){}

/* ═══════════ 靜態檔案 ═══════════ */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8'};
function serve(req,res){
  let u=decodeURIComponent(req.url.split('?')[0]);
  const qs=new URLSearchParams(req.url.split('?')[1]||'');
  if(u==='/')u='/ihca-client.html';
  if(u==='/favicon.ico'){res.writeHead(204);return res.end();}
  /* DP-1：錄影檔含學員的操作紀錄與代號。WebSocket 有房間代碼與教師金鑰，
     但 v3.4 的靜態伺服器完全沒有驗證 —— 部署到公開網址之後，
     任何知道網址的人都可以 GET /recordings 列出並下載全部檔案。

     v4.0.1：驗證改用「正規化之後的實際路徑」，不是使用者給的字串。
     只比對字串的話，/x/../recordings/xxx.json 這種寫法不會命中 /recordings 前綴，
     卻會在 path.normalize 之後指到錄影檔 —— 等於整道門形同虛設。 */
  const wanted=path.join(ROOT,path.normalize(u).replace(/^(\.\.[/\\])+/,''));
  const inRec=(wanted===RECDIR||wanted.startsWith(RECDIR+path.sep));
  if(inRec&&qs.get('k')!==TKEY){
    res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'});
    return res.end('需要教師金鑰才能存取錄影檔');
  }
  if(wanted===RECDIR){
    let list=[];try{list=fs.readdirSync(RECDIR).filter(f=>f.endsWith('.json')).sort().reverse();}catch(e){}
    res.writeHead(200,{'Content-Type':MIME['.json']});return res.end(JSON.stringify(list));
  }
  const p=wanted;
  if(!p.startsWith(ROOT)){res.writeHead(403);return res.end('forbidden');}
  fs.readFile(p,(err,buf)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('找不到 '+u);}
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream',
      'Cache-Control':'no-cache'});
    res.end(buf);});
}
const server=http.createServer(serve);

/* ═══════════ 極簡 WebSocket（RFC 6455，只做我們用得到的部分） ═══════════ */
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const socks=new Set();
server.on('upgrade',(req,sock)=>{
  const key=req.headers['sec-websocket-key'];
  if(!key){sock.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'+
             'Connection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  sock.setNoDelay(true);
  const ws={sock,buf:Buffer.alloc(0),alive:true,meta:{}};
  socks.add(ws);
  sock.on('data',d=>{ws.buf=Buffer.concat([ws.buf,d]);drain(ws);});
  sock.on('close',()=>{socks.delete(ws);onClose(ws);});
  sock.on('error',()=>{try{sock.destroy();}catch(e){}socks.delete(ws);onClose(ws);});
  onOpen(ws);
});
function drain(ws){
  for(;;){
    const b=ws.buf;
    if(b.length<2)return;
    const fin=(b[0]&0x80)!==0, op=b[0]&0x0f, masked=(b[1]&0x80)!==0;
    let len=b[1]&0x7f, off=2;
    if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4;}
    else if(len===127){if(b.length<10)return;len=Number(b.readBigUInt64BE(2));off=10;}
    const mkOff=off; if(masked)off+=4;
    if(b.length<off+len)return;
    let pay=b.slice(off,off+len);
    if(masked){const m=b.slice(mkOff,mkOff+4);const o=Buffer.allocUnsafe(len);
      for(let i=0;i<len;i++)o[i]=pay[i]^m[i&3];pay=o;}
    ws.buf=b.slice(off+len);
    if(op===0x8){try{ws.sock.end(frame(Buffer.alloc(0),0x8));}catch(e){}return;}
    if(op===0x9){try{ws.sock.write(frame(pay,0xA));}catch(e){}continue;}
    if(op===0x1&&fin){
      let msg=null;try{msg=JSON.parse(pay.toString('utf8'));}catch(e){}
      if(msg)onMsg(ws,msg);
    }
  }
}
function frame(payload,op){
  op=op===undefined?0x1:op;
  const len=payload.length;let head;
  if(len<126){head=Buffer.allocUnsafe(2);head[1]=len;}
  else if(len<65536){head=Buffer.allocUnsafe(4);head[1]=126;head.writeUInt16BE(len,2);}
  else{head=Buffer.allocUnsafe(10);head[1]=127;head.writeBigUInt64BE(BigInt(len),2);}
  head[0]=0x80|op;
  return Buffer.concat([head,payload]);
}
function send(ws,obj){
  try{ws.sock.write(frame(Buffer.from(JSON.stringify(obj),'utf8')));}catch(e){}
}
function broadcast(fn){for(const ws of socks){const o=fn(ws);if(o)send(ws,o);}}
setInterval(()=>{for(const ws of socks){try{ws.sock.write(frame(Buffer.alloc(0),0x9));}catch(e){}}},20000);

/* ═══════════ 一場演練 ═══════════ */
let R=null;                       /* 目前這一場 */
function newRound(setup){
  const seed=(Math.random()*0xFFFFFFFF)>>>0;
  setup=Object.assign({drip:'none',rhythm:'rand',cause:'rand',n:6},setup||{});
  setup.n=Math.max(2,Math.min(6,Number(setup.n)||6));
  const names={};
  if(R)for(const id in R.slots)if(R.slots[id])names[id]=R.slots[id].name;
  setup.names=names;
  const G=SIM.newState(seed,setup);
  R={seed,setup:{drip:setup.drip,rhythm:setup.rhythm,cause:setup.cause,n:setup.n,names,
                 train:!!setup.train},
     G, events:[], started:false, speed:1, savedAs:null,
     slots:R?R.slots:{a:null,b:null,c:null,d:null,e:null,f:null}};
  for(const id in R.slots)if(R.slots[id]){const c=G.ch.find(x=>x.id===id);
    if(c){c.n=R.slots[id].name;c.online=true;}}
  return R;
}
/* 存好檔之後順手寄一份到自己的信箱。沒設定環境變數就靜靜跳過。 */
function mailOut(kind,name,json,summary){
  if(!MAIL.enabled())return;
  const d=new Date().toLocaleString('zh-TW',{hour12:false});
  MAIL.send(
    '[IHCA] '+kind+' '+d,
    kind+'\n\n'+summary+'\n\n附件：'+name+'\n（引擎 '+SIM.ENGINE+'）\n',
    name, json,
    err=>{ if(err)console.error('  ▸ 寄信失敗：'+err.message+'（檔案仍在 recordings/）');
           else console.log('  ▸ 已寄到 '+MAIL.TO); });
}

function record(cid,act,p){R.events.push({k:R.G.tick,c:cid,a:act,p:p||null});}
/* 錄影檔裡的名冊。ANON=1 時只留代號與人事號的不可逆雜湊（IRB 要求）。 */
function roster(){
  const out=[];
  for(const id of SIM.K.SLOTS.slice(0,R.setup.n).map(x=>x.id)){
    const sl=R.slots[id];if(!sl)continue;
    out.push(ANON
      ?{slot:id,code:'P'+(SIM.K.SLOTS.findIndex(z=>z.id===id)+1),
        pid:anonId(sl.eid),pgy:sl.pgy||null}
      :{slot:id,name:sl.name,eid:sl.eid||null,pgy:sl.pgy||null});}
  return out;}

/* 熟悉環境結束時單獨存一份檔。
   它不是演練錄影（沒有教案、不能重播），而是「定向階段」的完成紀錄 ——
   每個人各項核心互動的完成秒數，之後可以當共變量。 */
function saveFamiliarization(){
  const G=R.G;
  const rost=roster().length?roster():G.ch.filter(c=>c.active).map(c=>({slot:c.id,name:c.n}));
  const per={};
  for(const r of rost){
    const d=(G.drill||{})[r.slot]||{};
    per[r.slot]={name:r.name||r.code,pgy:r.pgy||null,pid:r.pid||null,
      items:SIM.K.DRILL.map(it=>({k:it.k,n:it.n,at:d[it.k]!==undefined?d[it.k]:null})),
      complete:SIM.K.DRILL.every(it=>d[it.k]!==undefined),
      lastAt:SIM.K.DRILL.reduce((a,it)=>d[it.k]!==undefined?Math.max(a,d[it.k]):a,0)};
  }
  const rec={kind:'familiarization', v:2, engine:SIM.ENGINE, anon:ANON, wallAt:Date.now(),
    room:ROOM, seed:R.seed, n:R.setup.n,
    startedAt:R.startedAt||null, endedAt:new Date().toISOString(),
    dur:Math.round(G.t),
    allDoneAt:G.drillDone,          /* 全員完成的秒數；沒完成就是 null */
    roster:rost, per};
  try{
    const d=new Date(), z=x=>String(x).padStart(2,'0');
    const name='familiarization-'+d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())
      +'-'+z(d.getHours())+z(d.getMinutes())+'.json';
    const json=JSON.stringify(rec);
    fs.writeFileSync(path.join(RECDIR,name),json);
    console.log('  ▸ 已存檔 recordings/'+name
      +(rec.allDoneAt!==null?'（全員完成 '+rec.allDoneAt+' 秒）':'（未全員完成）'));
    rec.savedAs=name;
    const ok=Object.values(rec.per).filter(x=>x.complete).length;
    mailOut('熟悉環境紀錄',name,json,
      '完成人數：'+ok+' / '+rec.roster.length
      +'\n全員完成時間：'+(rec.allDoneAt!==null?rec.allDoneAt+' 秒':'未全員完成')
      +'\n總時長：'+rec.dur+' 秒');
  }catch(e){console.error(e);}
  return rec;
}
function doAct(cid,act,p){
  if(!R)return;
  const ok=SIM.applyAct(R.G,cid,act,p);
  if(ok)record(cid,act,p);
  return ok;
}
function saveRecording(){
  if(!R||!R.events.length||R.training)return null;   /* 熟悉環境不錄影 */
  const d=new Date(),z=n=>String(n).padStart(2,'0');
  const name=d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+'-'+z(d.getHours())+z(d.getMinutes())
    +'_'+(R.G.cause?R.G.cause.id:'x')+'.json';
  const rec={v:5,engine:SIM.ENGINE,seed:R.seed,setup:R.setup,events:R.events,
    familiarization:R.lastDrill||null,
    /* PA-7：同一批人一天跑好幾場時，分析要分得出來這是第幾場、
       以及距離熟悉環境過了多久 */
    sessionIndex:++SESSION_INDEX,
    familiarizationAge:(R.lastDrill&&R.lastDrill.wallAt)
      ?Math.round((Date.now()-R.lastDrill.wallAt)/1000):null,
    anon:ANON, roster:roster(), room:ROOM,
    endedAt:d.toISOString(),cause:R.G.cause.n,over:R.G.over,dur:Math.round(R.G.t)};
  try{
    const json=JSON.stringify(rec);
    fs.writeFileSync(path.join(RECDIR,name),json);R.savedAs=name;
    console.log('  ▸ 已存檔 recordings/'+name);
    /* 信件內文直接放報表全文 —— 就算附件之後不見了，結論還在信箱裡 */
    let txt='';
    try{txt=SIM.reportText(R.G);}catch(e){txt='（報表產生失敗）';}
    mailOut('演練錄影 · '+rec.cause,name,json,
      '結果：'+(rec.over==='ROSC'?'ROSC':'未恢復循環')+'　時長：'+Math.round(rec.dur/60)+' 分\n'
      +'熟悉環境：'+(rec.familiarization
          ?(rec.familiarization.allDoneAt!==null?'全員完成 '+rec.familiarization.allDoneAt+' 秒':'未全員完成')
          :'（這一場沒有做）')
      +'\n\n'+'─'.repeat(40)+'\n'+txt);
  }catch(e){console.error(e);}
  return name;
}

/* ═══════════ 連線事件 ═══════════ */
function lobbyInfo(){
  return{t:'lobby',phase:R.G.phase,over:R.G.over,speed:R.speed,paused:R.G.paused,
    setup:{drip:R.setup.drip,rhythm:R.setup.rhythm,cause:R.setup.cause,n:R.setup.n},
    training:!!R.training, drill:R.training?R.G.drill:null,
    drillDone:R.training?R.G.drillDone:null, lastDrill:R.lastDrill||null,
    slots:SIM.K.SLOTS.slice(0,R.setup.n).map(s=>({id:s.id,c:s.c,coat:!!s.coat,
      name:R.slots[s.id]?R.slots[s.id].name:null,
      pgy:R.slots[s.id]?(R.slots[s.id].pgy||null):null,
      hasEid:!!(R.slots[s.id]&&R.slots[s.id].eid),
      online:!!(R.slots[s.id]&&R.slots[s.id].ws)})),
    join:JOIN, joinLock:JOINLOCK, anon:ANON, sessionIndex:SESSION_INDEX,
    saved:R.savedAs, mail:MAIL.enabled()?MAIL.TO:null};
}
function onOpen(ws){ send(ws,{t:'hi',need:'hello'}); }
function authed(ws,m){
  const r=m.role||'player';
  if(r==='teacher'||r==='host')return String(m.key||'')===TKEY;
  if(String(m.room||'')!==ROOM)return 'room';
  if(String(m.join||'')!==JOIN)return 'join';
  /* 鎖定之後只讓已經佔到位子的人重新連線（斷線重連不受影響） */
  if(JOINLOCK&&r==='player'){
    const known=Object.keys(R.slots).some(k=>R.slots[k]&&R.slots[k].eid&&R.slots[k].eid===String(m.eid||''));
    if(!known)return 'locked';}
  return true;
}
function onClose(ws){
  if(!R)return;
  const id=ws.meta.slot;
  if(id&&R.slots[id]&&R.slots[id].ws===ws){R.slots[id].ws=null;
    const c=R.G.ch.find(x=>x.id===id);
    if(c){c.online=false;c.vx=0;c.vy=0;c.path=[];}}   /* 斷線的人不要一直走下去 */
  /* 演練還沒開始就離線 → 位子完全釋放，讓別人可以選 */
  if(id&&R.G.phase==='lobby'&&R.slots[id]&&!R.slots[id].ws){
    R.slots[id]=null;delete R.setup.names[id];
    const c=R.G.ch.find(x=>x.id===id);if(c)c.n=id.toUpperCase();}
  pushLobby();
}
function pushLobby(){const L=lobbyInfo();broadcast(()=>L);}

function onMsg(ws,m){
  if(!R)newRound();
  if(m.t==='hello'){
    const au=authed(ws,m);
    if(au!==true){send(ws,{t:'denied',
      need:(m.role==='teacher'||m.role==='host')?'key':(au===true?'room':au)});return;}
    ws.meta.role=m.role||'player';
    /* role 'lobby' = 手機已連上但還沒填名字，不佔位子 */
    if(ws.meta.role==='player'){
      /* 同一支手機改名／換顏色時，先把它原本佔的位子整個清掉，
         否則舊角色會一直掛在線上，最後六個位子全被同一個人佔滿 */
      for(const k in R.slots){
        if(R.slots[k]&&R.slots[k].ws===ws){
          R.slots[k]=null;
          const oc=R.G.ch.find(x=>x.id===k);
          if(oc){oc.online=false;oc.n=k.toUpperCase();}
          delete R.setup.names[k];
        }
      }
      ws.meta.slot=null;
      const open=SIM.K.SLOTS.slice(0,R.setup.n).map(s=>s.id);
      let id=m.slot;
      if(!id||open.indexOf(id)<0||(R.slots[id]&&R.slots[id].ws&&R.slots[id].ws!==ws))
        id=open.find(s=>!R.slots[s]||!R.slots[s].ws);
      if(!id){send(ws,{t:'full'});return;}
      const nm=(m.name||'').trim().slice(0,2)||id.toUpperCase();
      /* item 15：人事號用來跨場次比對同一個人；年資是分析一定要的共變量。
         畫面上永遠只出現那一個字，人事號不會顯示給任何人看。 */
      const eid=String(m.eid||'').trim().slice(0,20);
      const pgy=String(m.pgy||'').trim().slice(0,12);
      R.slots[id]={name:nm,eid,pgy,ws};
      ws.meta.slot=id;ws.meta.eid=eid;
      const c=R.G.ch.find(x=>x.id===id);
      if(c){c.n=ANON?('P'+(SIM.K.SLOTS.findIndex(z=>z.id===id)+1)):nm;c.online=true;}
      R.setup.names[id]=c?c.n:nm;
    }
    send(ws,{t:'welcome',role:ws.meta.role,slot:ws.meta.slot||null,
      room:ROOM,key:(ws.meta.role==='teacher'||ws.meta.role==='host')?TKEY:null,
      serverTime:Date.now()});
    pushLobby();
    send(ws,{t:'snap',s:SIM.snapshotFor(R.G,ws.meta.slot||null)});
    return;
  }
  if(m.t==='act'){
    if(ws.meta.role!=='player'||!ws.meta.slot)return;
    doAct(ws.meta.slot,m.act,m.p);
    return;
  }
  if(m.t==='history'&&R.G.over){ send(ws,{t:'history',h:SIM.history(R.G)}); return;}
  /* 教師控制台 */
  if(ws.meta.role!=='teacher'&&ws.meta.role!=='host')return;
  if(m.t==='setup'){ if(R.G.phase!=='lobby')return;
    const s=Object.assign({},R.setup,m.setup||{});
    newRound(s);
    /* 人數調小時，超出範圍的位子上如果還有人，把他退回進場畫面重選 */
    const open=SIM.K.SLOTS.slice(0,R.setup.n).map(x=>x.id);
    for(const k in R.slots){
      if(R.slots[k]&&R.slots[k].ws&&open.indexOf(k)<0){
        const w=R.slots[k].ws;R.slots[k]=null;delete R.setup.names[k];
        w.meta.slot=null;
        send(w,{t:'welcome',role:'player',slot:null,room:ROOM,serverTime:Date.now()});
      }
    }
    pushLobby(); return;}
  if(m.t==='start'){ if(R.G.phase!=='lobby')return;
    doAct(null,'__start'); R.started=true; pushLobby(); return;}
  /* 熟悉環境：同一個房間、同一批人，換成練習假人開一局。
     練習不錄影，結束時把 drill 完成時間留在 lastDrill 供正式場的 metadata 使用。 */
  if(m.t==='trainStart'){ if(R.G.phase!=='lobby')return;
    const prev=R.lastDrill;
    newRound(Object.assign({},R.setup,{train:true}));
    R.lastDrill=prev; R.training=true;
    doAct(null,'__start'); R.started=true; R.startedAt=new Date().toISOString();
    pushLobby(); broadcast(w=>({t:'snap',s:SIM.snapshotFor(R.G,w.meta.slot||null)})); return;}
  if(m.t==='trainEnd'){ if(!R.training)return;
    /* newRound 會整個換掉 R，所以先存成區域變數，建完新局再掛回去 */
    const drill=saveFamiliarization();
    const st=Object.assign({},R.setup); delete st.train;
    newRound(st); R.lastDrill=drill; R.training=false; R.started=false;
    pushLobby(); broadcast(w=>({t:'snap',s:SIM.snapshotFor(R.G,w.meta.slot||null)})); return;}
  /* item 16：換一組入場代碼 —— 舊的 QR 螢幕截圖立刻失效 */
  if(m.t==='newjoin'){ JOIN=newJoin(); pushLobby();
    send(ws,{t:'log',e:[{m:'已換一組入場代碼，請重新投影 QR code',p:0}]}); return;}
  if(m.t==='joinlock'){ JOINLOCK=!!m.on; pushLobby(); return;}
  if(m.t==='pause'){ doAct(null,'__pause',{on:!!m.on}); pushLobby(); return;}
  if(m.t==='speed'){ R.speed=Math.max(1,Math.min(3,Number(m.v)||1)); pushLobby(); return;}
  if(m.t==='stop'){ if(!R.G.over){doAct(null,'__stop');saveRecording();} pushLobby(); return;}
  if(m.t==='newgame'){ const drill=R.lastDrill;
    newRound(m.setup||R.setup); R.lastDrill=drill; pushLobby();
    broadcast(w=>({t:'snap',s:SIM.snapshotFor(R.G,w.meta.slot||null)})); return;}
  if(m.t==='history'){ send(ws,{t:'history',h:SIM.history(R.G)}); return;}
  /* 手動補寄最近一次的存檔（網路斷過、或想再寄一份給共同主持人時用） */
  if(m.t==='remail'){
    if(!MAIL.enabled()){send(ws,{t:'log',e:[{m:'伺服器沒有設定寄信環境變數',p:1}]});return;}
    if(!R.savedAs){send(ws,{t:'log',e:[{m:'還沒有可寄的存檔',p:1}]});return;}
    try{const j=fs.readFileSync(path.join(RECDIR,R.savedAs),'utf8');
      mailOut('補寄 · 演練錄影',R.savedAs,j,'教師手動補寄。');
      send(ws,{t:'log',e:[{m:'已送出到 '+MAIL.TO,p:0}]});}
    catch(e){send(ws,{t:'log',e:[{m:'補寄失敗：'+e.message,p:1}]});}
    return;}
  if(m.t==='recording'){ send(ws,{t:'recording',rec:{v:4,engine:SIM.ENGINE,seed:R.seed,setup:R.setup,
      events:R.events,cause:R.G.cause.n,over:R.G.over,dur:Math.round(R.G.t)}}); return;}
}

/* ═══════════ 主迴圈 ═══════════ */
let lastSnap=0, accum=0, prev=Date.now();
setInterval(()=>{
  if(!R)newRound();
  const now=Date.now(); let dtms=now-prev; prev=now;
  if(dtms>500)dtms=500;
  accum+=dtms;
  const stepMs=1000*SIM.DT;
  let steps=0;
  while(accum>=stepMs&&steps<20){
    for(let i=0;i<R.speed;i++){SIM.use(R.G);SIM.step();}
    accum-=stepMs;steps++;
  }
  /* 熟悉環境進行中，檢核表有變動就把大廳狀態推給教師端 */
  if(R.training){
    const sig=JSON.stringify(R.G.drill)+'|'+R.G.drillDone;
    if(sig!==R._drillSig){R._drillSig=sig;pushLobby();}
  }
  /* 結束時自動存檔 —— 存完要推播，否則報表上的「重播這一場」不會出現 */
  if(R.G.over&&!R.savedAs){saveRecording();pushLobby();}
  /* 訊息分流：私訊只給當事人 */
  if(R.G.outbox.length){
    const out=R.G.outbox.splice(0,R.G.outbox.length);
    broadcast(ws=>{
      const mine=out.filter(e=>!e.who||e.who===ws.meta.slot||ws.meta.role==='teacher');
      return mine.length?{t:'log',e:mine.map(e=>({t:e.t,m:e.m,p:!!e.who}))}:null;
    });
  }
  /* 狀態快照 12Hz */
  if(now-lastSnap>=66){
    lastSnap=now;
    broadcast(ws=>({t:'snap',s:SIM.snapshotFor(R.G,ws.meta.slot||null)}));
  }
},1000/SIM.HZ);

/* ═══════════ 啟動 ═══════════ */
function ips(){
  const out=[];const ifs=os.networkInterfaces();
  for(const k in ifs)for(const a of ifs[k])
    if(a.family==='IPv4'&&!a.internal)out.push(a.address);
  return out;
}
newRound();
function banner(pub,noHint){
  const list=ips();
  const base=pub||('http://localhost:'+PORT);
  console.log('');
  console.log('  ╔════════════════════════════════════════════════════════╗');
  console.log('  ║   IHCA 團隊復甦 — 多人版伺服器                         ║');
  console.log('  ╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  房間代碼：' + ROOM + '　入場代碼：' + JOIN + '　（學員掃 QR 就會自動帶入）');
  console.log('  ' + (ANON?'匿名模式：開（錄影檔只留代號與人事號雜湊）':'匿名模式：關（正式收資料請設 ANON=1）'));
  console.log('');
  console.log('  ▸ 主機投影畫面  ' + base + '/?m=host&k=' + TKEY);
  console.log('  ▸ 教師控制台    ' + base + '/?m=teacher&k=' + TKEY);
  console.log('  ▸ 學員（QR）    ' + base + '/?r=' + ROOM + '&j=' + JOIN);
  console.log('  ▸ 重播播放器    ' + base + '/?m=replay&k=' + TKEY);
  console.log('');
  if(pub){
    console.log('  這是公開網址，學員的手機用院內 WiFi（或 4G）都連得到，');
    console.log('  不需要跟這台電腦在同一個網路。關掉視窗網址就失效。');
  }else if(list.length){
    console.log('  同一個 WiFi 的手機可以改用：');
    for(const ip of list)console.log('      http://'+ip+':'+PORT+'/?r='+ROOM+'&j='+JOIN);
    console.log('');
    if(!noHint){
      console.log('  如果電腦跟手機不在同一個網路（例如電腦接網路線、手機用院內 WiFi），');
      console.log('  請改用：  node server.js --tunnel');
    }
  }
  console.log('');
  console.log('  錄影檔存到  '+RECDIR+'\n  按 Ctrl+C 結束。');
  console.log('');
}
server.listen(PORT,()=>{
  if(!USE_TUNNEL){banner(null);return;}
  console.log('\n  正在建立公開網址（Cloudflare Tunnel）…');
  const {spawn}=require('child_process');
  let cf;
  try{cf=spawn('cloudflared',['tunnel','--url','http://localhost:'+PORT,'--no-autoupdate'],
      {stdio:['ignore','pipe','pipe']});}
  catch(e){cf=null;}
  if(!cf){tunnelHelp();return;}
  let found=false;
  const scan=d=>{
    const s2=d.toString();
    const m2=s2.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if(m2&&!found){found=true;banner(m2[0]);}
  };
  cf.stdout.on('data',scan);cf.stderr.on('data',scan);
  cf.on('error',()=>{if(!found)tunnelHelp();});
  cf.on('exit',()=>{if(!found)tunnelHelp();});
  process.on('exit',()=>{try{cf.kill();}catch(e){}});
  setTimeout(()=>{if(!found){console.log('  （還在等 Cloudflare 回應…）');}},8000);
});
function tunnelHelp(){
  console.log('');
  console.log('  ✗ 找不到 cloudflared，沒辦法自動建立公開網址。');
  console.log('    請先安裝（只要裝一次）：');
  console.log('      Windows : winget install --id Cloudflare.cloudflared');
  console.log('      macOS   : brew install cloudflared');
  console.log('    裝好後再執行一次  node server.js --tunnel');
  console.log('');
  banner(null,true);
}
process.on('SIGINT',()=>{if(R&&R.events.length&&!R.savedAs)saveRecording();process.exit(0);});
