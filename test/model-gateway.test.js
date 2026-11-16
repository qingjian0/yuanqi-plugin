import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatInput, hasValidBearer, runYuanQiChat } from '../src/web/model.js';

test('normalizes OpenAI message history without promoting supplied roles to system instructions', () => {
  const value = normalizeChatInput({
    messages: [
      { role: 'system', content: 'be concise' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'next' },
    ],
  }, { openAi: true });
  assert.equal(value.message, 'next');
  assert.match(value.context, /SYSTEM:/);
  assert.match(value.context, /ASSISTANT:/);
});

test('rejects unsupported message roles and conversations not ending in user input', () => {
  assert.throws(() => normalizeChatInput({ messages: [{ role: 'tool', content: 'x' }] }, { openAi: true }), /Only system/);
  assert.throws(() => normalizeChatInput({ messages: [{ role: 'assistant', content: 'x' }] }, { openAi: true }), /last message/);
});

test('Bearer validation requires a configured long key and compares exact bytes', () => {
  const key = 'yuanqi-test-api-key-with-more-than-24-chars';
  assert.equal(hasValidBearer({ headers: { authorization: 'Bearer ' + key } }, key), true);
  assert.equal(hasValidBearer({ headers: { authorization: 'Bearer wrong' } }, key), false);
  assert.equal(hasValidBearer({ headers: {} }, key), false);
  assert.equal(hasValidBearer({ headers: { authorization: 'Bearer ' + key } }, 'short'), false);
});

test('Agent Loop chat owns a fresh Session, masks inherited tools and disposes its handle', async () => {
  const oldProvider = process.env.YUANQI_MODEL_PROVIDER;
  const oldModel = process.env.YUANQI_MODEL;
  process.env.YUANQI_MODEL_PROVIDER = 'test-provider';
  process.env.YUANQI_MODEL = 'test-model';
  let streamListener;
  let createOptions;
  let disposed = false;
  const ctx = { on(name, listener) { assert.equal(name, 'agent/assistant-stream'); streamListener = listener; return () => { streamListener = undefined; }; } };
  const agents = {
    async create(options) {
      createOptions = options;
      const agent = {
        id: options.sessionId,
        inject() {},
        followup() {
          streamListener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'hello' } } });
        },
        async whenIdle() {},
      };
      options.agentOptions.setup({ tools: { schemas: () => [{ name: 'shell' }, { name: 'web' }], restrict(value) { assert.deepEqual(value, { deny: ['shell', 'web'] }); } } });
      return { agent, async dispose() { disposed = true; } };
    },
  };
  try {
    const result = await runYuanQiChat({ ctx, agents, input: { context: '', message: 'hi' } });
    assert.equal(result.text, 'hello');
    assert.equal(result.model, 'test-model');
    assert.equal(typeof result.session_id, 'string');
    assert.equal(createOptions.agentOptions.provider, 'test-provider');
    assert.equal(disposed, true);
    assert.equal(streamListener, undefined);
  } finally {
    if (oldProvider === undefined) delete process.env.YUANQI_MODEL_PROVIDER; else process.env.YUANQI_MODEL_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.YUANQI_MODEL; else process.env.YUANQI_MODEL = oldModel;
  }
});
