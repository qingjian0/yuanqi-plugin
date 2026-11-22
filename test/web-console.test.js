import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerYuanQiWeb } from '../src/web/index.js';

test('registers one authenticated YuanQi route and releases it', async () => {
  let route;
  let disposed = false;
  const webServer = { register(value) { route = value; return () => { disposed = true; }; } };
  const store = { getYuanQiBirthProfile() { return null; } };
  const dispose = registerYuanQiWeb(webServer, store);
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/yuanqi');
  assert.equal(route.auth({ url: new URL('http://localhost/yuanqi') }), 'required');
  assert.equal(route.auth({ url: new URL('http://localhost/yuanqi/v1/chat/completions') }), 'anonymous');
  await dispose();
  assert.equal(disposed, true);
});

test('rejects missing DSH WebServer or SubjectStore', () => {
  assert.throws(() => registerYuanQiWeb(null, {}), /WebServer/);
  assert.throws(() => registerYuanQiWeb({ register() {} }, {}), /SubjectStore/);
});

test('routes worldline and evidence reads through the shared Worldline store', () => {
  let route;
  const worldlines = {
    getWorldline(id) { assert.equal(id, 'worldline:main'); return { worldline_id: id }; },
    getHead(id) { assert.equal(id, 'worldline:main'); return { current_snapshot_version: 2, current_evidence_refs: ['e1'], current_state_payload: { self_model: { centers: {} } } }; },
    getSelfModel() { return { centers: {} }; },
    getEvidenceRecord(query) { assert.deepEqual(query, { evidence_id: 'e1', worldline_id: 'worldline:main' }); return { status: 'active', record: { evidence_id: 'e1' } }; },
  };
  registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, { worldlines });
  const response = () => ({ status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
  const req = path => ({ method: 'GET', url: path });
  const worldlineResponse = response();
  route.handler(req('/yuanqi/api/worldline'), worldlineResponse);
  assert.equal(worldlineResponse.status, 200);
  assert.equal(JSON.parse(worldlineResponse.body).worldline.head.current_snapshot_version, 2);
  const evidenceResponse = response();
  route.handler(req('/yuanqi/api/evidence'), evidenceResponse);
  assert.equal(JSON.parse(evidenceResponse.body).items[0].record.evidence_id, 'e1');
});

test('POST chat route is not rejected by the static-page method gate', async () => {
  let route;
  registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, {});
  const res = { status: 0, headers: {}, body: '', destroyed: false, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  const req = {
    method: 'POST',
    url: '/yuanqi/api/chat',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from('{"message":"hello"}'); },
  };
  await route.handler(req, res, { id: 'peer-test' });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'model_not_configured');
});

test('OpenAI model catalog requires the API key and advertises the configured model', () => {
  const oldKey = process.env.YUANQI_API_KEY, oldProvider = process.env.YUANQI_MODEL_PROVIDER, oldModel = process.env.YUANQI_MODEL;
  process.env.YUANQI_API_KEY = 'yuanqi-test-api-key-with-more-than-24-chars';
  process.env.YUANQI_MODEL_PROVIDER = 'test-provider';
  process.env.YUANQI_MODEL = 'test-model';
  try {
    let route;
    registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, {});
    const res = { status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
    route.handler({ method: 'GET', url: '/yuanqi/v1/models', headers: { authorization: 'Bearer ' + process.env.YUANQI_API_KEY } }, res);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).data[0].id, 'test-model');
  } finally {
    if (oldKey === undefined) delete process.env.YUANQI_API_KEY; else process.env.YUANQI_API_KEY = oldKey;
    if (oldProvider === undefined) delete process.env.YUANQI_MODEL_PROVIDER; else process.env.YUANQI_MODEL_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.YUANQI_MODEL; else process.env.YUANQI_MODEL = oldModel;
  }
});

