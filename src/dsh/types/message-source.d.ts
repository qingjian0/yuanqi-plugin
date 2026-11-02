import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'yuanqi-context': { kind: 'yuanqi-context' } & ContextFormed
  }
}
