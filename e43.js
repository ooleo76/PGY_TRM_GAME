/* v4.3 端到端：新的 UI 行為 */
const {chromium}=require('playwright');
const base='http://localhost:8250';
const R=[];const ok=(n,c,d)=>{R.push(c);console.log((c?'  ✔ ':'  ✘ ')+n+(d!==undefined?'　'+d:''));};
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}).catch(()=>chromium.launch());
 const errs=[];
 const tc=await b.newPage({viewport:{width:1000,height:1000}});
 tc.on('pageerror',e=>errs.push('TC '+e.message));
 await tc.goto(base+'/?m=teacher&k=tk'); await tc.waitForTimeout(1200);
 const join=await tc.evaluate(()=>LOBBY&&LOBBY.join);
 const mk=async(nm,i,w,h)=>{const p=await b.newPage({viewport:{width:w||1180,height:h||820},isMobile:true,hasTouch:true});
   p.on('pageerror',e=>errs.push(nm+' '+e.message));
   await p.goto(base+'/?r=2468&j='+join); await p.waitForTimeout(800);
   await p.fill('#nameIn',nm); await p.fill('#eidIn','E'+i);
   await p.click('#pgys button:nth-child(2)'); await p.click('#visits button:nth-child(1)');
   await p.click('#slots button:nth-child('+i+')'); await p.click('#joinBtn');
   await p.waitForTimeout(1000); return p;};
 const host=await b.newPage({viewport:{width:1440,height:900}});
 host.on('pageerror',e=>errs.push('HOST '+e.message));
 await host.goto(base+'/?m=host&k=tk'); await host.waitForTimeout(900);
 const a=await mk('甲',1), e=await mk('乙',2), c=await mk('丙',3,390,844);

 /* 等到條件成立再往下走，比固定 sleep 穩 */
 const till=async(pg,fn,ms,label)=>{const t0=Date.now();
   while(Date.now()-t0<(ms||30000)){
     if(await pg.evaluate(fn))return true; await pg.waitForTimeout(400);}
   if(label!=='')console.log('      （等不到：'+(label||fn.toString().slice(0,50))+'）');
   return false;};
 const near=(pg,k)=>pg.evaluate(kk=>{
     const me=G.ch.find(x=>x.id===ME);if(!me)return false;
     const S=IHCA.K.ST[kk], E=G.eq&&G.eq[kk];
     const p=S?{x:S.x,y:S.y}:(E?{x:E.x+40,y:E.y+40}:null);
     if(!p)return false;
     return Math.hypot(me.x-p.x,me.y-p.y)<135;},k);
 const dist=(pg,k)=>pg.evaluate(kk=>{
     const me=G.ch.find(x=>x.id===ME);if(!me)return -1;
     const S=IHCA.K.ST[kk], E=G.eq&&G.eq[kk];
     const p=S?{x:S.x,y:S.y}:(E?{x:E.x+40,y:E.y+40}:null);
     if(!p)return -2;
     return Math.round(Math.hypot(me.x-p.x,me.y-p.y));},k);
 const free=pg=>till(pg,()=>{const me=G.ch.find(x=>x.id===ME);return me&&!me.busy;},20000,'空出手');
 const walk=async(pg,k)=>{
   await free(pg);
   for(let i=0;i<4;i++){
     await pg.evaluate(kk=>NET.act('goto',{k:kk}),k);
     await pg.waitForTimeout(900);
     if(await till(pg,()=>{const me=G.ch.find(x=>x.id===ME);
       return me&&(!me.path||!me.path.length);},15000,'走到 '+k)){
       await pg.waitForTimeout(400);
       if(await near(pg,k))return true;}}
   console.log('      （走不到 '+k+'，距離 '+(await dist(pg,k))+'）');return false;};


 console.log('\n── 職級選項 ──');
 const pgyTxt=await a.evaluate(()=>'x');
 const gp=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await gp.goto(base+'/?r=2468&j='+join); await gp.waitForTimeout(800);
 const pgyLabels=await gp.evaluate(()=>[...document.querySelectorAll('#pgys button')].map(x=>x.textContent.trim()));
 ok('職級沒有「其他」', pgyLabels.indexOf('其他')<0, pgyLabels.join('／'));
 ok('職級有「主治醫師」', pgyLabels.indexOf('主治醫師')>=0);
 await gp.close();

 await tc.evaluate(()=>NET.send({t:'setup',setup:{n:3,drip:'ns',rhythm:'PEA',cause:'k'}}));
 await tc.waitForTimeout(400);
 await tc.evaluate(()=>NET.send({t:'start'})); await tc.waitForTimeout(6500);

 console.log('\n── item 2：任何時候都能暫停壓胸 ──');
 await c.evaluate(()=>NET.act('goto',{k:'bedL'})); await c.waitForTimeout(2600);
 await c.evaluate(()=>NET.act('cprStart')); await c.waitForTimeout(2500);
 const hasHold=await c.evaluate(()=>document.getElementById('acts').textContent.indexOf('暫停壓胸')>=0);
 const cnt=await c.evaluate(()=>G.cnt);
 ok('壓胸中（第 '+cnt+' 下）就看得到「暫停壓胸」', hasHold);
 await c.evaluate(()=>NET.act('cprHold')); await c.waitForTimeout(900);
 const st=await c.evaluate(()=>({hold:G.holdCpr,resume:document.getElementById('acts').textContent.indexOf('繼續壓胸')>=0,
   gone:document.getElementById('acts').textContent.indexOf('暫停壓胸')<0}));
 ok('點下去真的暫停了', st.hold===true);
 ok('換成「繼續壓胸」', st.resume&&st.gone);
 await c.evaluate(()=>NET.act('resumeCpr')); await c.waitForTimeout(900);
 ok('可以接回去', await c.evaluate(()=>G.holdCpr===false&&G.cpr!==null));

 console.log('\n── item 10/11：插管後的面板 ──');
 /* 床頭是甲，器材由乙從急救車拿過去（引擎要求插管的人手上不能拿東西） */
 await walk(a,'head');
 await a.evaluate(()=>NET.act('answerEtt',{scope:'Video',blade:'3 號',tube:'7.5'}));
 for(let i=0;i<4&&!(await e.evaluate(()=>{const me=G.ch.find(x=>x.id===ME);return me&&me.hold==='ett';}));i++){
   await walk(e,'cart');
   await e.evaluate(()=>{const me=G.ch.find(x=>x.id===ME);if(me&&me.hold)NET.act('drop');});
   await e.waitForTimeout(500);
   await e.evaluate(()=>NET.act('grab',{k:'ett',scope:'Video',blade:'3 號',tube:'7.5'}));
   await till(e,()=>{const me=G.ch.find(x=>x.id===ME);return me&&me.hold==='ett';},14000,
     i===3?'備插管器材':'');}
 for(let i=0;i<3&&(await a.evaluate(()=>G.air==='BVM'));i++){
   await walk(e,'head');
   await a.evaluate(()=>NET.act('ett'));
   await till(a,()=>G.air!=='BVM',26000,i===2?'插管完成':'');}
 const t1=await a.evaluate(()=>document.getElementById('acts').textContent);
 ok('插完管出現「確認管路位置」', t1.indexOf('確認管路位置')>=0||t1.indexOf('EtCO')>=0, t1.slice(0,60).replace(/\s+/g,' '));
 await a.evaluate(()=>NET.act('confirmTube'));
 await till(a,()=>{const me=G.ch.find(x=>x.id===ME);return me&&me.tubeSeen===1;},20000,'看完波形');
 await a.waitForTimeout(800);
 const air=await a.evaluate(()=>G.air);
 const t2=await a.evaluate(()=>document.getElementById('acts').textContent);
 ok('確認完可以宣告', t2.indexOf('管路位置正確')>=0, 'air='+air);
 await a.evaluate(()=>{const bs=[...document.querySelectorAll('#acts button')];
   const t=bs.find(x=>x.textContent.indexOf('管路位置正確')>=0); if(t)t.click();});
 await a.waitForTimeout(1500);
 const t3=await a.evaluate(()=>document.getElementById('acts').textContent);
 ok('點「管路位置正確」有反應（airCalled 被設定）',
   await a.evaluate(()=>G.airCalled==='ok'), await a.evaluate(()=>String(G.airCalled)));
 const rec3=await a.evaluate(()=>{const me=G.ch.find(x=>x.id===ME);return me&&me.recent?me.recent.slice():[];});
 ok('「位置不對，拔管重插」不見了（面板）', t3.indexOf('位置不對')<0);
 ok('「管路位置不對，我拔掉了」也從回報清單收起來', rec3.every(t=>t.indexOf('管路位置')<0), JSON.stringify(rec3));
 ok('改成出現紅色「拔掉後重插」', t3.indexOf('拔掉後重插')>=0);
 const co2n=await a.evaluate(()=>{const el=document.getElementById('vCo');return el?el.textContent.trim():null;});
 ok('EtCO₂ 有數字（跟著波形，不是佔位符）', /^[0-9]+$/.test(String(co2n||'').trim()), String(co2n));
 await a.screenshot({path:'v43-tube.png'});

 console.log('\n── item 3：點滴袋標記 ──');
 const bag1=await host.evaluate(()=>({drip:G.dripNow}));
 ok('主畫面知道現在掛的是 N/S', bag1.drip==='ns', String(bag1.drip));
 for(let i=0;i<4&&!(await e.evaluate(()=>G.iv));i++){
   await walk(e,'cart'); await e.evaluate(()=>NET.act('grab',{k:'cath'})); await e.waitForTimeout(600);
   await walk(e,'bedR'); await e.evaluate(()=>NET.act('iv'));
   await till(e,()=>{const me=G.ch.find(x=>x.id===ME);return me&&!me.busy;},20000,'上針');}
 await e.evaluate(()=>NET.act('fixIv'));
 await till(e,()=>G.ivFixed===true,20000,'固定輸液');
 await walk(e,'cart'); await e.evaluate(()=>NET.act('draw',{k:'prbc'}));
 await till(e,()=>{const me=G.ch.find(x=>x.id===ME);return me&&me.hold==='prbc';},20000,'抽 pRBC');
 for(let i=0;i<4&&!(await host.evaluate(()=>G.dripNow==='prbc'));i++){
   await walk(e,'bedR'); await e.evaluate(()=>NET.act('give'));
   await till(host,()=>G.dripNow==='prbc',8000,i===3?'掛上 pRBC':'');}
 ok('掛 pRBC 之後畫面的點滴標記換成 prbc（袋子轉紅）',
   await host.evaluate(()=>G.dripNow==='prbc'), await host.evaluate(()=>String(G.dripNow)));
 await host.screenshot({path:'v43-drip.png'});

 console.log('\n── item 12：畫面上沒有「已插管·已確認位置」 ──');
 const hostTxt=await host.evaluate(()=>document.body.innerText);
 ok('主畫面沒有那行標註', hostTxt.indexOf('已確認位置')<0);

 console.log('\n── item 13 / 5 / 6 / 7：報表 ──');
 const alive=await tc.evaluate(()=>({over:G.over,rosc:G.rosc,t:Math.round(G.t)}));
 console.log('   （演練狀態：t='+alive.t+'s　rosc='+alive.rosc+'　over='+alive.over+'）');
 await tc.evaluate(()=>NET.send({t:'stop'})); await tc.waitForTimeout(4500);
 const sheetTeach=await tc.evaluate(()=>{const s=document.getElementById('sheet');
   return {on:s.classList.contains('on'),txt:s.textContent,
     top:!!document.getElementById('shReplayTop'),csv:!!document.getElementById('shCsv'),
     copy:!!document.getElementById('shCopy')};});
 ok('教師端報表打開了', sheetTeach.on);
 ok('最上方有「重播這一場」', sheetTeach.top);
 ok('有 CSV 下載', sheetTeach.csv);
 ok('報表有「紀錄品質（學員寫的 vs 實際發生的）」', sheetTeach.txt.indexOf('紀錄品質')>=0);
 await tc.screenshot({path:'v43-report.png',fullPage:false});
 const sheetStu=await c.evaluate(()=>{const s=document.getElementById('sheet');
   return {on:s.classList.contains('on'),copy:!!document.getElementById('shCopy'),
     dl:!!document.getElementById('shDl'),csv:!!document.getElementById('shCsv'),
     rp:!!document.getElementById('shReplay')||!!document.getElementById('shReplayTop'),
     close:!!document.getElementById('shClose')};});
 ok('學員端只剩「關閉」', sheetStu.on&&sheetStu.close&&!sheetStu.copy&&!sheetStu.dl&&!sheetStu.csv&&!sheetStu.rp,
   JSON.stringify(sheetStu));

 console.log('\n── item 8：泳道圖 hover ──');
 const swim=await tc.evaluate(()=>{const cv=document.getElementById('swim');
   if(!cv)return null;const r=cv.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,y:r.y};});
 ok('報表裡有泳道圖', !!swim);
 if(swim){
   let tip=null;
   const hits=await tc.evaluate(()=>(typeof SWIMHIT!=='undefined'?SWIMHIT:[]).length);
   const spot=await tc.evaluate(()=>{const H=(typeof SWIMHIT!=='undefined'?SWIMHIT:[]);
     if(!H.length)return null;
     let best=H[0];for(const h of H)if((h.y1-h.y0)>(best.y1-best.y0))best=h;
     return {x:(best.x0+best.x1)/2, y:(best.y0+best.y1)/2};});
   if(spot){
     await tc.mouse.move(swim.x+spot.x,swim.y+spot.y); await tc.waitForTimeout(500);
     tip=await tc.evaluate(()=>{const t=document.getElementById('swimtip');
       return t?{on:t.classList.contains('on')||t.style.display!=='none',txt:t.textContent}:null;});
   }
   ok('游標移過去有跳出細節', !!(tip&&tip.txt&&tip.txt.length>1),
     'hit 區塊 '+hits+' 個　'+(tip?JSON.stringify(tip.txt).slice(0,70):'沒有可命中的位置'));
 }

 console.log('\n── item 9：重新開始要回到輸入畫面 ──');
 await tc.evaluate(()=>NET.send({t:'newgame'})); await tc.waitForTimeout(3000);
 const backToGate=await c.evaluate(()=>{const g=document.getElementById('gate');
   return {on:g&&g.classList.contains('on'),visit:document.getElementById('visits')?
     [...document.querySelectorAll('#visits button')].some(x=>x.classList.contains('on')):null};});
 ok('學員被送回輸入畫面', backToGate.on===true, JSON.stringify(backToGate));
 ok('「第幾次參與」是空的，要重填', backToGate.visit===false);
 await c.screenshot({path:'v43-gate.png'});

 console.log('\nERRORS:',errs.length?errs.join(' | '):'(none)');
 const bad=R.filter(x=>!x).length;
 console.log('\n'+(bad?('✘ '+bad+' 項未通過'):'✔ 端到端全部通過')+'（共 '+R.length+' 項）');
 await b.close();
 process.exit(bad?1:0);
})();
