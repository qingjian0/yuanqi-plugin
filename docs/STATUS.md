# 元炁项目状态

> 当前版本：`1.1.0-alpha.9`  
> 项目阶段：Developer Preview  
> 许可证：GNU GPL-3.0-only  
> 默认文档语言：简体中文（zh-CN）

## 1. 当前验证摘要

| 项目 | 状态 | 说明 |
|---|---|---|
| 自动化测试 | P5/P6 CI 通过 | PR #4 head `12bad3bbffaa755b1df330c3f3bd6baf3018f9b1`：48 passed / 0 failed（Run #220，Node.js 22） |
| JavaScript 语法检查 | P5/P6 CI 通过 | Run #220 的 `npm run check` 通过，包含包根入口/DSH Domain 导出检查与源码语法检查 |
| npm 安装包构建与归档检查 | 归档隔离复验通过 | 历史隔离复验 `npm pack --dry-run` 成功，26 个发布文件；不代表当前分支重新构建通过 |
| 解压后入口导入检查 | 归档隔离复验通过 | 20/20 个本地导入目标存在；GitHub `dev` 导入待完成 |
| GitHub Actions CI | P5/P6 已验证 | PR #4 分支 `work/e00-20-06-p5-dsh-lifecycle-recovery`；Run #220（`42256698714`）成功，PR 仍为 Draft |
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
- 快照历史活动窗口仍保存在每条 Worldline Head 的单一记录中；v7 已提供显式归档与可重入压缩 API，归档保留策略、自动调度及真实后端故障语义仍待验收。
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
- Snapshot CAS 与 SelfModel 更新现在校验全部相关证据引用必须属于当前 Worldline 且处于 active 状态。引用缺失、跨线或已撤销时拒绝提交。`user_confirmed` 状态必须通过专用 SelfModel 更新路径，并附带可信验证的直接用户事件；普通快照提交不能伪造或静默修改用户确认状态。
- 证据撤销与 Snapshot 提交/证据转移使用同一进程内证据状态串行队列，避免单实例并发窗口导致已撤销证据刚好被提交或转移。此保证不扩展为跨进程分布式锁。
- 新增显式跨线转移授权：必须由直接用户事件授权，绑定同一 YuanQiSubject 的源线、目标线、明确 evidence ID 列表和最长 30 天的有效期；源线与目标线必须不同且均为 active。
- 授权可由直接用户事件撤销。转移执行必须再次检查授权、有效期、授权范围和源证据状态；每个授权/evidence 组合形成确定性转移记录与审计事件。
- 转移证据保留源证据引用链，不与源记录共享可变状态。源证据后续撤销时，目标线副本通过来源链动态呈现为 revoked；不会因为已复制而绕过源撤销。
- 自动化新增评估、不可变评估、评估失效、缺失/跨线/撤销引用拒绝、明确授权、超范围拒绝、授权撤销、幂等转移、转移审计、源撤销传播，以及用户确认必须来自直接用户事件的测试。
- GitHub Actions Run #152（`42238287216`）在最终代码提交 `e5a782a1903221903521ab70758406ed0fb24183` 通过：Node.js 22，31 tests passed / 0 failed；包入口、DSH Domain 导出与全部源码语法检查通过。
- 验证边界：当前证据评估是显式、不可变的结构化评估记录，不是外部事实核验服务；模型评估仍然是模型判断。授权、转移、撤销与提交的串行保护只在单个插件实例内成立。真实 DSH 后端、跨进程并发、重启恢复和 Android 宿主验收仍未完成。
- PR #3 保持 Draft，目标分支 `dev`；未合并 `dev` 或 `main`。


## 12. 2026-11-06 P3 Worldline 一致性审计与恢复诊断

