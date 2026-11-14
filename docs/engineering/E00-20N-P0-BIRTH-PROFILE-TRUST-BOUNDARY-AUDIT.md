# E00-20N P0 — BirthProfile 可信确认边界审计

> 日期：2026-11-14  
> 审计基线：PR #3 head `440dce04c0da660527c454f5a7ad8ba837a23658`  
> 分支：`work/e00-20e-05b-subject-domain-runtime`  
> 性质：源码审计与实现设计；本文件不代表运行时代码已修复。

## 1. 结论

BirthProfile 目前处于 **fail-closed、不可用但不应伪造成功** 的状态。当前 Host 入口将 `verifyBirthProfileConfirmation` 固定为返回 `null`，因此正式写入会被拒绝。这避免了模型或普通插件输入伪造确认，但并未交付用户可实际完成的出生资料收集与确认流程。

审计发现四个相互关联的缺口：

1. `src/initialization/onboarding.js` 是纯函数状态机，状态只在调用方内存对象中流转；没有 DSH Domain 持久化、Session 绑定、候选版本或证据来源。
2. `src/domain/subject-store.js` 的 `confirmUserBirthProfile` 直接接收 `facts`，仅要求验证器返回 `verified: true`，没有验证资料候选是否由用户提供、候选版本是否仍为当前版本、确认事件是否针对该版本。
3. `src/domain/subject-domain.js` 的 `birth_profiles` 表只存最终 facts、confirmation_event_ref 和状态；没有候选草稿、修订号、逐字段来源、确认审计或撤销记录。
4. 当前插件入口将 BirthProfile verifier 固定 fail-closed，且没有发现 onboarding 状态机与 DSH 事件入口之间的接线。因此，不能把已有纯函数或 Domain 表结构描述为“出生资料确认已完成”。

## 2. 当前实际信任边界

### 2.1 可以信任的宿主事实

`src/dsh/session-event.js` 从 Cordis 的 SessionEvent 中提取：
- Session ID：来自宿主监听器参数，而非模型/工具参数；
- 事件类型：`user/message`；
- 用户角色与来源：`data.role === 'user'` 且 `data.source.kind === 'user'`；
- 消息 ID、Session 序号和事件时间；
- 只有唯一文本块才被规范化为文本，多个块或非文本块不会拼接成启动命令。

此适配器可以成为确认事件的来源，但不能仅凭一个普通的 `verified: true` 布尔字段就将任意对象提升为可信确认。可信性必须来自 Host 适配器内部生成的不可由模型输入构造的事件引用和来源字段。

### 2.2 当前正式写入为何 fail-closed

`src/dsh/plugin.js` 中：
```js
verifyBirthProfileConfirmation() { return null; }
```

因此即使调用 `confirmUserBirthProfile`，也无法通过 Host 验证。这是当前安全默认值，不应为了让功能“看起来可用”而简单改成 `event => ({ ...event, verified: true })`。

### 2.3 现有 Store 的不足

当前写入路径：
- 接受调用方提供的 `profile_id`、`subject_id`、`facts` 和 `confirmation_event`；
- 检查 UserSubject 存在；
- 调用注入 verifier；
- 以 profile_id 为键执行 put-once。

缺少：
- 由 Store 管理的候选草稿与单调递增 revision；
- 每个事实字段的原始用户事件引用；
- 用户确认事件与候选 revision / candidate digest 的绑定；
- Session / UserSubject / 安装实例作用域检查；
- 过期、拒绝、修订、撤销、重复确认和并发冲突规则；
- 防止同一 profile_id 以不同 subject_id 重放/冲突的明确检查；
- 只读审计历史。

## 3. 必须采用的状态模型

建议把“候选资料”和“正式 BirthProfile”分成不同记录，禁止在候选阶段写入正式档案。

```text
collecting
  ├─ 缺少必需字段 ───────────────> collecting
  ├─ 用户补充/修订 ──────────────> collecting (revision + 1)
  └─ 候选完整且可展示 ───────────> awaiting_confirmation
       ├─ 用户明确确认当前 revision ─> confirmed
       ├─ 用户拒绝 ───────────────> rejected
       ├─ 用户要求修改 ───────────> collecting (revision + 1)
       └─ 超时/Session 失效 ───────> expired
confirmed
  ├─ 新候选经再次确认并替代 ───────> superseded
  └─ 用户明确撤销 ────────────────> revoked
```

关键规则：

