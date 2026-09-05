/* ══════════════════════════════════════════════════════════════
   極簡 QR Code 產生器（byte mode，版本 1–10，糾錯等級 M）
   只做這個專案需要的部分：把一段網址編成布林方陣。
   回傳 {n, get(x,y)}；n 是邊長（含格數）。
   ══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── GF(256) ── */
const EXP=new Uint8Array(512), LOG=new Uint8Array(256);
(function(){let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11D;}
 for(let i=255;i<512;i++)EXP[i]=EXP[i-255];})();
const mul=(a,b)=>(a===0||b===0)?0:EXP[LOG[a]+LOG[b]];
function rsPoly(n){let p=[1];
  for(let i=0;i<n;i++){const q=[...p,0];
    for(let j=0;j<p.length;j++)q[j+1]^=mul(p[j],EXP[i]);p=q;}
  return p;}
function rsEncode(data,n){
  const gen=rsPoly(n), res=new Uint8Array(data.length+n);
  res.set(data);
  for(let i=0;i<data.length;i++){
    const f=res[i];if(f===0)continue;
    for(let j=1;j<gen.length;j++)res[i+j]^=mul(gen[j],f);}
  return res.slice(data.length);
}

/* ── 版本表（等級 M）：[總碼字, ec每塊, 第1組塊數, 第1組資料碼字, 第2組塊數, 第2組資料碼字] ── */
const VER={
 1:[26,10,1,16,0,0],      2:[44,16,1,28,0,0],      3:[70,26,1,44,0,0],
 4:[100,18,2,32,0,0],     5:[134,24,2,43,0,0],     6:[172,16,4,27,0,0],
 7:[196,18,4,31,0,0],     8:[242,22,2,38,2,39],    9:[292,22,3,36,2,37],
 10:[346,26,4,43,1,44],   11:[404,30,1,50,4,51],   12:[466,22,6,36,2,37],
 13:[532,22,8,37,1,38],   14:[581,24,4,40,5,41],   15:[655,24,5,41,5,42]
};
const ALIGN={1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],
 7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50],11:[6,30,54],
 12:[6,32,58],13:[6,34,62],14:[6,26,46,66],15:[6,26,48,70]};

function capacity(v){const t=VER[v];return (t[2]*t[3]+t[4]*t[5]);}   /* 資料碼字數 */

/* ── 位元串流 ── */
function Bits(){this.b=[];}
Bits.prototype.push=function(val,len){for(let i=len-1;i>=0;i--)this.b.push((val>>i)&1);};