- 在 createWorldlineStore 增加只读 auditWorldline({ worldline_id, now_ms })，用于逐条检查 Worldline，不依赖 Storage Domain 表全量枚举能力。
- 检查 YuanQiSubject 身份、主线注册映射、父线归属与分支基准快照引用；检查 Head 身份、快照历史从版本 0 开始的连续性、当前版本/状态/证据引用与最后一条快照的一致性。
- 检查每条历史快照中的 SelfModel 五中心结构与证据引用。缺失/跨线引用报告为 critical；已撤销证据报告为 warning，不修改历史快照。
- 检查 Runtime Lease 元数据、fencing token 是否回退、过期 holder 残留；过期租约属于可接管的运行状态警告，不作为数据损坏。
- 检查被引用的转移证据是否具备一致的来源、目标、授权范围与审计记录；增加循环转移来源链检测，避免损坏数据导致递归溢出。
- 审计结果区分 healthy、degraded、critical，每项包含稳定 issue code、严重级别、说明和建议处置类型；所有结果均标记 repair_policy: manual_only。本阶段不自动重建 Head、不补造证据、不删除快照、不改写授权或撤销记录。
- 新增测试覆盖健康主线只读审计、快照历史断裂、Head 与历史不一致、撤销证据警告、缺失 Head 和循环转移来源链。
- 本阶段不新增表，不升级 Domain schema；快照压缩/归档仍未实现。历史快照仍随 Head 记录增长，未来归档必须先建立可验证的持久归档协议，不能直接截断数组。
- 本阶段代码已推送至 PR #3 分支；CI 尚待本轮最新提交的实际运行结果确认。内存适配器测试仍不代表真实 DSH Storage 后端或 Android 宿主验收。
- PR #3 保持 Draft，目标 dev；main 未修改，未合并。


## 13. 2026-11-06 P4 快照归档与可重入压缩

- YuanQiSubject Storage Domain 升级至 v7，兼容 v3、v4、v5、v6；新增 `worldline_snapshot_archive_entries` 与 `worldline_snapshot_archive_manifests` 两张表。旧 Head 的归档检查点字段为可选/可空，兼容未执行归档的历史记录。
- 新增 `compactSnapshotHistory`：调用方必须提供 Worldline、持有中的 Runtime Lease/fencing token、预期当前快照版本、归档截止版本和来源事件引用。不能归档当前快照，至少保留一个活动快照。
- 归档采用先写逐条不可变快照记录、再写归档清单、最后通过 Head CAS 更新归档检查点和活动历史的顺序。不会先截断 Head，也不删除归档记录。
- 归档清单通过 `previous_archive_id` 链接前一段归档；归档快照以 Worldline + snapshot version 定位。`getSnapshot` 对调用方透明地读取活动历史、归档历史或旧版快照表，旧分支基准引用继续可解析。
- 重试行为：相同归档请求幂等；若归档记录/清单已写入但 Head CAS 前发生中断，Head 历史保持完整，重试复用已持久化归档并完成 CAS。归档清单冲突、Head 版本变化、租约失效或归档范围缺失均拒绝压缩。
- `auditWorldline` 扩展为验证归档清单链、版本范围、每条归档快照、归档与活动历史连续性，并继续校验归档快照中的 SelfModel 和证据引用。缺失/损坏归档不会被静默跳过。`forkWorldline` 和 `getEffectiveSnapshot` 可通过统一的 `getSnapshot` 读取已归档的分支基准快照。
- 新增测试覆盖历史读取保持、分段归档链、重复请求幂等、Head CAS 过期拒绝、模拟归档完成但 Head 更新中断后的重试恢复。
- 本阶段不使用 SHA-256，不声称归档内容具有密码学防篡改能力；当前保证是基于 Storage Domain 不可变写入约束、确定性键、清单链与一致性审计。真实后端的持久化与故障语义仍需宿主验收。
- 快照归档目前是显式 API，不会在后台自动触发；归档保留策略、容量阈值和后台维护调度仍未定义。
- P4 代码和测试已推送至 PR #3 分支；CI 最新提交结果待确认。PR #3 保持 Draft，目标 `dev`；`main` 未修改、未合并。


## 14. 2026-11-07 P6 DSH Storage 契约核对与故障关闭

