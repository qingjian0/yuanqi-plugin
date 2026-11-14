/**
 * Host-normalized direct DSH user events.
 *
 * The WeakSet is a process-local capability: callers cannot make an arbitrary
 * object trusted by adding a `verified: true` property. Only this adapter can
 * brand an event after it has received the host SessionId and SessionEvent.
 */
const trustedDirectUserEvents = new WeakSet();

export function isTrustedDirectUserMessageEvent(event) {
  return Boolean(event && typeof event === 'object' && trustedDirectUserEvents.has(event));
}

/**
 * Normalize the documented DSH SessionEvent shape.
 * sessionId must come from the trusted host listener context, never model/tool input.
 */
export function normalizeDirectUserMessageEvent(sessionId, event) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new TypeError('host SessionId is required');
  }
  if (!event || event.type !== 'user/message') return null;

  const message = event.data;
  if (!message || message.role !== 'user' || message.source?.kind !== 'user') return null;
  if (typeof message.id !== 'string' || message.id.trim() === '') {
    throw new TypeError('DSH user message id is required');
  }
  if (!Number.isSafeInteger(event.seq) || event.seq < 0) {
    throw new TypeError('DSH SessionEvent.seq must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(event.time) || event.time < 0) {
    throw new TypeError('DSH SessionEvent.time must be Unix milliseconds');
  }

  const content = Array.isArray(message.content) ? message.content : [];
  const text = content.length === 1 && content[0]?.type === 'text' &&
    typeof content[0].text === 'string'
    ? content[0].text
    : '';

  const normalized = {
    event_type: 'user/message',
    source_kind: 'user',
    session_id: sessionId,
    event_id: message.id,
    event_seq: event.seq,
    event_time: event.time,
    text,
  };
  trustedDirectUserEvents.add(normalized);
  return normalized;
}
