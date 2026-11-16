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
