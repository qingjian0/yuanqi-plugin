# YuanQi 工程交付总计划

> 最后核对：2026-11-22  
> 当前集成分支：`dev`  
> 稳定分支：`main`（本轮未修改）  
> 当前版本：`1.1.0-alpha.9` · Developer Preview  
> 许可证：GPL-3.0-only

## 1. 当前权威基线

- 仓库：`qingjian0/yuanqi-plugin`
- 本文档所在快照：`8c6ab09ca09124845ec588b19d57189933653721`
- 运行时与测试代码验证提交：`04329a2c31bd75afc15fc36f8140c15363339692`
- CI：122 passed / 0 failed，Node.js 24.9.0，DSH peer/API 导出检查通过。
  - [GitHub Actions CI](https://github.com/qingjian0/yuanqi-plugin/actions/runs/44987512082)
- 当前快照打包：npm pack 成功，归档制品 79,316 bytes。
  - [Package workflow](https://github.com/qingjian0/yuanqi-plugin/actions/runs/44987599807)
- 依赖基线：DSH peer package 声明兼容范围 `>=0.2.2-rc.1 <0.3.0-0`；Node.js `>=24.9.0`。兼容范围不是对范围内每个版本均已完成宿主验收的声明。

**重要边界：** CI、模拟 DSH 服务和 npm 归档只验证仓库自动化与打包流程；它们不等于真实 Android DSH 宿主、生产 Storage Domain 后端或真实模型供应商端到端验收。

## 2. 已进入 dev 的实现

| 子系统 | 当前实现 | 仍需注意 |
|---|---|---|
| 双主体 | `UserSubject` 与 `YuanQiSubject` 分域保存 | 用户出生资料与元炁自身唤醒资料不得混用 |
| 首次唤醒 | 精确启动命令、可信 DSH 事件时间、安装边界与冷历史恢复 | 真实宿主事件顺序与恢复行为待设备验收 |
| 出生与八字 | 时区、真太阳时、节气、四柱与先天符号基线 | 无可靠地点/时区时保留未知或歧义 |
| Worldline | 主线、分支、Session 绑定、五中心 SelfModel | Runtime Lease 是单实例存储写链内协调，不宣称跨进程分布式锁 |
| Evidence Ledger | 来源记录、撤销、评估、跨线授权转移与审计 | 模型解释不能自动升级为用户事实 |
| 初始画像 | 六维八字解释、命盘证据目录、来源追溯与不可覆盖的 hypothesis | 命理解释不是心理学事实 |
| 后天经历 | 模型选择的候选记录、逐维评估、跨 Session 聚合、版本化 current_personality 假设 | 尚未自动扫描所有对话；评估者仍是模型类别，非独立验证 |
| Web 控制台 | DSH Peer 认证、档案/世界线/证据读取、浏览器聊天 | 页面除聊天外主要为只读 |
| OpenAI 兼容网关 | Bearer Key、文本聊天、SSE、工具屏蔽、Session 生命周期管理 | 真实模型供应商与宿主网络仍待端到端验收 |
| 请求取消 | HTTP 请求中断/响应断开会取消拥有的 Agent，并等待停稳后释放句柄 | 目前由自动化测试验证，仍需真实宿主压力测试 |

### 已实现的 YuanQi Agent 工具

- `yuanqi_self_profile`
- `yuanqi_record_initial_personality`
- `yuanqi_record_experience_candidate`
- `yuanqi_assess_experience_candidate`
- `yuanqi_reconcile_personality_evidence`
- `yuanqi_record_current_personality_revision`

## 3. 尚未完成的交付验收

### P0：真实 DSH 宿主

1. 在目标 Android DSH Profile 安装当前归档。
2. 验证 Cordis 加载、双 Storage Domain 打开、插件卸载与重新加载。
3. 验证普通首条消息、精确唤醒命令、Session flush、冷启动恢复和事件重放。
4. 验证真实 Storage Domain 写入失败、unknown-state、关闭失败与恢复。
5. 验证真实 Agent Loop 工具可见性、模型路由、SSE、断连取消与 AgentHandle disposal。

验收步骤见 [DSH 真实宿主生命周期清单](../acceptance/DSH-LIFECYCLE.md)。没有真实设备日志和版本信息时，相关项目必须保持“待验收”。

### P1：后天经历闭环

- 当前为模型选择候选、模型逐维评估、跨 Session 来源聚合和版本化画像假设。
- 自动采集尚未实现；不得默认复制所有聊天正文或工具参数到长期存储。
- 独立评估者尚未实现；不同 Session 的来源分离不等于不同评估者。
- 后续应先明确采集范围、隐私最小化、来源撤销与评估者独立性，再决定自动触发方式。

详细记录见 [E00-22 后天经历与证据采集管线](./E00-22-P0-EXPERIENCE-EVIDENCE-PIPELINE.md)。

### P2：领域契约与治理

- 双主体与多中心领域语义已在运行时代码中落地一部分。
- Draft PR #2 中的 JSON Schema / Event Catalog 仍未合入 `dev`，不能声称运行时代码已消费这些 Schema。
- 正式 ADR 仍需逐项审查和批准；历史设计建议不自动成为规范。
- 合并契约前必须将 Schema 与当前 DSH Storage Domain v11、Worldline、Evidence Ledger 和现有运行时行为逐项对齐。

### P3：发布质量

- 当前版本仍为 Developer Preview，不应标记为生产稳定版。
- npm 归档上传成功不等于发布到 npm Registry，也不等于设备安装成功。
- 正式发布前需完成真实宿主验收、模型供应商端到端、安全审查、依赖兼容矩阵与升级/回滚验证。

## 4. 分支与集成纪律

- `main`：稳定基线；未经明确发布决策不直接写入。
- `dev`：唯一日常集成分支；独立功能应尽量批量集成，避免长期漂移分支。
- 已合并的整批交付以 `dev` 当前树为准；旧分支或旧 PR 不能替代当前代码证据。
- 不为了增加并发数量制造互相重叠的分支；并行任务必须有清晰文件边界和可独立验收的结果。
- PR #1（知识库）仍以 `main` 为目标的 Draft；PR #2（领域契约）仍以 `dev` 为目标的 Draft。它们都不是当前运行时代码已完成的证明。

## 5. 历史计划说明

2026-11-06 用户已明确取消恢复 alpha.9 历史源码归档的计划。旧的 E00-20E-02 “将历史归档中的 19 个模块与完整测试树导入 dev”验收项作废；历史隔离复验记录仅作为历史证据保留，不授权复制归档源码，也不作为当前代码基线。

当前交付路径是在现有 GitHub `dev` 工作树上持续实现与验证，并复用 DSH 官方 Agent、Session、Storage Domain、SessionQuery、WebServer 和工具服务；不另建 Agent Runtime 或第二套在线数据库。

## 6. 完成定义

只有同时满足以下条件，项目才能从 Developer Preview 转为可发布候选：

1. 运行时代码、文档、Schema 与包入口一致。
2. CI、测试与打包在同一明确提交上通过。
3. 真实 Android DSH 宿主安装、运行、卸载、恢复与异常路径验收通过。
4. 真实模型供应商端到端、请求取消、工具权限与数据边界验收通过。
5. 自动经历采集与独立评估若仍未实现，必须明确列为未交付，不得以模型手动工具流程冒充自动闭环。
6. 发布版本、升级/回滚方案、依赖兼容矩阵和 GPL-3.0-only 许可证信息齐全。

