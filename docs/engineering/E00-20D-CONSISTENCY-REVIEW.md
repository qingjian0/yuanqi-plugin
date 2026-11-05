# E00-20D 契约建议稿一致性审查

> 状态：REVIEW COMPLETE（建议稿内部审查完成；项目决策仍未批准）
> 审查对象：P0/P1 决策建议稿、修订登记册、架构原则与项目状态说明。

## 结论

P0/P1 建议稿总体遵循身份与授权分离、Owner 写入、事件不可变、Worldline 隔离、证据优先和未知结果不盲目重试等既有原则。当前未发现足以直接否定整个建议方向的冲突，但存在若干必须在 ADR/Schema 前明确的细化项。

## 需要补充的裁决细节

| ID | 问题 | 风险 | 建议补充 |
|---|---|---|---|
| CR-001 | FIX-006 的“命令转发”没有独立模式 | 可能把路由行为误认为新的业务调用语义 | 将 forwarding 定义为 routing/transport 属性，不新增 call_mode；若原始契约证明它具有独立生命周期，再单独裁决 |
| CR-002 | FIX-004 sequence 分配时机与 FIX-005 commit 时机耦合 | 可能把未提交事件的序号缺口解释为事件丢失 | 明确 sequence 只对已提交流可见；事务回滚不产生正式可见事件；若分配器预留号段，缺口由 checkpoint/commit metadata 解释 |
| CR-003 | FIX-005 transaction 与 commit cardinality 尚未锁定 | Outbox 与业务状态的原子性边界不清 | 对单一原子存储事务，建议一笔 transaction 对应一个 commit；跨资源 Saga 的多次 commit 使用同一 correlation/transaction lineage，但各 commit 独立 |
| CR-004 | FIX-002 授权引用的在线/离线验证方式未明确 | 离线消息可能使用过期或已撤销授权 | 默认执行时在线校验；缓存必须有短 TTL、撤销版本/epoch 与高风险动作强制在线校验 |
| CR-005 | FIX-003 ServiceIdentity 的 environment 约束未定义 | 测试身份可能被生产环境接受 | issuer、audience/environment、key purpose 必须绑定；跨环境默认拒绝 |
| CR-006 | FIX-007 下游幂等语义的可信来源未定义 | 客户端误以为支持幂等而重复执行 | 必须有下游能力声明/契约或可验证回执；仅客户端自带 idempotency_key 不足以保证幂等 |
| CR-007 | FIX-008 版本字段最终类型仍未定 | Schema 可能再次出现整数/字符串不一致 | 在读取 E00-20D 原始字段矩阵前不冻结类型；Schema 版本与业务事件语义版本必须独立 |
| CR-008 | FIX-016 不可变审计记录与数据擦除边界 | 可能保留可识别个人数据或错误承诺合规 | Event 只保留最小必要事实/引用；敏感载荷外置并可删除/加密擦除；法律适用性需专项审查 |
| CR-009 | FIX-017 转移失败时的部分写入恢复 | 目标 Worldline 可能留下半完成数据 | 采用 staged import + commit marker；未提交转移不可见；恢复/撤销通过独立 Transfer 状态事件完成 |

## 重要一致性约束

1. JSON Schema 不承担授权真实性、签名验证、Owner 写入、并发序号、事务原子性和外部副作用保证。
2. `worldline_id` 只用于逻辑隔离，不是身份认证或授权凭证。
3. ServiceIdentity 不自动继承用户权限；代理用户执行必须具备明确 delegation。
4. Event 重放保留原始 event_id 与 sequence；不得伪造新事件序号来掩盖重复消费。
5. UNKNOWN_OUTCOME 不可自动转成失败；没有下游查询或可信幂等保障时不得自动重试。
6. Event/Query Subscription 必须分开定义数据语义，生命周期字段可复用但不得混淆。
7. D09～D13、D15 未经原始资料核验不得补名、补 Owner 或生成 Schema。

## 状态

- P0：7 项方案已形成，内部一致性审查完成；仍全部 PROPOSED。
- P1：10 项方案已形成；FIX-015 仍 OPEN，其余建议仍 PROPOSED。
- P0 测试矩阵已形成，但尚无测试源码，状态为 TEST DESIGN / NOT RUN。
- 当前未创建正式 ADR、JSON Schema 或运行时代码。
- 当前未执行项目测试、CI 或真实 DSH 宿主验证。

## 下一步

1. 将 CR-001～CR-009 纳入 P0/P1 对应 ADR 决策记录。
2. 从可信原始资料恢复 E00-20D 全领域矩阵，解决 FIX-015。
3. 项目批准 P0 决策后，生成正式 ADR 与 Common/Messaging Schema。
4. 可信源码恢复前，Schema/测试资产只作为设计草案，不能替代 E00-20E-02。
