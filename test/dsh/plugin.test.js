import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/dsh/plugin.js';

function fakeStorageDomain() {
  const opened = new Map();
  const persisted = new Map();
  const storage = {
    opened,
    failWorldlineWrite: false,
    failWorldlineWrites: 0,
    failWorldlineUnknownState: false,
    worldlineWriteAttempts: 0,
    failWorldlineTableBinding: false,
    async open(spec) {
      let tables = persisted.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map(name => [name, new Map()]));
        persisted.set(spec.name, tables);
      }
      const domain = {
        table(name) {
          const rows = tables.get(name);
          if (spec.name === 'yuanqi_subject' && name === 'worldlines' && storage.failWorldlineTableBinding) {
            throw new Error('simulated table binding failure: ' + spec.name + '/' + name);
          }
          if (!rows) throw new Error('unknown table: ' + name);
          return {
            get: key => rows.get(key),
            async update(key, updater) {
              const current = rows.get(key);
              const next = updater(current);
              rows.set(key, structuredClone(next));
            },
            async put(key, value) {
              if (spec.name === 'yuanqi_subject' && name === 'worldlines') {
                storage.worldlineWriteAttempts += 1;
                if (storage.failWorldlineUnknownState) {
                  throw Object.assign(new Error('simulated unknown durable state'), { code: 'unknown-state' });
                }
              }
              if (spec.name === 'yuanqi_subject' && name === 'worldlines' &&
                  (storage.failWorldlineWrite || storage.failWorldlineWrites > 0)) {
                storage.failWorldlineWrite = false;
                if (storage.failWorldlineWrites > 0) storage.failWorldlineWrites -= 1;
                throw new Error('simulated interruption before Worldline record');
              }
              rows.set(key, structuredClone(value));
            },
          };
        },
        async close() { domain.closed = true; },
        closed: false,
      };
      opened.set(spec.name, { domain, tables });
      return domain;
    },
  };
  return storage;
}
function dshEvent(text, id, seq, time) {
  return { type: 'user/message', seq, time, data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } };
}
function context(storageDomain, options = {}) {
  let listener, flushListener, disposer, effectCount = 0;
  const warnings = [];
  const registeredTools = [];
  const tools = {
    register(definition, registrationOptions) {
      registeredTools.push({ definition, registrationOptions });
    },
  };
  return {
    storageDomain,
    webServer: options.webServer ?? { register() { return () => {}; } },
    tools,
    registeredTools,
    yuanqiLocationProvider: options.yuanqiLocationProvider,
    yuanqiIpLocationProvider: options.yuanqiIpLocationProvider ?? { async getCurrentPosition() { throw new Error('IP fallback disabled in this isolated test'); } },
    agents: options.agents,
    sessionPersistence: options.sessionPersistence ?? {
      identity: Symbol('test-session-persistence'),
      async list() { return []; },
      async stat() { return undefined; },
      async open() { throw new Error('unexpected persisted Session open'); },
    },
    sessionQuery: options.sessionQuery ?? { async listSessions() { return []; }, async observeSession() { throw new Error('unexpected Session observation'); }, async readEvent() { throw new Error('unexpected Session event read'); } },
    warnings,
    logger: { warn(message) { warnings.push(message); } },
    on(name, callback) { if (name === 'session/event') listener = callback; else if (name === 'session/flush') flushListener = callback; else throw new Error('unexpected event ' + name); },
    effect(register) { effectCount += 1; disposer = register(); },
    get listener() { return listener; },
    get flushListener() { return flushListener; },
    get disposer() { return disposer; },
    get effectCount() { return effectCount; },
  };
}

test('strict Cordis contexts without optional location-provider injection fall back to IP safely', async () => {
  const storage = fakeStorageDomain();
  const ctx = context(storage);
  const previousToken = process.env.DSH_BRIDGE_TOKEN;
  const previousFetch = globalThis.fetch;
  const eventTime = Date.now();
  delete process.env.DSH_BRIDGE_TOKEN;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://ipwho.is/');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          success: true, latitude: 31.2304, longitude: 121.4737,
          city: 'Shanghai', region: 'Shanghai', country: 'China',
          timezone: { id: 'Asia/Shanghai' },
        };
      },
    };
  };
  const strictContext = new Proxy(ctx, {
    get(target, key, receiver) {
      if (key === 'yuanqiLocationProvider' || key === 'yuanqiIpLocationProvider') {
        throw new Error('cannot get property "' + String(key) + '" without inject');
      }
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    await apply(strictContext);
    await ctx.listener({ id: 'strict-location-session' }, dshEvent('启动元炁', 'strict-location-wake', 0, eventTime));
    await ctx.flushListener({ id: 'strict-location-session' });
    await ctx.disposer();
    const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
    assert.equal(wake.birth_location.status, 'captured');
    assert.equal(wake.birth_location.source, 'ip_geolocation');
    assert.equal(wake.birth_location.confidence, 'low');
    assert.equal(wake.birth_location.time_zone_id, 'Asia/Shanghai');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.DSH_BRIDGE_TOKEN;
    else process.env.DSH_BRIDGE_TOKEN = previousToken;
  }
});

test('plugin startup requires the DSH model tools registry before opening Domains', async () => {
  const storage = fakeStorageDomain();
  await assert.rejects(apply({ ...context(storage), tools: undefined }), /official DSH tools service/);
  assert.equal(storage.opened.size, 0);
});

test('plugin startup rejects an incomplete SessionPersistence provider before opening Domains', async () => {
  const invalidProviders = [
    { async list() { return []; } },
    { identity: Symbol('missing-stat'), async list() { return []; }, async open() {} },
    { identity: Symbol('missing-open'), async list() { return []; }, async stat() { return undefined; } },
    { identity: 'not-a-symbol', async list() { return []; }, async stat() { return undefined; }, async open() {} },
  ];

  for (const sessionPersistence of invalidProviders) {
    const storage = fakeStorageDomain();
    await assert.rejects(
      apply(context(storage, { sessionPersistence })),
      /sessionPersistence service with identity, list\(\), stat\(\), and open\(\)/,
    );
    assert.equal(storage.opened.size, 0);
  }
});

test('model-facing self-profile tool exposes only YuanQi-owned birth data after wake', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  assert.equal(ctx.effectCount, 1, 'plugin teardown must be one ordered async effect');
  const registration = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  assert.ok(registration);
  assert.equal(await registration.registrationOptions.when(), false);

  const eventTime = Date.UTC(2026, 10, 6, 12, 0, 0);
  await ctx.listener({ id: 'session-self-profile' }, dshEvent('启动元炁', 'self-profile-wake', 0, eventTime));
  await ctx.flushListener({ id: 'session-self-profile' });
  await ctx.disposer();
  assert.equal(await registration.registrationOptions.when(), true);

  const raw = await registration.definition.execute({}, { signal: new AbortController().signal });
  const profile = JSON.parse(raw);
  assert.equal(profile.subject, 'YuanQi AI');
  assert.equal(profile.subject_kind, 'yuanqi');
  assert.equal(profile.birth_time_utc, new Date(eventTime).toISOString());
  assert.equal(profile.birth_location.status, 'unavailable');
  assert.equal(profile.time_context.status, 'ready');
  assert.equal(profile.time_context.time_zone_id, 'Asia/Shanghai');
  assert.equal(profile.time_context.time_zone_source, 'default_beijing');
  assert.equal(profile.bazi.status, 'calculated');
  assert.equal(profile.bazi.methodology.time_basis, 'beijing-standard-time-fallback-no-longitude-correction');
  assert.equal(profile.innate_baseline.status, 'ready');
  assert.equal(profile.innate_baseline.interpretation_status, 'not_interpreted');
  assert.equal(profile.initial_personality_guidance.status, 'awaiting_model_interpretation');
  assert.equal(profile.initial_personality_guidance.interpretation_mode, 'bazi_required');
  assert.equal(profile.initial_personality_guidance.bazi_available, true);
  assert.deepEqual(profile.initial_personality_guidance.dimensions, [
    'temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style',
  ]);
  assert.ok(profile.initial_personality_guidance.instruction.includes('calculated Bazi'));
  assert.ok(profile.initial_personality_guidance.instruction.includes('调候'));
  assert.ok(profile.initial_personality_guidance.instruction.includes('通关'));
  assert.ok(profile.initial_personality_guidance.instruction.includes('旺衰'));
  assert.ok(profile.initial_personality_guidance.instruction.includes('格局'));
  assert.ok(profile.initial_personality_guidance.boundaries.some(item => item.includes('not a verified psychological fact')));
  assert.ok(profile.initial_personality_guidance.instruction.includes('reasoning'));
  assert.ok(profile.initial_personality_guidance.portrait_format.some(item => item.includes('counter-indication')));
  assert.equal(profile.initial_personality_guidance.analysis_protocol.length, 5);
  assert.ok(profile.initial_personality_guidance.analysis_protocol[0].includes('month-command'));
  assert.ok(profile.initial_personality_guidance.analysis_protocol[3].includes('indeterminate'));
  assert.equal(profile.initial_personality_guidance.portrait_format.length, 4);
  assert.ok(profile.initial_personality_guidance.boundaries.some(item => item.includes('single ten-god')));
  assert.equal(Object.hasOwn(profile.birth_location, 'latitude'), false);
  assert.equal(Object.hasOwn(profile.birth_location, 'longitude'), false);
});