test('chat resume tokens are scoped to the authenticated DSH Peer', async () => {
  const oldProvider = process.env.YUANQI_MODEL_PROVIDER, oldModel = process.env.YUANQI_MODEL;
  process.env.YUANQI_MODEL_PROVIDER = 'test-provider';
  process.env.YUANQI_MODEL = 'test-model';
  let route, listener, resumed = 0;
  const runtime = {
    ctx: { on(_name, callback) { listener = callback; return () => { listener = undefined; }; } },
    agents: {
      async create(options) { return makeHandle(options.sessionId, options); },
      async resume(options) { resumed++; return makeHandle(options.resumeSessionId, options); },
    },
  };
  function makeHandle(id, options) {
    options.setup({ tools: { schemas: () => [], restrict() {} } });
    const events = [];
    const agent = {
      id, session: { snapshotEvents: () => events }, inject() {},
      followup() { listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'reply' } } }); events.push({ seq: 0, type: 'assistant/message' }); },
      async whenIdle() {},
    };
    return { agent, async dispose() {} };
  }
  const response = () => ({ status: 0, headers: {}, body: '', destroyed: false, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
  const request = body => ({ method: 'POST', url: '/yuanqi/api/chat', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } });
  try {
    registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, runtime);
    const first = response();
    await route.handler(request({ message: 'hello' }), first, { id: 'peer-a' });
    const token = JSON.parse(first.body).chat_token;
    assert.match(token, /^[a-f0-9-]{36}$/i);
    const second = response();
    await route.handler(request({ message: 'again', chat_token: token }), second, { id: 'peer-a' });
    assert.equal(resumed, 1);
    assert.equal(JSON.parse(second.body).text, 'reply');
    const denied = response();
    await route.handler(request({ message: 'steal', chat_token: token }), denied, { id: 'peer-b' });
    assert.equal(denied.status, 404);
    assert.equal(JSON.parse(denied.body).error, 'invalid_chat_token');
  } finally {
    if (oldProvider === undefined) delete process.env.YUANQI_MODEL_PROVIDER; else process.env.YUANQI_MODEL_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.YUANQI_MODEL; else process.env.YUANQI_MODEL = oldModel;
  }
});

test('OpenAI chat completions streams text deltas and a terminal marker', async () => {
  const oldKey = process.env.YUANQI_API_KEY, oldProvider = process.env.YUANQI_MODEL_PROVIDER, oldModel = process.env.YUANQI_MODEL;
  process.env.YUANQI_API_KEY = 'yuanqi-test-api-key-with-more-than-24-chars';
  process.env.YUANQI_MODEL_PROVIDER = 'test-provider';
  process.env.YUANQI_MODEL = 'test-model';
  let route, listener;
  const runtime = {
    ctx: { on(_name, callback) { listener = callback; return () => { listener = undefined; }; } },
    agents: {
      async create(options) {
        options.setup({ tools: { schemas: () => [], restrict() {} } });
        const events = [];
        const agent = {
          id: options.sessionId, session: { snapshotEvents: () => events }, inject() {},
          followup() { listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'streamed' } } }); events.push({ seq: 0, type: 'assistant/message' }); },
          async whenIdle() {},
        };
        return { agent, async dispose() {} };
      },
    },
  };
  const res = {
    status: 0, headers: {}, body: '', destroyed: false, headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    flushHeaders() {},
    write(chunk) { this.body += chunk; },
    end(chunk = '') { this.body += chunk; this.ended = true; },
  };
  const body = { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'hello' }] };
  const req = { method: 'POST', url: '/yuanqi/v1/chat/completions', headers: { authorization: 'Bearer ' + process.env.YUANQI_API_KEY, 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  try {
    registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, runtime);
    await route.handler(req, res);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.match(res.body, /streamed/);
    assert.match(res.body, /data: \[DONE\]/);
    assert.equal(res.ended, true);
  } finally {
    if (oldKey === undefined) delete process.env.YUANQI_API_KEY; else process.env.YUANQI_API_KEY = oldKey;
    if (oldProvider === undefined) delete process.env.YUANQI_MODEL_PROVIDER; else process.env.YUANQI_MODEL_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.YUANQI_MODEL; else process.env.YUANQI_MODEL = oldModel;
  }
});