- 对照 DeepSeek Harness 官方当前源码与文档核对 `@deepseek-ai/dsh-storage-domain`：每个 Domain 具有单独写队列；写入先等待后端持久化，再更新内存并发出 `domain/changed`；关闭会立即拒绝新写入、排空已排队写入、关闭后端单元；关闭操作幂等。`unknown-state` 会隔离 Domain 的读取和后续写入，必须关闭并重新打开。参考官方仓库：`packages/storage/storage-domain/src/domain.ts`、`packages/storage/storage-domain/src/index.ts`、`packages/storage/storage/src/error.ts`。
- 核对 `@deepseek-ai/dsh-session`：`session/event` 是 post-commit、fire-and-forget feed；`session/flush` 是 awaited parallel durability checkpoint。`user/message` 事件不等于直接人类输入；注入上下文同样使用 user-role 消息，必须通过 `event.data.source.kind === 'user'` 区分。YuanQi 的归一化器只接受该直接来源，新增回归测试覆盖 `source.kind === 'plugin'` 的合成上下文不会锁定首次用户消息。
- 修复 flush 错误可能丢失的问题：此前任务一旦快速 settle 就从 `pendingBySession` 删除，若它在 `session/flush` 开始前失败，后续 flush 可能看不到失败。现在保留任务直到 flush drain 消费，使用 `Promise.allSettled` 收集失败，并由 flush 返回 `AggregateError`；任务在后台先附加 rejection handler，避免 fire-and-forget 事件产生未处理拒绝。
- 增加 `unknown-state` fail-closed：一旦任一 Storage Domain 写入报告稳定错误码 `unknown-state`，插件停止处理后续消息并记录要求 unload/reload 的警告。不会在旧句柄仍被隔离时自动继续写入，也不会尝试在同一插件实例内偷偷重开 Domain。卸载时等待在途任务结束后关闭两个 Domain。
- P6 自动化测试新增/扩展覆盖：真实契约形状的 per-Domain write queue、插件初始化中途失败时关闭两个已打开 Domain、插件卸载等待在途写入、快失败仍被后续 Session flush 观察、unknown-state 后停止新写入、合成 user-role context 不被认作直接人类消息、重启重放幂等和第二个 Domain 打开失败时清理第一个 Domain。
- P6 最新代码提交 `12bad3bbffaa755b1df330c3f3bd6baf3018f9b1` 已由 GitHub Actions Run #220（`42256698714`）验证：Node.js 22，48 tests passed / 0 failed；包根入口与 DSH Domain 导出检查、全部源码语法检查均通过。该结果覆盖 P5/P6 新增测试。本执行环境仍无法连接目标 Android/DSH 设备，不能执行真实后端 fsync、系统强杀、真实热卸载或多进程竞争。
- P5/P6 自动化测试已通过，但仍是模拟 Storage Domain 契约测试，不宣称真实宿主验收完成。若真实后端返回 `unknown-state`，恢复流程是插件卸载/释放旧 Domain，再重新加载并让 Storage Domain 在 open 时重新读取、校验全部记录；不进行自动数据修补，不重建缺失证据。
- CI 日志有一条非阻断提示：`actions/checkout@v4` 与 `actions/setup-node@v4` 所使用的 Node.js 20 运行环境已弃用，当前 runner 强制切换到 Node.js 24；后续可单独升级 Actions 主版本并复验。
- PR #4 保持 Draft、base 为 `dev`；PR #3 未修改；未合并 `dev` 或 `main`。

## 15. 2026-11-07 P7 DSH 运行时与 peer API 基线对齐（CI 待验证）

- 核对 DSH 官方仓库当前 `master` 根 `package.json`：版本 `0.2.2-rc.1`，`engines.node` 为 `>=24.9.0`。因此旧 YuanQi `>=22` 声明不足以代表当前 DSH 目标运行时；P7 将 YuanQi Node 要求调整为 `>=24.9.0`，CI Node 调整为 `24.9.0`。
- 核对 DSH 官方包清单：`@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm` 当前源码版本均为 `0.2.2-rc.1`。peer dependency 下限由 `>=0.2.0-0` 提升为 `>=0.2.2-rc.1`，上限保持 `<0.3.0-0`，避免把未核对的早期 0.2.x 版本宣称为兼容目标。
- 核对 Storage Domain 实际公开 API：`defineDomain`、`domainTable`、`DomainError`；`Domain.table()` 返回同步读/异步写的 KV 表，支持 `put`、`update`，`Domain.close()` 是异步幂等关闭。现有 YuanQi schema 声明与 `defineDomain` / `domainTable` 用法匹配官方 `0.2.2-rc.1` 源码。
- 核对 Session API：`session/flush` 是 `SessionStore.flush(session)` 调度的 awaited durability barrier；当前事件监听器必须保持异步任务排空行为。宿主真实调用链仍需实际集成验收。
- CI 已改为 Node.js `24.9.0`，安装后执行四个 peer package 的 `npm ls`，并检查真实 Storage Domain 导出；上述改动已提交，但本节在 CI 成功前只标记为“待验证”。
- 仍未执行真实 Android DSH 安装、Cordis Loader 插件生命周期、真实 JSON/SQLite backend 重启与强杀恢复；不得将 package import 或模拟适配器测试标记为宿主验收。
- 不涉及 SHA-256；PR #4 继续 Draft，base `dev`，不合并 PR #3、`dev` 或 `main`。