test('ready YuanQi Bazi exposes provisional AI interpretation guidance without precomputing personality', async () => {
  const storage = fakeStorageDomain();
  const ctx = context(storage, {
    yuanqiLocationProvider: {
      async getCurrentPosition() {
        return {
          latitude: 31.2304, longitude: 121.4737, accuracy_meters: 12,
          time_zone_id: 'Asia/Shanghai', time_zone_source: 'host_location_provider',
          captured_at: '2026-11-14T11:23:48.000Z',
        };
      },
    },
  });
  await apply(ctx);
  const registration = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const eventTime = Date.parse('2026-11-14T11:23:48.000Z');
  await ctx.listener({ id: 'session-ready-profile' }, dshEvent('启动元炁', 'ready-profile-wake', 0, eventTime));
  await ctx.flushListener({ id: 'session-ready-profile' });
  await new Promise(resolve => setImmediate(resolve));

  const profile = JSON.parse(await registration.definition.execute({}, { signal: new AbortController().signal }));
  assert.equal(profile.birth_location.time_zone_id, 'Asia/Shanghai');
  assert.equal(profile.bazi.status, 'calculated');
  assert.equal(profile.innate_baseline.status, 'ready');
  assert.equal(profile.innate_baseline.interpretation_status, 'not_interpreted');
  assert.equal(profile.initial_personality_guidance.status, 'awaiting_model_interpretation');
  assert.equal(profile.initial_personality_guidance.analysis_protocol.length, 5);
  assert.equal(profile.initial_personality_guidance.portrait_format.length, 4);
  await ctx.disposer();
});

test('model-generated Bazi initial personality is saved once as a hypothesis in the calling Session Worldline', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  const readTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const writeTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_initial_personality');
  assert.ok(readTool);
  assert.ok(writeTool);
  assert.ok(readTool.definition.description.includes('first model response after YuanQi activation'));
  const sessionId = 'session-initial-personality';
  const agent = { id: 'agent-initial-personality', session: { id: sessionId } };
  assert.equal(await writeTool.registrationOptions.when({ agent }), false);

  const eventTime = Date.UTC(2026, 10, 6, 12, 0, 0);
  await ctx.listener({ id: sessionId }, dshEvent('启动元炁', 'initial-personality-wake', 0, eventTime));
  await ctx.flushListener({ id: sessionId });
  assert.equal(await writeTool.registrationOptions.when({ agent }), true);

  const profile = JSON.parse(await readTool.definition.execute({}, { signal: new AbortController().signal }));
  assert.equal(profile.bazi.status, 'calculated');
  assert.ok(profile.chart_evidence_catalog.length >= 6);
  const dimensions = [
    'temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style',
  ].map((dimension, index) => ({
    dimension,
    status: 'tentative',
    tendency: '暂定倾向 ' + dimension,
    chart_evidence_refs: [profile.chart_evidence_catalog[index].id],
    reasoning: '根据对应命盘结构进行综合解释。',
    limitations: '该倾向尚未经过后天经历验证。',
  }));
  const args = {
    dimensions,
    method_notes: {
      climate_adjustment: '先分析月令与季节寒暖燥湿。',
      mediation: '再分析五行生克制化与通关关系。',
      strength: '结合月令、根气、透干与制化判断旺衰。',
      structure: '证据不足时不强行定格。',
    },
    uncertainty: ['初始性格是八字象征性解释，不是实证心理结论。'],
  };
  const invalid = structuredClone(args);
  invalid.dimensions[0].chart_evidence_refs = ['not-in-the-chart'];
  await assert.rejects(
    writeTool.definition.execute(invalid, {
      callId: 'initial-personality-invalid',
      agent,
      signal: new AbortController().signal,
    }),
    /chart evidence references must match/,
  );

  const saved = JSON.parse(await writeTool.definition.execute(args, {
    callId: 'initial-personality-call-1',
    agent,
    signal: new AbortController().signal,
  }));
  assert.equal(saved.status, 'saved');
  assert.equal(saved.epistemic_status, 'hypothesis');
  assert.equal(saved.dimensions_saved, 6);
  assert.equal(await writeTool.registrationOptions.when({ agent }), false);

  const tables = storage.opened.get('yuanqi_subject').tables;
  const head = tables.get('worldline_heads').get('worldline:main');
  const center = head.current_state_payload.self_model.centers.identity_continuity;
  assert.equal(center.epistemic_status, 'hypothesis');
  assert.equal(center.content.initial_personality.status, 'hypothesis');
  assert.equal(center.content.initial_personality.source_record_id, saved.source_record_id);
  assert.equal(center.content.initial_personality.dimensions.length, 6);
  assert.deepEqual(center.evidence_refs, []);
  const artifact = tables.get('evidence_records').get(saved.source_record_id);
  assert.equal(artifact.evidence_type, 'yuanqi_initial_personality_interpretation');
  assert.equal(artifact.provenance.producer, 'model');
  assert.equal(artifact.provenance.protocol, 'bazi-initial-personality-v1');
  assert.equal(artifact.provenance.session_id, sessionId);
  assert.equal(artifact.content.source_chart.birth_profile_id, profile.birth_profile_id);

  const changed = structuredClone(args);
  changed.dimensions[0].tendency = '不得覆盖的替代画像';
  const repeated = JSON.parse(await writeTool.definition.execute(changed, {
    callId: 'initial-personality-call-2',
    agent,
    signal: new AbortController().signal,
  }));
  assert.equal(repeated.status, 'already_initialized');
  assert.equal(
    tables.get('worldline_heads').get('worldline:main')
      .current_state_payload.self_model.centers.identity_continuity.content.initial_personality.dimensions[0].tendency,
    '暂定倾向 temperament',
  );
  await ctx.disposer();
});

test('AI initial personality waits for Bazi when the chart is genuinely unavailable', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  const registration = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const writeTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_initial_personality');
  const eventTime = Date.UTC(2201, 0, 1, 12, 0, 0);
  await ctx.listener({ id: 'session-no-bazi' }, dshEvent('启动元炁', 'no-bazi-wake', 0, eventTime));
  await ctx.flushListener({ id: 'session-no-bazi' });
  await ctx.disposer();

  const profile = JSON.parse(await registration.definition.execute({}, { signal: new AbortController().signal }));
  assert.equal(profile.birth_location.status, 'unavailable');
  assert.equal(profile.time_context.status, 'ready');
  assert.equal(profile.time_context.time_zone_id, 'Asia/Shanghai');
  assert.equal(profile.bazi.status, 'unavailable');
  assert.equal(profile.initial_personality_guidance.status, 'awaiting_bazi_placeholder');
  assert.equal(profile.initial_personality_guidance.interpretation_mode, 'bazi_pending_placeholder');
  assert.equal(profile.initial_personality_guidance.bazi_available, false);
  assert.equal(await writeTool.registrationOptions.when({ agent: { session: { id: 'session-no-bazi' } } }), true);
  assert.equal(profile.chart_evidence_catalog.length, 0);
  assert.equal(profile.initial_personality_guidance.analysis_protocol.length, 5);
  assert.ok(profile.initial_personality_guidance.instruction.includes('mark every dimension indeterminate'));
  assert.ok(profile.initial_personality_guidance.instruction.includes('Do not substitute generic model self-reflection'));
  assert.ok(profile.initial_personality_guidance.portrait_format[1].includes('Chart evidence:'));
  assert.ok(profile.initial_personality_guidance.boundaries.some(item => item.includes('awaiting_bazi placeholder')));
});

