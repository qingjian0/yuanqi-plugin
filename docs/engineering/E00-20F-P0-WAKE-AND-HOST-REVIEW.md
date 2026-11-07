# E00-20F P0 — 首次唤醒与 DSH Host 集成审查

> 日期：2026-11-07  
> 适用分支：`work/e00-20e-05b-subject-domain-runtime`  
> 目标分支：`dev`  
> 状态：代码修正已提交；GitHub Actions Run #264 通过；真实 DSH 宿主验收待完成。

## 1. 本轮结论

本轮对 PR #3 的当前 head 进行源码审查，发现首次唤醒路径存在两项语义偏差，并完成修正：

1. 原实现对启动文本执行 `trim()`，导致带前后空格的消息也会被视为启动口令；原要求是精确匹配。
2. 原插件在任何直接用户消息后都会创建主 Worldline 并绑定 Session，即使首条消息不是启动口令；这使未唤醒主体提前进入 Worldline 运行态。

修正后，启动口令必须是首条直接用户消息中唯一文本块的完整内容，且精确等于 `启动元气` 或 `启动元炁`。首条直接用户消息不是口令时，永久消耗本次安装实例的唤醒资格；后续 Session 再发送口令也不会唤醒。未唤醒时不创建主 Worldline，也不绑定 Session。

此外，插件启动时会检查已持久化的首次消息锁并执行唤醒恢复；如果唤醒记录已经持久化、但 Worldline 创建/Session 绑定尚未完成，插件重启后会幂等补齐。

## 2. DSH 事件契约

以 DSH 源码提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` 为核验基线：

- Cordis 事件监听使用 `ctx.on('session/event', (session, event) => ...)`。
- SessionEvent 信封包含 `type`、`seq`、`time`、`data`。
- 用户消息使用 `event.type === 'user/message'`。
- 直接用户消息必须同时满足 `event.data.role === 'user'` 与 `event.data.source.kind === 'user'`；不能只根据 role 判定，因为注入到模型可见 surface 的 user-role 消息不一定来自真实用户。
- `event.time` 是 Unix 毫秒时间戳，作为唤醒时间唯一来源。
- `session/event` 是同步通知，监听器返回的 Promise 不作为事件分发的等待屏障。插件将自己的异步写入按 Session 跟踪，并在 `session/flush` 中等待该 Session 的待处理写入。

参考：
- [DSH Event system](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/user/develop/framework/events.md)
- [DSH Session types](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/src/types.ts)
- [DSH Session persistence](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/session/session-persistence/README.md)

## 3. 唤醒规则与持久化顺序

### 3.1 首条消息资格锁

`first_user_messages` 按固定 YuanQiSubject ID 保存首次直接用户消息：

- Session ID、Message ID、Session Event sequence、DSH event.time；
- 事件类型与来源类型；
- 首条消息是否为精确启动口令；
- schema version。

锁按 YuanQiSubject 全局串行化，而不是按 Session 分开。首条消息一旦写入，后续消息不会覆盖它。

### 3.2 精确匹配

仅接受以下形式：

- 内容数组必须恰好包含一个元素；
- 该元素必须是 `type: 'text'`；
- 文本必须完整等于 `启动元气` 或 `启动元炁`。

以下均不匹配：前后空格、换行、引号、标点、前后附加语句、多文本块、图片/其他非文本块。

### 3.3 写入和恢复

1. 持久化首次直接用户消息锁。
2. 若锁中的 `trigger_command` 为 null，结束，不创建唤醒记录或 Worldline。
3. 若为精确口令，幂等创建唤醒记录，时间取首次事件的 `event.time`。
4. 根据持久化首次事件创建主 Worldline，并绑定首次 Session。
5. 当前后续 Session 只有在主体已经唤醒后才可绑定到同一主 Worldline。

插件启动时重新读取首次消息锁；如果它是有效启动口令，则补齐缺失的唤醒记录、主 Worldline 和首次 Session 绑定。不会使用当前时间替代历史事件时间。

## 4. 本轮代码变更

| 文件 | 变更 |
|---|---|
| `src/dsh/session-event.js` | 只把唯一文本块规范化为命令文本；多块或非文本内容不参与匹配 |
| `src/domain/subject-store.js` | 移除命令比较前的 trim，使用原始完整文本精确比较 |
| `src/dsh/plugin.js` | 只有取得持久化 wake record 才创建主 Worldline；增加插件启动时的 wake/Worldline/Session 绑定恢复 |
| `test/dsh/session-event.test.js` | 增加多文本块不能拼接成启动口令的断言 |
| `test/domain/subject-store.test.js` | 增加空格、换行、引号、标点和附加文本拒绝用例 |
| `test/dsh/plugin.test.js` | 增加非口令首条消息不创建 Worldline、后续口令不能补触发、空格命令拒绝，以及唤醒中断后的重启恢复测试 |

## 5. 自动验证

GitHub Actions：
- Run：[#264](https://github.com/qingjian0/yuanqi-plugin/actions/runs/42347900017)
- Commit：`03999247cda29cf1c52b8b673a7ec5ae26ccd17c`
- Job：`node-check`
- 结果：completed / success
- 已通过步骤：依赖安装、包根入口与 DSH Storage Domain exports 验证、`npm run check`（源码语法检查与 Node.js 自动化测试）。

本次不在文档中推算测试总数；以 GitHub Actions 实际执行结果为准。

## 6. 未完成与保证边界

- 自动化测试使用内存 Storage Domain 适配器，不代表真实 DSH Storage Domain 后端持久化、重启恢复或故障语义已验收。
- 首次消息锁与 Worldline 状态变更的串行化是单个插件实例内保证，不宣称多进程/多 Facility 分布式 CAS。
- 未在真实 DSH Profile 中完成安装、加载、卸载、重启和模型会话端到端验收。
- 当前 `verifyBirthProfileConfirmation()` 在 Host 入口中 fail-closed，出生资料确认不会被伪造；出生资料对话流程和可信确认事件接线仍未交付。
- `cordis.patch.yml` 当前只声明插件插入点；目标 DSH 版本的打包、依赖注入与实际加载仍需真实宿主验证。
- 包版本仍为 `1.1.0-alpha.9`。本分支上的新实现不等于已发布 alpha.9 包具备这些能力。

## 7. PR 状态

PR #3 仍为 Draft，目标 `dev`。本轮没有合并 PR，没有修改 `main`，也没有宣称真实宿主验收通过。
