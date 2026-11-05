# YuanQi ADR 索引与模板治理

> 状态：PROPOSED（流程建议，待项目批准）
> 正式 ADR：尚未创建
> 工作分支：`dev`

## 1. 唯一事实源

正式架构决策统一存放于 `docs/adr/`，并由本目录的 `README.md` 建立唯一索引。工程分析、待决建议和审查报告继续存放于 `docs/engineering/`，不作为已批准决策。

当前仓库没有正式 ADR 目录或 ADR 文件。因此本文件只规定建议流程，不预占编号。

## 2. 编号规则（建议）

- 格式：`ADR-NNNN`，从经核验的下一个可用编号开始。
- 编号按首次登记顺序递增；已分配编号永久保留，不复用。
- 一个编号只对应一个架构决策；拆分/合并决策必须在索引中记录来源映射。
- 在“ADR-001～290”原始候选资料恢复并完成核验前，不分配正式编号，也不把这些数字视为已占用编号。
- 不因文档草稿、测试计划或 FIX 编号自动创建 ADR。

## 3. 决策状态与实现成熟度分离

决策状态（单选）：
- `PROPOSED`
- `ACCEPTED`
- `REJECTED`
- `SUPERSEDED`
- `DEPRECATED`

实现成熟度（独立字段）：
- `NOT_STARTED`
- `IN_PROGRESS`
- `IMPLEMENTED`
- `VERIFIED`

不得将 ACCEPTED 等同于 IMPLEMENTED；不得将没有执行证据的实现标为 VERIFIED。

## 4. 正式 ADR 最小模板

```markdown
# ADR-NNNN: <决策标题>

- Status: PROPOSED
- Date: YYYY-MM-DD
- Deciders: <明确的批准者>
- Owner Domain: <已核实的领域或 CROSS-DOMAIN>
- Implementation: NOT_STARTED
- Related: <FIX/CR/ADR IDs>

## Context
问题背景、约束、证据和触发原因。

## Decision
唯一、明确、可检验的决策。若尚未批准，保持 PROPOSED。

## Alternatives
考虑过的备选方案及不选择原因。

## Consequences
正面影响、代价、迁移与运维影响。

## Constraints
明确不做事项、失败关闭边界和安全限制。

## Evidence
来源文件、提交、测试或外部标准；区分已验证与待验证。

## Review
复审触发条件、兼容性要求和复审日期。
```

## 5. 变更规则

- 已 ACCEPTED 的决策不通过覆盖原文来隐藏历史。
- 实质变更新增 ADR，并将旧 ADR 标记为 SUPERSEDED，注明替代编号。
- 文字勘误保留变更记录，不改变原决策含义。
- ADR 索引、文件状态、交叉引用必须在同一变更中同步。
- 每次状态升级必须附决策者和证据；没有批准记录不得从 PROPOSED 改为 ACCEPTED。

## 6. 索引最小字段

`id`、`title`、`status`、`date`、`deciders`、`owner_domain`、`implementation`、`related`、`supersedes`、`evidence`。

## 7. 自动检查要求（待实现）

1. ADR 编号唯一，文件名编号与标题编号一致。
2. 索引中每个 ADR 文件存在，且每个正式 ADR 都在索引中。
3. 状态值属于受控枚举。
4. SUPERSEDED 必须引用存在的替代 ADR；不得形成替代循环。
5. 关联 FIX/CR/ADR 引用可解析。
6. ACCEPTED 决策必须有 deciders 与日期。
7. IMPLEMENTED/VERIFIED 必须有代码/测试/CI 等证据引用。
8. 不允许把 PROPOSED 文档列为当前有效决策。

以上是流程要求草案，不是已经存在或运行的自动化检查。
