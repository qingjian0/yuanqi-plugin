# E00-20D P0 公共契约裁决建议稿

> 状态：PROPOSED（待项目批准）
> 适用分支：`dev`
> 目的：把 FIX-001～FIX-007 转化为可逐项审查的明确方案。
> 重要：本文不是已批准 ADR，不代表 Schema 或运行时实现已经存在。

## 总体原则

1. Envelope 只承载协议控制信息；领域事实只进入业务 payload。
2. 身份标识、授权引用和授权判定分离。数据结构正确不等于调用者已获授权。
3. Event 的顺序仅在明确作用域内成立；不承诺全局总序。
4. Event 的正式可见性以持久化提交成功为准。
5. DomainCall 必须由显式模式判别；不同模式的字段不能混用。
6. 外部副作用的未知结果必须保留为未知，禁止通过盲目重试把不确定性伪装成成功或失败。

## FIX-001：Metadata 序列化布局

**建议裁决**

- Envelope 顶层固定包含 `protocol_version`、`message_id`、`message_type`、`created_at`、`source`、`metadata` 与 `payload`。
- `metadata` 是协议级元数据对象，不允许混入领域业务字段。
- 领域扩展必须放入 `payload` 的领域 Schema；协议扩展放入明确命名的 `metadata.extensions`。
- 固定字段使用稳定的 snake_case 命名；协议版本与领域 payload 版本分别表达。
- Schema 对未声明的顶层字段默认拒绝；扩展对象的键和值也必须遵循受控约束，不设置任意深度的自由扩展。

**理由与边界**

这样可避免 metadata 变成无边界的第二个 payload。JSON Schema 只校验结构，不能保证调用者没有篡改 metadata；签名与可信来源由安全层处理。

## FIX-002：Authorization Schema

**建议裁决**

- Command / DomainCall 不内嵌可自行声明有效的授权事实，只携带 `authorization_ref`（或明确的授权凭证引用）。
- 授权记录由可信授权服务签发，至少绑定：授权 ID、签发者、被授权主体、目标资源范围、允许动作、约束、有效期、撤销状态/版本及审计关联。
- 授权主体必须引用 Principal 或 ServiceIdentity，不允许仅凭自由文本名称建立权限。
- 运行时必须验证签发者可信、主体匹配、资源与动作匹配、约束满足、有效期有效且未撤销。
- 高风险动作应在执行时重新校验，不得只依赖消息入队时的校验结果。

**理由与边界**

Schema 能校验授权引用形状，不能证明授权真实、未撤销或适用于当前资源。拒绝默认（fail closed）。

## FIX-003：ServiceIdentity

**建议裁决**

- ServiceIdentity 是独立主体类型，不与用户 Principal、Agent Identity、Worldline Identity 或 Runtime Instance 混用。
- 最小字段建议：`service_id`、`issuer`、`key_id`、`environment`、`identity_version`。
- ServiceIdentity 只能由受信任注册/签发流程创建；运行时通过凭据或签名验证其真实性。
- 服务身份只代表“哪个服务在调用”，不自动继承用户权限；代用户执行时必须另带经授权的 delegation/authorization reference。
- 轮换密钥不得改变稳定的 `service_id`；密钥版本和服务身份版本分开管理。

**理由与边界**

防止服务身份伪装成用户或 Agent，并避免服务间调用无意扩大权限。

## FIX-004：Event Sequence

**建议裁决**

- 序号作用域为一个明确的 `stream_id`（或等价的聚合/事件流标识），不得宣称全局顺序。
- 同一 stream 内，已提交事件的 sequence 严格递增且不可复用；并发分配必须由持久化层原子完成。
- 不同 stream 的 sequence 不可比较，也不能据此推导跨领域因果顺序。
- 允许因事务回滚或分配策略出现缺口；消费者必须区分“缺口待确认”与“事件永久丢失”，通过 commit/stream checkpoint 查询恢复。
- 重放保持原始 event_id 与 sequence，不得为重放生成伪造的新序号。

**理由与边界**

作用域化序号可用于检测流内乱序和缺口，但不替代 causation_id、correlation_id 或跨流因果关系。

## FIX-005：Event Commit 约束

