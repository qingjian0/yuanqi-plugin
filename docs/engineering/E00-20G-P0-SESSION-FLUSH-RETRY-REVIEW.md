# E00-20G P0 — Session Flush 失败写入保留与重试审查

> 日期：2026-11-07  
> 适用分支：`work/e00-20e-05b-subject-domain-runtime`  
> PR：#3 → `dev`  
> 代码提交：`c9285a9c8e829d7d3a3680611050fa18bcce307f`  
> 状态：代码与自动化测试通过；真实 DSH Storage/Host 验收待完成。

## 1. 本轮结论

本轮发现并修复一个 P0 持久化屏障问题：

旧版 `track(sessionId, task)` 对 Promise 的成功和失败分支都执行相同的删除逻辑。失败任务可能在后续 `session/flush` 到达前已经从 `pendingBySession` 消失，导致 Flush 无法观察失败。旧版 Flush 只对当前集合做一次快照，并使用 `Promise.all()`；首个拒绝会提前结束等待，不保证同批次其他任务全部结束。

修复后：

1. 每个待处理项保留原始执行函数与最新 Promise。
2. 成功任务从待处理集合移除。
3. 失败任务保留，不会因为 Promise 已拒绝而消失。
4. Flush 使用 `Promise.allSettled()` 等待整个批次。
5. 每次 Flush 对失败任务进行一次幂等重试。
6. 重试仍失败时抛出 `AggregateError`，失败任务继续保留，后续 Flush 可以再次尝试。
7. Flush 循环重新读取待处理集合，直到当前 Session 没有剩余任务。
8. 插件卸载等待所有已启动任务结束，关闭 Domain 后报告仍未解决的写入错误。

## 2. DSH 契约依据

本轮按 DSH 源码提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` 核验：

- `session/event` 是同步通知，不是异步持久化屏障。
- `session/flush` 是由 Session 生命周期所有者调度的 awaited durability checkpoint。
- DSH Storage Domain 的 `table.put()` 在后端持久化成功后才 resolve。
- Storage Domain 的 `get()` 是同步读取；`put()`、`update()` 等写入进入单域写入链。
- Domain 写入失败不会发布已提交的内存状态；未知持久化状态需要关闭并重新打开 Domain。

因此，插件必须在自己的 `session/flush` 监听器中等待领域写入完成，并把持续失败反馈给宿主；不能把已失败 Promise 从集合删除后视为成功。

参考 DSH 官方源码：
- [Storage Domain package reference](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/storage/storage-domain/README.md)
- [Storage Domain runtime](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/storage/storage-domain/src/domain.ts)
- [Session persistence flush contract](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/session/session-persistence/README.md)

## 3. 代码变更

### 3.1 `src/dsh/plugin.js`

- 将待处理 Promise 改为带 `run`、`promise`、`execute` 的任务记录。
- 只在任务成功后移除待处理项。
- 失败任务保留原始重放闭包。
- Flush 使用 `Promise.allSettled()` 等待批次所有任务。
- 对失败项执行一次重试。
- 持续失败通过 `AggregateError` 反馈。
- Flush 每轮重新读取集合，覆盖等待期间新增的任务。
- 插件卸载等待当前任务 settle，关闭两个 Domain 后报告失败。

### 3.2 `test/dsh/plugin.test.js`

新增/调整以下验证：

- 一次性 Worldline 写入失败：首次事件处理失败，Flush 重放同一事件并补齐 Worldline 与 Session 绑定。
- 连续两次写入失败：首次事件失败，Flush 重试仍失败并向宿主拒绝。
- 后续 Flush：再次重试之前保留的失败项并成功完成。
- 插件卸载：仍未解决的写入失败不能被静默吞掉。
- 测试 Logger 改为记录 warning，不再通过 Logger 自身抛错替代原始 Storage 错误。

## 4. 重试安全性

重试执行的是原始 `observe(session, event)`，而不是重新生成新的用户事件或新的主体身份。

现有路径具有幂等检查：
- UserSubject / YuanQiSubject 身份创建复用已有记录。
- 首条直接用户消息锁不会被后续消息覆盖。
- 唤醒记录复用已存在的记录。
- 主 Worldline 创建检查已存在的主线/Head。
- Session 绑定先读取已有绑定并验证主体与 Worldline 一致性。

因此，重试能够从已成功持久化的阶段继续，而不会把一次失败拆成重复主体或重复唤醒。

## 5. 验证结果

- Commit：`c9285a9c8e829d7d3a3680611050fa18bcce307f`
- Push CI Run [#275](https://github.com/qingjian0/yuanqi-plugin/actions/runs/42349568355)：completed / success。
- PR CI Run [#276](https://github.com/qingjian0/yuanqi-plugin/actions/runs/42349572586)：completed / success。
- Node.js：22。
- `npm run check`：46 passed / 0 failed。
- 包根入口与 DSH Storage Domain 导出检查：通过。
- JavaScript 语法检查：通过。

中间提交 `4c69e7f` 的 Run #273/#274 曾因旧测试仍期待卸载静默吞掉失败而失败；随后更新测试，明确要求卸载报告未解决写入错误。最终提交的 Run #275/#276 均通过。

## 6. 保证边界

- 每次 Flush 最多自动重试一次，不进行无限自动重试。
- 持续失败会拒绝当前 Flush；失败项保留供下一次 Flush 再试。
- 插件卸载不进行无限重试：等待已启动任务、关闭 Domain，再报告未解决的错误。
- 该机制不构成跨 Domain 原子事务。
- 该机制不构成跨进程或跨 Facility 分布式锁。
- CI 使用内存 Storage Domain 适配器，尚未证明真实后端在进程崩溃、磁盘错误、未知提交结果时的行为。
- 真实 DSH Profile 生命周期、Android 宿主和真实模型会话端到端验收仍待完成。

## 7. PR 状态

PR #3 仍为 Draft，目标分支 `dev`。未合并 PR #1/#2/#3，未修改 `main`。
