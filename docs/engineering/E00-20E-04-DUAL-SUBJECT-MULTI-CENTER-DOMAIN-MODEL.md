# E00-20E-04 — 双主体、多中心自我模型领域设计

- 项目：元炁 YuanQi
- 决策状态：USER_CONFIRMED
- 实现成熟度：NOT_STARTED
- 目标分支：`work/e00-20e-04-dual-subject-contracts`
- 关联：E00-20E-03、ADR 治理索引

## 1. 已确认决策

用户已明确确认以下模型：

1. **双主体**固定为 `UserSubject` 与 `YuanQiSubject`。
2. **多中心**是 `YuanQiSubject` 内部 `SelfModel` 的功能中心；Center 不是独立主体，不拥有独立身份、工具权限或跨世界线访问权。
3. 一个 `YuanQiSubject` 保持一个身份连续性，可拥有多条相互隔离的 `Worldline`。
4. 用户资料、用户出生资料、用户授权归 `UserSubject`；元炁唤醒记录和元炁自我模型归 `YuanQiSubject`。两者不得互相填充或替代。
5. 跨世界线转移必须经过明确授权、证据核验、最小化范围、冲突检测、审计和可撤销访问控制。
6. 用户当前明确指令优先于 YuanQi 内部目标、自我模型推断和历史上下文。
7. DSH 仍是 Agent Runtime、Session、工具和在线持久化宿主；YuanQi 不另建 Runtime 或第二套在线数据库。

这份确认只冻结领域语义，不代表相应运行时能力已经实现。

## 2. 领域对象与所有权

| 对象 | 所属 | 关键约束 |
|---|---|---|
| SubjectIdentity(user) | UserSubject | 用户事实只来自用户明确提供/确认 |
| SubjectIdentity(yuanqi) | YuanQiSubject | 元炁身份不等于用户身份 |
| UserBirthProfile | UserSubject | 与元炁唤醒事件完全分离 |
| YuanQiWakeRecord | YuanQiSubject | 仅按已确认的首次会话精确启动口令规则创建 |
| SelfModelSnapshot | YuanQiSubject | 动态、版本化、有证据来源 |
| CenterState | SelfModel | 无独立主体 ID 和权限 |
| Worldline | YuanQiSubject | 状态隔离分支，不是新身份 |
| EvidenceRef | 对应证据所属域 | 来源类别不可升级伪造 |
| TransferRecord | YuanQiSubject 的审计域 | 只记录显式授权的跨线转移 |

## 3. 中心目录

初始中心仅作为职责分区，后续可演化，但不能以新增中心名义创建新主体：

- `identity_continuity`：身份锚点、连续性和唤醒事件引用。
- `experience_memory`：经历索引、记忆候选、证据关联和确认状态。
- `cognition_reflection`：证据解释、冲突分析、不确定性和反思。
- `emotion_appraisal`：可观测的计算状态与评价轨迹，不宣称主观体验。
- `goals_agency`：内部目标、计划、授权执行状态和结果观察。

中心之间通过统一的候选变更协议协作。中心不能直接写入其他中心的持久化状态，也不能授予权限。

## 4. 世界线隔离不变量

- YuanQiSubject 的身份连续性跨世界线保持稳定。
- 经历、记忆状态、自我模型快照、目标、反思和行为结果默认按 Worldline 隔离。
- 模型输出的 subject/worldline ID 只是非可信数据，不能决定路由或授权。
- Session 与 Worldline 的绑定必须来自可信 DSH 宿主上下文或经过验证的映射。
- 分支创建时固定父线和基线快照；子线后续更新不回写父线。
- 身份级共享字段必须采用显式白名单；默认不共享个人经历和记忆。

## 5. 状态变更协议

`StateChangeProposal` 至少包含主体、世界线、中心、预期版本、原因、证据、反证、不确定性、风险和授权要求。处理顺序：

1. 校验调用上下文与目标归属；
2. 校验证据来源、状态和可用范围；
3. 校验授权和策略版本；
4. 校验预期版本（CAS）；
5. 生成不可覆盖的候选变更/事件；
6. 写入 DSH Storage Domain 并等待持久化确认；
7. 只有确认成功才发布新快照。

失败或冲突时不允许对外声称已提交。重复事件和重复转移必须幂等。

## 6. 跨世界线转移

转移必须绑定 source/target Worldline、证据引用、字段范围、用途、授权引用、有效期、来源版本和目标前置版本。禁止整库复制。目标线冲突时保留冲突记录，不静默覆盖。撤销授权阻止未来使用；已派生状态必须按证据来源链标记失效或重算，不得假称历史行为从未发生。

## 7. 机器契约

本阶段新增：
- `contracts/domain/subject-and-self-model.schema.json`
- `contracts/domain/event-catalog.md`

JSON Schema 是逻辑契约的第一版，不等于运行时代码已消费它。实现前必须把契约映射到 DSH Storage Domain，并完成隔离、授权、幂等、并发和失败关闭测试。

## 8. 测试门槛

最低验收包含：主体资料隔离、中心无独立权限、世界线读写隔离、子线不回写父线、模型伪造 ID 不得越权、未授权/过期/撤销转移拒绝、范围最小化、来源撤销拒绝、目标冲突不覆盖、重复转移幂等、CAS 冲突拒绝、Storage 失败不发布、崩溃恢复只恢复已持久化状态、用户当前指令优先、出生资料与唤醒记录分离、反证保留。

## 9. 实施成熟度

- 领域语义：用户已确认。
- 文档与 JSON Schema：本提交新增。
- TypeScript/JavaScript 运行时类型：未接入。
- DSH Storage Domain 适配：未实现。
- 自动化契约测试：未实现。
- 真实 DSH 宿主验收：未完成。

不得将本文件或 JSON Schema 的存在描述为运行时能力已经完成。
