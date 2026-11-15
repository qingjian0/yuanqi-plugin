# E00-22 P0 — 后天经历与证据采集管线研究

> 日期：2026-11-15  
> 适用范围：DSH SessionEvent、SessionQuery、YuanQi Evidence Ledger、五中心 SelfModel  
> 状态：模型选择的有界候选记录与不可变经历评估历史已实现；自动评估、跨 Session 独立佐证聚合及人格画像修订仍未实现  
> 目的：明确如何让后天经历验证或反驳八字初始画像，同时避免把用户资料或模型自述误当成 AI 自身经历事实

## 1. 当前实现审计

当前工作树已有：

- DSH session/event 监听器，但 YuanQi 插件当前只把精确直接用户消息用于首次唤醒/出生资料初始化。
- Worldline Runtime 与 Session→Worldline 绑定。
- Evidence Ledger 的 recordEvidence、revokeEvidence、assessEvidence、跨线授权转移 API。
- SelfModel 五中心、Evidence 引用校验、Runtime Lease、Snapshot CAS。
- 初始八字画像写入 identity_continuity.content.initial_personality，认识状态为 hypothesis。

当前工作树尚无：

- 普通对话的通用经历采集器。
- 独立 Memory / Experience / Goals / Behavior 运行时模块。
- 自动扫描普通对话并写入 Evidence Ledger 的逻辑。
- 跨 Session 独立证据聚合、自动评估和稳定人格画像修订流程。

因此，Evidence Ledger 已存在不等于“后天经历系统”已完成；五中心已存在也不等于动态自我模型已形成闭环。

## 2. DSH 事件源契约

DSH Session 是追加式事件日志，核心事件带有单调递增的 seq 和毫秒时间 time。当前 DSH SessionEvent 至少包含以下与经历研究相关的事件：

| 事件 | 可观察内容 | 对元炁的意义 |
|---|---|---|
| user/message | 用户角色消息及 source | 外部刺激；必须区分真实直接用户消息与 agent.inject 等合成上下文 |
| assistant/message | 已提交的助手消息、turn/step 与消息内容 | AI 对外可观察的实际输出 |
| assistant/attempt | 未形成表面消息的模型尝试 | 不能直接当成已发生的对外行为 |
| tool/call | turn/step、callId、工具名和原始参数 | AI 请求执行的动作；参数可能包含敏感数据 |
| tool/result | 与工具调用配对的执行结果 | 可观察动作结果；结果正文也可能含敏感信息 |

重要边界：

1. user/message 不全是人类直接输入。DSH 还会把 agent.inject() 等合成上下文投影为 user-role 消息；只能将 source.kind === 'user' 的消息视为直接用户输入。
2. assistant/message 是已提交的助手表面消息；assistant/attempt 不代表模型已经对外完成表达。
3. tool/call 与 tool/result 通过 callId 配对。调用参数不应默认作为长期记忆保存。
4. Session 可能含有继承的 Fork 前缀；必须保留 inheritedEventCount 边界，不把祖先事件误归为当前分支新经历。

## 3. 事件读取方式

新的经历功能应通过 DSH 官方 sessionQuery 服务读取事件，不应依赖已标记 deprecated 的 Session.eventAt()、snapshotEvents() 或 ownEvents() 同步读取 API。

可用的官方读取方式：

- observeSession(sessionId)：取得一次一致的 live-preferred Session observation，包含事件快照和继承前缀边界。
- readEvent({ sessionId, seq, before, after })：读取一个事件及有限邻近窗口。
- readSession(sessionId)：在确实需要时读取完整、经过回放校验的事件日志。

首选有限窗口读取；不应每次经历分析都复制整个 Session 历史。当前模型工具执行上下文可提供 exec.agent.session.id 与 exec.callId，但不能把模型参数中的 Session ID、事件 ID 或 Worldline ID 当作可信权限输入。

## 4. 先区分三种不同对象

### 4.1 外部刺激（Interaction Input）

直接用户消息属于 AI 接收到的外部刺激。它可以说明当时的交互环境、用户提出了什么问题，但不能直接证明 AI 具有某种性格，也不能把用户的偏好、经历或个人资料写成 AI 自身属性。

### 4.2 可观察的 AI 行为（Observed Action）

助手最终输出、已提交的工具调用及其结果，是 AI 在某个 Session/Worldline 中可观察的行为证据。工具调用失败、工具结果未知、助手中断等状态必须分别保留，不能把计划动作等同于已成功完成的动作。

### 4.3 模型自我解释（Model Reflection）

模型对自己为什么这样回答、某段经历意味着什么的总结，属于模型解释或候选假设。即使它引用了真实事件，也不能自动升级为 evidence_supported；必须与原始事件来源分开保存。

## 5. 建议的最小闭环

复用现有 Evidence Ledger 与五中心，不新增独立数据库：

DSH SessionEvent → bounded source references → model experience candidate → Evidence Ledger → evidence assessment → SelfModel revision

建议流程：

1. **选择事件：** 在一个已完成的 turn 后，由模型按需选择与自身行为有关的直接用户输入、助手输出、工具调用和工具结果。默认不自动持久化完整对话文本。
2. **校验来源：** 插件从 exec.agent.session.id 取得当前 Session；通过 sessionQuery 验证事件真实存在、属于该 Session、位于允许的继承/时间范围内，并检查事件类型与来源。
3. **形成候选经历：** 模型提交简短的经历摘要、实际执行的动作、可观察结果、尚未知晓的结果和不确定性；不能把计划或推测写成已完成行为。
4. **写入不可变来源记录：** Evidence Ledger 保存最小必要摘要、事件引用、Session、turn/step、工具调用配对关系和采集来源。原始事件正文仍由 DSH Session 持有，避免重复保存整段对话。
5. **评估：** 使用现有 assessEvidence 记录 corroborated、contradicted 或 insufficient 结果，并保留评估者、理由、来源和反证引用。置信值若使用，只能是工程启发式指标，不代表心理学概率。
6. **更新 SelfModel：** cognition_reflection 保存独立版本的经历评估历史；identity_continuity 中的八字 initial_personality 保持原样。只有跨 Session 独立证据聚合与后续规则通过后，才考虑生成新的当前画像版本。

