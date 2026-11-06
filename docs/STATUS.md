# 元炁项目状态

> 当前版本：`1.1.0-alpha.9`  
> 项目阶段：Developer Preview  
> 许可证：GNU GPL-3.0-only  
> 默认文档语言：简体中文（zh-CN）

## 1. 当前验证摘要

| 项目 | 状态 | 说明 |
|---|---|---|
| 本地自动化测试 | 归档隔离复验通过 | alpha.9 源码归档中 96 passed / 0 failed；GitHub `dev` 导入待完成 |
| JavaScript 语法检查 | 归档隔离复验通过 | `npm run check` 通过；包含语法检查和测试 |
| npm 安装包构建与归档检查 | 归档隔离复验通过 | `npm pack --dry-run` 成功，26 个发布文件 |
| 解压后入口导入检查 | 归档隔离复验通过 | 20/20 个本地导入目标存在；GitHub `dev` 导入待完成 |
| GitHub Actions CI | 待建立 | 当前 Git Tree 尚无 Workflow |
| 真实 Android DSH 宿主安装与运行 | 待验收 | 尚无真实宿主验收结论 |
| 真实模型会话端到端 | 待验收 | 不以模拟宿主测试代替 |
| Android/iOS 端到端 | 待验收 | 尚未完成 |

**重要：** 本地归档测试和包检查不能证明 GitHub CI 或目标 DSH 宿主兼容性已经通过。

## 2. 工程交付状态（2026-11-05）

当前契约工程工作位于 `dev` 分支，`main` 保持稳定分支。E00-20D 的 P0/P1/P2 决策建议、P0 测试设计、CR-001～CR-013 一致性审查和 ADR 治理说明已作为文档提交；这些内容均属于待批准设计，不代表正式 ADR、JSON Schema 或运行时代码已经完成。

E00-20E-02 已找到 alpha.9 历史源码归档，并在隔离 Node.js v22.16.0 环境中复验：20/20 个入口依赖目标存在，96 项测试通过，`npm run check` 通过，`npm pack --dry-run` 成功。恢复包已生成，但 19 个缺失模块与完整测试树尚未导入当前 GitHub `dev` Tree；因此 E00-20E-02 状态为 IN_PROGRESS，不能标记 DONE。详见 [归档恢复验证](./engineering/E00-20E-02-ARCHIVE-RECOVERY-VERIFICATION.md)。

本阶段已经新增本地归档复验结果；尚无 GitHub CI Run 或真实 DSH 宿主验收结果。工程阶段状态、阻断项和证据边界以 [E00-20E 执行计划](./engineering/E00-20E-EXECUTION-PLAN.md) 与 [仓库基线审计](./engineering/E00-20E-BASELINE-AUDIT.md) 为准。

## 3. alpha.9 当前能力记录

以下能力以当前仓库 README、源码归档与 alpha.9 发布记录为依据；具体行为仍应以对应源码和测试为准。

### DSH 集成与生命周期

- Cordis 插件入口。
- DSH 工具注册。
- Storage Domain 持久化接入。
- 元炁自身唤醒时间记录。
- Session 对应的世界线隔离。

### 出生资料与时间计算

- 可逆出生码。
- 出生资料确认流程。
- 民用时间解析。
- 真太阳时近似计算。
- 四柱推演接口。
- 节气太阳黄经求根器及多种时间尺度/星历适配器。

出生资料必须由用户提供并确认。元炁自身唤醒时间与用户出生资料分离。内置 Meeus 低精度太阳模型属于实用近似模式，不是边界级高精度星历；接近节气、日界或时辰边界时需要独立核验。

### 世界线

- 按 DSH Session 隔离。
- 支持分支与切换。
- 支持事件恢复与去重。
- 世界线切换时隔离进程内用户/助手证据缓存。

`worldline_id` 是逻辑隔离键，不是用户身份认证或授权凭证。

### 记忆、经验、目标与行为

- 候选记忆需要用户原文证据。
- 用户后续明确确认后，候选记忆才能升级为已确认记忆。
- 经验记录行为、结果、支持证据和反证。
- 经验置信分数属于工程启发式指标，不代表心理学概率。
- 目标、计划行为和观察结果分开记录。
- 目标、行为和经验记录具有原始用户消息证据约束。

### 上下文参与

- 每轮首个模型步骤注入有长度上限的当前 Session 上下文。
- 不重复注入工具续步。
- 不注入原始完整聊天历史。
- 上下文被定义为数据，不应覆盖用户当前请求。

