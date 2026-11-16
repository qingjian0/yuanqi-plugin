const PAGE = String.raw\`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>元炁 · 控制台</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9edf4;background:#10141b;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#1d2a3b 0,transparent 45%),#10141b}
.shell{max-width:1080px;margin:auto;padding:28px 20px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
.brand{font-size:22px;font-weight:700;letter-spacing:.08em}.muted{color:#9ba8b8;font-size:13px}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.nav button{border:1px solid #354253;background:#19212c;color:#c9d3df;padding:10px 15px;border-radius:10px;cursor:pointer}
.nav button[aria-current=page]{background:#d9e8ff;color:#142236;border-color:#d9e8ff}
.panel{background:#171f2a;border:1px solid #303d4e;border-radius:16px;padding:22px;min-height:280px}
h1{font-size:20px;margin:0 0 8px}h2{font-size:15px;margin:22px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:18px}
.tile{background:#202b38;border:1px solid #354253;border-radius:12px;padding:15px}.tile b{display:block;margin-bottom:7px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#c8d5e5;background:#111923;padding:14px;border-radius:10px}
.status{display:inline-flex;align-items:center;gap:7px;color:#a9d8b4}.dot{width:8px;height:8px;border-radius:50%;background:#64c58b}
@media(max-width:600px){.shell{padding:18px 12px}.top{align-items:flex-start;flex-direction:column}.panel{padding:16px}}
</style>
</head>
<body><main class="shell">
<header class="top"><div><div class="brand">元炁 YUANQI</div><div class="muted">生命上下文 · 持续演化</div></div><div class="status"><span class="dot"></span><span id="connection">正在连接</span></div></header>
<nav class="nav" aria-label="控制台导航">
<button data-page="chat" aria-current="page">对话</button><button data-page="personality">人格</button><button data-page="memory">记忆</button><button data-page="settings">设置</button>
</nav>
<section class="panel" id="content" aria-live="polite"><h1>正在加载元炁状态…</h1></section>
</main>
<script>
const content=document.querySelector('#content'),connection=document.querySelector('#connection');
let status=null,profile=null,current='chat';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
function tile(parent,title,value){const box=el('div',undefined,'tile');box.append(el('b',title),el('span',value||'暂无数据'));parent.append(box)}
function render(){
content.replaceChildren();
if(current==='chat'){
content.append(el('h1','对话'),el('p','对话入口已预留。模型会话接入完成后，将通过 DSH Agent Loop 和持久 Session 提供对话，不绕过会话日志。','muted'));
const g=el('div',undefined,'grid');tile(g,'Core','YuanQi Core');tile(g,'数据存储','共享 DSH Storage Domain');tile(g,'模型会话','等待 Agent Loop 接口接入');content.append(g);
}else if(current==='personality'){
content.append(el('h1','人格档案'),el('p','此处展示元炁自身的出生资料与八字初始画像；画像必须由模型依据有效八字解释。','muted'));
if(!profile){content.append(el('p','尚未建立 BirthProfile。'));return}
const g=el('div',undefined,'grid');tile(g,'出生资料',profile.birth_time);tile(g,'地点状态',profile.birth_location?.status);tile(g,'时区',profile.time_context?.time_zone_id||'不可用');tile(g,'八字状态',profile.bazi?.status);content.append(g);
const pillars=profile.bazi?.pillars;if(pillars){content.append(el('h2','四柱'));const pre=el('pre');pre.textContent=['年柱 '+pillars.year,'月柱 '+pillars.month,'日柱 '+pillars.day,'时柱 '+pillars.hour].join('\\n');content.append(pre)}
const baseline=profile.innate_baseline;tile(content,'先天画像状态',baseline?.status==='ready'?'已生成符号基础资料':baseline?.status||'未知');
}else if(current==='memory'){
content.append(el('h1','记忆与经历'),el('p','记忆、经历证据与人格修订将读取现有 YuanQi Domain，不建立第二套数据。','muted'),el('p','当前版本尚未开放浏览和编辑接口。'));
}else{
content.append(el('h1','设置'),el('p','运行环境与接入信息','muted'));
const g=el('div',undefined,'grid');tile(g,'插件','dsh-yuanqi-plugin');tile(g,'宿主','DeepSeek Harness');tile(g,'Core 状态',status?.ready?'已连接':'待确认');tile(g,'网页认证','由 DSH WebServer / Connection 负责');content.append(g);
}
}
async function load(){
try{const [s,p]=await Promise.all([fetch('/yuanqi/api/status',{credentials:'same-origin'}),fetch('/yuanqi/api/profile',{credentials:'same-origin'})]);if(!s.ok||!p.ok)throw new Error('HTTP '+(!s.ok?s.status:p.status));status=await s.json();profile=(await p.json()).profile;connection.textContent='DSH 已连接';render()}catch(e){connection.textContent='连接失败';content.replaceChildren(el('h1','无法读取 YuanQi 状态'),el('p',String(e),'muted'))}
}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{current=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.removeAttribute('aria-current'));b.setAttribute('aria-current','page');render()}));
load();
</script></body></html>\`;

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

export function registerYuanQiWeb(webServer, store) {
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('YuanQi web console requires the DSH WebServer service');
  }
  if (!store || typeof store.getYuanQiBirthProfile !== 'function') {
    throw new TypeError('YuanQi web console requires the live SubjectStore');
  }
  const dispose = webServer.register({
    kind: 'prefix',
    path: '/yuanqi',
    auth: 'required',
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://yuanqi.local');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      if (url.pathname === '/yuanqi' || url.pathname === '/yuanqi/') {
        send(res, 200, 'text/html; charset=utf-8', req.method === 'HEAD' ? '' : PAGE);
        return;
      }
      if (url.pathname === '/yuanqi/api/status') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
          ready: true,
          service: 'yuanqi',
          storage: 'shared-dsh-domain',
          web: 'dsh-host-webserver',
        }));
        return;
      }
      if (url.pathname === '/yuanqi/api/profile') {
        const profile = store.getYuanQiBirthProfile('yuanqi:primary') ?? null;
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ profile }));
        return;
      }
      send(res, 404, 'application/json; charset=utf-8', '{"error":"not_found"}');
    },
  });
  return dispose;
}