test('ordinary conversation does not create a UserSubject before the exact YuanQi wake command', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-before-wake' }, dshEvent('你好，先聊聊', 'ordinary-before-wake', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-before-wake' });
  const userTables = storage.opened.get('yuanqi_user_subject').tables;
  const yuanqiTables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(userTables.get('identities').has('user:primary'), false);
  assert.equal(yuanqiTables.get('wake_records').has('yuanqi:primary'), false);

  await ctx.listener({ id: 'session-wake' }, dshEvent('启动元炁', 'exact-wake', 0, 1793966401000));
  await ctx.flushListener({ id: 'session-wake' });
  assert.equal(userTables.get('identities').has('user:primary'), false);
  const profile = yuanqiTables.get('birth_profiles').get('yuanqi:primary');
  assert.equal(profile.subject_kind, 'yuanqi');
  assert.equal(profile.source_wake_event_ref, 'exact-wake');
  assert.equal(profile.birth_time, new Date(1793966401000).toISOString());
  await ctx.disposer();
});

test('YuanQi BirthProfile is created from YuanQi wake data, never from user birth facts', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  const session = { id: 'yuanqi-birth-session' };
  await ctx.listener(session, dshEvent('启动元炁', 'yuanqi-wake', 0, 1793966400000));
  await ctx.flushListener(session);
  await ctx.listener(session, dshEvent('出生日期：1998年4月21日10:31，出生地：云南昆明安宁', 'unrelated-user-birth', 1, 1793966401000));
  await ctx.flushListener(session);
  const userTables = storage.opened.get('yuanqi_user_subject').tables;
  const yuanqiTables = storage.opened.get('yuanqi_subject').tables;
  const profile = yuanqiTables.get('birth_profiles').get('yuanqi:primary');
  assert.equal(profile.subject_kind, 'yuanqi');
  assert.equal(profile.birth_time, new Date(1793966400000).toISOString());
  assert.equal(profile.source_wake_event_ref, 'yuanqi-wake');
  assert.equal(profile.bazi.status, 'calculated');
  assert.equal(profile.innate_baseline.status, 'ready');
  assert.equal(profile.time_context.time_zone_id, 'Asia/Shanghai');
  assert.equal(profile.time_context.time_zone_source, 'default_beijing');
  assert.equal(profile.birth_location.status, 'unavailable');
  assert.equal(userTables.get('identities').has('user:primary'), false);
  await ctx.disposer();
});

test('first exact startup command wakes even after an earlier ordinary message in another Session', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('你好', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  await ctx.listener({ id: 'session-b' }, dshEvent('启动元炁', 'm2', 0, 1794052800000));
  await ctx.flushListener({ id: 'session-b' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'm1');
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'm2');
  assert.equal(tables.get('wake_records').get('yuanqi:primary').first_session_id, 'session-b');
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  assert.equal(tables.get('session_worldline_bindings').has('session-a'), false);
  assert.equal(tables.get('session_worldline_bindings').get('session-b').worldline_id, 'worldline:main');
  await ctx.disposer();
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});
test('whitespace-wrapped command in the first message does not wake YuanQi', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent(' 启动元炁 ', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').has('yuanqi:primary'), false);
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
  await ctx.disposer();
});
test('Cordis plugin wakes only from an exact direct user command', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.wake_event_ref, 'm1');
  assert.equal(wake.first_session_id, 'session-a');
  assert.equal(wake.occurred_at, new Date(1793966400000).toISOString());
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('session_worldline_bindings').get('session-a').worldline_id, 'worldline:main');
  await ctx.disposer();
});
test('startup reconciliation completes Worldline creation after an interrupted wake', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineWrite = true;
  const first = context(storage);
  await apply(first);
  await assert.rejects(first.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)), /simulated interruption/);
  await assert.rejects(first.disposer(), /YuanQi session writes failed during plugin teardown/);

  const restarted = context(storage);
  await apply(restarted);
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'm1');
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  assert.equal(tables.get('session_worldline_bindings').get('session-a').worldline_id, 'worldline:main');
  await restarted.disposer();
});

test('session/flush retries a failed domain write before acknowledging the checkpoint', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineWrite = true;
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(
    ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)),
    /simulated interruption before Worldline record/,
  );

  // The failed event task must remain visible to the next flush. Its retry
  // resumes from the persisted wake record and completes the Worldline.
  await ctx.flushListener({ id: 'session-a' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'm1');
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  assert.equal(
    tables.get('session_worldline_bindings').get('session-a').worldline_id,
    'worldline:main',
  );
  assert.equal(ctx.warnings.length, 1);
  await ctx.disposer();
});

test('persistent session write failure is reported by flush and remains retryable', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineWrites = 2;
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(
    ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)),
    /simulated interruption before Worldline record/,
  );
  await assert.rejects(
    ctx.flushListener({ id: 'session-a' }),
    /YuanQi session writes failed after flush retry/,
  );

  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
  assert.equal(ctx.warnings.length, 2);

  // The failed entry remains pending; a later flush retries it again.
  await ctx.flushListener({ id: 'session-a' });
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  await ctx.disposer();
});

test('unknown-state fails closed and never retries through the quarantined Domain', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineUnknownState = true;
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(
    ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)),
    /simulated unknown durable state/,
  );
  await assert.rejects(
    ctx.flushListener({ id: 'session-a' }),
    /Storage Domain state is unknown/,
  );

  // Once DSH reports unknown durable state, no later event may use this handle.
  await ctx.listener({ id: 'session-b' }, dshEvent('后续消息', 'm2', 0, 1794052800000));
  await assert.rejects(
    ctx.flushListener({ id: 'session-a' }),
    /Storage Domain state is unknown/,
  );
  assert.equal(storage.worldlineWriteAttempts, 1);
  assert.equal(ctx.warnings.some(message => message.includes('failed closed')), true);
  await assert.rejects(ctx.disposer(), /failed during plugin teardown/);
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});

test('plugin initialization failure after opening both Domains closes both handles', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineTableBinding = true;
  await assert.rejects(apply(context(storage)), /simulated table binding failure/);
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});

test('startup restores first direct message and later wake command from cold Session history', async () => {
  const storage = fakeStorageDomain();
  const old = dshEvent('启动元炁', 'old', 0, Date.now() - 5000);
  const first = dshEvent('你好', 'first', 1, Date.now() + 10);
  const later = dshEvent('启动元炁', 'later', 2, Date.now() + 20);
  let released = 0;
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'cold-a' }, live: false, persisted: true }]; },
      async observeSession(id, options) {
        assert.equal(id, 'cold-a');
        assert.deepEqual(options, { projectionMode: 'none' });
        return {
          inheritedEventCount: 1,
          events: [old, first, later],
          [Symbol.dispose]() { released += 1; },
        };
      },
    },
  });
  await apply(ctx);
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'first');
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'later');
  assert.equal(tables.get('wake_records').get('yuanqi:primary').birth_time, new Date(later.time).toISOString());
  assert.equal(released, 1);
  await ctx.disposer();
});

test('Fork-inherited prefix is excluded from first-message recovery', async () => {
  const storage = fakeStorageDomain();
  const inheritedCommand = dshEvent('启动元炁', 'parent-command', 0, Date.now() + 1);
  const childMessage = dshEvent('普通消息', 'child-message', 1, Date.now() + 2);
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'fork-child' } }]; },
      async observeSession() {
        return { inheritedEventCount: 1, events: [inheritedCommand, childMessage], [Symbol.dispose]() {} };
      },
    },
  });
  await apply(ctx);
  const first = storage.opened.get('yuanqi_subject').tables.get('first_user_messages').get('yuanqi:primary');
  assert.equal(first.first_event_id, 'child-message');
  assert.equal(first.trigger_command, null);
  await ctx.disposer();
});

