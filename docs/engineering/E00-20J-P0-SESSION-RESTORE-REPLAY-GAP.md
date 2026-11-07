# E00-20J P0 — DSH Session Restore 历史事件重放缺口

> 日期：2026-11-07
> 当前分支：`work/e00-20e-05b-subject-domain-runtime`
> 状态：首轮代码接入已实施，真实 Host 验收阻断项仍未关闭。

## 1. 结论

当前 YuanQi 插件监听 `session/event`，并通过 `session/flush` 等待自身 sidecar 写入。但 DSH SessionStore 恢复已有 Session 时，不会把历史 seed events 再次发送为 `session/event`。

这意味着 Session 历史已持久化、YuanQi 首条消息锁尚未持久化的崩溃窗口不能仅靠当前 `session/event` listener 自动恢复。

## 2. 官方 DSH 契约

核对基准：DSH 源码提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。

### 2.1 session/event

- append 先提交到 Session event log。
- `session/event` 是 post-commit、fire-and-forget observer feed。
- observer 失败被记录并隔离，不会撤销已经提交的 append。
- 进入一个带 seed history 的 Session 不会将 seed events 重新作为 `session/event` 发布。

### 2.2 session/created

- `session/created` 是 SessionStore 进入/发布 Session 后的只读创建公告。
- 监听器能看到该 Session 的既有历史。
- 新事件在同步创建公告监听器全部返回前拒绝。
- 该事件不是历史事件重放流；返回 Promise 的拒绝不能追溯性撤销同步创建边界。

### 2.3 session/flush

- `session/flush` 是 awaited parallel durability checkpoint。
- 所有监听器都会运行，调用方等待全部监听器完成。
- 没有 waterfall veto；某个插件监听器失败不代表其他持久化监听器不会执行。

因此，Session history 的持久化和 YuanQi Storage Domain 的首次锁写入不是一个原子事务。

### 2.4 正式历史读取 API（已找到，尚未接入）

DSH Session public API 中的 `Session.snapshotEvents()` 与 `ownEvents()` 已标记 deprecated，禁止新增调用。正式替代服务为 `ctx.sessionQuery`，由 `@deepseek-ai/dsh-session-query-sqlite` 后端提供，接口包版本为 `0.2.2-rc.1`。

已核对的方法：

- `listSessions()`：列出 live-preferred 逻辑 Session 及来源可用性。
- `readSession(sessionId)`：读取完整、脱离宿主对象且 replay-validated 的 SessionLogSnapshot。
- `observeSession(sessionId, { projectionMode: 'none' })`：取得精确不可变观察，含 `inheritedEventCount`、events 与 cursor；cold Session 通过持久化读取，不会被加入 live SessionStore。
- `listEvents(sessionId)`：读取 seq/type/time 等轻量事件元数据。
- `readEvent(request)`：读取指定事件及有限上下文。

Session Query 通过可选的 `ctx.sessionPersistence` 读取 cold history；缺少持久化服务时，不能保证跨进程恢复。YuanQi 当前未注入 `sessionQuery`，也未声明相关 peer dependency，因此正式 API 虽已存在，当前插件仍未接入。

`inheritedEventCount` 是正式 Fork 历史边界；任何恢复扫描都必须排除继承前缀。不得调用 deprecated 的同步 Session history API。

## 3. 当前 YuanQi 的行为边界

- 监听 `session/event`。
- 监听 `session/flush`。
- 已注入 `sessions`，但未使用该服务。
- 未订阅 `session/created`。
- 未使用 Session Query / History API。
- `apply()` 可以根据已持久化的 first-message lock / Wake Record 修复后续 Worldline 缺失。
- 如果 first-message lock 本身不存在，当前插件没有可靠的历史事件来源可供恢复。

## 4. 崩溃场景

1. DSH 收到 direct-user `user/message`。
2. Session event 已提交到内存 log。
3. YuanQi 的异步 sidecar 写入尚未完成或失败。
4. DSH 触发 parallel `session/flush`；Session persistence listener 可能成功，而 YuanQi listener 失败。
5. 进程退出。
6. DSH 重启并恢复 Session history。
7. 历史事件不会再次通过 `session/event` 通知 YuanQi。
8. 若 YuanQi 的 first-message lock 未持久化，现有恢复逻辑无法确定应补齐哪条历史消息。

这不是当前测试已经证明会发生的确定故障，而是由 DSH parallel flush 与 event restore 契约共同形成的可达一致性缺口；必须通过正式 API 和真实后端测试验证。

## 5. PR #4 生命周期测试的证据边界

PR #4 的 `test/dsh/lifecycle-recovery.test.js` 在关闭/重开 Domain 后，手动再次调用 `secondContext.listener(..., firstEvent)`。

这验证的是同一个事件再次被插件 listener 投递时的幂等性，以及 Storage Domain close/reopen 后状态保留。

它没有执行真实 DSH SessionStore restore，没有验证历史 seed events 的事件发布行为，也没有验证 `session/created` 的历史查询路径。因此不能称为真实 Host Session restore 验收。

## 6. 后续实现要求

实现前先核对正式 Session Query / History API，并明确：

1. 如何区分安装后新事件与安装前已有历史。
2. 多个 Session 的首条 direct-user 消息如何排序，是否存在全局事件序列；没有可靠全局序列时不得伪造全局顺序。
3. Session restore 时如何只读取必要的历史窗口，而不是复制完整聊天历史。
4. 如何验证 `source.kind === 'user'`、唯一文本块和事件时间均来自 DSH 持久化历史。
5. 如何避免旧 Session 历史在新安装实例中触发首次唤醒。
6. 恢复写入如何幂等，并在跨 Domain 部分写入时保留证据来源。
7. 如何通过真实 SessionStore restore + Storage Domain restart 测试，而不是手工调用插件 listener。

不得使用模型输出构造历史事件；不得使用当前系统时间替代 `SessionEvent.time`；不得使用已 deprecated 的 `Session.snapshotEvents()` 新增恢复调用；不得将安装前历史误判为安装后的首次消息；不得宣称跨 Domain 事务已经存在。

## 7. 验收状态

- 官方 DSH event/created/flush 契约：已核对。
- 当前 YuanQi 恢复覆盖范围：已界定。
- 正式 Session Query / History API：待审查。
- 安装实例边界与多 Session 顺序：待设计和核验。
- 真实 SessionStore restore 测试：未完成。
- 真实后端故障与进程崩溃测试：未完成。

## 8. 首轮修复实现状态（2026-11-07）

PR #3 首轮实现已接入官方 `ctx.sessionQuery` / `ctx.sessionPersistence`，启动时通过 live-preferred Session 列表和精确 observation 扫描可恢复历史；严格过滤 direct-user 消息，排除 Fork inherited prefix，并将 listener 在扫描期间收到的事件缓冲合并。安装边界只持久化一次，避免每次重启刷新。若跨 Session 最早候选同毫秒，恢复拒绝唤醒。

该实现已由 GitHub Actions Run #299/#300 验证通过（56 passed / 0 failed），但自动化仍使用内存 Session Query mock。它仍未达到真实宿主验收：目标 Profile 是否同时挂载 Session Query SQLite backend 与 Session Persistence JSONL backend 尚未核实；没有真实 DSH SessionStore restore + 进程重启测试；跨 Session event.time 不是单调全局时钟；超大 Session 的完整 observation 成本也未在目标 Android 环境测量。