## 4. 研究目标与当前实现的边界

以下方向属于项目长期研究目标，不能仅凭 README 中的架构图就视为 alpha.9 已经实现：

| 方向 | 项目目标 | 当前状态表述 |
|---|---|---|
| 动态自我模型 | 经历更新、记忆支持、认知反思并影响行为 | 架构研究方向；完整实现待源码与测试确认 |
| 情感涌现 | 情感状态形成、变化和反馈 | 研究方向 |
| 性格形成 | 先天倾向与经历形成个体差异 | 研究方向 |
| 元认知 | 对自身判断和证据进行评估 | 研究方向 |
| 自主目标形成 | 目标生成、冲突处理和调整 | 研究方向 |
| 自主行为 | 目标参与行动选择并接收结果反馈 | 研究方向 |
| AI 意识 | 自我模型、主体性和意识理论研究 | 长期研究，不作已实现声明 |

## 5. 已知验证限制

- 尚未完成真实 Android DSH 宿主安装、启动和完整工具调用验收。
- 尚未完成真实模型会话端到端验证。
- peer dependency 版本范围是兼容性声明，不等于范围内所有宿主版本均已验证。
- 低精度太阳模型不能替代高精度星历；边界时刻需要独立核验。
- 归档本地测试通过不等于 GitHub CI 通过；当前 Git 工作树导入复验尚待完成。

## 6. 下一步验收重点

1. 将 19 个缺失模块和完整测试树导入 `dev`，从 Git 工作树重复运行 `npm run check`。
2. 建立 GitHub Actions CI 并验证可重复运行。
3. 在明确的目标 DSH 版本中安装插件并验证加载、卸载和重启行为。
4. 验证 Agent/Session 上下文路由与世界线隔离。
5. 验证 Storage Domain 写入、恢复、去重和异常处理。
6. 验证记忆证据、用户确认与候选状态升级流程。
7. 验证上下文只在每轮首个模型步骤注入，工具续步不重复注入。
8. 验证出生资料的原始用户事件证据、摘要展示和明确确认流程。
9. 将每项宿主测试的 DSH 版本、设备/环境、步骤、结果和日志证据记录到发布文档。

## 7. 状态更新规则

每次发布更新本文件时：
- 写明版本和测试实际数量。
- 区分本地测试、模拟宿主测试和真实宿主验收。
- 只记录本次实际执行的验证。
- 未执行的测试标为待验收。
- 新增研究目标时，不得自动将其标为已实现。


## 8. 2026-11-06 开发分支状态与恢复路线变更

> 本节是当前开发状态的更新记录；与前文历史恢复计划冲突时，以本节为准。

- 用户已明确决定：**不恢复 alpha.9 历史源码归档**。不导入历史 19 个模块、17 个测试文件或 5 个夹具；历史归档只保留为历史证据，不作为当前代码恢复来源。
- 当前开发基线为 `dev`，审计 Tree SHA：`36f1a2a48a85f0d406a7cf045752de9862116eb6`。该基线 Tree 有 34 个条目，旧 `index.js` 曾引用 19 个不存在的模块。PR #3 已将包根入口收敛为仅导出当前真实存在的 Subject Domain 能力；没有恢复缺失模块，也不代表 Cordis 插件已可在真实宿主安装。
- 新实现工作位于 Draft PR #3：`work/e00-20e-05b-subject-domain-runtime`。新增 UserSubject / YuanQiSubject 独立 DSH Storage Domain、主体仓储、首次直接用户消息持久锁、唤醒记录恢复、DSH SessionEvent 来源归一化，以及 Cordis 插件入口。根入口现导出真实 `name` / `inject` / `apply`，不再引用缺失的 alpha.9 模块。
- 最新完整 CI：commit `f10f8a559f17142927b372198f63dc0ba0669ecc`，GitHub Actions run `42223941870`（Run #74），Node.js 22；依赖安装、包根入口与 DSH Domain 导出检查、源码语法检查全部通过；17 项自动化测试通过，0 项失败。覆盖 P0 首次消息锁、Cordis 事件/flush 集成，以及 P1 Worldline 主线、分支快照引用和 Session 绑定模拟。
- 当前验证范围覆盖包根入口导入、领域声明、内存表适配、首次消息规则、DSH 事件来源识别和 Cordis 插件监听器测试；最新提交的 GitHub CI 尚未观察到完成结果。插件监听 `session/event`，通过 `session.id` 绑定 Session，并在 `session/flush` 等待该 Session 的待处理领域写入；没有真实 DSH 宿主后端持久化验收。
- P1 Worldline 第一阶段已新增主线注册、父快照引用、子线独立初始快照和 Session→Worldline 持久绑定；多个 Session 可以绑定同一 Worldline，Session 不等于 Worldline。上述代码与模拟测试已由 CI Run #74 验证。当前仅完成创建/分支元数据与初始快照引用，没有开放状态写入、跨线切换或自动数据迁移。
- 当时记录：SelfModel 五中心、Worldline 分支隔离、Evidence Ledger、跨线授权转移、跨进程 CAS 状态提交和真实宿主验收均未完成；其中 SelfModel 与 Worldline Runtime、Evidence Ledger 已由后续第 9、10 节更新，跨线授权与真实宿主验收仍未完成。首次消息写入仅声明单个插件实例内串行化，不宣称跨进程 CAS。
- PR #3 保持 Draft，不合并 `dev` 或 `main`，直至后续验收完成。