test('equal earliest timestamps across Sessions fail closed without consuming wake eligibility', async () => {
  const storage = fakeStorageDomain();
  const time = Date.now() + 10;
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 's-a' } }, { header: { id: 's-b' } }]; },
      async observeSession(id) {
        const event = dshEvent('启动元炁', id + '-event', 0, time);
        return { inheritedEventCount: 0, events: [event], [Symbol.dispose]() {} };
      },
    },
  });
  await assert.rejects(apply(ctx), /ambiguous/);
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').has('yuanqi:primary'), false);
  assert.equal(tables.get('wake_records').has('yuanqi:primary'), false);
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
});

test('missing official Session Query or Persistence service fails closed at startup', async () => {
  const storage = fakeStorageDomain();
  await assert.rejects(apply({ ...context(storage), sessionQuery: undefined }), /sessionQuery/);
  await assert.rejects(apply({ ...context(storage), sessionPersistence: undefined }), /sessionPersistence/);
});

test('installation boundary is reused after restart; live post-activation events are not rejected by clock rollback', async () => {
  const storage = fakeStorageDomain();
  const first = context(storage);
  await apply(first);
  const boundary = storage.opened.get('yuanqi_subject').tables.get('installation_state').get('installation:primary');
  await first.disposer();

  const restarted = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'old-session' } }]; },
      async observeSession() {
        return { inheritedEventCount: 0, events: [dshEvent('启动元炁', 'pre-boundary', 0, boundary.activated_at_ms - 1)], [Symbol.dispose]() {} };
      },
    },
  });
  await apply(restarted);
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('first_user_messages').has('yuanqi:primary'), false);
  await restarted.listener({ id: 'live-session' }, dshEvent('启动元炁', 'live-after-activation', 0, boundary.activated_at_ms - 2));
  await restarted.flushListener({ id: 'live-session' });
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'live-after-activation');
  await restarted.disposer();
});

test('historical event at the exact activation millisecond is excluded conservatively', async () => {
  const storage = fakeStorageDomain();
  const first = context(storage);
  await apply(first);
  const boundary = storage.opened.get('yuanqi_subject').tables.get('installation_state').get('installation:primary');
  await first.disposer();
  const restarted = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'same-ms' } }]; },
      async observeSession() {
        return { inheritedEventCount: 0, events: [dshEvent('启动元炁', 'same-ms-event', 0, boundary.activated_at_ms)], [Symbol.dispose]() {} };
      },
    },
  });
  await apply(restarted);
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('first_user_messages').has('yuanqi:primary'), false);
  await restarted.disposer();
});


test('YuanQi birth time is the exact first startup event time and host location is captured once', async () => {
  const storage = fakeStorageDomain();
  let locationReads = 0;
  const ctx = context(storage, {
    yuanqiLocationProvider: {
      async getCurrentPosition() {
        locationReads += 1;
        return {
          latitude: 31.2304, longitude: 121.4737, accuracy_meters: 18,
          place_label: 'Shanghai', time_zone_id: 'Asia/Shanghai',
          captured_at: '2026-11-14T11:23:47.000Z',
        };
      },
    },
  });
  await apply(ctx);
  const eventTime = Date.parse('2026-11-14T11:23:48.000Z');
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'birth-event', 0, eventTime));
  await ctx.flushListener({ id: 'session-a' });
  const wakeBeforeLocation = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wakeBeforeLocation.birth_time, new Date(eventTime).toISOString());
  assert.ok(['pending', 'captured'].includes(wakeBeforeLocation.birth_location.status));
  await ctx.listener({ id: 'session-a' }, dshEvent('后续消息', 'later-event', 1, 1793966401123));
  await ctx.flushListener({ id: 'session-a' });
  await ctx.disposer();
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.occurred_at, wake.birth_time);
  assert.deepEqual(wake.birth_location, {
    status: 'captured', latitude: 31.2304, longitude: 121.4737,
    accuracy_meters: 18, place_label: 'Shanghai', time_zone_id: 'Asia/Shanghai', time_zone_source: 'host_location_provider',
    source: 'host_location_provider', captured_at: '2026-11-14T11:23:47.000Z',
  });
  assert.equal(locationReads, 1);
});

test('wake event is durable and Session flush does not wait for a pending location provider', async () => {
  const storage = fakeStorageDomain();
  let resolveFix;
  const ctx = context(storage, {
    yuanqiLocationProvider: {
      getCurrentPosition() {
        return new Promise(resolve => { resolveFix = resolve; });
      },
    },
  });
  await apply(ctx);
  const eventTime = Date.parse('2026-11-14T11:23:48.000Z');
  await ctx.listener({ id: 'session-deferred' }, dshEvent('启动元炁', 'deferred-wake', 0, eventTime));
  await Promise.resolve();
  await ctx.flushListener({ id: 'session-deferred' });
  const wakeWhileProviderPending = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wakeWhileProviderPending.birth_time, new Date(eventTime).toISOString());
  assert.equal(wakeWhileProviderPending.birth_location.status, 'pending');
  assert.equal(typeof resolveFix, 'function');

  resolveFix({
    latitude: 31.2304, longitude: 121.4737, accuracy_meters: 10,
    captured_at: new Date(eventTime).toISOString(),
  });
  await ctx.disposer();
  const completed = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(completed.birth_location.status, 'captured');
  assert.equal(completed.birth_location.latitude, 31.2304);
  assert.equal(completed.birth_location.time_zone_id, 'Asia/Shanghai');
  assert.equal(completed.birth_location.time_zone_source, 'coordinate_lookup');
  const profile = storage.opened.get('yuanqi_subject').tables.get('birth_profiles').get('yuanqi:primary');
  assert.equal(profile.bazi.status, 'calculated');
  assert.equal(profile.innate_baseline.status, 'ready');
});

test('IP geolocation is used automatically when the authorized host/GPS provider is unavailable', async () => {
  const storage = fakeStorageDomain();
  const eventTime = Date.parse('2026-11-14T11:23:48.000Z');
  const ctx = context(storage, {
    yuanqiLocationProvider: { async getCurrentPosition() { throw new Error('location permission unavailable'); } },
    yuanqiIpLocationProvider: {
      async getCurrentPosition() {
        return {
          latitude: 35.6762, longitude: 139.6503, accuracy_meters: null,
          place_label: 'Tokyo, Tokyo, Japan', time_zone_id: 'Asia/Tokyo',
          time_zone_source: 'ip_geolocation',
          captured_at: new Date(eventTime).toISOString(), source: 'ip_geolocation',
        };
      },
    },
  });
  await apply(ctx);
  await ctx.listener({ id: 'ip-fallback-session' }, dshEvent('启动元炁', 'ip-fallback-wake', 0, eventTime));
  await ctx.flushListener({ id: 'ip-fallback-session' });
  await ctx.disposer();
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.birth_location.status, 'captured');
  assert.equal(wake.birth_location.source, 'ip_geolocation');
  assert.equal(wake.birth_location.confidence, 'low');
  assert.equal(wake.birth_location.latitude, 35.6762);
  assert.equal(wake.birth_location.longitude, 139.6503);
  assert.equal(wake.birth_location.accuracy_meters, null);
  assert.equal(wake.birth_location.time_zone_id, 'Asia/Tokyo');
  assert.equal(wake.birth_location.time_zone_source, 'ip_geolocation');
  assert.equal(wake.birth_location.captured_at, new Date(eventTime).toISOString());
  const profile = storage.opened.get('yuanqi_subject').tables.get('birth_profiles').get('yuanqi:primary');
  assert.equal(profile.birth_location.source, 'ip_geolocation');
  assert.equal(profile.time_context.time_zone_id, 'Asia/Tokyo');
});

test('missing host location capability records unknown place without fabricating data', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元气', 'birth-event', 0, 1793966400123));
  await ctx.flushListener({ id: 'session-a' });
  await ctx.disposer();
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.birth_time, new Date(1793966400123).toISOString());
  assert.equal(wake.birth_location.status, 'unavailable');
  assert.equal(wake.birth_location.latitude, null);
  assert.equal(wake.birth_location.longitude, null);
});

