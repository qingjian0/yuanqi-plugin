# E00-20D P0 契约验证矩阵

> 状态：TEST DESIGN（测试设计，未执行）
> 适用对象：E00-20D-P0-DECISION-PROPOSALS.md
> 约束：本文件不是测试源码，不代表任何测试已运行或通过。

## 测试分层

- Schema tests：只验证消息结构、类型、必填字段、互斥字段和枚举约束。
- Runtime invariant tests：验证授权、身份可信、事件原子提交、Owner 写入、并发序号和幂等恢复。
- Persistence/integration tests：验证事务提交、崩溃恢复、Outbox、重放和订阅可见性。
- Security tests：验证伪造主体、越权资源、过期/撤销授权和跨 Worldline 隔离。

## FIX-001 Metadata

| ID | 场景 | 预期 |
|---|---|---|
| T001-01 | 合法 Envelope，metadata 仅含协议元数据 | Schema 接受 |
| T001-02 | metadata 混入领域业务字段 | Schema 拒绝或按明确扩展契约拒绝 |
| T001-03 | 顶层出现未声明字段 | Schema 拒绝 |
| T001-04 | metadata.extensions 使用允许的受控扩展 | 按扩展注册规则接受 |
| T001-05 | protocol_version 与 payload schema version 不一致 | 不混淆版本；按各自兼容规则判定 |

## FIX-002 Authorization

| ID | 场景 | 预期 |
|---|---|---|
| T002-01 | 授权引用格式正确且授权服务验证通过 | 允许进入执行阶段 |
| T002-02 | 授权引用不存在 | Fail closed |
| T002-03 | 授权主体与调用主体不匹配 | 拒绝 |
| T002-04 | 资源范围不覆盖目标资源 | 拒绝 |
| T002-05 | 动作不在授权范围内 | 拒绝 |
| T002-06 | 授权过期或已撤销 | 拒绝 |
| T002-07 | 高风险执行前授权被撤销 | 执行前再次校验并拒绝 |

## FIX-003 ServiceIdentity

| ID | 场景 | 预期 |
|---|---|---|
| T003-01 | 由受信任签发方签发的服务身份 | 验证通过 |
| T003-02 | 未知 issuer 或无效签名 | 拒绝 |
| T003-03 | ServiceIdentity 被当作用户 Principal 使用 | 类型/授权层拒绝 |
| T003-04 | 仅轮换 key_id，稳定 service_id 不变 | 身份连续性保持 |
| T003-05 | 服务代用户执行但没有 delegation | 拒绝 |
| T003-06 | delegation 主体、资源或动作不匹配 | 拒绝 |

## FIX-004 Event Sequence

| ID | 场景 | 预期 |
|---|---|---|
| T004-01 | 同一 stream 的顺序提交 | sequence 严格递增 |
| T004-02 | 并发写入同一 stream | 无重复 sequence |
| T004-03 | 两个不同 stream 的 sequence 相同 | 不推导全局顺序 |
| T004-04 | 回滚后 sequence 出现缺口 | 缺口可解释，不复用已提交 sequence |
| T004-05 | 事件重放 | event_id 与原 sequence 保持不变 |
| T004-06 | 重复 sequence 写入 | 持久化层唯一约束拒绝 |

## FIX-005 Event Commit

| ID | 场景 | 预期 |
|---|---|---|
| T005-01 | 业务状态与 Outbox 同事务提交 | 两者同时持久化 |
| T005-02 | 事务回滚 | 事件不可见 |
| T005-03 | 提交成功但发布器宕机 | Outbox 可恢复发布 |
| T005-04 | 发布后 ACK 丢失并重复投递 | 消费者按 event_id 幂等 |
| T005-05 | 消费者查询未提交事件 | 不可见 |
| T005-06 | 存储不支持原子提交 | 不得宣称原子性/exactly-once，必须验证补偿与恢复协议 |

## FIX-006 DomainCall

| ID | 场景 | 预期 |
|---|---|---|
| T006-01 | 合法 SYNC_COMMAND | Schema 接受；deadline/response correlation 有效 |
| T006-02 | 合法 ASYNC_COMMAND | Schema 接受；command_id 与状态引用有效 |
| T006-03 | 合法 QUERY | Schema 接受；无写入副作用字段 |
| T006-04 | SYNC_COMMAND 混入 ASYNC_COMMAND 专属字段 | Schema 拒绝 |
| T006-05 | QUERY 混入写入命令字段 | Schema 拒绝 |
| T006-06 | call_mode 缺失或未知 | Schema 拒绝 |
| T006-07 | Event Subscription 被伪装成 DomainCall | 拒绝；走独立订阅契约 |

## FIX-007 UNKNOWN_OUTCOME

| ID | 场景 | 预期 |
|---|---|---|
| T007-01 | 超时后下游查询显示操作已成功 | 记录确认成功，不重放副作用 |
| T007-02 | 超时后下游查询显示操作未发生 | 满足幂等/安全条件后允许重试 |
| T007-03 | 下游状态未知但支持同 key 幂等 | 使用相同 idempotency_key 对账/安全重试 |
| T007-04 | 下游不支持查询且不支持幂等 | 禁止自动重试，进入人工处理 |
| T007-05 | UNKNOWN_OUTCOME 直接触发补偿 | 拒绝 |
| T007-06 | 人工裁决结果 | 追加审计记录，不覆盖原始未知事实 |
| T007-07 | 重复恢复任务并发执行 | 单操作幂等，不产生重复副作用 |

## 全局跨域与安全测试

| ID | 场景 | 预期 |
|---|---|---|
| TG-01 | 非 Owner Domain 发起领域写入 | Owner 边界拒绝 |
| TG-02 | Worldline A 请求读取 Worldline B 记忆 | 默认拒绝 |
| TG-03 | 无授权跨 Worldline 转移 | 拒绝并审计 |
| TG-04 | 未提交状态被投影到当前上下文 | 不允许 |
| TG-05 | 同一事件重复消费 | 状态与副作用保持幂等 |
| TG-06 | 系统时钟回拨 | 不破坏事件顺序与授权过期判断；使用可信时间策略 |
| TG-07 | Schema 合法但运行时授权不合法 | 运行时拒绝，证明 Schema 不替代安全校验 |

## 完成标准

测试设计只有在转化为真实测试源码、接入执行脚本、运行并保存日志后，才可标记 IMPLEMENTED / VERIFIED。当前所有条目均为 NOT RUN。