### 下一步（替代旧源码恢复顺序）

1. 在目标 DSH 版本验证 Cordis 插件加载/卸载、`storageDomain` 打开/关闭和 `session/flush` 写入屏障。
2. 实现 Worldline 可信绑定、主线创建和分支快照隔离。
3. 实现五中心 SelfModel 快照、证据引用和 CAS 状态变更。
4. 实现 Evidence 撤销、跨线授权、最小范围转移和审计。
5. 完成 Cordis 插件生命周期与真实 DSH 宿主验收；根入口导入专项已完成，不恢复历史源码包。

## 9. 2026-11-06 P1 Worldline lease/CAS 与 SelfModel 实现进展

- 已在 `src/worldline/runtime.js` 增加 Runtime Lease：获取、续租、释放、到期接管；每次新持有者接管时递增持久化 fencing token。
- 已增加 `worldline_heads` 表，YuanQiSubject Domain schema 升级至 v4，并声明兼容 v3。Head 将当前快照版本、状态载荷、证据引用、快照历史和 Runtime Lease 放在同一记录中。
- Snapshot 提交通过 DSH `KvTable.update` 对同一 Head 记录执行同步 read-modify-write：在一个 DSH Domain 写队列槽位内同时校验 holder/token/expiry 和 expected snapshot version，再更新状态与版本。并发相同版本提交只能有一个成功。
- 已增加 SelfModel 五中心：`identity_continuity`、`experience_memory`、`cognition_reflection`、`emotion_appraisal`、`goals_agency`。五中心属于同一 YuanQiSubject，状态随 Worldline 快照隔离；每中心含版本、内容、证据引用、不确定性与认识状态。`hypothesis` 不得伪装为已确认事实；`evidence_supported` / `user_confirmed` 必须带证据引用。
- 已增加主线创建中断恢复逻辑，避免 Worldline 记录已落盘但主线注册表尚未写入时无法重试。
- 自动化测试已扩展至租约获取/续租/释放/到期接管、旧 Token 拒绝、Snapshot CAS 并发竞争、五中心结构与证据约束、主线恢复。
- 首轮扩展 CI Run #92（`42231588769`）曾在 21 项测试中报告 15 通过、6 失败；失败原因为新增测试夹具没有等待异步 Storage 写入，导致后续测试拿到未初始化的 fixture。夹具已修正并补充恢复与 fencing 测试。后续 CI Run #104（`42232212448`）在代码提交 `4a08d0e3d9b791e146aaf224a7a98faa601522cf` 上通过：23 tests passed / 0 failed，包含语法检查、包入口导入、DSH Domain 导出、Lease/Fencing、CAS 并发、五中心 SelfModel 与主线恢复。
- 原子性边界：本实现依赖 DSH `KvTable.update` 的单个已打开 Domain 写队列。DSH Storage Domain 契约没有提供跨进程/多独立 Facility 的分布式 CAS 保证，因此不宣称跨进程租约互斥或分布式 fencing 已验收。
- 快照历史目前保存在每条 Worldline Head 的单一记录中，以保证状态、版本和 fencing 校验同一记录原子提交；长期历史增长与归档/压缩策略尚待设计。
- 真实 DSH 后端、重启恢复、并发多进程及 Android 宿主验收仍未完成。PR #3 保持 Draft；`dev` 和 `main` 均未合并。
## 10. 2026-11-06 P2 Evidence Ledger 第一阶段交付