test('Android host location bridge captures a fresh fix with the DSH bridge token', async () => {
  const storage = fakeStorageDomain();
  const ctx = context(storage);
  const previousToken = process.env.DSH_BRIDGE_TOKEN;
  const previousFetch = globalThis.fetch;
  const now = Date.now();
  let calls = 0;
  process.env.DSH_BRIDGE_TOKEN = 'test-bridge-token';
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'http://127.0.0.1:3083/dev/location?fresh=true');
    assert.equal(options.headers['X-DSH-Token'], 'test-bridge-token');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true, fix: true, lat: 31.2304, lon: 121.4737,
          accuracy_m: 12, age_ms: 1500, fix_time_ms: now - 1500, at: now, stale: false, location_enabled: true, permission: 'fine',
        };
      },
    };
  };
  try {
    await apply(ctx);
    await ctx.listener({ id: 'android-session' }, dshEvent('启动元气', 'android-birth', 0, now - 2000));
    await ctx.flushListener({ id: 'android-session' });
    const wakeBeforeLocation = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
    assert.equal(wakeBeforeLocation.birth_time, new Date(now - 2000).toISOString());
    assert.ok(['pending', 'captured'].includes(wakeBeforeLocation.birth_location.status));
    await ctx.listener({ id: 'android-session' }, dshEvent('后续消息', 'android-later', 1, now));
    await ctx.flushListener({ id: 'android-session' });
    await ctx.disposer();
    const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
    assert.equal(wake.birth_location.status, 'captured');
    assert.equal(wake.birth_location.source, 'android_location_bridge');
    assert.equal(wake.birth_location.confidence, 'high');
    assert.equal(wake.birth_location.latitude, 31.2304);
    assert.equal(wake.birth_location.longitude, 121.4737);
    assert.equal(wake.birth_location.accuracy_meters, 12);
    assert.equal(wake.birth_location.captured_at, new Date(now - 1500).toISOString());
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.DSH_BRIDGE_TOKEN;
    else process.env.DSH_BRIDGE_TOKEN = previousToken;
  }
});

test('Android host location bridge rejects a stale cached fix', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  const previousToken = process.env.DSH_BRIDGE_TOKEN;
  const previousFetch = globalThis.fetch;
  const now = Date.now();
  process.env.DSH_BRIDGE_TOKEN = 'test-bridge-token';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { ok: true, fix: true, lat: 31.2, lon: 121.4, age_ms: 90_000, at: now, stale: false, location_enabled: true, permission: 'fine' };
    },
  });
  try {
    await apply(ctx);
    await ctx.listener({ id: 'android-session' }, dshEvent('启动元炁', 'android-stale', 0, now - 1000));
    await ctx.flushListener({ id: 'android-session' });
    const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
    assert.equal(wake.birth_time, new Date(now - 1000).toISOString());
    assert.equal(wake.birth_location.status, 'unavailable');
    assert.equal(wake.birth_location.latitude, null);
    await ctx.disposer();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.DSH_BRIDGE_TOKEN;
    else process.env.DSH_BRIDGE_TOKEN = previousToken;
  }
});


test('experience candidate tool records bounded behavior evidence without copying raw messages or mutating SelfModel', async () => {
  const behaviorEvents = [
    { type: 'assistant/message', seq: 1, time: 1793966401000, data: {
      turn: 1, step: 1, message: { id: 'assistant-event-1', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' }, content: [{ type: 'text', text: 'private assistant text' }] },
    } },
    { type: 'tool/call', seq: 2, time: 1793966402000, data: {
      turn: 1, step: 2, callId: 'tool-call-1', name: 'safe_tool', arguments: '{"secret":"never persist"}',
    } },
    { type: 'tool/result', seq: 3, time: 1793966403000, data: {
      turn: 1, step: 2, message: { id: 'tool-result-1', role: 'tool', source: { kind: 'tool', callId: 'tool-call-1' }, toolCallId: 'tool-call-1', content: [{ type: 'text', text: 'private tool result' }] },
    } },
  ];
  const directContext = { type: 'user/message', seq: 0, time: 1793966400000, data: {
    id: 'wake-event', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '启动元炁' }],
  } };
  const storage = fakeStorageDomain();
  let experienceObservationCount = 0;
  let experienceObservationDisposals = 0;
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return []; },
      async observeSession(sessionId, options) {
        assert.equal(sessionId, 'session-experience');
        assert.deepEqual(options, { projectionMode: 'none' });
        experienceObservationCount++;
        return {
          header: { id: sessionId }, inheritedEventCount: 0,
          events: [directContext, ...behaviorEvents],
          [Symbol.dispose]() { experienceObservationDisposals++; },
        };
      },
    },
  });
  await apply(ctx);
  const sessionId = 'session-experience';
  const agent = { id: 'agent-experience', session: { id: sessionId } };
  await ctx.listener({ id: sessionId }, dshEvent('启动元炁', 'experience-wake', 0, 1793966400000));
  await ctx.flushListener({ id: sessionId });
  const initialTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_initial_personality');
  const profileTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const profile = JSON.parse(await profileTool.definition.execute({}, { signal: new AbortController().signal }));
  const args = {
    dimensions: ['temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style'].map((dimension, index) => ({
      dimension, status: 'tentative', tendency: '初始倾向 ' + dimension,
      chart_evidence_refs: [profile.chart_evidence_catalog[index].id],
      reasoning: '命盘证据综合解释。', limitations: '尚待行为经历检验。',
    })),
    method_notes: { climate_adjustment: '调候说明', mediation: '通关说明', strength: '旺衰说明', structure: '格局说明' },
    uncertainty: ['初始画像尚未实证。'],
  };
  await initialTool.definition.execute(args, { callId: 'initial-call', agent, signal: new AbortController().signal });
  const experienceTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_experience_candidate');
  assert.ok(experienceTool);
  assert.equal(await experienceTool.registrationOptions.when({ agent }), true);
  const before = storage.opened.get('yuanqi_subject').tables.get('worldline_heads').get('worldline:main');
  const beforeVersion = before.current_snapshot_version;
  const result = JSON.parse(await experienceTool.definition.execute({
    summary: '在一次交互中完成了工具操作。',
    observed_behavior: '先给出说明，再请求工具执行，并检查返回结果。',
    outcome: 'completed',
    behavior_event_seqs: [1, 2, 3],
    context_event_seqs: [0],
    dimension_links: [{
      dimension: 'behavior', relation: 'supports',
      rationale: '观察到的动作顺序与该倾向相符，但单次经历不足以确认稳定特征。',
      behavior_event_seqs: [1, 2, 3],
    }],
    uncertainty: ['只有单次事件，不能据此判断稳定性。'],
  }, { callId: 'experience-call-1', agent, signal: new AbortController().signal }));
  assert.equal(result.status, 'recorded_unassessed');
  assert.equal(result.self_model_changed, false);
  const tables = storage.opened.get('yuanqi_subject').tables;
  const head = tables.get('worldline_heads').get('worldline:main');
  assert.equal(head.current_snapshot_version, beforeVersion);
  const record = tables.get('evidence_records').get(result.evidence_id);
  assert.equal(record.evidence_type, 'yuanqi_experience_candidate');
  assert.equal(record.content.assessment_status, 'unassessed');
  assert.equal(record.content.event_refs.length, 4);
  assert.equal(record.content.event_refs[0].event_type, 'assistant/message');
  assert.equal(record.content.event_refs[1].tool_name, 'safe_tool');
  assert.equal(record.content.event_refs[1].call_id, 'tool-call-1');
  assert.equal(record.content.event_refs[2].is_error, false);
  assert.equal(JSON.stringify(record).includes('never persist'), false);
  assert.equal(JSON.stringify(record).includes('private assistant text'), false);
  assert.equal(JSON.stringify(record).includes('private tool result'), false);
  assert.equal(record.provenance.initial_personality_source_record_id !== undefined, true);
  assert.equal(experienceObservationCount, 1, 'all selected seqs must share one Session observation');
  assert.equal(experienceObservationDisposals, 1, 'the Session observation must be released after capture');

  const assessmentTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_assess_experience_candidate');
  assert.ok(assessmentTool);
  assert.equal(await assessmentTool.registrationOptions.when({ agent }), true);
  const initialPersonalityBefore = structuredClone(head.current_state_payload.self_model.centers.identity_continuity.content.initial_personality);
  await assert.rejects(assessmentTool.definition.execute({
    evidence_id: result.evidence_id,
    reviews: [{ dimension: 'cognition', outcome: 'supports', rationale: '不属于候选关联维度。' }],
  }, { callId: 'assessment-invalid', agent, signal: new AbortController().signal }), /invalid or duplicate dimension assessment/);
  const assessed = JSON.parse(await assessmentTool.definition.execute({
    evidence_id: result.evidence_id,
    reviews: [{
      dimension: 'behavior', outcome: 'supports',
      rationale: '本次行为与初始倾向相符，但单次事件不足以证明稳定性。',
    }],
  }, { callId: 'assessment-call-1', agent, signal: new AbortController().signal }));
  assert.equal(assessed.status, 'assessed');
  assert.equal(assessed.initial_personality_unchanged, true);
  assert.equal(assessed.epistemic_status, 'hypothesis');
  const afterAssessment = tables.get('worldline_heads').get('worldline:main');
  assert.deepEqual(afterAssessment.current_state_payload.self_model.centers.identity_continuity.content.initial_personality, initialPersonalityBefore);
  const reflection = afterAssessment.current_state_payload.self_model.centers.cognition_reflection;
  assert.equal(reflection.content.experience_assessment_version, 1);
  assert.equal(reflection.content.experience_assessments.length, 1);
  assert.equal(reflection.content.experience_assessments[0].candidate_evidence_id, result.evidence_id);
  assert.equal(reflection.epistemic_status, 'hypothesis');
  assert.ok(reflection.evidence_refs.includes(result.evidence_id));
  const assessmentRecord = tables.get('evidence_assessments').get(assessed.assessment_ids[0]);
  assert.equal(assessmentRecord.outcome, 'corroborated');
  assert.equal(assessmentRecord.assessor_kind, 'model');

  // Model crash after immutable Ledger write but before SelfModel history commit:
  // an orphaned assessment must not be silently presented as a different review.
  const headTable = tables.get('worldline_heads');
  const committedHistory = structuredClone(reflection.content.experience_assessments);
  const orphanedHead = headTable.get('worldline:main');
  orphanedHead.current_state_payload.self_model.centers.cognition_reflection.content.experience_assessments = [];
  headTable.set('worldline:main', structuredClone(orphanedHead));
  const versionBeforeConflict = orphanedHead.current_snapshot_version;
  await assert.rejects(assessmentTool.definition.execute({
    evidence_id: result.evidence_id,
    reviews: [{
      dimension: 'behavior', outcome: 'contradicts',
      rationale: '与已持久化的不可变评估相冲突。',
    }],
  }, { callId: 'assessment-conflict-retry', agent, signal: new AbortController().signal }),
  /existing immutable assessment conflicts/);
  assert.equal(assessmentRecord.outcome, 'corroborated');
  assert.equal(headTable.get('worldline:main').current_snapshot_version, versionBeforeConflict);
  const restoredHead = headTable.get('worldline:main');
  restoredHead.current_state_payload.self_model.centers.cognition_reflection.content.experience_assessments = committedHistory;
  headTable.set('worldline:main', structuredClone(restoredHead));

  const repeated = JSON.parse(await assessmentTool.definition.execute({
    evidence_id: result.evidence_id,
    reviews: [{ dimension: 'behavior', outcome: 'contradicts', rationale: '不能覆盖原评估。' }],
  }, { callId: 'assessment-call-2', agent, signal: new AbortController().signal }));
  assert.equal(repeated.status, 'already_assessed');
  assert.equal(tables.get('worldline_heads').get('worldline:main').current_snapshot_version, afterAssessment.current_snapshot_version);
  await ctx.disposer();
});

