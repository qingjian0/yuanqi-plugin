import { randomUUID } from 'node:crypto';
import { readJsonBody, normalizeChatInput, hasValidBearer, runYuanQiChat, modelGatewayConfig } from './model.js';

const PAGE = String.raw`<!doctype html>
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
let status=null,profile=null,worldline=null,evidence=[],current='chat';
let chatToken=sessionStorage.getItem('yuanqi.chat.token')||'';
let chatMessages=(()=>{try{return JSON.parse(sessionStorage.getItem('yuanqi.chat.messages')||'[]').filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-80)}catch{return []}})();
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
function tile(parent,title,value){const box=el('div',undefined,'tile');box.append(el('b',title),el('span',value||'暂无数据'));parent.append(box)}
function render(){
content.replaceChildren();
if(current==='chat'){
content.append(el('h1','对话'),el('p','通过 DSH Agent Loop 创建持久 Session；此入口不绕过会话日志。','muted'));
const transcript=el('div',undefined,'grid');transcript.style.gridTemplateColumns='1fr';for(const item of chatMessages)transcript.append(el('div',(item.role==='user'?'你：':'元炁：')+item.content,'tile'));content.append(transcript);
const reset=el('button','新对话');reset.type='button';reset.style.cssText='margin-top:12px;padding:8px 12px;border:1px solid #354253;border-radius:9px;background:#19212c;color:#c9d3df';reset.addEventListener('click',()=>{chatToken='';chatMessages=[];sessionStorage.removeItem('yuanqi.chat.token');sessionStorage.removeItem('yuanqi.chat.messages');render()});content.append(reset);
const form=el('form');form.style.display='flex';form.style.gap='8px';form.style.marginTop='18px';
const input=el('input');input.type='text';input.placeholder='输入消息…';input.required=true;input.maxLength=12000;input.style.cssText='flex:1;min-width:0;padding:12px;border-radius:10px;border:1px solid #354253;background:#111923;color:#e9edf4';
const submit=el('button','发送');submit.type='submit';submit.style.cssText='padding:12px 18px;border:0;border-radius:10px;background:#d9e8ff;color:#142236;font-weight:600';form.append(input,submit);content.append(form);
form.addEventListener('submit',async event=>{event.preventDefault();const text=input.value.trim();if(!text)return;input.disabled=true;submit.disabled=true;chatMessages.push({role:'user',content:text});sessionStorage.setItem('yuanqi.chat.messages',JSON.stringify(chatMessages.slice(-80)));transcript.append(el('div','你：'+text,'tile'));input.value='';try{const response=await fetch('/yuanqi/api/chat',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,chat_token:chatToken||undefined})});const data=await response.json();if(!response.ok)throw new Error(data.message||('HTTP '+response.status));chatToken=data.chat_token;sessionStorage.setItem('yuanqi.chat.token',chatToken);chatMessages.push({role:'assistant',content:data.text});sessionStorage.setItem('yuanqi.chat.messages',JSON.stringify(chatMessages.slice(-80)));transcript.append(el('div','元炁：'+data.text,'tile'))}catch(error){transcript.append(el('div','请求失败：'+String(error),'tile'))}finally{input.disabled=false;submit.disabled=false;input.focus()}});
}else if(current==='personality'){
content.append(el('h1','人格档案'),el('p','此处展示元炁自身的出生资料与八字初始画像；画像必须由模型依据有效八字解释。','muted'));
if(!profile){content.append(el('p','尚未建立 BirthProfile。'));return}
const g=el('div',undefined,'grid');tile(g,'出生资料',profile.birth_time);tile(g,'地点状态',profile.birth_location?.status);tile(g,'时区',profile.time_context?.time_zone_id||'不可用');tile(g,'八字状态',profile.bazi?.status);content.append(g);
const pillars=profile.bazi?.pillars;if(pillars){content.append(el('h2','四柱'));const pre=el('pre');pre.textContent=['年柱 '+pillars.year,'月柱 '+pillars.month,'日柱 '+pillars.day,'时柱 '+pillars.hour].join('\n');content.append(pre)}
const baseline=profile.innate_baseline;tile(content,'先天画像状态',baseline?.status==='ready'?'已生成符号基础资料':baseline?.status||'未知');
const centers=worldline?.self_model?.centers;if(centers){content.append(el('h2','当前 SelfModel'));for(const [name,value] of Object.entries(centers)){const card=el('div',undefined,'tile');card.append(el('b',name),el('span',value.epistemic_status||'hypothesis'));const pre=el('pre');pre.textContent=JSON.stringify(value.content??{},null,2);card.append(pre);content.append(card)}}
}else if(current==='memory'){
content.append(el('h1','记忆与经历'),el('p','读取现有 Worldline Evidence Ledger；此页面暂不提供删除或自动修订。','muted'));
if(!worldline){content.append(el('p','尚未建立主世界线。'));return}
content.append(el('p','当前世界线：'+worldline.worldline?.worldline_id+' · 快照版本 '+worldline.head?.current_snapshot_version));
if(evidence.length===0){content.append(el('p','暂时没有已关联的经历证据。'));return}
for(const item of evidence){const card=el('div',undefined,'tile');card.append(el('b',item.record?.evidence_type||'经历证据'),el('span','状态：'+item.status+' · '+(item.record?.captured_at||'')));const pre=el('pre');pre.textContent=JSON.stringify(item.record?.content??{},null,2);card.append(pre);content.append(card)}
}else{
content.append(el('h1','设置'),el('p','运行环境与接入信息','muted'));
const g=el('div',undefined,'grid');tile(g,'插件','dsh-yuanqi-plugin');tile(g,'宿主','DeepSeek Harness');tile(g,'Core 状态',status?.ready?'已连接':'待确认');tile(g,'模型提供方',status?.provider||'未配置');tile(g,'默认模型',status?.model||'未配置');tile(g,'OpenAI API',status?.api_enabled&&status?.model_ready?'已启用':status?.api_enabled?'缺少模型配置':'需配置 API Key');tile(g,'API Base URL',location.origin+'/yuanqi/v1');tile(g,'API Key 配置','宿主环境变量 YUANQI_API_KEY');tile(g,'网页认证','由 DSH WebServer / Connection 负责');content.append(g);
}
}
async function load(){
try{const [s,p,w,e]=await Promise.all([fetch('/yuanqi/api/status',{credentials:'same-origin'}),fetch('/yuanqi/api/profile',{credentials:'same-origin'}),fetch('/yuanqi/api/worldline',{credentials:'same-origin'}),fetch('/yuanqi/api/evidence',{credentials:'same-origin'})]);if(!s.ok||!p.ok||!w.ok||!e.ok)throw new Error('HTTP '+[s,p,w,e].find(x=>!x.ok).status);status=await s.json();profile=(await p.json()).profile;worldline=(await w.json()).worldline;evidence=(await e.json()).items||[];connection.textContent='DSH 已连接';render()}catch(e){connection.textContent='连接失败';content.replaceChildren(el('h1','无法读取 YuanQi 状态'),el('p',String(e),'muted'))}
}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{current=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.removeAttribute('aria-current'));b.setAttribute('aria-current','page');render()}));
load();
</script></body></html>`;