- 候选只允许来自用户直接消息中可追溯的事实，或明确标注为“待核实”的外部地理解析结果；模型抽取只能形成候选，不能自动成为事实。
- 每个字段保留 `source_event_ref`、原始值、规范化值、采集方式和精度/不确定性；模型推断字段不得标成 user-provided。
- 候选每次变化都递增 revision，并产生新的候选标识或不可变 revision 记录。
- 展示确认摘要时，生成一次性 confirmation challenge，绑定 UserSubject、候选 ID、revision、候选内容摘要、Session ID、挑战事件引用和过期时间。
- 只有来自 DSH Host 的后续 direct-user `user/message` 事件，且文本是该挑战要求的精确确认表达，才能确认；助手输出、工具调用、模型生成内容、注入上下文、其他 Session 的确认均不能代替。
- 确认时必须再次检查候选仍是当前 revision、challenge 未消费、未过期、Session/Subject 匹配；确认与正式档案写入应在同一 Domain 写入协议内幂等完成。
- 拒绝、撤销和替代均写审计记录，不物理覆盖旧证据；撤销不应删除历史事实来源。
- 若持久化中断，恢复时根据 challenge 状态和正式档案引用做幂等 reconciliation，不得重新解释用户消息或推测用户已确认。

## 4. 建议的持久化表与不变量

建议扩展 UserSubject Domain（必须设计版本迁移，不可直接改动 v1 strict schema）：

| 表 | 作用 | 核心约束 |
|---|---|---|
| `birth_profile_candidates` | 当前候选及状态 | candidate_id + revision 单调递增 |
| `birth_profile_candidate_revisions` | 不可变候选版本 | 每次修订追加，不覆盖 |
| `birth_profile_confirmation_challenges` | 一次性确认挑战 | 绑定 candidate_id、revision、摘要、Session、challenge event、expiry |
| `birth_profiles` | 正式确认档案 | 仅 confirmed 写入；引用精确 revision 和确认事件 |
| `birth_profile_audit_events` | 拒绝、确认、撤销、替代记录 | 只追加，不覆盖 |

最低不变量：

1. 一个确认事件最多消费一个 challenge。
2. 一个 challenge 最多确认一个 candidate revision。
3. 任何候选修订都会使旧 challenge 失效。
4. 已确认档案的 facts 必须与被确认 revision 完全一致。
5. `confirmation_event_ref` 必须指向 Host 验证的 direct-user 事件，且晚于对应 challenge。
6. 不允许用同一事件既创建候选又确认候选。
7. UserSubject / Session / candidate 的关系必须在持久化层校验，不能只依赖 UI 或模型提示。
8. 任何状态不确定、写入冲突或证据引用缺失都 fail-closed。

## 5. 对现有实现的具体修复顺序

### P0-A：定义 Host 事件适配器

将 `normalizeDirectUserMessageEvent` 的可信输出封装为 Host-only capability，避免普通对象上的 `verified: true` 成为可伪造信任标记。适配器必须保留事件类型、Session ID、message ID、seq、time、source kind 和原始内容引用。

### P0-B：候选采集与来源追踪

在 DSH 事件入口识别用户明确提供的出生事实，写入候选 revision。不能从系统当前时间、设备定位、IP、模型常识或用户未确认的地点解析结果补齐出生事实。时间精度未知必须允许显式记录为 unknown，而不是猜测。

### P0-C：挑战-确认协议

确认请求必须引用明确展示给用户的候选版本。后续用户确认事件只能消费尚未过期的对应 challenge；确认文本不能脱离 challenge 独立生效。建议先用确定性、可审计的精确确认表达，避免将任意自然语言或模型判定当作授权。

### P0-D：持久化与并发安全

为 UserSubject Domain 增加版本化 schema；实现候选 revision、challenge 消费、正式档案写入和审计事件的幂等协议。若 DSH Domain API 不提供跨表事务/CAS，必须通过单一聚合记录或明确的 prepare/commit 状态机实现可恢复协议，不得声称多进程原子事务。

### P0-E：测试与验收

必须覆盖：
- 非 direct-user、助手消息、工具消息和注入 user-role 消息不能确认；
- 旧 revision challenge、过期 challenge、跨 Session、跨 Subject、跨安装实例确认均拒绝；
- 同一确认事件重复投递幂等；
- 两个并发确认只能有一个成功；
- 候选更新后旧确认失效；
- 用户拒绝、修改、撤销、重新确认和替代；
- 每字段来源和原始值完整保留；
- 正式 facts 与确认 revision 一致；
- 写入中断后的进程重启恢复；
- 真实 DSH Storage Domain provider 的持久化与冲突语义；
- Android 目标 Profile 中真实消息链路验收。

## 6. 必须澄清的语义边界

- YuanQi 的唤醒时间与用户出生时间是两种不同时间，不得互相填充。
- 用户在首次说“启动元气/启动元炁”时触发的是 YuanQi 初始化，不代表用户出生资料已提供或已确认。
- “出生地点”文本、地理编码得到的坐标、时区和经纬度精度是不同事实；地理解析结果必须保留来源和精度，不能把城市中心点冒充准确出生地点。
- 如果用户没有出生时刻，系统应允许记录 unknown/approximate（前提是产品语义允许），不能强迫填充一个模型猜测的时间。
- 不能将模型生成的总结或工具参数当作用户确认；必须保留原始 direct-user event 引用。

