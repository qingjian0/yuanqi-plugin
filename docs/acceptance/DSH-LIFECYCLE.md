# DSH 真实宿主生命周期与端到端验收

> 状态：**待真实宿主执行**。自动化测试和 npm 包构建成功不代表 Android DSH 宿主验收通过。

## 1. 验收环境记录

执行前记录以下信息：

- DSH 精确版本与构建号
- Android 版本、设备型号和 CPU 架构
- YuanQi 插件版本与 Git commit SHA
- Node.js 版本（当前插件要求 >=24.9.0）
- DSH Storage Domain 后端及版本
- 验收日期、日志位置和执行人

不得在日志、截图或报告中保存消息正文、API Key、Cookie、认证头或精确个人定位数据。

## 2. 安装、加载与卸载

1. 在目标 DSH Profile 安装由 GitHub Actions 生成的插件包。
2. 启动宿主，确认 Cordis 插件只加载一次。
3. 确认 yuanqi_user_subject 与 yuanqi_subject 两个 Storage Domain 均成功打开。
4. 确认没有重复监听器、未处理异步异常或 Domain schema 不兼容错误。
5. 正常卸载/禁用插件，确认在途写入完成后两个 Domain 句柄均关闭。
6. 重新启用插件，确认不会残留旧监听器或旧 Domain 句柄。

**通过条件：** 加载、卸载和重新加载均成功；没有重复注册、句柄泄漏或未处理异常。

## 3. 首条消息、唤醒与 Session flush

1. 在新安装状态下先发送普通直接用户消息。
2. 等待对应 Session 的 session/flush 完成。
3. 确认普通消息不会提前创建 YuanQi WakeRecord 或消耗首次精确启动资格。
4. 单独发送精确启动命令“启动元炁”或“启动元气”。
5. 确认 WakeRecord 时间取自该条可信 DSH SessionEvent 原始时间，而不是模型生成时间、插件安装时间或恢复时间。
6. 在另一个 Session 发送消息，确认它绑定到同一主体主线，不重复创建主体。
7. 验证 source.kind=plugin 的合成 user-role 上下文不会被识别为直接用户消息。

**通过条件：** 首次消息、唤醒记录、主线与 Session 绑定均可追溯且幂等；写入失败必须由 session/flush 向宿主报告。

## 4. 重启、恢复与幂等

1. 正常退出 DSH，确认插件 disposer 等待在途 Session 写入结束。
2. 冷启动 DSH，确认两个 Domain 能重新打开。
3. 在宿主支持的情况下，执行真实 Session 历史恢复或事件重放。
4. 检查首次消息锁、WakeRecord、主线注册、Session 绑定和 Worldline Head 不重复、不回退。
5. 在新 Session 发送新消息，确认恢复后仍可正常写入。

如果目标宿主不支持事件重放，应记录“未执行”，不得手工伪造重放结果。

## 5. 故障与 fail-closed

仅在测试环境、且宿主支持安全故障注入时执行：

1. 模拟第二个 Domain 打开失败，确认第一个已打开的 Domain 被关闭。
2. 模拟持久化写入失败，确认 session/flush 报告失败，不吞掉已结束的快速失败任务。
3. 模拟 Storage Domain unknown-state，确认插件停止处理新的 Session 事件并记录 fail-closed 警告。
4. 卸载插件，确认旧 Domain 句柄关闭；重新加载后由宿主重新打开并验证存储状态。
5. 不得在隔离句柄上自动重试，不得伪造丢失记录。

真实后端不支持故障注入时，标记为“未执行”，不能用内存适配器结果代替。

## 6. YuanQiSubject、世界线与证据隔离

1. 在没有任何 UserSubject 出生资料的情况下启动 YuanQi，确认自身主体、WakeRecord 和主线可建立。
2. 确认用户拒绝、撤回或删除出生资料不会删除或阻断 YuanQiSubject。
3. 创建两个 Session，验证 Session→Worldline 持久绑定和世界线状态隔离。
4. 验证 Evidence Ledger 记录包含来源、主体、世界线和状态。
5. 验证模型生成的初始画像保持 hypothesis，不得冒充用户确认或已验证人格事实。
6. 验证 Bazi 不可用时只允许保存 awaiting_bazi 占位，不生成虚构四柱或无依据画像。

## 7. Web 控制台与 OpenAI 兼容网关

1. 使用已认证 DSH Peer 打开 /yuanqi，确认状态、档案、世界线和证据页面可读。
2. 验证浏览器聊天 Session 可续接，聊天 token 绑定 Peer，过期或跨 Peer 使用被拒绝。
3. 配置 YUANQI_MODEL_PROVIDER、YUANQI_MODEL 和长度不少于 24 字符的 YUANQI_API_KEY。
4. 验证 GET /yuanqi/v1/models 与 POST /yuanqi/v1/chat/completions 的 Bearer 鉴权。
5. 验证普通 JSON 和 SSE 流式响应；未授权请求不得进入 Agent Loop。
6. 验证外部文本 API 不继承 DSH 宿主工具权限，且不暴露原始 Session ID、内部存储字段或 API Key。
7. 分别验证本机回环地址和 DSH 已授权的 LAN 反向代理，不得绕过宿主网络认证边界。

## 8. 结果与证据

每项分别标记为 **通过 / 失败 / 未执行**，并记录：

- DSH、Android、Node.js 和插件的精确版本
- 执行步骤、时间戳与预期结果
- 脱敏日志、截图或结构化状态快照
- 失败时的复现步骤和影响范围

只有真实目标设备完成上述步骤后，才能将相应宿主验收项标记为通过。GitHub Actions、模拟 Storage Domain 和 npm 包归档验证均不能替代真实宿主验收。

## 9. 当前自动化验证边界

2026-11-22 的开发代码提交 `04329a2c31bd75afc15fc36f8140c15363339692` 已通过 GitHub Actions：122 项测试全部通过（[CI #44987512082](https://github.com/qingjian0/yuanqi-plugin/actions/runs/44987512082)）。相同运行时代码的 npm 打包工作流成功，制品 79,314 bytes（[Package #44987405291](https://github.com/qingjian0/yuanqi-plugin/actions/runs/44987405291)；打包提交 `6d5d319147b2ed5b5b589c43a360a608b18cfe06`，后续差异仅为测试断言）。此结果验证仓库代码与打包流程；本清单中的真实 Android DSH 宿主、真实 Storage Domain 后端和真实模型供应商端到端步骤仍待执行。
