/* ══════════════════════════════════════════════════════════════
   極簡 SMTP 寄信（零外部套件，只用 Node 內建的 tls / net）
   只做這個專案需要的：把一個 JSON 附件寄到自己的信箱。

   設定四個環境變數就會啟用，沒設就自動關閉（不影響其他功能）：
     MAIL_TO    收件者，例如 you@hospital.org.tw
     MAIL_USER  寄件帳號，例如 you@gmail.com
     MAIL_PASS  應用程式密碼（不是你的登入密碼，見 README）
     MAIL_HOST  可省略，預設 smtp.gmail.com:465

   Gmail 要先開兩步驟驗證，再到「應用程式密碼」產生一組 16 碼。
   ══════════════════════════════════════════════════════════════ */
'use strict';
const tls=require('tls');

const HOST=process.env.MAIL_HOST||'smtp.gmail.com';
const PORT=Number(process.env.MAIL_PORT||465);
const USER=process.env.MAIL_USER||'';
const PASS=process.env.MAIL_PASS||'';
const TO  =process.env.MAIL_TO  ||'';
const FROMNAME=process.env.MAIL_FROM_NAME||'IHCA 模擬器';

const enabled=()=>!!(USER&&PASS&&TO);

/* 把長字串折成 76 字元一行的 base64（RFC 2045） */
function b64lines(buf){
  const s=Buffer.from(buf).toString('base64');
  let out='';
  for(let i=0;i<s.length;i+=76)out+=s.slice(i,i+76)+'\r\n';
  return out;
}
/* 中文標題要用 RFC 2047 編碼，否則收到會是亂碼 */
const encHeader=t=>'=?UTF-8?B?'+Buffer.from(t,'utf8').toString('base64')+'?=';

function buildMessage(subject,body,filename,content){
  const bd='==IHCA_'+Date.now()+'==';
  return [
    'From: '+encHeader(FROMNAME)+' <'+USER+'>',
    'To: '+TO,
    'Subject: '+encHeader(subject),
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="'+bd+'"',
    '',
    '--'+bd,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(Buffer.from(body,'utf8')),
    '--'+bd,
    'Content-Type: application/json; charset=UTF-8; name="'+filename+'"',
    'Content-Disposition: attachment; filename="'+filename+'"',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(Buffer.from(content,'utf8')),
    '--'+bd+'--',
    ''
  ].join('\r\n');
}

/* SMTP 是一問一答的協定：送一行、等一個三位數狀態碼。
   2xx / 3xx 是好的，4xx / 5xx 是錯誤。 */
function send(subject,body,filename,content,cb){
  cb=cb||function(){};
  if(!enabled())return cb(new Error('未設定寄信環境變數'));

  const msg=buildMessage(subject,body,filename,content);
  /* 內文裡單獨一行的句點會被當成結束符號，要加一個點跳脫 */
  const safe=msg.replace(/\r\n\./g,'\r\n..');

  const steps=[
    {expect:220, send:null},
    {expect:250, send:'EHLO ihca'},
    {expect:334, send:'AUTH LOGIN'},
    {expect:334, send:Buffer.from(USER,'utf8').toString('base64')},
    {expect:235, send:Buffer.from(PASS,'utf8').toString('base64')},
    {expect:250, send:'MAIL FROM:<'+USER+'>'},
    {expect:250, send:'RCPT TO:<'+TO+'>'},
    {expect:354, send:'DATA'},
    {expect:250, send:safe+'\r\n.'},
    {expect:221, send:'QUIT'}
  ];

  let i=0, buf='', done=false;
  const finish=err=>{if(done)return;done=true;try{sock.end();}catch(e){}cb(err||null);};

  const sock=tls.connect({host:HOST,port:PORT,servername:HOST},()=>{});
  sock.setTimeout(20000);
  sock.on('timeout',()=>finish(new Error('SMTP 逾時')));
  sock.on('error',e=>finish(e));

  sock.on('data',chunk=>{
    buf+=chunk.toString('utf8');
    /* 多行回應的中間行是「250-」，最後一行才是「250 」（空格） */
    let m;
    while((m=/^(\d{3})([ -])(.*)\r\n/m.exec(buf))){
      const code=Number(m[1]), more=(m[2]==='-');
      buf=buf.slice(m.index+m[0].length);
      if(more)continue;
      const st=steps[i];
      if(!st)return;
      if(code!==st.expect)
        return finish(new Error('SMTP '+code+'：'+m[3]+'（在第 '+i+' 步）'));
      i++;
      const nx=steps[i];
      if(!nx)return finish(null);
      if(nx.send!==null){try{sock.write(nx.send+'\r\n');}catch(e){return finish(e);}}
    }
  });
}

module.exports={enabled,send,TO,HOST,PORT};
