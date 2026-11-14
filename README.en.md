# YuanQi (元炁) — DSH Plugin

**Version:** 1.1.0-alpha.9  
**Package:** `dsh-yuanqi-plugin`  
**Host:** DeepSeek Harness (DSH)

YuanQi is a DSH-hosted life-context and digital-personality evolution plugin. DSH remains the authority for the Agent, sessions, tools, lifecycle, and persistence.

## Alpha.9

- Session-scoped persistent worldlines, branching and switching.
- Evidence-backed candidate memories; explicit user confirmation is required before promotion.
- Experience records with supporting and contradictory evidence.
- Goals and planned/observed behaviors.
- A bounded projection of confirmed memories, experiences, goals and planned behaviors into the first model step of each turn.
- Birth-profile calculation with source-event evidence and explicit confirmation gates.
- Reversible birth-code encoding; no SHA-256 or hashing.

## Validation

Local verification for alpha.9: **96 tests passed, 0 failed**; JavaScript syntax checks and package/archive smoke checks passed.

This is local validation only. It does **not** claim successful installation or execution in a real Android DSH host.

## Requirements

- Node.js `>=24.9.0`
- DSH peer packages in the compatible `>=0.2.2-rc.1 <0.3.0-0` range:
  - `@deepseek-ai/dsh-tools`
  - `@deepseek-ai/dsh-storage-domain`
  - `@deepseek-ai/dsh-session`
  - `@deepseek-ai/dsh-llm`
  - `@deepseek-ai/dsh-session-query`
  - `@deepseek-ai/dsh-session-persistence`

## Install

Build the package archive and install it into the target DSH profile:

```sh
npm run check
npm pack
dsh plugin --profile web add ./dist/dsh-yuanqi-plugin-1.1.0-alpha.9.tgz
```

Restart the target profile after installation.

## Core boundaries

- YuanQi may receive ordinary direct-user messages after installation without waking. It wakes on the first direct-user `user/message` event whose content consists of exactly one text block and whose full text is exactly `启动元气` or `启动元炁`. Whitespace, quotes, punctuation, appended text, multiple content blocks, assistant output, and injected context do not match. The wake instant is YuanQi's own birth time. Its BirthProfile belongs to YuanQiSubject and is derived from that host event plus an authorized host location fix; user birth details are not part of YuanQi initialization. Cold-history recovery excludes pre-activation events and Fork-inherited prefixes; it never substitutes the current device location for a historical wake location.
- Personal birth facts must come from the user and pass explicit confirmation; no IP/device geolocation or model inference is used to fill them.
- DSH Storage Domain is the sole online persistence authority.
- Stored memories, experiences and goals are context data, not instructions that override the user's current request.
- Candidate memories are not treated as confirmed facts.

## License

GNU GPL-3.0-only. See [LICENSE](./LICENSE).