**建议裁决**

- Event 写入分为 `PENDING`（事务内暂存）与 `COMMITTED`（正式提交）两个可区分阶段；必要时可记录 `ABORTED`，但 ABORTED 不进入正式事件流。
- 只有事务成功持久化后，事件才对 Query、订阅者和下游消费者可见。
- 同一事务内业务状态变更与事件 Outbox/Commit 记录必须原子提交；若存储架构无法提供该原子性，必须明确采用的可靠交付协议与可恢复窗口，不得声称 exactly-once。
- Commit 记录至少关联 `commit_id`、`transaction_id`、事件 ID 集合/范围、提交时间和提交结果。
- 消费端采用至少一次投递 + 稳定 event_id 幂等去重；不得把“消息只投递一次”当作系统保证。

**理由与边界**

提交状态必须由持久化层事实决定，不能由生产者在消息体中自行声明。

## FIX-006：DomainCall 模式条件

**建议裁决**

- DomainCall 采用显式判别字段 `call_mode`，使用 JSON Schema `oneOf` 表达互斥结构。
- 初始模式仅包含：
  - `SYNC_COMMAND`：请求-响应式命令调用，必须有 deadline/timeout 和 response correlation。
  - `ASYNC_COMMAND`：异步命令投递，必须有 command_id、delivery policy 与可查询的执行状态引用。
  - `QUERY`：只读查询，必须声明 query contract/version；不得携带写入副作用字段。
- Event Publish 与 Event Subscription 不作为 DomainCall 的隐式模式；它们属于独立消息/订阅契约。
- 每种模式只允许出现该模式定义的字段；互斥字段同时出现应校验失败。
- 调用方、目标 Domain、授权引用、correlation/causation 和 deadline 的适用性按模式分别定义。

**理由与边界**

显式判别联合能减少同一个对象被解释成同步命令、异步命令或查询的歧义。

## FIX-007：UNKNOWN_OUTCOME 恢复

**建议裁决**

- `UNKNOWN_OUTCOME` 是执行结果状态，不是成功、失败或可直接重试的信号。
- 将调用状态与结果状态分开：调用可进入 `RECONCILIATION_REQUIRED`，结果保持 `UNKNOWN_OUTCOME`，直到对账证据确定最终结果。
- 每个可能产生外部副作用的调用必须有稳定 `idempotency_key`（若下游支持）和可查询的 `external_operation_id`（若下游提供）。
- 恢复顺序：先查询下游状态；若下游不支持查询，则按其幂等能力执行安全对账；只有能证明原操作未发生，或重复执行由下游幂等保证时，才允许重试。
- 若无法查询也无幂等保障，禁止自动重试；进入人工介入/业务补偿队列，并保留原始不确定状态。
- 补偿只针对已确认发生的副作用；不得对 UNKNOWN_OUTCOME 直接执行反向补偿。
- 所有查询、重试、补偿和人工裁决都必须追加审计记录，不能覆盖原始调用事实。

**理由与边界**

外部系统可能已经完成副作用但响应丢失。把超时直接当失败并重试，可能造成重复扣款、重复创建或重复发送。

## P0 依赖与建议批准顺序

建议按以下顺序裁决：

1. FIX-001（Envelope 基础）
2. FIX-003（ServiceIdentity）与 FIX-002（Authorization）
3. FIX-004（Event Sequence）与 FIX-005（Event Commit）
4. FIX-006（DomainCall）
5. FIX-007（UNKNOWN_OUTCOME）

FIX-002 与 FIX-003 需要共同定义主体引用，但授权模型不得反向决定身份类型。FIX-004 与 FIX-005 必须共同定义 sequence 分配与 commit 可见性。

## 验收门槛（批准后才能开始）

每项至少需要：
- 一份正式 ADR（背景、决策、备选、后果、状态）。
- 更新后的契约字段表和对应 JSON Schema。
- 正向、反向、边界和安全失败测试。
- 运行时责任归属与存储原子性说明。
- 对兼容性/迁移影响的说明。

在以上证据未形成前，FIX-001～FIX-007 继续保持 PROPOSED；本文件不触发 Schema 冻结或实现状态变更。