/* ── 主流程 ── */
function encode(text){
  const bytes=new TextEncoder().encode(text);
  let v=0;
  for(let i=1;i<=15;i++){
    const cw=capacity(i);
    const cci=(i<10)?8:16;
    if(4+cci+bytes.length*8<=cw*8){v=i;break;}
  }
  if(!v)throw new Error('QR：字串太長');
  const t=VER[v], ecLen=t[1], g1=t[2], d1=t[3], g2=t[4], d2=t[5];
  const total=capacity(v);
  const bs=new Bits();
  bs.push(4,4);                                   /* byte mode */
  bs.push(bytes.length,(v<10)?8:16);
  for(const b of bytes)bs.push(b,8);
  const cap=total*8;
  for(let i=0;i<4&&bs.b.length<cap;i++)bs.b.push(0);
  while(bs.b.length%8)bs.b.push(0);
  const data=[];
  for(let i=0;i<bs.b.length;i+=8){let x=0;for(let j=0;j<8;j++)x=(x<<1)|bs.b[i+j];data.push(x);}
  const PAD=[0xEC,0x11];let pi=0;
  while(data.length<total)data.push(PAD[pi++%2]);

  /* 分塊 + RS */
  const blocks=[],ecs=[];let off=0;
  for(let i=0;i<g1;i++){const d=Uint8Array.from(data.slice(off,off+d1));off+=d1;
    blocks.push(d);ecs.push(rsEncode(d,ecLen));}
  for(let i=0;i<g2;i++){const d=Uint8Array.from(data.slice(off,off+d2));off+=d2;
    blocks.push(d);ecs.push(rsEncode(d,ecLen));}
  /* 交錯 */
  const out=[];
  const maxD=Math.max(d1,d2||0);
  for(let i=0;i<maxD;i++)for(const b of blocks)if(i<b.length)out.push(b[i]);
  for(let i=0;i<ecLen;i++)for(const e of ecs)out.push(e[i]);

  /* 畫矩陣 */
  const n=17+4*v;
  const M=[],RES=[];
  for(let y=0;y<n;y++){M.push(new Int8Array(n).fill(-1));RES.push(new Uint8Array(n));}
  const setF=(x,y,val)=>{if(x<0||y<0||x>=n||y>=n)return;M[y][x]=val;RES[y][x]=1;};
  /* 定位圖案 */
  const finder=(ox,oy)=>{
    for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++){
      const x=ox+dx,y=oy+dy;
      if(x<0||y<0||x>=n||y>=n)continue;
      const inb=dx>=0&&dx<=6&&dy>=0&&dy<=6;
      let on=0;
      if(inb){const e=(dx===0||dx===6||dy===0||dy===6);
        const c=(dx>=2&&dx<=4&&dy>=2&&dy<=4);on=(e||c)?1:0;}
      setF(x,y,on);}};
  finder(0,0);finder(n-7,0);finder(0,n-7);
  /* 對齊圖案 */
  const al=ALIGN[v];
  for(const ay of al)for(const ax of al){
    if((ax<=8&&ay<=8)||(ax>=n-9&&ay<=8)||(ax<=8&&ay>=n-9))continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const on=(Math.max(Math.abs(dx),Math.abs(dy))!==1)?1:0;
      setF(ax+dx,ay+dy,on);}}
  /* 時序圖案 */
  for(let i=8;i<n-8;i++){setF(i,6,(i%2===0)?1:0);setF(6,i,(i%2===0)?1:0);}
  /* 深色模組 */
  setF(8,n-8,1);
  /* 格式資訊區先佔位 */
  for(let i=0;i<9;i++){if(M[8][i]<0)setF(i,8,0);if(M[i][8]<0)setF(8,i,0);}
  for(let i=0;i<8;i++){setF(n-1-i,8,0);setF(8,n-1-i,0);}
  /* 版本資訊區（v>=7） */
  if(v>=7)for(let i=0;i<6;i++)for(let j=0;j<3;j++){setF(n-11+j,i,0);setF(i,n-11+j,0);}

  /* 放資料 */
  let bit=0,dir=-1,col=n-1;
  const bits=[];for(const b of out)for(let i=7;i>=0;i--)bits.push((b>>i)&1);
  const raw=[];
  for(let y=0;y<n;y++)raw.push(new Int8Array(n).fill(-1));
  while(col>0){
    if(col===6)col--;
    for(let r=0;r<n;r++){
      const y=(dir===-1)?(n-1-r):r;
      for(let c=0;c<2;c++){
        const x=col-c;
        if(RES[y][x])continue;
        raw[y][x]=bit<bits.length?bits[bit++]:0;
      }
    }
    dir=-dir;col-=2;
  }

  /* 遮罩：八種都試，取懲罰分最低 */
  const maskFn=[
    (x,y)=>((x+y)%2===0),(x,y)=>(y%2===0),(x,y)=>(x%3===0),(x,y)=>((x+y)%3===0),
    (x,y)=>((Math.floor(y/2)+Math.floor(x/3))%2===0),(x,y)=>(((x*y)%2)+((x*y)%3)===0),
    (x,y)=>((((x*y)%2)+((x*y)%3))%2===0),(x,y)=>((((x+y)%2)+((x*y)%3))%2===0)];
  const EC_M=0;    /* 等級 M 的格式位元前綴 = 00 */
  const FMT_POLY=0x537, FMT_MASK=0x5412;
  function fmtBits(maskIdx){
    const d=(EC_M<<3)|maskIdx;
    let x=d<<10;
    for(let i=14;i>=10;i--)if((x>>i)&1)x^=FMT_POLY<<(i-10);
    return ((d<<10)|x)^FMT_MASK;
  }
  function verBits(ver){
    let x=ver<<12;
    for(let i=17;i>=12;i--)if((x>>i)&1)x^=0x1F25<<(i-12);
    return (ver<<12)|x;
  }
  function build(maskIdx){
    const g=[];for(let y=0;y<n;y++)g.push(new Uint8Array(n));
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      if(RES[y][x])g[y][x]=M[y][x]===1?1:0;
      else{let b=raw[y][x]===1?1:0;if(maskFn[maskIdx](x,y))b^=1;g[y][x]=b;}}
    /* 格式資訊 */
    const f=fmtBits(maskIdx);
    const put=(x,y,b)=>{g[y][x]=b;};
    /* 第一份：位元 0–5 在第 8 欄由上往下，位元 9–14 在第 8 列由右往左 */
    for(let i=0;i<=5;i++)put(8,i,(f>>i)&1);
    put(8,7,(f>>6)&1);put(8,8,(f>>7)&1);put(7,8,(f>>8)&1);
    for(let i=9;i<=14;i++)put(14-i,8,(f>>i)&1);
    /* 第二份：位元 0–7 在第 8 列右端，位元 8–14 在第 8 欄下端 */
    for(let i=0;i<=7;i++)put(n-1-i,8,(f>>i)&1);
    for(let i=8;i<=14;i++)put(8,n-7+(i-8),(f>>i)&1);
    put(8,n-8,1);
    if(v>=7){const vb=verBits(v);
      for(let i=0;i<18;i++){const b=(vb>>i)&1;
        g[Math.floor(i/3)][n-11+(i%3)]=b;
        g[n-11+(i%3)][Math.floor(i/3)]=b;}}
    return g;
  }
  function penalty(g){
    let p=0;
    /* 規則1：同色連續 */
    for(let i=0;i<n;i++){
      for(const line of [g[i],Array.from({length:n},(_,k)=>g[k][i])]){
        let run=1;
        for(let j=1;j<n;j++){
          if(line[j]===line[j-1])run++;
          else{if(run>=5)p+=3+(run-5);run=1;}}
        if(run>=5)p+=3+(run-5);}}
    /* 規則2：2×2 同色 */
    for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
      const a=g[y][x];if(a===g[y][x+1]&&a===g[y+1][x]&&a===g[y+1][x+1])p+=3;}
    /* 規則3：特定樣式 */
    const pat=[1,0,1,1,1,0,1,0,0,0,0],pat2=[0,0,0,0,1,0,1,1,1,0,1];
    for(let y=0;y<n;y++)for(let x=0;x<=n-11;x++){
      let m1=true,m2=true;
      for(let k=0;k<11;k++){if(g[y][x+k]!==pat[k])m1=false;if(g[y][x+k]!==pat2[k])m2=false;}
      if(m1||m2)p+=40;}
    for(let x=0;x<n;x++)for(let y=0;y<=n-11;y++){
      let m1=true,m2=true;
      for(let k=0;k<11;k++){if(g[y+k][x]!==pat[k])m1=false;if(g[y+k][x]!==pat2[k])m2=false;}
      if(m1||m2)p+=40;}
    /* 規則4：黑色比例 */
    let dark=0;for(let y=0;y<n;y++)for(let x=0;x<n;x++)dark+=g[y][x];
    const pct=dark*100/(n*n);
    p+=Math.floor(Math.abs(pct-50)/5)*10;
    return p;
  }
  let best=null,bestP=Infinity;
  for(let mi=0;mi<8;mi++){const g=build(mi),pp=penalty(g);
    if(pp<bestP){bestP=pp;best=g;}}
  return {n,version:v,grid:best,get:(x,y)=>best[y][x]===1};
}

/* 畫成 SVG 字串（quiet zone 4 格） */
function svg(text,px,fg,bg){
  const q=encode(text), n=q.n, m=4, N=n+m*2;
  px=px||8;fg=fg||'#000';bg=bg||'#fff';
  let d='';
  for(let y=0;y<n;y++){let x=0;
    while(x<n){
      if(!q.get(x,y)){x++;continue;}
      let w=1;while(x+w<n&&q.get(x+w,y))w++;
      d+='M'+(x+m)+' '+(y+m)+'h'+w+'v1h-'+w+'z';
      x+=w;}}
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+N+' '+N+'" '
    +'width="'+(N*px)+'" height="'+(N*px)+'" shape-rendering="crispEdges">'
    +'<rect width="'+N+'" height="'+N+'" fill="'+bg+'"/>'
    +'<path d="'+d+'" fill="'+fg+'"/></svg>';
}

const API={encode,svg};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
else if(typeof window!=='undefined')window.QR=API;
})();
