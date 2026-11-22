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

Current `dev` runtime/test baseline commit `fe9d681a26c31d4ce35f7da723fc09bc37845fd8` passed GitHub Actions on 2026-11-22: **123 tests passed, 0 failed** on Node.js 24.9.0, including DSH peer/API export checks. Regression coverage includes aborting active Agent requests and draining them during plugin unload. The current snapshot also passed [Package workflow #45002789087](https://github.com/qingjian0/yuanqi-plugin/actions/runs/45002789087), which created and uploaded a 79,548-byte npm archive.

- [CI test run](https://github.com/qingjian0/yuanqi-plugin/actions/runs/45002651811)

These checks validate the repository snapshot only. Real Android DSH host installation, unload/reload, production Storage Domain behavior, and live model-provider end-to-end acceptance remain pending.

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
- YuanQi's BirthProfile is its own AI birth record, not the user's. When an authorized host location supplies coordinates, the plugin prefers an explicit host IANA time zone and otherwise resolves one from a bundled offline coordinate-to-time-zone database; it then derives local apparent solar time, solar-term context and four pillars. Missing location/time-zone data never gets filled from user birth facts, IP geolocation or model inference. Jie, apparent-solar midnight and double-hour boundaries within the 30-minute guard are marked ambiguous rather than forced.
- The model reads its own BirthProfile through the conditional read-only `yuanqi_self_profile` tool on demand; the full record is not injected into every prompt. The tool appears only after YuanQi is initialized and never returns the user's birth data or exact coordinates.
- A versioned symbolic `innate_baseline` derives the day master, visible stems, hidden stems, ten-god relations and unweighted five-element occurrence counts. It is explicitly not a personality profile, strength score or destiny claim; SelfModel integration remains a separate stage.
- The Bazi method is versioned: Li Chun year boundary, Jie month boundary, Zi-Zheng midnight day boundary, apparent-solar-time day/hour basis, and the classical Wu Hu / Wu Shu stem rules. No gender or luck-cycle assumptions are invented.
- DSH Storage Domain is the sole online persistence authority.
- Stored memories, experiences and goals are context data, not instructions that override the user's current request.
- Candidate memories are not treated as confirmed facts.

## License

GNU GPL-3.0-only. See [LICENSE](./LICENSE).