## 7. 当前交付状态

| 项目 | 状态 |
|---|---|
| 首次唤醒与精确命令 | 已有实现和历史 CI 证据 |
| Subject / Worldline 基础域 | 已有实现和历史 CI 证据 |
| Onboarding 纯函数 | 有代码，但未接 DSH Host 与持久化 |
| BirthProfile Domain 基础表 | 有代码，但字段与审计模型不足 |
| Host 可信确认 | **fail-closed，未接线** |
| 候选版本与逐字段来源 | 未实现 |
| Challenge 绑定与一次性消费 | 未实现 |
| 拒绝/撤销/替代审计 | 未实现 |
| 持久化重启恢复 | BirthProfile 流程未实现 |
| 本轮代码修复与 CI | 本审计仅为文档提交，不代表运行时代码修复 |
| 真实 Android DSH 验收 | 未完成 |

## 8. 安全验收原则

任何实现都必须先证明“确认来自真实用户、针对当前资料版本、只消费一次”，然后才允许写入正式 BirthProfile。若 Host 无法提供可信事件来源或 Domain 无法提供足够的持久化一致性能力，则保持 fail-closed，并明确报告阻断原因；不得降低确认门槛以追求演示成功。


## 9. 2026-11-14 实现复核：持久化候选与一次性确认协议（第一阶段）

本节更新运行时代码状态；前述审计设计仍作为完整验收目标，不能将未接线的产品交互视为已交付。

### 9.1 已落地代码

- `src/dsh/session-event.js` 使用模块私有 `WeakSet` 为由 Host listener + SessionEvent 规范化的对象打能力标记。对象上的 `verified: true` 字段不能自行取得该能力。
- `src/dsh/plugin.js` 的 BirthProfile verifier 只接受该私有能力标记，并限定精确命令“确认出生资料”“拒绝出生资料”“撤销出生资料”。
- UserSubject Domain 已升级为 v2，声明兼容 v1。新增 `birth_profile_workflows`，将候选 revision、字段来源、challenge、确认档案快照和审计事件放入同一 Subject 聚合记录；旧 `birth_profiles` 表保留为兼容结构。
- 每个 revision 保存事实字段、字段级来源事件引用、原始文本、`user_explicit` / `model_extracted` 区分、创建事件和事件时间。模型抽取值仍然是候选，必须经过后续确认。
- 候选更新递增 revision，并使旧 challenge 失效。相同来源事件重放幂等，携带不同候选数据的冲突重放拒绝。
- Challenge 绑定 Subject、revision、Session、发起事件引用和有效期。确认要求精确文本、同 Session、确认事件晚于 challenge 且未超过 expiry；同一确认事件重放幂等。拒绝和撤销保留追加审计。
- 确认后的正式档案快照当前保存在 `birth_profile_workflows.confirmed_profile`，而不是跨表双写到旧 `birth_profiles` 表；读取 API 优先从聚合记录读取。

### 9.2 验证证据

- GitHub Actions Run #478（`43598666851`），commit `0826dc814ad83313650b5801b473671f678a051f`：75 passed / 0 failed。
- 覆盖候选 revision、字段来源、挑战失效、精确/一次性确认、Session 绑定、过期挑战、拒绝、撤销、来源事件重放，以及官方 DSH DomainFacility 的关闭/重开持久化读取。
- 该 DomainFacility 集成测试使用测试内存 KV backend，验证 DSH DomainFacility/Domain schema/update API 的行为；不等于目标 Android Profile 的生产 backend 验收。

### 9.3 仍然阻断产品交付的事项

- 候选写入与 challenge 签发 API 尚未接入 DSH direct-user 消息流和 onboarding；没有自然语言资料抽取、字段澄清、候选摘要展示和交互式 challenge 签发。
- 旧 v1 `birth_profiles` 记录没有迁移为 v2 workflow 聚合；旧表结构仍保留。
- 初次 workflow 聚合创建通过 put-once；后续同一聚合更新通过单记录 `table.update`。串行队列仅保护单个插件实例；不宣称跨进程分布式 CAS 或并发创建互斥。
- OS 进程强制终止故障注入、Android 真机及目标 DSH Profile 端到端确认仍未完成。
- 因此，本阶段是 **持久化协议与 Host 事件信任边界的第一阶段实现**，不是 BirthProfile onboarding 产品流程完成。Host 可信确认不再固定 fail-closed，但没有挑战的精确确认事件仍会被 Store 拒绝。
