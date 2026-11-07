# E00-20M P0 — DSH Profile Provider 组合与冷读取契约审计

> 日期：2026-11-07  
> 范围：DSH 0.2.2-rc.1 Base Profile、SessionPersistence / SessionQuery provider contract、YuanQi 启动前置校验  
> 状态：官方 Base 组合已核实；YuanQi 启动契约检查已补强并提交；目标 Android Profile 仍待实机确认。

## 1. 审计结论

DSH 官方源码基线：

- Repository：`deepseek-ai/deepseek-harness`
- Commit：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
- Release/package baseline：`0.2.2-rc.1`

DSH Base bundle 的 `packages/bundle/base/cordis.patch.yml` 同时挂载：

| DSH row | Provider | 配置 | YuanQi 冷恢复用途 |
|---|---|---|---|
| `session-persistence-jsonl` | `@deepseek-ai/dsh-session-persistence-jsonl` | `root: dshHomePath('sessions')` | 权威 SessionEvent 日志 |
| `session-query-sqlite` | `@deepseek-ai/dsh-session-query-sqlite` | `path: ':memory:'; openAt: never` | 统一 Session Query 服务和精确冷观察 |
| `storage-domain` | `@deepseek-ai/dsh-storage-domain` | `backend: json` | YuanQi UserSubject / YuanQiSubject Domain 的宿主存储 |

DSH Base bundle 被 CLI composition 文档定义为 web、headless、sdk、acp profiles 的共享基础层。此证据只适用于采用该 Base bundle 且未被用户 patch 禁用/替换这些 provider 的 Profile；不能推断任意 Android Profile 都使用相同组合。

## 2. 关键澄清：openAt: never 不等于没有 Session Query

官方 `session-query-sqlite` 配置定义明确说明：

- `openAt: never` 禁止打开 SQLite FTS5 全文搜索索引；
- `searchSessions()` / `searchEvents()` 会以 `SESSION_QUERY_SEARCH_DISABLED` 失败；
- 继承的精确读取、过滤和谱系追踪仍然可用；
- `listSessions()`、`observeSession()` 仍属于 `ctx.sessionQuery` 服务能力。

因此，YuanQi 的恢复扫描只调用 `listSessions()` 与 `observeSession(id, { projectionMode: 'none' })`，不依赖全文搜索，不应要求目标 Profile 把 `openAt` 改为 `startup` 或 `first-search`，也不应把派生 SQLite 索引当作 Session 原始日志。

## 3. SessionPersistence 的真实冷读取依赖

官方抽象服务 `@deepseek-ai/dsh-session-persistence` 暴露：

- `identity: symbol`：持久化服务实例身份；
- `list()`：枚举可见持久化 Session；
- `stat(id)`：读取指定 Session 的 revision/header 元数据；
- `open(id, 'read')`：通过只读 handle 读取完整已验证日志；
- `create()` / `flush()`：写入方能力，YuanQi 的冷读取路径不直接调用。

官方 Session Query 实现的冷观察流程为：

1. `SessionObservationReader.read()` 检查 live Session；
2. 对 cold Session 调用 persistence `stat()` 获取 revision；
3. cache miss 时通过 `readColdSessionLog()` 调用 `open(id, 'read')`；
4. 调用 handle `read()`，再 `close()`；
5. 通过 `SessionStore.prepare()` 创建不进入 live store 的恢复观察；
6. 返回带 `inheritedEventCount` 的只读 observation lease。

Session Query 的 corpus listing 还依赖 persistence `list()`。因此只检查 `list()` 不能证明冷读取能力完整。

## 4. YuanQi 本轮运行时修复

文件：`src/dsh/plugin.js`

启动前现在检查：

- `sessionQuery.listSessions`
- `sessionQuery.observeSession`
- `sessionPersistence.identity` 必须为 symbol
- `sessionPersistence.list`
- `sessionPersistence.stat`
- `sessionPersistence.open`

不完整服务在打开 YuanQi Storage Domains 之前即 fail-closed，避免插件先占用 Domain 句柄、进入运行态后才在 cold Session 恢复阶段报错。

测试：`test/dsh/plugin.test.js`

新增四种错误 Provider 形态：

1. 只有 `list()`；
2. 缺少 `stat()`；
3. 缺少 `open()`；
4. `identity` 不是 symbol。

每种都必须在 Domain 打开前被拒绝。测试 fixture 也已补齐官方读取面接口。

## 5. 真实 Provider 集成覆盖现状

`test/dsh/jsonl-session-restart.integration.test.js` 已使用：

- 官方 DSH `SessionStore`；
- 官方 `@deepseek-ai/dsh-session-persistence-jsonl`；
- 官方 `@deepseek-ai/dsh-session-query-sqlite`；
- JSONL 磁盘根目录；
- Query `openAt: 'never'`。

测试通过关闭并重建 DSH Context，重新挂载同一 JSONL 根目录，验证 cold Session 可被 Query observation 恢复，并由 YuanQi 建立首次消息锁、WakeRecord、Worldline 和 Session binding。

但 YuanQi Storage Domain adapter 在该测试仍是内存实现；该测试不是 OS 进程强制终止测试，也不是 Android Profile 验收。

## 6. 目标 Profile 验收清单

目标 Android Profile 必须逐项记录，不得以 DSH Base 文档替代设备证据：

- [ ] DSH 版本 / commit / Node runtime；
- [ ] 实际 Profile 名称与最终合并后的 Cordis patch；
- [ ] `session-persistence-jsonl` provider 已启用，root 是稳定且可写的绝对路径；
- [ ] `session-query-sqlite` provider 已启用；`openAt: never` 可以保留；
- [ ] `ctx.sessionPersistence` 的 `identity/list/stat/open` 均可调用；
- [ ] `ctx.sessionQuery` 的 `listSessions/observeSession` 均可调用；
- [ ] 对一条真实已持久化 cold Session 执行 observation，验证 lease dispose；
- [ ] YuanQi 两个 Storage Domain 使用目标 Android 实际后端；
- [ ] 强制杀进程后重新启动，验证首次消息锁 / WakeRecord / Worldline 恢复；
- [ ] 记录大 Session 数量、事件规模、启动耗时与峰值内存。

## 7. 不做的事

- 不为 YuanQi 开启 DSH 全文搜索；不要求 SQLite FTS5 索引启动。
- 不另建 Session 原始日志数据库，不复制完整聊天历史到 YuanQi Domain。
- 不将 Base bundle 的存在当作 Android Profile 已挂载 Provider 的证明。
- 不将同进程 Context 重建测试称为 OS crash recovery。
- 不宣称 DSH 两个不同 Domain 之间具有原子事务。

## 8. 本轮提交与验证

- Runtime guard：检查 SessionPersistence 的 `identity/list/stat/open`。
- Unit coverage：拒绝四种不完整 Provider。
- README / INSTALLATION：补齐 Session Query 与 Session Persistence 两个 peer dependencies，避免文档只列四项而 package.json 实际声明六项。
- 真实 DSH Provider 组合：官方 Base composition 源码已核实；Android Profile 尚未核实。
- 本文记录的代码验证以当前 PR #3 最新 GitHub Actions 为准；本文件提交后仍需等待本次 CI 完成。
