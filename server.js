#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════
   IHCA 團隊復甦 — 多人版伺服器
   零外部套件，只用 Node 內建模組。啟動：  node server.js
   ══════════════════════════════════════════════════════════════ */
'use strict';
const http=require('http'), fs=require('fs'), path=require('path'),
      crypto=require('crypto'), os=require('os');
const SIM=require('./ihca-sim.js');

const PORT=Number(process.env.PORT||8080);
/* 放到公開網路上時，用房間代碼擋住路人；不指定就每次隨機產生 */
const ROOM=String(process.env.ROOM||Math.floor(1000+Math.random()*9000));
const TKEY=String(process.env.TKEY||Math.random().toString(36).slice(2,8));
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
  if(u==='/')u='/ihca-client.html';
  if(u==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(u==='/recordings'||u==='/recordings/'){
    let list=[];try{list=fs.readdirSync(RECDIR).filter(f=>f.endsWith('.json')).sort().reverse();}catch(e){}
    res.writeHead(200,{'Content-Type':MIME['.json']});return res.end(JSON.stringify(list));
  }
  const p=path.join(ROOT,path.normalize(u).replace(/^(\.\.[/\\])+/,''));
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
  R={seed,setup:{drip:setup.drip,rhythm:setup.rhythm,cause:setup.cause,n:setup.n,names},
     G, events:[], started:false, speed:1, savedAs:null,
     slots:R?R.slots:{a:null,b:null,c:null,d:null,e:null,f:null}};
  for(const id in R.slots)if(R.slots[id]){const c=G.ch.find(x=>x.id===id);
    if(c){c.n=R.slots[id].name;c.online=true;}}
  return R;
}
function record(cid,act,p){R.events.push({k:R.G.tick,c:cid,a:act,p:p||null});}
function doAct(cid,act,p){
  if(!R)return;
  const ok=SIM.applyAct(R.G,cid,act,p);
  if(ok)record(cid,act,p);
  return ok;
}
function saveRecording(){
  if(!R||!R.events.length)return null;
  const d=new Date(),z=n=>String(n).padStart(2,'0');
  const name=d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+'-'+z(d.getHours())+z(d.getMinutes())
    +'_'+(R.G.cause?R.G.cause.id:'x')+'.json';
  const rec={v:3,seed:R.seed,setup:R.setup,events:R.events,
    endedAt:d.toISOString(),cause:R.G.cause.n,over:R.G.over,dur:Math.round(R.G.t)};
  try{fs.writeFileSync(path.join(RECDIR,name),JSON.stringify(rec));R.savedAs=name;
    console.log('  ▸ 已存檔 recordings/'+name);}catch(e){console.error(e);}
  return name;
}

/* ═══════════ 連線事件 ═══════════ */
function lobbyInfo(){
  return{t:'lobby',phase:R.G.phase,over:R.G.over,speed:R.speed,paused:R.G.paused,
    setup:{drip:R.setup.drip,rhythm:R.setup.rhythm,cause:R.setup.cause,n:R.setup.n},
    slots:SIM.K.SLOTS.slice(0,R.setup.n).map(s=>({id:s.id,c:s.c,coat:!!s.coat,
      name:R.slots[s.id]?R.slots[s.id].name:null,
      online:!!(R.slots[s.id]&&R.slots[s.id].ws)})),
    saved:R.savedAs};
}
function onOpen(ws){ send(ws,{t:'hi',need:'hello'}); }
function authed(ws,m){
  const r=m.role||'player';
  if(r==='teacher'||r==='host')return String(m.key||'')===TKEY;
  return String(m.room||'')===ROOM;
}
function onClose(ws){
  if(!R)return;
  const id=ws.meta.slot;
  if(id&&R.slots[id]&&R.slots[id].ws===ws){R.slots[id].ws=null;
    const c=R.G.ch.find(x=>x.id===id);if(c)c.online=false;}
  pushLobby();
}
function pushLobby(){const L=lobbyInfo();broadcast(()=>L);}

function onMsg(ws,m){
  if(!R)newRound();
  if(m.t==='hello'){
    if(!authed(ws,m)){send(ws,{t:'denied',need:(m.role==='teacher'||m.role==='host')?'key':'room'});return;}
    ws.meta.role=m.role||'player';
    /* role 'lobby' = 手機已連上但還沒填名字，不佔位子 */
    if(ws.meta.role==='player'){
      const open=SIM.K.SLOTS.slice(0,R.setup.n).map(s=>s.id);
      let id=m.slot;
      if(!id||open.indexOf(id)<0||(R.slots[id]&&R.slots[id].ws&&R.slots[id].ws!==ws))
        id=open.find(s=>!R.slots[s]||!R.slots[s].ws);
      if(!id){send(ws,{t:'full'});return;}
      const nm=(m.name||'').trim().slice(0,2)||id.toUpperCase();
      R.slots[id]={name:nm,ws};
      ws.meta.slot=id;
      const c=R.G.ch.find(x=>x.id===id);
      if(c){c.n=nm;c.online=true;}
      R.setup.names[id]=nm;
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
    newRound(s); pushLobby(); return;}
  if(m.t==='start'){ if(R.G.phase!=='lobby')return;
    doAct(null,'__start'); R.started=true; pushLobby(); return;}
  if(m.t==='pause'){ doAct(null,'__pause',{on:!!m.on}); pushLobby(); return;}
  if(m.t==='speed'){ R.speed=Math.max(1,Math.min(3,Number(m.v)||1)); pushLobby(); return;}
  if(m.t==='stop'){ if(!R.G.over){doAct(null,'__stop');saveRecording();} pushLobby(); return;}
  if(m.t==='newgame'){ newRound(m.setup||R.setup); pushLobby();
    broadcast(w=>({t:'snap',s:SIM.snapshotFor(R.G,w.meta.slot||null)})); return;}
  if(m.t==='history'){ send(ws,{t:'history',h:SIM.history(R.G)}); return;}
  if(m.t==='recording'){ send(ws,{t:'recording',rec:{v:3,seed:R.seed,setup:R.setup,
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
  /* 結束時自動存檔 */
  if(R.G.over&&!R.savedAs)saveRecording();
  /* 訊息分流：私訊只給當事人 */
  if(R.G.outbox.length){
    const out=R.G.outbox.splice(0,R.G.outbox.length);
    broadcast(ws=>{
      const mine=out.filter(e=>!e.who||e.who===ws.meta.slot||ws.meta.role==='teacher');
      return mine.length?{t:'log',e:mine.map(e=>({t:e.t,m:e.m,p:!!e.who}))}:null;
    });
  }
  /* 狀態快照 12Hz */
  if(now-lastSnap>=83){
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
  console.log('  房間代碼：' + ROOM + '　（學員掃 QR 就會自動帶入）');
  console.log('');
  console.log('  ▸ 主機投影畫面  ' + base + '/?m=host&k=' + TKEY);
  console.log('  ▸ 教師控制台    ' + base + '/?m=teacher&k=' + TKEY);
  console.log('  ▸ 學員（QR）    ' + base + '/?r=' + ROOM);
  console.log('  ▸ 重播播放器    ' + base + '/?m=replay');
  console.log('');
  if(pub){
    console.log('  這是公開網址，學員的手機用院內 WiFi（或 4G）都連得到，');
    console.log('  不需要跟這台電腦在同一個網路。關掉視窗網址就失效。');
  }else if(list.length){
    console.log('  同一個 WiFi 的手機可以改用：');
    for(const ip of list)console.log('      http://'+ip+':'+PORT+'/?r='+ROOM);
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
