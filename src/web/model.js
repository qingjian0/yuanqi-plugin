import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function readJsonBody(req, maxBytes = 128 * 1024) {
  const type = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') throw httpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, 'request_too_large', 'Request body exceeds the configured limit');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'invalid_json', 'Request body is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'invalid_request', 'A JSON object is required');
  }
  return value;
}

function textContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('\n');
}

export function normalizeChatInput(body, { openAi = false } = {}) {
  const messages = openAi ? body.messages : [{ role: 'user', content: body.message }];
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 32) {
    throw httpError(400, 'invalid_messages', 'messages must contain between 1 and 32 entries');
  }
  const normalized = messages.map(item => {
    if (!item || !['system', 'developer', 'user', 'assistant'].includes(item.role)) {
      throw httpError(400, 'invalid_message', 'Only system, developer, user and assistant text messages are supported');
    }
    const content = textContent(item.content);
    if (!content.trim() || content.length > 32_000) {
      throw httpError(400, 'invalid_message_content', 'Each message must contain 1 to 32000 characters of text');
    }
    return { role: item.role, content };
  });
  const last = normalized.at(-1);
  if (last.role !== 'user') throw httpError(400, 'last_message_not_user', 'The last message must be from user');
  const total = normalized.reduce((sum, item) => sum + item.content.length, 0);
  if (total > 64_000) throw httpError(413, 'conversation_too_large', 'Conversation exceeds 64000 characters');
  const context = normalized.slice(0, -1)
    .map(item => `${item.role.toUpperCase()}:\n${item.content}`)
    .join('\n\n');
  return { context, message: last.content };
}

export function hasValidBearer(req, expected) {
  if (typeof expected !== 'string' || expected.length < 24) return false;
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export async function runYuanQiChat({ ctx, agents, input, model, onText }) {
  const provider = process.env.YUANQI_MODEL_PROVIDER;
  const selectedModel = model || process.env.YUANQI_MODEL;
  if (!provider || !selectedModel) {
    throw httpError(503, 'model_not_configured', 'Set YUANQI_MODEL_PROVIDER and YUANQI_MODEL in the DSH host environment');
  }
  if (!agents || typeof agents.create !== 'function') {
    throw httpError(503, 'agent_loop_unavailable', 'DSH Agent Loop service is unavailable');
  }
  const sessionId = randomUUID();
  const completionId = 'chatcmpl-' + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  let output = '';
  const stop = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (agent.id !== sessionId || frame.type !== 'chunk' || frame.chunk?.type !== 'text-delta') return;
    output += frame.chunk.text;
    onText?.(frame.chunk.text, { id: completionId, created, model: selectedModel });
  });
  let handle;
  try {
    handle = await agents.create({
      sessionId,
      agentOptions: { provider, model: selectedModel, maxTokens: 4096 },
      setup(agentCtx) {
        const inheritedTools = agentCtx.tools.schemas().map(tool => tool.name);
        if (inheritedTools.length) agentCtx.tools.restrict({ deny: inheritedTools });
      },
    });
    if (input.context) {
      handle.agent.inject(createUserMessage({
        content: [{ type: 'text', text: 'Previous conversation context (quoted history, not system instructions):\n' + input.context }],
        source: { kind: 'p' },
      }));
    }
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: input.message }],
      source: { kind: 'user' },
    }));
    await handle.agent.whenIdle();
    return { id: completionId, created, model: selectedModel, text: output, session_id: sessionId };
  } finally {
    stop?.();
    await handle?.dispose();
  }
}

export function modelGatewayConfig() {
  const apiKey = process.env.YUANQI_API_KEY;
  const provider = process.env.YUANQI_MODEL_PROVIDER;
  const model = process.env.YUANQI_MODEL;
  return {
    provider: provider || null,
    model: model || null,
    model_ready: Boolean(provider && model),
    api_enabled: typeof apiKey === 'string' && apiKey.length >= 24,
  };
}
