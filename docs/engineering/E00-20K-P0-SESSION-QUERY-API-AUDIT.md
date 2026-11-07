# E00-20K P0 — DSH Session Query 正式 API 核验

> 日期：2026-11-07  
> YuanQi 分支：`work/e00-20e-05b-subject-domain-runtime`  
> DSH 源码基准：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`  
> DSH 包基线：`0.2.2-rc.1`  
> 状态：接口核验完成；首轮 YuanQi 运行时接入已进入 PR #3，真实 DSH/Android Host 验收未完成。

## 1. 结论

DSH 已提供正式的 Session Query / History API，无需 YuanQi 自行读取 Session 内部 log，也不应新增对 deprecated 同步接口的调用。

正式服务是 `ctx.sessionQuery`，由 `@deepseek-ai/dsh-session-query-sqlite` 提供具体后端。接口包 `@deepseek-ai/dsh-session-query` 本身定义服务并实现 backend-independent exact reads；SQLite 插件补充搜索后端和服务生命周期。

## 2. 已核实 API

| API | 契约 | 对恢复的用途 |
|---|---|---|
| `listSessions()` | live-preferred 逻辑 Session 列表，含 live/persisted 状态 | 枚举恢复候选 |
| `readSession(id)` | 完整 detached、replay-validated SessionLogSnapshot | 一次读取完整历史及 Fork 边界 |
| `observeSession(id, { projectionMode: 'none' })` | 精确不可变 Session observation | 获取 events、cursor、inheritedEventCount；cold Session 不会变成 live |
| `listEvents(id)` | seq/type/time 等轻量事件记录 | 事件元数据筛选 |
| `readEvent(request)` | 指定 seq 的完整事件和有限上下文 | 读取候选事件正文 |

服务类型定义与实现位置：

- `packages/session-query/session-query/src/index.ts`
- `packages/session-query/session-query/src/types.ts`
- `packages/session-query/session-query/src/observation.ts`
- `packages/session-query/session-query/README.md`

## 3. 正确使用边界

### 3.1 不直接访问 Session 私有 log

禁止新增调用：

- `Session.snapshotEvents()`
- `Session.ownEvents()`

二者均已 deprecated，官方声明禁止新增调用。

恢复必须通过 `ctx.sessionQuery`，不能依赖内部对象字段或自行解析 JSONL 文件。

### 3.2 Fork 继承边界

`SessionLogSnapshot` 和 `SessionObservation` 都提供 `inheritedEventCount`。

恢复时仅能把满足以下条件的事件作为该 Session 自身事件候选：

```text
event.seq >= observation.inheritedEventCount
```

继承前缀中的父线 user/message 不属于子 Session 新发生的用户输入，不能重复消费，也不能触发首次唤醒。

### 3.3 Cold Session 依赖持久化服务

Session Query 通过 `ctx.sessionPersistence` 动态读取已持久化 Session。

缺少 `sessionPersistence` 时，查询能力不能保证读取进程退出后不再 live 的历史。

DSH Base composition 文档列出了：

- `@deepseek-ai/dsh-session-persistence-jsonl`
- `@deepseek-ai/dsh-session-query-sqlite`

但这只是 Base composition 的证据，不能代替对目标 Android/Profile 实际 Loader 组合的核验。

### 3.4 SessionEvent 时间

DSH `Session.append()` 源码在构造事件时使用 `Date.now()` 写入 `SessionEvent.time`。

YuanQi Wake Record 的发生时间仍必须直接复制原始事件的 `time`。任何插件安装边界或恢复筛选边界都不能覆盖、重算或替代这个时间。

## 4. YuanQi 当前接入缺口

当前 PR #3 的 `src/dsh/plugin.js`：

```js
export const inject = ['storageDomain', 'sessions'];
```

当前 `package.json` peerDependencies 没有：

- `@deepseek-ai/dsh-session-query`
- `@deepseek-ai/dsh-session-persistence`

因此，当前代码既没有注入 Session Query 服务，也没有检查 cold history 的持久化来源。此前的 Session Restore 风险仍然成立。

建议接入边界（尚未实施）：

1. 由 YuanQi 显式声明所需 DSH peer dependency 兼容范围。
2. 插件启动时确认 `sessionQuery` 与 `sessionPersistence` 服务可用；缺少时按明确策略 fail-closed，不静默降级为“恢复已完成”。
3. 使用 `listSessions()` 枚举候选。
4. 使用 `observeSession(..., { projectionMode: 'none' })` 获取一致观察。
5. 按 `inheritedEventCount` 排除 Fork 继承事件。
6. 只接受 `type === 'user/message'`、`data.role === 'user'`、`data.source.kind === 'user'` 的事件。
7. 对唯一文本块及口令精确匹配继续复用现有归一化契约。
8. 释放每个 observation lease；不长期保留完整聊天历史。

## 5. 仍需设计的关键问题

### 5.1 安装实例边界

历史查询能读到事件，不代表该事件一定发生在 YuanQi 安装之后。

需要一个可持久化、可恢复的安装实例边界。不能在每次插件重载时重新生成边界，否则会把上一次运行期间已发生、但 YuanQi sidecar 未写入的事件误判为安装前历史。

### 5.2 多 Session 排序

DSH 的 `SessionEvent.seq` 只保证单个 Session 内连续，不是跨 Session 全局序号。

`SessionEvent.time` 是毫秒时间戳，不保证不同 Session 事件不会同毫秒。

因此：
- 不得把不同 Session 的 seq 直接比较。
- 不得用 Session ID 字典序伪造事件先后。
- 若恢复时多个候选事件无法唯一排序，必须明确采用保守 fail-closed 规则。
- 正常运行中由实时 observer 接收的先后顺序和重启后历史重建的顺序需要分别定义，不能混为同一种保证。

### 5.3 Storage Domain 并发语义

DSH Storage Domain 的 `KvTable.update()` 是同一个 Domain 实例内部 write chain 上的原子 read-modify-write。

这不等于跨 Facility / 跨进程 CAS，也不提供分布式锁。

当前 YuanQi 的 `serializeByKey()` 同样只是单个插件实例内的 Promise queue。下一轮不能把它升级描述为跨实例保证。

### 5.4 大历史成本

`readSession()` / `observeSession()` 会读取完整逻辑日志。不能在没有成本评估的情况下，在每次普通消息上扫描全部历史。

需要明确：
- 只在安装恢复/首次唤醒恢复阶段进行必要扫描。
- 事件正文只在候选事件上进入 YuanQi 处理路径。
- 观察结果不写入长期日志、不复制整段聊天历史。
- 处理超大 Session 的内存和启动时延。
- query/read 失败时保留恢复未完成状态，不消费唤醒资格。

## 6. 验收计划

- [x] 确认正式服务名与 provider。
- [x] 确认 `readSession()` 和 `observeSession()` 契约。
- [x] 确认 `inheritedEventCount` Fork 边界。
- [x] 确认 cold history 依赖 `sessionPersistence`。
- [x] 确认 DSH event.time 的产生位置。
- [x] 确认 Domain.update 的原子范围仅限同一 Domain 实例。
- [ ] YuanQi 注入 Session Query / Persistence。
- [ ] 安装边界与恢复排序协议。
- [ ] 恢复实现及幂等测试。
- [ ] 真实 DSH SessionStore restore 测试。
- [ ] 真实持久化后端进程重启测试。
- [ ] Android/Profile 实际服务组合验收。

## 7. 本轮结论

正式 API 已找到，原先“尚未找到 Session History API”的调查任务可以关闭；但 P0 故障本身没有关闭。当前 PR #3 仍不能宣称首次唤醒在所有 Session restore 崩溃窗口下可靠。


## 8. 首轮运行时接入（2026-11-07）

当前 PR #3 已开始按上述 API 实施：

- `inject` 要求 `sessionQuery` 与 `sessionPersistence`；缺失服务时启动 fail-closed。
- `package.json` 声明 `@deepseek-ai/dsh-session-query` 与 `@deepseek-ai/dsh-session-persistence` peer dependencies，范围为 `>=0.2.2-rc.1 <0.3.0-0`。
- YuanQiSubject Domain v8 新增只写一次的安装边界记录；重启时复用原始 `activated_at_ms`，不刷新。
- 先注册 `session/event` listener 并缓冲事件，再扫描 `listSessions()`；每个 Session 使用 `observeSession(id, { projectionMode: 'none' })`，按 `inheritedEventCount` 排除 Fork 继承前缀，并释放 observation lease。
- 历史候选只筛选 `event.time >= activated_at_ms`；实时缓冲事件是安装边界写入后由 Host listener 实际观察到的事件，不再用系统时钟二次过滤。
- 多 Session 恢复时先取各 Session 内最早符合边界的 direct-user 事件，再比较 DSH event.time。多个 Session 的最早候选若同毫秒，拒绝唤醒并保留首次资格，不以 Session ID 排序。
- `session/flush` 等待启动恢复 barrier，避免恢复扫描尚未完成时先确认 Flush。
- Wake Record 的 `occurred_at` 仍取源事件 `event.time`，安装边界只用于区分安装前历史。

### 尚未证明的保证

1. DSH `event.time` 由 `Date.now()` 生成，但不是跨 Session 的单调全局时钟；时钟回拨可能让历史事件落在安装边界之前，或影响跨 Session 的先后判断。当前实现对同毫秒最早候选 fail-closed，但无法从 API 层消除时钟回拨风险。
2. DSH `observeSession()` 为完整日志观察，超大 Session 仍可能带来启动内存和延迟成本；观察结果不写入 YuanQi 持久存储，但 API 本身需要完整日志。
3. 内存 mock 测试不等于 DSH 真实 SessionStore restore、JSONL persistence 进程重启或目标 Android/Profile 组合验收。
4. 安装边界在本次功能版本首次激活时建立。若用户此前已运行旧版插件，而旧版没有保存该边界，升级前的事件不能被安全地认定为原始安装后的事件；本实现按保守策略不回溯这些无可靠边界的历史。
5. Storage Domain 与 Session Persistence 仍是不同持久化域；不存在跨 Domain 原子事务。首次锁、Wake Record、Worldline 的部分写入仍依赖幂等恢复。

### 首轮自动化验证（已通过，真实 Host 仍待验收）

- cold Session 历史恢复；
- 安装边界前历史排除；
- Fork inherited prefix 排除；
- 同毫秒跨 Session 歧义拒绝；
- Session Query / Persistence 服务缺失拒绝；
- 安装边界重启复用；
- listener 事件与历史扫描合并；
- Flush 等待恢复 barrier。

GitHub Actions Push Run #299（`42355677376`）和 PR Run #300（`42355680482`）均通过，commit `801e9c1057943f2c917f702f813a41621901e181`，Node.js 24.9.0，56 passed / 0 failed。Run #295-#298 曾因测试期望未同步 Domain v8 表清单和新的 inject 服务列表而失败；修正后最新两条 CI 均通过。

真实 DSH SessionStore restore 和 JSONL 后端重启测试仍是后续 P0 验收门槛。