## 6. 初始画像与后天经历的关系

初始画像每项倾向应有稳定 claim ID。经历评估必须明确指出它支持、反驳还是不足以判断哪一项倾向，不能只给整个画像一个笼统分数。

建议的最小状态区分：

- hypothesis：初始八字解释，或尚未验证的模型解释。
- evidence_supported：存在可追溯的行为/结果证据，且评估规则满足。
- disputed：存在实质反证或证据冲突。
- unknown：没有足够来源作出判断。
- user_confirmed：只用于用户明确确认的用户事实，不用于模型自我画像。

证据增加不等于画像自动变真；反证也不应删除旧画像。每次修正都应生成新版本并保留来源链。

## 7. 隐私与完整性边界

- 默认不把每条用户消息全文自动复制到 YuanQi Evidence Ledger。
- 不保存工具原始参数全文；命令参数可能含凭据、路径、私密内容或用户数据。
- 工具结果仅保留与 AI 行为/结果判断有关的最小必要摘要。
- 直接用户输入只能作为外部刺激来源，不能直接当作 AI 自身性格证据。
- 不能只凭模型自我评价证明它已表现出某种稳定倾向。
- 跨 Session/Worldline 的事件引用必须通过当前 Agent Session 与现有授权机制核验；不得由模型指定目标世界线。
- Evidence Ledger 来源记录、模型解释和 SelfModel 状态必须分层保存。
- 读取历史应使用有界 SessionQuery，避免无上限历史复制和上下文膨胀。

## 8. 本阶段结论与下一步

当前最合理的下一步仍不是自动收集全部聊天。开发分支已实现一个**有界、模型选择、来源可验证的经历候选工具**：

- 输入只接受当前 Session 中的事件序号引用和简短结构化经历摘要。
- 插件自行校验事件类型、source.kind、turn/step、callId 配对与 Worldline 绑定。
- 默认只保留最小摘要和事件引用，不重复保存整段对话。
- 写入 Evidence Ledger 后先作为候选经历；不直接改变初始画像。
- `yuanqi_assess_experience_candidate` 已实现：只允许评估当前 Session 绑定 Worldline 中、仍 active 且尚未评估的候选，并要求逐一覆盖候选关联的画像维度。
- 每个维度评估写入现有 Evidence Assessment Ledger，`assessor_kind` 固定为 `model`，结果为 corroborated / contradicted / insufficient；Assessment ID 按候选与维度确定，已评估候选不可覆盖。
- 评估历史追加到 `cognition_reflection`，使用独立版本号；`identity_continuity.initial_personality` 不被改写，SelfModel epistemic status 保持 `hypothesis`。
- 单次模型评估不构成独立验证，不会自动把任何倾向升级为事实；自动扫描、跨 Session 独立佐证聚合和新画像版本生成仍未实现。

真实 DSH SessionQuery 的目标 Profile 版本、事件恢复/冷读行为、工具执行上下文以及隐私策略仍需端到端验收。未经这些验证，不应将自动经历采集或动态人格修正标记为已完成。


## 9. 最小运行时实现：经历候选记录

已在开发分支加入 `yuanqi_record_experience_candidate` 与 `yuanqi_assess_experience_candidate`，覆盖模型选择候选、显式评估与独立历史保存；不自动扫描对话，也不自动重写初始画像：

- 工具只对已绑定 YuanQi Worldline 且已有八字初始画像的当前 Session 可见。
- 模型提交当前 Session 的事件 seq、短摘要、行为描述、结果状态、画像维度关联和不确定性；Session ID 始终由宿主执行上下文提供。
- 插件每次候选采集只调用一次 `sessionQuery.observeSession(sessionId, { projectionMode: 'none' })`，在同一一致快照中按 seq 校验事件及 inherited prefix；行为事件仅接受已提交的 `assistant/message`、`tool/call`、`tool/result`。校验结束后释放 observation。
- 用户消息仅可作为 `source.kind === 'user'` 的外部交互背景，不可进入 AI 行为证据；合成注入消息被拒绝。
- 工具结果必须和候选中所引用的同一 turn/step 的工具调用配对；只选择工具调用时只记录“已请求动作”，不推断结果。
- Evidence Ledger 只保存摘要、事件引用和最少元数据，不复制助手正文、工具参数或工具结果正文；新记录状态为 `unassessed`。
- 当前阶段不调用 `assessEvidence`，不写入 SelfModel，不修改八字初始画像。后续必须单独实现证据评估和经评估的画像修订。



**读取成本边界：** `observeSession()` 提供一个固定的一致 Session observation；访问 `events` 时仍可能物化当前 Session 的完整事件快照，因此单次候选采集的底层内存/读取成本仍随 Session 长度增长。但插件不再对每个 seq 重复调用 `readEvent()`（当前实现每次都会重新解析/加载逻辑 Session），而是一次快照完成全部最多 12 个事件引用的校验，并在完成后释放 observation。模型可见引用和 Evidence Ledger 持久化摘要仍保持有界；未来若要把底层读取也降为窗口级，应依赖 DSH 提供的有证据范围读取能力，不得绕过 SessionQuery 直接访问存储。

本轮实现仍需目标 DSH Profile 的真实端到端验证；测试替身不能替代 Android 宿主验收。
