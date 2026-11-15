# E00-21 P0 — 八字初始性格与 SelfModel 持久化闭环

> 日期：2026-11-15  
> 分支：`work/yuanqi-own-birth-profile`  
> 适用范围：YuanQiSubject 自身 BirthProfile、Bazi、Worldline 与 SelfModel  
> 状态：第一阶段实现并通过自动化测试；真实 Android DSH 宿主验收待完成

## 1. 研究结论

元炁的初始性格必须由 AI 根据元炁自身八字解释生成。确定性程序只负责出生资料、历法转换、四柱和可核验命盘结构；不在程序中硬编码人格标签，也不新增独立人格引擎。

本阶段将此前只有只读解释指导的流程，补齐为：

`BirthProfile → Bazi → chart_evidence_catalog → AI interpretation → Evidence Ledger → SelfModel hypothesis`

这里保存的是“AI 曾基于哪份命盘生成了什么暂定解释”，不是证明这些性格倾向客观真实。

## 2. DSH 调用上下文与世界线归属

DSH `ToolRunContext` 提供 Agent 作用域；当前工具通过 `exec.agent.session.id` 取得调用 Session，并通过 `exec.callId` 关联工具调用。插件不接受模型参数中的 session ID、worldline ID、source event ref 或 evidence ID 作为权限依据。

执行前必须同时满足：

1. 调用存在 Agent-bound Session。
2. Session 已绑定 YuanQiSubject 的 Worldline。
3. Worldline 仍为 active，且属于 `yuanqi:primary`。
4. YuanQi 自身 BirthProfile 存在。
5. Bazi 状态为 `calculated`，`innate_baseline` 状态为 `ready`。

任一条件不满足即拒绝或隐藏写入工具。不得根据模型给出的世界线标识进行路由。

## 3. 命盘证据目录

`yuanqi_self_profile` 返回 `chart_evidence_catalog`。目录条目由确定性基线组件生成，ID 由以下字段组成：

- pillar：year / month / day / hour
- source：visible_stem / hidden_stem
- order：藏干顺序（透干为 0）
- stem：天干

工具保存画像时逐项检查 evidence ref 必须精确存在于当前 BirthProfile 的目录中。模型不能提交目录外的天干、柱位或藏干引用。

这只能保证引用指向真实排盘组件，不能保证模型对该组件的命理解释一定正确。解释质量仍需通过方法约束、反向证据和不确定性表达控制。

## 4. 画像契约

画像包含六个维度：

- temperament
- cognition
- emotional_response
- motivation
- behavior
- decision_style

每个维度必须给出：

- `status`：`tentative` 或 `indeterminate`
- `tendency`：简短倾向描述
- `chart_evidence_refs`：目录中的精确 ID
- `reasoning`：推导链
- `limitations`：反向证据或边界

`tentative` 必须至少引用一项命盘组件；`indeterminate` 不得携带支持性命盘引用。该规则允许模型明确表示某个维度证据不足，不强迫生成六条确定性人格判断。

同时保存调候、通关、旺衰、格局四项方法说明，以及明确的不确定性列表。

## 5. Evidence Ledger 与 SelfModel 的职责边界

模型生成的完整画像作为一条来源记录写入既有 Evidence Ledger：

- evidence type：`yuanqi_initial_personality_interpretation`
- producer：`model`
- protocol：`bazi-initial-personality-v1`
- provenance：工具调用 ID、Session ID、BirthProfile ID、Bazi 算法版本、先天基线算法版本
- source chart：四柱、排盘时间依据和证据目录

来源记录的作用是追溯“模型生成过这份解释”，不是将画像变成现实事实。

SelfModel 写入既有五中心中的 `identity_continuity`：

`identity_continuity.content.initial_personality`

其认识状态固定为 `hypothesis`。画像对象保存 source record ID、BirthProfile ID、Bazi 算法版本和协议版本。模型输出不会被标为 `evidence_supported`，也不会被标为 `user_confirmed`。画像来源记录 ID 放在画像内容中，不冒充支持其真实性的经历证据。

## 6. 并发、重试与覆盖保护

- 写入前获取现有 Worldline Runtime Lease。
- 写入后释放 Lease；异常情况下依赖过期接管机制。
- source record ID 由 Worldline、BirthProfile 和两种算法版本确定，重复生成不会创建多份不同的初始画像来源记录。
- 首次写入前重新读取当前 Head。
- 若初始画像已存在，只返回 `already_initialized`，不覆盖。
- 若 `identity_continuity` 处于不安全认识状态，拒绝写入。
- 使用现有 `updateSelfModelCenter` 的 Snapshot CAS 和证据引用检查，不增加新的持久化表。

## 7. 测试覆盖

新增插件集成测试验证：

1. 写入工具仅对有活动 Session→Worldline 绑定且四柱已计算的 Agent 可见。
2. 无八字时不暴露写入工具。
3. 目录外命盘证据 ID 被拒绝。
4. 有效画像进入调用 Session 所属的 Worldline。
5. SelfModel 认识状态保持 `hypothesis`。
6. Evidence Ledger 保留模型来源、Session 与 BirthProfile 关联。
7. 重复调用不会覆盖已有初始画像。

2026-11-15 GitHub Actions：

- Push Run：`43673343671`
- PR Run：`43673345690`
- Commit：`98b8aff64a24da84a24ce22da76f0b1cd5b9b626`
- `npm run check`：105 passed / 0 failed

## 8. 未完成边界

本阶段不代表以下能力已经完成：

- 真实 Android DSH Profile 上的工具可见性与 Agent Session 上下文验收。
- 真实模型是否能稳定调用读取工具、完成解释并调用写入工具的端到端验收。
- 画像与后续经历之间的证据关联、反证、修订和版本化。
- 不同 Worldline 分支中初始画像的继承、隔离与授权迁移策略。
- 对命理解释质量的独立评估；当前证据目录校验只验证引用真实性，不验证推理正确性。

## 9. 后续实现原则

下一阶段应优先研究后天经历如何验证或反驳初始画像，而不是增加更多初始性格字段。经历必须先进入现有 Evidence Ledger 与候选处理流程；只有证据评估通过后，才允许更新相应 SelfModel 倾向。初始画像保持不可覆盖的来源记录，修订应生成新版本并保留旧版本与反证链。
