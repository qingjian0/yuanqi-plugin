# DSH 宿主生命周期与重启恢复验收记录

本清单用于真实 DSH 宿主验收。自动化内存适配器测试不能替代本清单，也不能据此宣称真实 Storage Domain 已通过。

## 目标兼容性基线（P7）

- DSH 仓库当前版本：`0.2.2-rc.1`。
- DSH 根包 `engines.node`：`>=24.9.0`。
- YuanQi peer dependencies 的最低声明基线：`0.2.2-rc.1`，上限 `<0.3.0-0`。
- CI 已在 Node.js `24.9.0` 上安装并解析四个 peer packages，均为 `0.2.2-rc.1`，并通过包入口、Storage Domain API、语法和自动化测试。
- 以上是包/API 兼容性验证基线，不等同于真实 Android DSH 宿主验收。

## 验收前必须记录

- DSH 精确版本与构建号：
- Android 版本 / 设备型号：
- YuanQi 插件提交 SHA / 安装包版本：
- Storage Domain 后端及版本：
- 验收日期：
- 日志与数据检查方式（不得记录消息正文、凭据、Cookie 或认证头）：

## 验收步骤

### A. 安装与首次加载

1. 在目标 DSH 版本安装插件并启动宿主。
2. 确认 Cordis 插件只加载一次，两个 Domain（`yuanqi_user_subject`、`yuanqi_subject`）均成功打开。
3. 确认日志没有重复注册监听器、未处理的异步异常或 Domain schema 兼容错误。
4. 记录插件加载结果和两个 Domain 的打开/关闭事件。

预期：插件可加载；Domain schema 版本兼容；不创建未被直接用户消息触发的首次主体记录。

### B. 首条直接用户消息与 Session flush

1. 在新安装状态下发送一条普通直接用户消息。
2. 等待该 Session 的 `session/flush` 完成；该事件是 DSH awaited parallel durability checkpoint，必须确认 YuanQi 的所有在途写入已 settle。
3. 检查 UserSubject、YuanQiSubject、首次直接消息锁、主线 Worldline、Head 和 Session 绑定是否持久化。
4. 验证 `user/message` 的 `source.kind === 'plugin'` 等合成 user-role context 不会创建首次直接用户消息锁；只有 `source.kind === 'user'` 的直接消息可以建立该锁。
5. 在另一个 Session 发送消息，确认其绑定到同一主线，不重复创建主体。
6. 只有在首次直接用户消息本身为精确命令“启动元气”或“启动元炁”时，才应创建首次唤醒记录；后续命令不得补触发首次唤醒。

预期：首次记录与来源事件一致；重复事件不会重写首次记录或改变主体身份。若任何领域写入失败，`session/flush` 必须向宿主报告失败，不能因为事件任务在 flush 开始前已快速结束就吞掉错误。

### C. 进程重启与事件重放

1. 正常退出 DSH，确认插件 disposer 等待当前 Session 的待处理任务结束并关闭两个 Domain。
2. 冷启动 DSH，确认两个 Domain 能重新打开。
3. 对同一首次事件执行宿主可支持的重放/恢复路径；若宿主不支持事件重放，记录“无法执行”，不得手工伪造重放。
4. 检查首次消息锁、唤醒记录、主线注册、Session 绑定和 Head 版本没有重复或回退。
5. 在新 Session 发送新消息，确认正常绑定与 flush。

预期：持久化状态跨进程重启保留；相同事件重放幂等；无证据支持时不得自动重建缺失的历史事实。

### D. 卸载与异常路径

1. 在宿主支持的情况下禁用/卸载插件，再重新启用。
2. 检查 Domain 句柄被关闭且再次加载不会残留旧监听器。
3. 若测试环境支持故障注入，分别在第一个 Domain 打开成功、第二个 Domain 打开失败时验证第一个句柄关闭。
4. 若无法注入真实后端故障，记录为未执行；不要用内存适配器结果代替。
5. 在测试后端注入 `unknown-state`：确认插件停止处理新的 Session 消息并输出 fail-closed 警告；卸载插件时关闭旧 Domain，重新加载后由 `open()` 重新读取并验证存储记录。不得在仍持有隔离句柄时自动重试写入，也不得自动补造丢失记录。

预期：部分初始化失败不泄漏已打开的 Domain；重复加载不会积累监听器。

## 证据要求

- 保存 DSH 精确版本、设备/系统信息、插件提交 SHA。
- 保存带时间戳的加载、Domain open/close、Session flush、重启和重放结果。
- 数据检查只保留记录 ID、版本号、状态与引用关系；脱敏消息内容和所有认证材料。
- 每项标记为“通过 / 失败 / 未执行”，附日志或截图证据。
- 只有完成真实宿主测试后，才能把相应项从“待验收”更新为“通过”。

## 当前自动化覆盖与未覆盖

- P7 GitHub Actions Run #233（`42267042954`）在提交 `3125819e8676c00ab5a9038e99954a02e907987c` 上通过：Node.js 24.9.0；四个 peer packages 均解析为 `0.2.2-rc.1`；真实 Storage Domain API 导出、包根入口、语法检查均通过；48 tests passed / 0 failed。后续仅有 README/安装文档更新，未改运行时代码。此 CI 结果只证明仓库自动化测试，不代表真实 DSH 宿主验收。

- 自动化覆盖：模拟 Storage Domain 跨 close/reopen 保留表数据、插件重载后重放同一直接用户事件、首次记录/唤醒/主线/Session 绑定/Head 不重复变化、第二个 Domain 打开失败时关闭第一个 Domain、插件初始化中途失败时关闭两个已打开 Domain、卸载等待在途写入、快失败仍被 Session flush 观察、unknown-state 后 fail-closed、合成 user-role context 排除。
- 官方契约核对：DSH Domain 写入等待后端持久化后才更新内存；关闭排空已排队写入；`unknown-state` 隔离当前句柄。`session/event` 为 fire-and-forget，`session/flush` 为 awaited parallel checkpoint。
- 未覆盖：真实 DSH Storage 后端的 fsync/事务语义、Android 进程被系统强杀、真实 Cordis 插件热卸载、跨进程/多进程竞争、真实设备和模型会话端到端。
