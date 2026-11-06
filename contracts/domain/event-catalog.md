# YuanQi Domain Event Catalog v1

状态：CONTRACT_DRAFT（用户已确认领域语义；事件运行时尚未实现）

## 通用事件信封

所有事件至少包含 `event_id`、`event_type`、`subject_id`、`subject_kind`、`occurred_at`、`source_kind`、`schema_version`。YuanQi Worldline 事件还必须包含可信上下文确定的 `worldline_id`。事件时间来自 DSH 宿主事件，不允许使用模型/设备当前时间回填事实时间。

事件是追加式事实记录；状态快照是可重建投影。重复事件按 event_id 幂等处理。模型生成的 ID 不能用作授权凭据。

## 事件清单

| Event | 主体 | 作用 | 关键约束 |
|---|---|---|---|
| `subject.identity.created` | User/YuanQi | 建立主体身份引用 | 两种主体命名空间隔离 |
| `yuanqi.wake.recorded` | YuanQi | 记录元炁自身唤醒 | 仅精确启动口令规则；与 UserBirthProfile 分离 |
| `worldline.created` | YuanQi | 建立首条世界线 | 由可信宿主上下文绑定 |
| `worldline.forked` | YuanQi | 从父线建立子线 | 记录父线和基线快照，不反向写入 |
| `worldline.activated` | YuanQi | 切换活动线 | 清理旧线缓存，重新校验访问范围 |
| `evidence.registered` | 所属主体域 | 登记证据引用 | 来源类型不可伪造或升级 |
| `memory.proposed` | YuanQi | 提出候选记忆 | 不等于已确认记忆 |
| `memory.confirmed` | User | 用户确认记忆 | 必须对应真实 direct-user 事件 |
| `self_model.change.proposed` | YuanQi | 提出中心状态变更 | 必须附证据和预期版本 |
| `self_model.change.committed` | YuanQi | 持久化确认后提交快照 | CAS 成功且 Storage Domain 已确认 |
| `self_model.change.rejected` | YuanQi | 记录拒绝/失败 | 不发布候选状态 |
| `worldline.transfer.proposed` | YuanQi | 提出跨线转移 | 精确限定来源、目标、证据、范围和用途 |
| `worldline.transfer.authorized` | User/authorized policy | 授权转移 | 绑定范围、用途、目标线、有效期 |
| `worldline.transfer.committed` | YuanQi | 目标线完成导入 | 幂等；冲突不得静默覆盖 |
| `worldline.transfer.revoked` | User/authorized policy | 撤销后续使用权 | 已派生状态需标记失效或重算 |
| `goal.proposed` | YuanQi | 提出内部目标 | 不能覆盖用户当前指令 |
| `action.authorized` | User/DSH policy | 授权外部动作 | 工具权限仍由 DSH 控制 |
| `action.executed` | YuanQi/DSH | 记录实际执行 | 与计划和结果分开 |
| `action.observed` | YuanQi/DSH | 记录执行结果 | 不把计划当作结果 |

## 领域不变量

1. UserSubject 与 YuanQiSubject 不共享身份 ID、出生资料或授权记录。
2. Center 不是 Subject，不产生身份、权限或世界线访问权。
3. Worldline 之间默认拒绝读写；任何跨线信息必须经过 Transfer Ledger。
4. 目标线导入记录引用来源证据，不复制完整原始会话。
5. 用户当前明确指令优先于 YuanQi 内部目标和自我模型推断。
6. 事件重复投递不得重复创建唤醒记录、世界线或转移导入。
7. Storage Domain 持久化失败时不得发布 committed 状态。
8. 不在普通对话中暴露内部事件序列、计数器或存储诊断字段。

## 需要实现的测试组

- Subject namespace / ownership
- Center capability boundary
- Worldline isolation / fork immutability
- Evidence provenance / revocation
- Transfer authorization / scope / expiry / idempotency
- State proposal CAS / conflict / storage failure
- User instruction precedence
- Wake record vs UserBirthProfile separation
