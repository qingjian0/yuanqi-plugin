# YuanQi Web Console and Gateway

## Scope in this implementation slice

The console is mounted by the YuanQi DSH plugin through the existing
`@deepseek-ai/dsh-host-webserver` service. It shares the live SubjectStore and
the existing Storage Domain; it does not create a second database or listener.

- `GET /yuanqi`: four-section lightweight console shell.
- `GET /yuanqi/api/status`: plugin and storage readiness.
- `GET /yuanqi/api/profile`: YuanQi AI's own BirthProfile, or `null`.
- `GET /yuanqi/api/worldline`: main Worldline metadata, current snapshot version, and SelfModel.
- `GET /yuanqi/api/evidence`: evidence records referenced by the current mainline SelfModel.
- `POST /yuanqi/api/chat`: same-origin DSH Peer chat, backed by a resumable Agent Loop Session and a peer-bound chat token.
- `GET /yuanqi/v1/models`: OpenAI-compatible model catalog, protected by the API bearer key.
- `POST /yuanqi/v1/chat/completions`: OpenAI-compatible text chat; bearer key is read from `YUANQI_API_KEY` and provider/model from `YUANQI_MODEL_PROVIDER` / `YUANQI_MODEL`.
- The console and `/yuanqi/api/*` routes require an authenticated DSH Peer.
  `/yuanqi/v1/*` uses WebServer anonymous admission plus a constant-time checked
  bearer API key; Connection's Host/Origin source fence still applies.
- Route registration is disposed with the plugin. Its cleanup is sequenced in the same Cordis effect as Storage Domain shutdown: the plugin first closes admission and drains active model requests, then waits for pending Session and location work, and only then closes the domains. This is required because separate asynchronous Cordis disposers may begin concurrently.

## Model gateway boundary

The model gateway uses `ctx.agents.create()` and `Agent.followup()` / `whenIdle()`;
each request owns a durable Session and disposes its AgentHandle after
completion. Both HTTP chat routes observe request aborts and premature response
closure; request-body parsing is also abortable, and plugin unload destroys a
stalled incoming body stream so it cannot keep teardown pending. The gateway
cancels the owned Agent with `Agent.cancel({ kind: 'user' })`, waits for the
Agent to settle, and disposes the handle instead of leaving generation running
after the client disconnects. Plugin unload closes admission, invalidates
peer-bound chat tokens, aborts every admitted chat request, drains the complete
HTTP handler (including body parsing and Agent execution), and only then allows
Storage Domain shutdown. Conversation history is carried as bounded, quoted context into the
new request Session. Global inherited tools are masked for this external text-only API.
The endpoint is available only when the host environment supplies a sufficiently
long `YUANQI_API_KEY`, `YUANQI_MODEL_PROVIDER`, and `YUANQI_MODEL`. The web
console's same-origin chat route uses the authenticated DSH Peer instead of an
API key. It returns an opaque token mapped to that Peer and Session in process
memory; tokens expire after 12 hours, the map is capped at 256 entries, and
plugin unload invalidates the tokens. The raw Session ID is never returned.
OpenAI message history is flattened into quoted context for each stateless API
request; it does not preserve provider-native role channels. No API key is
persisted in the YuanQi Storage Domain.

## Current UI boundaries

The personality page reads YuanQi AI's own BirthProfile and current SelfModel;
it does not infer personality in the browser. The memory page lists evidence
currently referenced by the mainline SelfModel. It does not yet enumerate
unreferenced candidate evidence or mutate/revoke records. The four-page shell
is intentionally read-only apart from chat.


## Host configuration and client access

Set these variables in the DSH host process before starting the engine:

- `YUANQI_MODEL_PROVIDER`: registered DSH LLM adapter/provider id.
- `YUANQI_MODEL`: default model id.
- `YUANQI_API_KEY`: a random secret of at least 24 characters.

The console's Settings page shows the active base URL and whether these values
are configured; it never displays the secret.

Local API base URL:

`http://127.0.0.1:3080/yuanqi/v1`

For a LAN client, use the existing DSH reverse proxy:

`http://<phone-ip>:3090/yuanqi/v1`

The LAN proxy has its own password cookie in addition to the YuanQi bearer key.
A non-browser client must send both credentials when using port 3090:
`Cookie: dsh_lan_pw=<LAN-proxy-password>` and
`Authorization: Bearer <YUANQI_API_KEY>`. Do not put either secret in the
URL or browser-visible query string.

Example request:

```bash
curl http://127.0.0.1:3080/yuanqi/v1/chat/completions \\
  -H "Authorization: Bearer $YUANQI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

The requested `model` is routed through the configured
`YUANQI_MODEL_PROVIDER`; `max_tokens` / `max_completion_tokens` is bounded to
1–8192. Text is supported; multimodal content and tool calls are not.