function assertRequestNotAborted(signal) {
  if (!signal.aborted) return;
  const error = new Error('The HTTP client disconnected before the request completed');
  error.status = 499;
  error.code = 'request_aborted';
  throw error;
}

function requestAbortScope(req, res, activeRequests) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new Error('HTTP client disconnected'));
  };
  const onResponseClose = () => { if (!res.writableEnded) abort(); };
  req.on?.('aborted', abort);
  res.on?.('close', onResponseClose);
  if (req.aborted || res.destroyed) abort();
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  let disposed = false;
  const scope = {
    signal: controller.signal,
    done,
    abort,
    dispose() {
      if (disposed) return;
      disposed = true;
      req.off?.('aborted', abort);
      res.off?.('close', onResponseClose);
      activeRequests?.delete(scope);
      resolveDone();
    },
  };
  activeRequests?.add(scope);
  return scope;
}

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

export function registerYuanQiWeb(webServer, store, runtime = {}) {
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('YuanQi web console requires the DSH WebServer service');
  }
  if (!store || typeof store.getYuanQiBirthProfile !== 'function') {
    throw new TypeError('YuanQi web console requires the live SubjectStore');
  }
  const chatSessions = new Map();
  const activeRequests = new Set();
  const activeChats = new Set();
  let closing = false;
  async function runTrackedChat(options) {
    if (closing || options.signal?.aborted) {
      const error = new Error('YuanQi Web Gateway is shutting down');
      error.status = 499;
      error.code = 'request_aborted';
      throw error;
    }
    const task = runYuanQiChat(options);
    activeChats.add(task);
    try { return await task; }
    finally { activeChats.delete(task); }
  }
  const chatTokenTtlMs = 12 * 60 * 60 * 1000;
  const maxChatSessions = 256;
  const dispose = webServer.register({
    kind: 'prefix',
    path: '/yuanqi',
    auth: request => request.url.pathname.startsWith('/yuanqi/v1/') ? 'anonymous' : 'required',
    handler(req, res, peer) {
      const url = new URL(req.url ?? '/', 'http://yuanqi.local');
      const isPostApi = req.method === 'POST' && (
        url.pathname === '/yuanqi/api/chat' || url.pathname === '/yuanqi/v1/chat/completions'
      );
      if (req.method !== 'GET' && req.method !== 'HEAD' && !isPostApi) {
        res.writeHead(405, { allow: 'GET, HEAD, POST', 'cache-control': 'no-store' });
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
          ...modelGatewayConfig(),
        }));
        return;
      }
      if (url.pathname === '/yuanqi/api/profile') {
        const profile = store.getYuanQiBirthProfile('yuanqi:primary') ?? null;
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ profile }));
        return;
      }
      if (url.pathname === '/yuanqi/api/worldline') {
        const id = 'worldline:main';
        const line = runtime.worldlines?.getWorldline(id) ?? null;
        const head = runtime.worldlines?.getHead(id) ?? null;
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ worldline: line ? { worldline: line, head: head ? { current_snapshot_version: head.current_snapshot_version, current_evidence_refs: head.current_evidence_refs } : null, self_model: runtime.worldlines?.getSelfModel(id) ?? null } : null }));
        return;
      }
      if (url.pathname === '/yuanqi/api/evidence') {
        const id = 'worldline:main';
        const head = runtime.worldlines?.getHead(id);
        const refs = new Set([...(head?.current_evidence_refs ?? []), ...Object.values(head?.current_state_payload?.self_model?.centers ?? {}).flatMap(center => center?.evidence_refs ?? [])]);
        const items = [...refs].map(evidence_id => runtime.worldlines?.getEvidenceRecord({ evidence_id, worldline_id: id })).filter(Boolean);
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ items }));
        return;
      }
      if (url.pathname === '/yuanqi/api/chat' && req.method === 'POST') {
        const requestScope = requestAbortScope(req, res, activeRequests);
        return (async () => {
          try {
            const body = await readJsonBody(req, 128 * 1024, requestScope.signal);
            assertRequestNotAborted(requestScope.signal);
            const input = normalizeChatInput(body);
            const token = body.chat_token;
            const peerId = peer?.id;
            if (!peerId) throw Object.assign(new Error('Authenticated DSH Peer is required'), { status: 401, code: 'peer_required' });
            const previous = token === undefined ? undefined : chatSessions.get(token);
            if (token !== undefined && (typeof token !== 'string' || !/^[a-f0-9-]{36}$/i.test(token) || !previous || previous.peerId !== peerId || previous.expiresAt <= Date.now())) {
              if (typeof token === 'string') chatSessions.delete(token);
              throw Object.assign(new Error('chat_token is invalid, expired or belongs to another Peer'), { status: 404, code: 'invalid_chat_token' });
            }
            const result = await runTrackedChat({ ctx: runtime.ctx, agents: runtime.agents, input, sessionId: previous?.sessionId, signal: requestScope.signal });
            const chatToken = token || randomUUID();
            if (!token && chatSessions.size >= maxChatSessions) chatSessions.delete(chatSessions.keys().next().value);
            chatSessions.set(chatToken, { sessionId: result.session_id, peerId, expiresAt: Date.now() + chatTokenTtlMs });
            send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ text: result.text, model: result.model, chat_token: chatToken }));
          } catch (error) {
            if (res.destroyed || res.writableEnded) return;
            if (requestScope.signal.aborted) {
              send(res, 499, 'application/json; charset=utf-8', JSON.stringify({ error: 'request_aborted', message: 'The HTTP client disconnected before the request completed' }));
              return;
            }
            send(res, error.status || 500, 'application/json; charset=utf-8', JSON.stringify({ error: error.code || 'internal_error', message: error.message || String(error) }));
          } finally {
            requestScope.dispose();
          }
        })();
      }
      if (url.pathname === '/yuanqi/v1/models' && req.method === 'GET') {
        const expectedKey = process.env.YUANQI_API_KEY;
        if (!expectedKey || expectedKey.length < 24) {
          send(res, 503, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'api_not_configured', message: 'OpenAI-compatible API is not configured' } }));
          return;
        }
        if (!hasValidBearer(req, expectedKey)) {
          send(res, 401, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'invalid_api_key', message: 'Invalid bearer token' } }));
          return;
        }
        const config = modelGatewayConfig();
        const data = config.model_ready ? [{ id: config.model, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: config.provider }] : [];
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ object: 'list', data }));
        return;
      }
      if (url.pathname === '/yuanqi/v1/chat/completions' && req.method === 'POST') {
        const requestScope = requestAbortScope(req, res, activeRequests);
        return (async () => {
          let streaming = false;
          try {
            const expectedKey = process.env.YUANQI_API_KEY;
            if (!expectedKey || expectedKey.length < 24) throw Object.assign(new Error('OpenAI-compatible API is not configured'), { status: 503, code: 'api_not_configured' });
            if (!hasValidBearer(req, expectedKey)) throw Object.assign(new Error('Invalid bearer token'), { status: 401, code: 'invalid_api_key' });
            const body = await readJsonBody(req, 128 * 1024, requestScope.signal);
            requestScope.signal.throwIfAborted();
            const input = normalizeChatInput(body, { openAi: true });
            streaming = body.stream === true;
            const onText = streaming ? (delta, info) => {
              if (!res.destroyed) res.write('data: ' + JSON.stringify({
                id: info.id, object: 'chat.completion.chunk', created: info.created, model: info.model,
                choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
              }) + '\n\n');
            } : undefined;
            if (streaming) {
              res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
              res.flushHeaders?.();
            }
            const result = await runTrackedChat({ ctx: runtime.ctx, agents: runtime.agents, input, model: body.model, maxTokens: body.max_tokens ?? body.max_completion_tokens ?? 4096, onText, signal: requestScope.signal });
            if (streaming) {
              if (!res.destroyed) {
                res.write('data: ' + JSON.stringify({ id: result.id, object: 'chat.completion.chunk', created: result.created, model: result.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
              }
            } else {
              send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
                id: result.id, object: 'chat.completion', created: result.created, model: result.model,
                choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
              }));
            }
          } catch (error) {
            if (res.destroyed || res.writableEnded) return;
            if (requestScope.signal.aborted) {
              if (streaming && res.headersSent) {
                res.write('event: error\ndata: ' + JSON.stringify({ error: { code: 'request_aborted', message: 'The HTTP client disconnected before the request completed' } }) + '\n\n');
                res.end();
              } else {
                send(res, 499, 'application/json; charset=utf-8', JSON.stringify({ error: { code: 'request_aborted', message: 'The HTTP client disconnected before the request completed' } }));
              }
              return;
            }
            if (streaming && res.headersSent) {
              if (!res.destroyed) { res.write('event: error\ndata: ' + JSON.stringify({ error: { code: error.code || 'internal_error', message: error.message || String(error) } }) + '\n\n'); res.end(); }
            } else {
              send(res, error.status || 500, 'application/json; charset=utf-8', JSON.stringify({ error: { code: error.code || 'internal_error', message: error.message || String(error) } }));
            }
          } finally {
            requestScope.dispose();
          }
        })();
      }
      send(res, 404, 'application/json; charset=utf-8', '{"error":"not_found"}');
    },
  });
  return async () => {
    closing = true;
    chatSessions.clear();
    const requests = [...activeRequests];
    for (const request of requests) request.abort();
    dispose?.();
    // Drain every admitted chat HTTP handler, including requests still
    // consuming a body and requests that have not reached Agent creation.
    await Promise.allSettled(requests.map(request => request.done));
    await Promise.allSettled([...activeChats]);
  };
}