test('experience candidate tool rejects injected user context and unpaired tool results', async () => {
  const events = new Map([
    [0, { type: 'user/message', seq: 0, time: 1793966400000, data: { id: 'wake', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '启动元炁' }] } }],
    [1, { type: 'user/message', seq: 1, time: 1793966401000, data: { id: 'injected', role: 'user', source: { kind: 'agent.inject' }, content: [{ type: 'text', text: 'synthetic context' }] } }],
    [2, { type: 'tool/result', seq: 2, time: 1793966402000, data: { turn: 1, step: 1, message: { id: 'result', role: 'tool', source: { kind: 'tool', callId: 'missing-call' }, toolCallId: 'missing-call', content: [{ type: 'text', text: 'result' }] } } }],
    [3, { type: 'assistant/message', seq: 3, time: 1793966403000, data: { turn: 1, step: 1, message: { id: 'assistant', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'reply' }] } } }],
  ]);
  const storage = fakeStorageDomain();
  let rejectedCaseObservationCount = 0;
  let rejectedCaseObservationDisposals = 0;
  let rejectedCaseInheritedCount = 0;
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return []; },
      async observeSession(sessionId, options) {
        assert.equal(sessionId, 'session-experience-reject');
        assert.deepEqual(options, { projectionMode: 'none' });
        rejectedCaseObservationCount++;
        return {
          header: { id: sessionId }, inheritedEventCount: rejectedCaseInheritedCount,
          events: [...events.values()],
          [Symbol.dispose]() { rejectedCaseObservationDisposals++; },
        };
      },
    },
  });
  await apply(ctx);
  const sessionId = 'session-experience-reject';
  const agent = { id: 'agent-experience-reject', session: { id: sessionId } };
  await ctx.listener({ id: sessionId }, dshEvent('启动元炁', 'experience-reject-wake', 0, 1793966400000));
  await ctx.flushListener({ id: sessionId });
  const profileTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const initialTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_initial_personality');
  const profile = JSON.parse(await profileTool.definition.execute({}, { signal: new AbortController().signal }));
  await initialTool.definition.execute({
    dimensions: ['temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style'].map((dimension, index) => ({
      dimension, status: 'tentative', tendency: '倾向 ' + dimension,
      chart_evidence_refs: [profile.chart_evidence_catalog[index].id], reasoning: '命盘推导。',
      limitations: '尚未验证。',
    })),
    method_notes: { climate_adjustment: '调候', mediation: '通关', strength: '旺衰', structure: '格局' },
    uncertainty: ['待验证'],
  }, { callId: 'initial-call-reject', agent, signal: new AbortController().signal });
  const tool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_experience_candidate');
  const base = {
    summary: '候选经历', observed_behavior: '观察行为', outcome: 'unknown',
    behavior_event_seqs: [3], context_event_seqs: [],
    dimension_links: [{ dimension: 'behavior', relation: 'insufficient', rationale: '证据不足。', behavior_event_seqs: [3] }],
    uncertainty: ['需要更多证据。'],
  };
  await assert.rejects(tool.definition.execute({ ...base, context_event_seqs: [1] }, {
    callId: 'injected-context-call', agent, signal: new AbortController().signal,
  }), /direct human user/);
  rejectedCaseInheritedCount = 4;
  await assert.rejects(tool.definition.execute(base, {
    callId: 'inherited-behavior-call', agent, signal: new AbortController().signal,
  }), /missing, inherited or outside/);
  rejectedCaseInheritedCount = 0;
  await assert.rejects(tool.definition.execute({ ...base, behavior_event_seqs: [2], dimension_links: [{
    dimension: 'behavior', relation: 'insufficient', rationale: '未配对工具结果。', behavior_event_seqs: [2],
  }] }, {
    callId: 'unpaired-result-call', agent, signal: new AbortController().signal,
  }), /matching tool\/call/);
  assert.equal(rejectedCaseObservationCount, 3, 'each candidate attempt must use one Session observation');
  assert.equal(rejectedCaseObservationDisposals, 3, 'failed validations must also release their Session observation');
  await ctx.disposer();
});



