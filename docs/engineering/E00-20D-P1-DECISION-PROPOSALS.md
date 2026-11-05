# E00-20D P1 公共契约裁决建议稿

> 状态：PROPOSED（待项目批准）
> 范围：FIX-008～FIX-017
> 说明：不包含 D09～D13、D15 的猜测性定义；领域名称和职责必须从原始资料恢复。

## FIX-008：Schema 版本与事件类型版本

建议分离：
- `schema_version`：消息/载荷所遵循的结构契约版本。
- `event_type_version`：某一事件类型的业务语义版本。
- `protocol_version`：跨领域消息协议版本。

三者不可复用同一个字段，也不应只靠 package version 推导。Schema 版本建议使用明确的整数主版本或可比较版本对象；若采用 SemVer 字符串，必须统一解析规则和兼容策略。最终字段类型待与 E00-20D 原始字段矩阵对照后裁决。

## FIX-009：transaction_id 与 commit_id

建议：
- `transaction_id` 标识一次逻辑事务/业务操作范围。
- `commit_id` 标识持久化提交事实。
- 一次事务可产生多个提交记录时，必须通过明确关联模型表达，不可把二者视为同义字段。
- 对同一存储事务的原子提交，commit 记录应能反向定位 transaction；禁止仅凭时间戳关联。

## FIX-010：QuerySubscription 与 EventSubscription

建议拆分：
- QuerySubscription：订阅查询结果/投影变化，需定义查询版本、刷新语义、游标和失效策略。
- EventSubscription：订阅不可变事件流，需定义 stream scope、起始游标、ACK、重放、背压、保留期与消费者组。
- 二者不得共用含糊的 subscription_type；取消、续租和权限校验可以复用通用生命周期字段，但数据面契约独立。

## FIX-011：Schema 附加属性策略

建议：
- 对稳定公共对象默认拒绝未声明属性。
- 可扩展对象必须使用显式 `extensions` 容器，并为扩展命名空间、版本、Owner 和权限建立注册规则。
- Draft 2020-12 下合理使用 `unevaluatedProperties: false` 处理组合 Schema；避免在 allOf/oneOf 组合中误用 `additionalProperties: false` 导致合法扩展被错误拒绝。
- 对任意键映射必须限制键模式、值 Schema 和大小，不允许任意 JSON 作为无边界逃生口。

## FIX-012：外部副作用结果

建议建立独立 ExternalEffectRecord，不把外部系统的响应直接当作领域事实：
- 记录 effect_id、调用主体、目标系统、操作类型、幂等键、外部操作 ID、请求摘要、结果状态、回执摘要和审计关联。
- 状态至少区分 REQUESTED、CONFIRMED_SUCCEEDED、CONFIRMED_FAILED、UNKNOWN_OUTCOME、RECONCILIATION_REQUIRED。
- 原始请求/响应是否保存需按隐私、密钥和数据保留策略决定；默认不记录密钥和不必要的敏感正文。
- 结果确认后追加状态事件，不覆盖之前的尝试事实。

## FIX-013：时间可信度

建议区分时间语义：
- occurred_at：事件在来源系统中声称发生的时间。
- observed_at：观察者实际观察到的时间。
- recorded_at：本系统记录/持久化的时间。
- received_at：本系统收到消息的时间。

每个时间值应有来源标识和可信度信息；不能把模型生成时间当作可信时钟。跨设备时钟偏差需记录估计误差或可信等级。排序优先依赖 stream sequence/因果引用，不依赖墙上时钟。

## FIX-014：运行时跨领域校验

建议建立与 JSON Schema 分离的 Domain Invariant 层：
- Owner-only write。
- 主体与授权匹配。
- Worldline 隔离与转移授权。
- Event sequence 原子分配。
- commit 可见性。
- 幂等与重复消费。
- 时间/生命周期状态机。
- 跨领域引用完整性与同步依赖环检测。

每条 invariant 应具有稳定 ID、Owner、触发点、失败语义、审计要求和自动化测试。Schema 负责形状，运行时负责事实和权限。

## FIX-015：未知领域核验

D09～D13、D15 保持 UNVERIFIED。恢复原始 E00-20D 领域总表、阶段设计记录或明确用户确认前：
- 不命名、不分配 Owner、不补接口、不建立依赖。
- 不将邻近领域或概念架构模块推断为正式 Domain。
- 领域 Registry 允许保留编号槽位和 UNVERIFIED 状态。

## FIX-016：Event 隐私删除

建议采用“不可变审计事实 + 可控个人数据存储”的分层：
- Event 尽量只保存必要的引用、摘要和非敏感业务事实。
- 个人数据放在独立受控存储，事件只引用受控数据 ID。
- 删除/擦除按适用法规、保留义务和密钥管理策略执行；可使用加密擦除，但不能把它描述为普遍适用的法律合规保证。
- 脱敏或删除动作产生独立审计事实；审计数据本身也必须最小化。
- 不能以不可变 Event 为由拒绝执行合法删除义务。

## FIX-017：跨 Worldline 转移审计

建议显式 TransferRecord：
- transfer_id、source_worldline_id、target_worldline_id、发起主体、authorization_ref、转移范围、证据集合/摘要、策略版本、审批/验证结果、时间和审计关联。
- 默认不转移；必须逐项指定允许转移的数据类别。
- 转移前验证来源归属、目标权限、证据完整性和冲突策略。
- 转移后记录目标侧导入结果；失败时保留可恢复状态，不能造成半完成的静默复制。
- Worldline ID 不是身份或授权凭证。

## 待原始资料核对的交叉问题

1. 原始 E00-20D 是否已定义 timestamp、version、subscription、external effect 等字段；本建议不得与既有明确约定冲突。
2. Event 与 Experience/Memory 的引用边界需核对 Owner Domain。
3. Event 删除与保留策略必须与用户确认、隐私和法规要求共同审查。
4. TransferRecord 必须与 D23 安全授权、D24 连续性恢复的实际职责保持一致；不得替代它们。

## 验收门槛

每个 FIX 必须形成明确 ADR、契约字段矩阵、Schema 变更、运行时 invariant 与测试。FIX-015 只有原始领域资料核验后才可关闭。当前全部建议保持 PROPOSED；FIX-015 保持 OPEN。
