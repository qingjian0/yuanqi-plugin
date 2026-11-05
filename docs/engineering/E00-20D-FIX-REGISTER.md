# E00-20D 契约修订登记册

> 状态：OPEN（修订待决，不代表 ADR 已批准）
> 适用工程分支：`dev`
> 输入：E00-20D-01～12 设计初稿及 E00-20D-12 一致性审查
> 目的：在生成正式 JSON Schema 前，收敛公共契约中的阻断歧义。

## 状态语义

- **OPEN**：问题已登记，尚未完成裁决。
- **PROPOSED**：存在建议方案，但尚未获得项目级批准。
- **ACCEPTED**：已批准并可进入规范实现。
- **IMPLEMENTED**：已落入仓库代码或 Schema。
- **VERIFIED**：已由自动化测试或明确证据验证。

本登记册中的任何建议均不自动构成 ACCEPTED。ADR 编号仅用于追踪，不代表批准。

## P0：Schema 开始前必须裁决

| ID | 问题 | 必须明确的内容 | 建议方向（待决） | 状态 |
|---|---|---|---|---|
| FIX-001 | Metadata 序列化布局 | Metadata 是 Envelope 的固定字段还是扩展容器；字段命名、版本和规范化规则 | 将协议元数据与业务 payload 分层，固定字段采用显式 Schema | PROPOSED |
| FIX-002 | Authorization Schema | 授权声明、授权主体、资源范围、动作、约束、有效期和撤销引用 | 使用不可混淆的 AuthorizationRef；授权判定仍由安全运行时完成 | PROPOSED |
| FIX-003 | ServiceIdentity | 服务身份与用户 Principal、Agent Identity、Runtime Identity 的边界 | 定义独立 ServiceIdentity 类型和受信任签发来源 | PROPOSED |
| FIX-004 | Event Sequence | sequence 的作用域、单调性、并发分配、重放和缺口语义 | 明确为某一事件流/聚合范围内的序号，不宣称全局排序 | PROPOSED |
| FIX-005 | Event Commit 约束 | 已创建事件与已提交事件的区别；事务提交、可见性和失败语义 | 定义 commit 状态/提交凭证；仅提交后事件才进入正式可见流 | PROPOSED |
| FIX-006 | DomainCall 模式条件 | 同步调用、异步消息、命令转发、查询和事件订阅各自的约束 | 将调用模式做成判别联合，不允许互斥字段混用 | PROPOSED |
| FIX-007 | UNKNOWN_OUTCOME 恢复 | 超时但副作用可能已发生时的查询、重试、补偿与人工介入策略 | 将 UNKNOWN_OUTCOME 作为独立终态/待解析状态；先查询或对账，禁止盲目重试 | PROPOSED |

## P1：公共契约一致性与安全边界

| ID | 问题 | 必须明确的内容 | 建议方向（待决） | 状态 |
|---|---|---|---|---|
| FIX-008 | event_version 类型 | 各文档中的整数、字符串和版本语义是否一致 | 区分 Schema 版本与事件类型版本，统一字段类型 | PROPOSED |
| FIX-009 | transaction_id / commit_id | 事务标识与提交标识的语义、作用域及关联 | 两者分离；一个事务可关联一个或多个提交记录 | PROPOSED |
| FIX-010 | Query/Event Subscription | 查询订阅与事件流订阅的语义和生命周期 | 拆分 QuerySubscription 与 EventSubscription | PROPOSED |
| FIX-011 | Schema 附加属性策略 | additionalProperties、unevaluatedProperties 与扩展点 | 默认拒绝未声明字段；扩展点显式命名并版本化 | PROPOSED |
| FIX-012 | 外部副作用结果 | 外部服务调用结果、回执、超时和未知结果如何持久化 | 将外部副作用记录与领域事件分离，并保留外部关联 ID | PROPOSED |
| FIX-013 | 时间可信度 | observed/recorded/occurred/received 时间及其可信来源 | 时间值与时间来源/可信等级分开表达 | PROPOSED |
| FIX-014 | 运行时跨领域校验 | JSON Schema 无法表达的 Owner、授权、唯一性、时序和跨实体约束 | 建立独立运行时 invariant 校验层及测试 | PROPOSED |
| FIX-015 | D09-D13、D15 领域核验 | 领域正式名称、职责、Owner、命令/查询/事件及依赖 | 仅从原始领域资料核实；核实前保持 UNVERIFIED | OPEN |
| FIX-016 | Event 隐私删除 | 不可变事件与隐私删除、保留期限、密钥销毁之间的关系 | 采用受控删除/加密擦除或脱敏补偿策略，保留审计边界 | PROPOSED |
| FIX-017 | 跨 Worldline 转移审计 | 授权、来源、目标、证据校验、审批与结果记录 | 采用显式 TransferRecord 和审计事件；默认禁止隐式转移 | PROPOSED |

## P2：可维护性与文档治理

| ID | 问题 | 必须明确的内容 | 建议方向（待决） | 状态 |
|---|---|---|---|---|
| FIX-018 | 统计去重 | event_count、统计快照、重放与去重口径 | 以稳定事件 ID 和明确统计窗口定义去重规则 | PROPOSED |
| FIX-019 | Schema URI | Schema 标识符、版本路径、发布与兼容策略 | 采用稳定命名空间与不可变版本 URI | PROPOSED |
| FIX-020 | ADR 编号治理 | ADR-001～290 候选项的重复、冲突、依赖和状态 | 建立索引和状态字段；编号不作为批准证据 | OPEN |

## 修订顺序与依赖

1. 先裁决 FIX-001～FIX-007，形成公共 Envelope、授权引用、ServiceIdentity、事件顺序/提交及 DomainCall 的规范决定。
2. 再裁决 FIX-008～FIX-014，统一版本、订阅、Schema 严格性、外部副作用、时间可信度与运行时 invariant。
3. FIX-015 必须以原始领域资料为证据，不得按邻近领域推测名称或职责。
4. FIX-016～FIX-017 在事件不可变性与跨 Worldline 隔离规则稳定后裁决。
5. FIX-018～FIX-020 在公共规范稳定后完成治理。
6. 只有 ACCEPTED 项可以进入规范 Schema；只有实际文件、测试和执行记录齐备，才可标记 IMPLEMENTED / VERIFIED。

## 不属于 JSON Schema 可独立证明的事项

以下事项必须由运行时、持久化层、授权服务或集成测试承担，不能仅凭 JSON Schema 声称已保证：

- 用户/服务主体是否真实可信；
- 当前调用者是否具有目标资源的授权；
- Event Sequence 是否在并发下唯一且单调；
- commit 是否原子、持久且对订阅者可见；
- 跨领域写操作是否只由 Owner 执行；
- 跨 Worldline 数据是否已授权并完成证据校验；
- 外部副作用是否实际发生，以及 UNKNOWN_OUTCOME 是否已对账；
- 删除/脱敏是否满足法律、保留和密钥管理要求。

## 关闭标准

本登记册只有在每个问题均有明确裁决、关联 ADR（如需）、Schema/实现变更引用和验证证据时，才可整体关闭。当前状态仍为 OPEN。
