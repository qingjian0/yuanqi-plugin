import test from 'node:test';
import assert from 'node:assert/strict';
import { registerYuanQiWeb } from '../src/web/index.js';

test('registers one authenticated YuanQi route and releases it', () => {
  let route;
  let disposed = false;
  const webServer = { register(value) { route = value; return () => { disposed = true; }; } };
  const store = { getYuanQiBirthProfile() { return null; } };
  const dispose = registerYuanQiWeb(webServer, store);
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/yuanqi');
  assert.equal(route.auth({ url: new URL('http://localhost/yuanqi') }), 'required');
  assert.equal(route.auth({ url: new URL('http://localhost/yuanqi/v1/chat/completions') }), 'anonymous');
  dispose();
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
  await route.handler(req, res);
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'model_not_configured');
});
