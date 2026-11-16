# YuanQi Web Console and Gateway

## Scope in this implementation slice

The console is mounted by the YuanQi DSH plugin through the existing
`@deepseek-ai/dsh-host-webserver` service. It shares the live SubjectStore and
the existing Storage Domain; it does not create a second database or listener.

- `GET /yuanqi`: four-section lightweight console shell.
- `GET /yuanqi/api/status`: plugin and storage readiness.
- `GET /yuanqi/api/profile`: YuanQi AI's own BirthProfile, or `null`.
- `POST /yuanqi/api/chat`: same-origin DSH Peer chat, backed by a fresh Agent Loop Session.
- `POST /yuanqi/v1/chat/completions`: OpenAI-compatible text chat; bearer key is read from `YUANQI_API_KEY` and provider/model from `YUANQI_MODEL_PROVIDER` / `YUANQI_MODEL`.
- All routes require an authenticated DSH Peer. The WebServer/Connection
  admission path remains authoritative; the plugin does not add a bypass token.
- Route registration is disposed with the plugin.

## Model gateway boundary

The model gateway uses `ctx.agents.create()` and `Agent.followup()` / `whenIdle()`;
each request owns a fresh durable Session and disposes its AgentHandle after
completion. Global inherited tools are masked for this external text-only API.
The endpoint is available only when the host environment supplies a sufficiently
long `YUANQI_API_KEY`, `YUANQI_MODEL_PROVIDER`, and `YUANQI_MODEL`. The web
console's same-origin chat route uses the authenticated DSH Peer instead of an
API key. No API key is persisted in the YuanQi Storage Domain.

## Remaining console surfaces

The Memory and experience-evidence pages are navigation shells only. They
must be connected to existing domain query APIs before showing or mutating
records. The personality page reads only YuanQi AI's own BirthProfile and does
not infer personality in the browser.
