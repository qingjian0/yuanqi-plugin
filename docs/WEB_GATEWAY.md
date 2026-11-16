# YuanQi Web Console and Gateway

## Scope in this implementation slice

The console is mounted by the YuanQi DSH plugin through the existing
\`@deepseek-ai/dsh-host-webserver\` service. It shares the live SubjectStore and
the existing Storage Domain; it does not create a second database or listener.

- \`GET /yuanqi\`: four-section lightweight console shell.
- \`GET /yuanqi/api/status\`: plugin and storage readiness.
- \`GET /yuanqi/api/profile\`: YuanQi AI's own BirthProfile, or \`null\`.
- All routes require an authenticated DSH Peer. The WebServer/Connection
  admission path remains authoritative; the plugin does not add a bypass token.
- Route registration is disposed with the plugin.

## Model gateway boundary

The OpenAI-compatible model gateway is deliberately not advertised as active
in this slice. It must use the DSH Agent Loop and durable Session lifecycle,
not call \`ctx.llm\` as an untracked one-shot proxy. Before exposing
\`/yuanqi/v1/chat/completions\`, implementation must verify the Android-bundled
Agent Loop API and settle session ownership, model selection, streaming,
cancellation, and API-key storage. Until then the UI labels chat as pending.

## Remaining console surfaces

The Memory and experience-evidence pages are navigation shells only. They
must be connected to existing domain query APIs before showing or mutating
records. The personality page reads only YuanQi AI's own BirthProfile and does
not infer personality in the browser.