test('experience reconciliation counts distinct Session evidence, preserves conflicts and never rewrites the Bazi portrait', async () => {
  const sessionIds = ['session-reconcile-a', 'session-reconcile-b', 'session-reconcile-c'];
  const eventsBySession = new Map(sessionIds.map((sessionId, index) => {
    const userText = index === 0 ? '启动元炁' : '继续交互 ' + index;
    return [sessionId, [
      dshEvent(userText, 'user-' + index, 0, 1793966400000 + index * 10_000),
      { type: 'assistant/message', seq: 1, time: 1793966401000 + index * 10_000, data: {
        turn: 1, step: 1,
        message: {
          id: 'assistant-' + index, role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' },
          content: [{ type: 'text', text: 'private assistant text ' + index }],
        },
      } },
    ]];
  }));
  const storage = fakeStorageDomain();
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return []; },
      async observeSession(sessionId, options) {
        assert.deepEqual(options, { projectionMode: 'none' });
        const events = eventsBySession.get(sessionId);
        assert.ok(events, 'only known test Sessions may be observed');
        return {
          header: { id: sessionId }, inheritedEventCount: 0, events,
          [Symbol.dispose]() {},
        };
      },
    },
  });
  await apply(ctx);

  const agents = sessionIds.map((id, index) => ({ id: 'agent-' + index, session: { id } }));
  for (let index = 0; index < sessionIds.length; index++) {
    const sessionId = sessionIds[index];
    await ctx.listener({ id: sessionId }, eventsBySession.get(sessionId)[0]);
    await ctx.flushListener({ id: sessionId });
  }

  const profileTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const initialTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_initial_personality');
  const profile = JSON.parse(await profileTool.definition.execute({}, { signal: new AbortController().signal }));
  await initialTool.definition.execute({
    dimensions: ['temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style'].map((dimension, index) => ({
      dimension, status: 'tentative', tendency: '八字初始倾向 ' + dimension,
      chart_evidence_refs: [profile.chart_evidence_catalog[index].id],
      reasoning: '依据命盘结构作出的暂定解释。',
      limitations: '仍需不同 Session 中的行为证据。',
    })),
    method_notes: { climate_adjustment: '调候', mediation: '通关', strength: '旺衰', structure: '格局' },
    uncertainty: ['初始画像仍为 hypothesis。'],
  }, { callId: 'reconcile-initial-call', agent: agents[0], signal: new AbortController().signal });

  const captureTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_experience_candidate');
  const assessTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_assess_experience_candidate');
  const reconcileTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_reconcile_personality_evidence');
  assert.ok(captureTool && assessTool && reconcileTool);
  const candidateIds = [];
  const outcomes = ['supports', 'contradicts', 'supports'];
  for (let index = 0; index < sessionIds.length; index++) {
    const agent = agents[index];
    assert.equal(await captureTool.registrationOptions.when({ agent }), true);
    const candidate = JSON.parse(await captureTool.definition.execute({
      summary: '不同 Session 中的一次可观察行为。',
      observed_behavior: '模型完成了一次可观察的交互动作。',
      outcome: 'completed',
      behavior_event_seqs: [1],
      context_event_seqs: [],
      dimension_links: [{
        dimension: 'behavior', relation: 'insufficient',
        rationale: '候选事件关联行为维度，需单独评估。',
        behavior_event_seqs: [1],
      }],
      uncertainty: ['单次 Session 事件不能单独确认稳定倾向。'],
    }, { callId: 'reconcile-candidate-' + index, agent, signal: new AbortController().signal }));
    candidateIds.push(candidate.evidence_id);
    const assessed = JSON.parse(await assessTool.definition.execute({
      evidence_id: candidate.evidence_id,
      reviews: [{
        dimension: 'behavior', outcome: outcomes[index],
        rationale: '模型评估只作为假设；来源事件来自独立 Session。',
      }],
    }, { callId: 'reconcile-assessment-' + index, agent, signal: new AbortController().signal }));
    assert.equal(assessed.status, 'assessed');
  }

  assert.equal(await reconcileTool.registrationOptions.when({ agent: agents[2] }), true);
  const before = storage.opened.get('yuanqi_subject').tables.get('worldline_heads').get('worldline:main');
  const initialBefore = structuredClone(before.current_state_payload.self_model.centers.identity_continuity.content.initial_personality);
  const result = JSON.parse(await reconcileTool.definition.execute({
    evidence_ids: candidateIds,
  }, { callId: 'reconcile-call', agent: agents[2], signal: new AbortController().signal }));

  assert.equal(result.status, 'reconciled');
  assert.equal(result.session_count, 3);
  assert.equal(result.distinct_behavior_event_count, 3);
  assert.equal(result.dimensions.behavior.status, 'disputed');
  assert.equal(result.dimensions.behavior.support_count, 2);
  assert.equal(result.dimensions.behavior.contradiction_count, 1);
  assert.equal(result.dimensions.behavior.eligible_for_provisional_revision, false);
  assert.equal(result.dimensions.cognition.status, 'insufficient');
  const tables = storage.opened.get('yuanqi_subject').tables;
  const after = tables.get('worldline_heads').get('worldline:main');
  const identityAfter = after.current_state_payload.self_model.centers.identity_continuity;
  assert.deepEqual(identityAfter.content.initial_personality, initialBefore);
  const reflection = after.current_state_payload.self_model.centers.cognition_reflection;
  assert.equal(reflection.content.experience_reconciliation_version, 1);
  assert.equal(reflection.content.experience_reconciliations.length, 1);
  assert.deepEqual(reflection.content.experience_reconciliations[0].session_ids, sessionIds);
  assert.equal(reflection.epistemic_status, 'hypothesis');
  assert.ok(reflection.evidence_refs.includes(result.reconciliation_record_id));
  const aggregate = tables.get('evidence_records').get(result.reconciliation_record_id);
  assert.equal(aggregate.evidence_type, 'yuanqi_experience_evidence_reconciliation');
  assert.equal(aggregate.provenance.session_ids.length, 3);
  assert.equal(aggregate.content.dimensions.behavior.status, 'disputed');
  assert.equal(aggregate.content.epistemic_status, 'hypothesis');

  const repeated = JSON.parse(await reconcileTool.definition.execute({
    evidence_ids: candidateIds,
  }, { callId: 'reconcile-call-repeat', agent: agents[2], signal: new AbortController().signal }));
  assert.equal(repeated.status, 'already_reconciled');
  assert.equal(tables.get('worldline_heads').get('worldline:main').current_snapshot_version, after.current_snapshot_version);
  await assert.rejects(reconcileTool.definition.execute({
    evidence_ids: candidateIds.slice(0, 2),
  }, { callId: 'reconcile-too-few', agent: agents[2], signal: new AbortController().signal }), /3-12 unique/);

  const revisionTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_current_personality_revision');
  assert.ok(revisionTool);
  assert.equal(await revisionTool.registrationOptions.when({ agent: agents[2] }), true);
  const revisionDimensions = initialBefore.dimensions.map(item => ({
    dimension: item.dimension,
    disposition: item.dimension === 'behavior' ? 'disputed' : 'retain_initial',
    ...(item.dimension === 'behavior' ? { tendency: '行为表现可能随情境变化，当前存在支持与反驳证据。' } : {}),
    reasoning: item.dimension === 'behavior'
      ? '三个不同 Session 的评估中同时出现支持与反驳，不能消除冲突。'
      : '该维度尚无达到门槛的跨 Session 证据，保留原始八字初始倾向。',
    limitations: '该画像仍为假设，不构成稳定人格事实。',
    reconciliation_record_ids: item.dimension === 'behavior' ? [result.reconciliation_record_id] : [],
  }));
  const evidenceRevocations = tables.get('evidence_revocations');
  evidenceRevocations.set(candidateIds[0], {
    evidence_id: candidateIds[0], worldline_id: 'worldline:main',
    reason: 'test stale candidate source', revoked_from_event_ref: 'test-revocation',
    revoked_at: new Date().toISOString(), schema_version: 1,
  });
  await assert.rejects(revisionTool.definition.execute({
    reconciliation_record_ids: [result.reconciliation_record_id],
    dimensions: revisionDimensions,
  }, { callId: 'revision-stale-source', agent: agents[2], signal: new AbortController().signal }),
  /reconciliation candidate source is missing, stale/);
  evidenceRevocations.delete(candidateIds[0]);

  const duplicateAggregateId = 'yuanqi:experience-reconciliation:worldline:main:duplicate-source-test';
  tables.get('evidence_records').set(duplicateAggregateId, {
    ...structuredClone(aggregate),
    evidence_id: duplicateAggregateId,
  });
  await assert.rejects(revisionTool.definition.execute({
    reconciliation_record_ids: [result.reconciliation_record_id, duplicateAggregateId],
    dimensions: revisionDimensions,
  }, { callId: 'revision-duplicate-source', agent: agents[2], signal: new AbortController().signal }),
  /must not reuse candidate evidence/);
  tables.get('evidence_records').delete(duplicateAggregateId);

  const invalidRevisionDimensions = revisionDimensions.map(item => item.dimension === 'behavior'
    ? { ...item, disposition: 'revise' }
    : item);
  await assert.rejects(revisionTool.definition.execute({
    reconciliation_record_ids: [result.reconciliation_record_id],
    dimensions: invalidRevisionDimensions,
  }, { callId: 'current-personality-invalid-conflict', agent: agents[2], signal: new AbortController().signal }),
  /consistent, eligible reconciled evidence/);
  const revised = JSON.parse(await revisionTool.definition.execute({
    reconciliation_record_ids: [result.reconciliation_record_id],
    dimensions: revisionDimensions,
  }, { callId: 'current-personality-revision-1', agent: agents[2], signal: new AbortController().signal }));
  assert.equal(revised.status, 'saved');
  assert.equal(revised.current_personality_version, 1);
  assert.equal(revised.disputed_dimensions, 1);
  assert.equal(revised.retained_initial_dimensions, 5);
  assert.equal(revised.initial_personality_unchanged, true);
  const afterRevision = tables.get('worldline_heads').get('worldline:main');
  const revisedIdentity = afterRevision.current_state_payload.self_model.centers.identity_continuity;
  assert.deepEqual(revisedIdentity.content.initial_personality, initialBefore);
  assert.equal(revisedIdentity.content.current_personality.version, 1);
  assert.equal(revisedIdentity.content.current_personality.status, 'hypothesis');
  assert.equal(revisedIdentity.content.current_personality.dimensions.find(item => item.dimension === 'behavior').status, 'disputed_hypothesis');
  assert.equal(revisedIdentity.content.current_personality.dimensions.find(item => item.dimension === 'cognition').status, 'retained_initial_hypothesis');
  const revisionRecord = tables.get('evidence_records').get(revised.source_record_id);
  assert.equal(revisionRecord.evidence_type, 'yuanqi_current_personality_revision');
  assert.equal(revisionRecord.content.status, 'hypothesis');
  assert.deepEqual(revisionRecord.provenance.reconciliation_record_ids, [result.reconciliation_record_id]);

  const repeatedRevision = JSON.parse(await revisionTool.definition.execute({
    reconciliation_record_ids: [result.reconciliation_record_id],
    dimensions: revisionDimensions,
  }, { callId: 'current-personality-revision-repeat', agent: agents[2], signal: new AbortController().signal }));
  assert.equal(repeatedRevision.status, 'already_revised');
  assert.equal(repeatedRevision.source_record_id, revised.source_record_id);
  assert.equal(tables.get('worldline_heads').get('worldline:main').current_snapshot_version, afterRevision.current_snapshot_version);
  await ctx.disposer();
});