test('aborting an OpenAI SSE request cancels the active DSH Agent request', async () => {
  const oldKey = process.env.YUANQI_API_KEY, oldProvider = process.env.YUANQI_MODEL_PROVIDER, oldModel = process.env.YUANQI_MODEL;
  process.env.YUANQI_API_KEY = 'yuanqi-test-api-key-with-more-than-24-chars';
  process.env.YUANQI_MODEL_PROVIDER = 'test-provider';
  process.env.YUANQI_MODEL = 'test-model';
  let route, cancelCause, disposed = false, startedResolve, idleResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const idle = new Promise(resolve => { idleResolve = resolve; });
  const runtime = {
    ctx: { on() { return () => {}; } },
    agents: {
      async create(options) {
        options.setup({ tools: { schemas: () => [], restrict() {} } });
        const events = [];
        const agent = {
          id: options.sessionId, session: { snapshotEvents: () => events }, inject() {},
          followup() { startedResolve(); },
          cancel(cause) { cancelCause = cause; idleResolve(); },
          async whenIdle() { await idle; },
        };
        return { agent, async dispose() { disposed = true; } };
      },
    },
  };
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: '/yuanqi/v1/chat/completions',
    headers: { authorization: 'Bearer ' + process.env.YUANQI_API_KEY, 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ model: 'test-model', stream: true, messages: [{ role: 'user', content: 'hello' }] })); },
  });
  const res = new EventEmitter();
  Object.assign(res, {
    status: 0, headers: {}, body: '', destroyed: false, writableEnded: false, headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    write(chunk) { this.body += chunk; },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; },
  });
  try {
    registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, runtime);
    const pending = route.handler(req, res);
    await started;
    req.emit('aborted');
    await pending;
    assert.deepEqual(cancelCause, { kind: 'user' });
    assert.equal(disposed, true);
    assert.equal(res.writableEnded, true);
    assert.match(res.body, /event: error\ndata:/);
    assert.equal(req.listenerCount('aborted'), 0);
  } finally {
    if (oldKey === undefined) delete process.env.YUANQI_API_KEY; else process.env.YUANQI_API_KEY = oldKey;
    if (oldProvider === undefined) delete process.env.YUANQI_MODEL_PROVIDER; else process.env.YUANQI_MODEL_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.YUANQI_MODEL; else process.env.YUANQI_MODEL = oldModel;
  }
});


test('plugin disposal aborts and drains active Agent Loop requests before completing', async () => {
  const oldKey = process.env.YUANQI_API_KEY, oldProvider = process.env.YUANQI_MODEL_PROVIDER, oldModel = process.env.YUANQI_MODEL;
  process.env.YUANQI_API_KEY = 'yuanqi-test-api-key-with-more-than-24-chars';
  process.env.YUANQI_MODEL_PROVIDER = 'test-provider';
  process.env.YUANQI_MODEL = 'test-model';
  let route, cancelCause, disposed = false, startedResolve, idleResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const idle = new Promise(resolve => { idleResolve = resolve; });
  const runtime = {
    ctx: { on() { return () => {}; } },
    agents: {
      async create(options) {
        options.setup({ tools: { schemas: () => [], restrict() {} } });
        const events = [];
        const agent = {
          id: options.sessionId, session: { snapshotEvents: () => events }, inject() {},
          followup() { startedResolve(); },
          cancel(cause) { cancelCause = cause; idleResolve(); },
          async whenIdle() { await idle; },
        };
        return { agent, async dispose() { disposed = true; } };
      },
    },
  };
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: '/yuanqi/v1/chat/completions',
    headers: { authorization: 'Bearer ' + process.env.YUANQI_API_KEY, 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ model: 'test-model', stream: true, messages: [{ role: 'user', content: 'hello' }] })); },
  });
  const res = new EventEmitter();
  Object.assign(res, {
    status: 0, headers: {}, body: '', destroyed: false, writableEnded: false, headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    write(chunk) { this.body += chunk; },
    end(chunk = '') { this.body += chunk; this.writableEnded = true; },
  });
  try {
    const dispose = registerYuanQiWeb({ register(value) { route = value; return () => {}; } }, { getYuanQiBirthProfile() { return null; } }, runtime);
    const pendingRequest = route.handler(req, res);
    await started;
    await dispose();
    await pendingRequest;
    assert.deepEqual(cancelCause, { kind: 'user' });
    assert.equal(disposed, true);
    assert.equal(res.writableEnded, true);
    assert.match(res.body, /event: error\ndata:/);
    assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(res.listenerCount('close'), 0);
  } finally {
    if (oldKey === undefined) delete process.env.YUANQI_API_KEY; else process.env.YUANQI_API_KEY = oldKey;
    if (oldProvider === undefined) delete process.env.YUANQI_MODEL_PROVIDER; else process.env.YUANQI_MODEL_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.YUANQI_MODEL; else process.env.YUANQI_MODEL = oldModel;
  }
});