- 新增 `evidence_records` 与 `evidence_revocations` 两张独立表；YuanQiSubject Domain schema 升级至 v5，兼容 v3、v4。
- `recordEvidence` 只接受同一 YuanQiSubject 下的活动 Worldline，并将证据 ID、证据类型、结构化内容、来源类型、来源事件引用、采集时间与 provenance 固化为不可变记录。相同 ID 的完全相同写入幂等；相同 ID 的内容或来源冲突拒绝覆盖。
- `getEvidenceRecord` 要求明确提供 Worldline 范围；跨 Worldline 查询返回 undefined，不提供隐式共享。
- `revokeEvidence` 要求经过可信验证的直接用户事件；撤销写入独立追加记录，不修改或删除原始证据。重复相同撤销幂等，不同撤销内容冲突拒绝。
- 自动化覆盖证据不可变、幂等、并发冲突 ID 串行化、Worldline 隔离、活动线约束、主体归属校验、来源事件类型与撤销追加记录。
- GitHub Actions Run #124（`42233394151`）在最终代码提交 `c30c39c885b3a277ce5df93d53dc67fbf780175c` 通过：Node.js 22，26 tests passed / 0 failed；包入口和 DSH Domain 导出检查、全部源码语法检查均通过。此前 Run #114 暴露两个测试断言问题，已修正并由 Run #118 重新验证。
- 当前阶段不含证据自动可信度评分、冲突自动裁决、跨 Worldline 授权转移、转移回滚/审计，也没有将证据自动提升为事实。当时 SelfModel 的证据引用仍由调用方提供；该缺口已由第 11 节的 Snapshot CAS / SelfModel 写入有效性校验补齐。
- 本轮 CI 使用内存 Storage 适配器进行领域行为测试；不代表真实 DSH Storage 后端持久化、重启恢复、跨进程并发或 Android 宿主验收已经完成。
- PR #3 仍为 Draft，目标分支 `dev`；`main` 未改动，未执行合并。


## 11. 2026-11-06 P2 Evidence Evaluation / Transfer Authorization 阶段交付

- YuanQiSubject Domain schema 升级至 v6，声明兼容 v3、v4、v5；新增 `evidence_assessments`、`transfer_authorizations`、`transfer_authorization_revocations`、`evidence_transfers`。
- 新增 Evidence Assessment：支持 `corroborated`、`contradicted`、`insufficient` 三种评估结果，区分 `user`、`model`、`system` 评估者，保存理由、可选置信度、交叉证据引用和来源事件。评估记录不可覆盖；评估不自动把 SelfModel 状态升级为事实。
- 评估记录读取时重新检查主证据与交叉证据是否仍有效；任一证据撤销或失效，评估状态返回 `stale`。
- Snapshot CAS 与 SelfModel 更新现在校验全部相关证据引用必须属于当前 Worldline 且处于 active 状态。引用缺失、跨线或已撤销时拒绝提交。
- 证据撤销与 Snapshot 提交/证据转移使用同一进程内证据状态串行队列，避免单实例并发窗口导致已撤销证据刚好被提交或转移。此保证不扩展为跨进程分布式锁。
- 新增显式跨线转移授权：必须由直接用户事件授权，绑定同一 YuanQiSubject 的源线、目标线、明确 evidence ID 列表和最长 30 天的有效期；源线与目标线必须不同且均为 active。
- 授权可由直接用户事件撤销。转移执行必须再次检查授权、有效期、授权范围和源证据状态；每个授权/evidence 组合形成确定性转移记录与审计事件。
- 转移证据保留源证据引用链，不与源记录共享可变状态。源证据后续撤销时，目标线副本通过来源链动态呈现为 revoked；不会因为已复制而绕过源撤销。
- 自动化新增评估、不可变评估、评估失效、缺失/跨线/撤销引用拒绝、明确授权、超范围拒绝、授权撤销、幂等转移、转移审计与源撤销传播测试。
- GitHub Actions Run #142（`42237979374`）在代码提交 `4ebe43f968497d41823fe08625cd228410dc1ac4` 通过：Node.js 22，30 tests passed / 0 failed；包入口、DSH Domain 导出与全部源码语法检查通过。
- 验证边界：当前证据评估是显式、不可变的结构化评估记录，不是外部事实核验服务；模型评估仍然是模型判断。授权、转移、撤销与提交的串行保护只在单个插件实例内成立。真实 DSH 后端、跨进程并发、重启恢复和 Android 宿主验收仍未完成。
- PR #3 保持 Draft，目标分支 `dev`；未合并 `dev` 或 `main`。