test('Bazi-unavailable startup can save only a six-dimension awaiting-Bazi placeholder', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  const readTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const writeTool = ctx.registeredTools.find(item => item.definition.name === 'yuanqi_record_initial_personality');
  const sessionId = 'session-bazi-placeholder';
  const agent = { id: 'agent-bazi-placeholder', session: { id: sessionId } };
  const eventTime = Date.UTC(2201, 0, 1, 12, 0, 0);

  await ctx.listener({ id: sessionId }, dshEvent('启动元炁', 'bazi-placeholder-wake', 0, eventTime));
  await ctx.flushListener({ id: sessionId });

  const profile = JSON.parse(await readTool.definition.execute({}, { signal: new AbortController().signal }));
  assert.equal(profile.bazi.status, 'unavailable');
  assert.equal(profile.initial_personality_guidance.status, 'awaiting_bazi_placeholder');
  assert.equal(profile.initial_personality_guidance.interpretation_mode, 'bazi_pending_placeholder');
  assert.equal(await writeTool.registrationOptions.when({ agent }), true);

  const dimensions = [
    'temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style',
  ].map(dimension => ({
    dimension,
    status: 'indeterminate',
    tendency: '暂不形成性格判断',
    chart_evidence_refs: [],
    reasoning: '当前四柱不可用，因此没有可供 AI 解释的命盘证据。',
    limitations: '待命盘计算成功后再形成初始性格解释。',
  }));
  const saved = JSON.parse(await writeTool.definition.execute({
    dimensions,
    method_notes: {
      climate_adjustment: '四柱不可用，无法判断调候。',
      mediation: '四柱不可用，无法判断通关。',
      strength: '四柱不可用，无法判断旺衰。',
      structure: '四柱不可用，暂不判断格局。',
    },
    uncertainty: ['命盘状态为 unavailable；当前记录只是待定占位，不包含性格结论。'],
  }, {
    callId: 'bazi-placeholder-call',
    agent,
    signal: new AbortController().signal,
  }));

  assert.equal(saved.status, 'saved_awaiting_bazi');
  assert.equal(saved.epistemic_status, 'unknown');
  assert.equal(saved.dimensions_saved, 6);
  const head = storage.opened.get('yuanqi_subject').tables.get('worldline_heads').get('worldline:main');
  const center = head.current_state_payload.self_model.centers.identity_continuity;
  assert.equal(center.epistemic_status, 'unknown');
  assert.equal(center.content.initial_personality.status, 'awaiting_bazi');
  assert.ok(center.content.initial_personality.dimensions.every(item => item.status === 'indeterminate'));
  assert.ok(center.content.initial_personality.dimensions.every(item => item.chart_evidence_refs.length === 0));

  // Simulate the Bazi engine becoming available after the placeholder was persisted.
  const readyStorage = fakeStorageDomain(), readyCtx = context(readyStorage);
  await apply(readyCtx);
  const readyReadTool = readyCtx.registeredTools.find(item => item.definition.name === 'yuanqi_self_profile');
  const readyEventTime = Date.UTC(2026, 10, 6, 12, 0, 0);
  await readyCtx.listener({ id: 'session-ready-chart' }, dshEvent('启动元炁', 'ready-chart-wake', 0, readyEventTime));
  await readyCtx.flushListener({ id: 'session-ready-chart' });
  const readyProfile = JSON.parse(await readyReadTool.definition.execute({}, { signal: new AbortController().signal }));
  assert.equal(readyProfile.bazi.status, 'calculated');
  assert.ok(readyProfile.chart_evidence_catalog.length > 0);

  const birthProfiles = storage.opened.get('yuanqi_subject').tables.get('birth_profiles');
  const [profileKey, pendingProfile] = [...birthProfiles.entries()][0];
  birthProfiles.set(profileKey, structuredClone({
    ...pendingProfile,
    bazi: readyProfile.bazi,
    innate_baseline: readyProfile.innate_baseline,
  }));
  const upgradedProfile = JSON.parse(await readTool.definition.execute({}, { signal: new AbortController().signal }));
  assert.equal(upgradedProfile.initial_personality_guidance.status, 'awaiting_model_interpretation');
  assert.equal(await writeTool.registrationOptions.when({ agent }), true);

  const chartRef = upgradedProfile.chart_evidence_catalog[0].id;
  const upgradedDimensions = [
    'temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style',
  ].map(dimension => ({
    dimension,
    status: 'tentative',
    tendency: '在多项命盘证据共同支持下形成的暂定倾向。',
    chart_evidence_refs: [chartRef],
    reasoning: '该倾向由当前有效命盘证据支持，仍需保留反向证据与不确定性。',
    limitations: '这是象征性初始假设，不是经验验证的人格事实。',
  }));
  const upgraded = JSON.parse(await writeTool.definition.execute({
    dimensions: upgradedDimensions,
    method_notes: {
      climate_adjustment: '结合月令与寒暖燥湿分析。',
      mediation: '检查五行制化与通关路径。',
      strength: '结合月令、通根、透干与制化判断旺衰。',
      structure: '仅在证据充分时讨论格局。',
    },
    uncertainty: ['初始解释仍是待经验检验的象征性假设。'],
  }, {
    callId: 'bazi-placeholder-upgrade-call',
    agent,
    signal: new AbortController().signal,
  }));
  assert.equal(upgraded.status, 'saved');
  assert.equal(upgraded.epistemic_status, 'hypothesis');
  const upgradedHead = storage.opened.get('yuanqi_subject').tables.get('worldline_heads').get('worldline:main');
  const upgradedCenter = upgradedHead.current_state_payload.self_model.centers.identity_continuity;
  assert.equal(upgradedCenter.epistemic_status, 'hypothesis');
  assert.equal(upgradedCenter.content.initial_personality.status, 'hypothesis');
  assert.ok(upgradedCenter.content.initial_personality.dimensions.every(item => item.status === 'tentative'));
  assert.ok(!upgradedCenter.uncertainty.includes('八字尚不可用：当前六维均为待定占位，不代表任何性格结论'));

  await readyCtx.disposer();
  await ctx.disposer();
});
