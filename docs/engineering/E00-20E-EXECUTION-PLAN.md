# E00-20E 工程落地执行计划

> 状态：进行中
> 工作分支：`dev`
> 基线分支：`main`
> 基线提交：`228fd46d5969a3b965017e295e533f55c556facd`
> 设计输入：E00-20D-01～12（对话阶段形成的接口契约设计初稿）

## 目标

将 E00-20D 的接口契约设计转化为可版本控制、可自动校验、可审计的工程资产，同时保护现有 DSH 插件能力。

## 执行原则

- 只在工作分支提交，不直接修改 `main`。
- 先恢复和验证源码基线，再扩大工程改动。
- 不以空壳模块、模拟测试或未执行的命令伪造完成状态。
- Common Schema 先于领域 Schema。
- 未核验领域不得生成业务字段或伪造 Owner。
- 所有测试结果必须来自实际执行日志或 CI Run。
- 真实 DSH 宿主验证与本地 Schema 验证分别报告。

## 阶段

| 阶段 | 任务 | 状态 | 完成标准 |
|---|---|---|---|
| 20E-01 | 仓库与源码基线审计 | DONE | Tree、入口依赖、测试、CI、文档状态已记录 |
| 20E-01A | 可见分支与提交来源复核 | DONE | 已核查可见分支、提交；未发现 Git 提交恢复源 |
| 20E-01B | 历史测试证据标注 | DONE | alpha.9 的 96 项测试声明已从恢复归档隔离复验；Git Tree 导入仍待完成 |
| 20E-01C | 公开来源补充排查 | DONE | PR、提交搜索、Release、代码搜索及相似仓库完成核查；结果见源码恢复记录 |
| 20E-02 | 恢复完整源码和测试基线 | IN_PROGRESS | 19 个入口依赖与完整测试树导入 `dev`；Git 工作树入口可导入；96 项测试与语法检查通过 |
| 20E-03 | 现有功能回归与 CI 基线 | PENDING | 从 Git 工作树重复运行测试；建立可重复 CI |
| 20E-04 | Common JSON Schema | PENDING | ID、时间、主体、安全引用、元数据定义通过 Draft 2020-12 校验 |
| 20E-05 | Messaging JSON Schema | PENDING | Command、Query、Event、Error、DomainCall 通过正负向测试 |
| 20E-06 | Domain Registry 与领域 Schema | PENDING | 已核实领域完整登记；未核实领域标记 UNVERIFIED |
| 20E-07 | 跨领域引用与依赖检查 | PENDING | 引用可解析；同步依赖无环；Owner 规则有测试 |
| 20E-08 | 兼容性和迁移测试 | PENDING | 历史版本读取及破坏性变更检查 |
| 20E-09 | 安全边界测试 | PENDING | Principal、授权、Worldline、资源和 Fencing 规则有可执行测试 |
| 20E-10 | 最终工程验收 | PENDING | 代码、Schema、Registry、测试、CI 和交付报告齐全 |

## 契约修订

- E00-20D 的 20 项待修订问题已登记于 [E00-20D 契约修订登记册](./E00-20D-FIX-REGISTER.md)。
- FIX-001～FIX-007 的逐项方案见 [P0 公共契约裁决建议稿](./E00-20D-P0-DECISION-PROPOSALS.md)；全部仍为 PROPOSED。
- P0 正反向、安全和持久化测试设计见 [P0 契约验证矩阵](./E00-20D-P0-TEST-MATRIX.md)；当前是 TEST DESIGN / NOT RUN，不是测试源码或测试结果。
- FIX-008～FIX-017 的方案见 [P1 公共契约裁决建议稿](./E00-20D-P1-DECISION-PROPOSALS.md)；FIX-015 仍需原始领域资料核验。
- FIX-018～FIX-020 的方案见 [P2 治理裁决建议稿](./E00-20D-P2-GOVERNANCE-PROPOSALS.md)；统计口径、Schema URI 命名空间和 ADR 候选清单仍待核验/批准。
- ADR 流程建议见 [ADR 索引与模板治理](../adr/README.md)；该文件不是正式 ADR 索引，尚未创建正式决策记录。
- 建议稿一致性审查见 [契约一致性审查](./E00-20D-CONSISTENCY-REVIEW.md)，CR-001～CR-013 必须纳入后续 ADR。
- 只有 ACCEPTED 项可以进入规范 Schema；建议稿和测试矩阵不构成 ADR 或冻结规范。
- `dev` 是当前开发分支；`main` 保持稳定分支，不直接修改。

## 当前阻断

详见 [E00-20E 仓库基线审计](./E00-20E-BASELINE-AUDIT.md)、[E00-20E 源码恢复排查记录](./E00-20E-SOURCE-RECOVERY.md) 和 [alpha.9 归档恢复验证](./E00-20E-02-ARCHIVE-RECOVERY-VERIFICATION.md)。

当前最优先事项：
1. alpha.9 源码归档已在历史文件库中找到，且隔离复验通过；但 19 个缺失模块和完整 `test/` 树尚未导入当前 GitHub `dev` Tree。
2. 因此当前远端 Git Tree 仍不能完整导入入口或独立运行测试；必须将恢复包导入 `dev` 后再次从 Git 工作树复验。
3. 当前仓库没有 GitHub Actions Workflow；本地测试通过不等于 CI 通过。
4. 当前仓库没有 E00-20D Schema 或领域契约文件；尚无正式 ADR 文件。
5. ADR-001～290 候选项的原始清单未在当前 Git Tree 中找到，无法完成逐项去重/冲突审查。
6. D09～D13、D15 的领域定义尚待原始资料核验。
7. 本轮公开来源排查未发现 GitHub 恢复提交；相似的 `kimi9813/yuanqi-plugins` 已确认是腾讯元器 FastAPI 插件集合，不属于本项目。Forks API 因连接器端点限制未能核实，不能据此断言不存在 Fork。

## 当前执行状态

- 20E-01、20E-01A、20E-01B、20E-01C 已完成；来源排查与历史证据边界均已记录。
- alpha.9 源码归档已恢复到隔离目录；20 个入口依赖目标全部存在，17 个测试文件和 5 个夹具文件均已找到。
- 隔离归档中 `npm test` 为 96 passed / 0 failed；`npm run check` 通过；`npm pack --dry-run` 成功并列出 26 个发布文件。
- 上述结果不代表 GitHub `dev` Tree 已恢复。恢复包已生成，下一步需导入 `dev` 并从 Git 工作树重新验证。
- 20D P0：FIX-001～FIX-007 已形成逐项建议与验证矩阵，内部一致性审查已完成；所有项目仍为 PROPOSED。
- 20D P1：FIX-008～FIX-017 已形成方案建议；FIX-015 保持 OPEN，等待原始领域资料。
- 20D 一致性审查已扩展至 CR-001～CR-013，仍待项目裁决；新增 FIX-018～FIX-020 治理建议和 ADR 流程说明，但仍未创建正式 ADR 决策记录。
- FIX 登记册已明确分离 decision_status 与 implementation_maturity，防止将批准与实现验证混为一谈。
- 本轮没有 CI Run、没有真实 DSH 宿主验证；不得将这些项目标记为通过。
- 下一步：先把恢复包导入 `dev` 并从 Git 工作树复验，再建立 CI 基线；P0/P1/P2 方案仍需项目决策者批准/修订。Schema 草案不能替代源码基线恢复。

## 阶段关闭规则

只有当每项验收标准有实际文件、测试结果或 CI 证据支持时，才能将阶段标记为 DONE。文档草案、未运行命令和推测结果不构成工程验收证据。


## 2026-11-06 用户方向变更（覆盖此前源码恢复计划）

用户已明确要求**不恢复** alpha.9 历史源码归档。此前 20E-02 中“把 19 个模块和完整测试树导入 dev”的动作取消，不再执行；20E-03 中基于历史归档的唤醒补丁导入也取消。历史归档隔离验证记录保留为历史证据，但不构成当前代码基线，也不授权复制其源码。

新的实施路径是在当前 GitHub 开发树上重新实现所需能力，并复用已核实的 DSH Storage Domain API；不建设第二套 Runtime 或持久化系统。当前第一批实现位于 Draft PR #3（E00-20E-05B）：

- UserSubject 与 YuanQiSubject 使用两个独立 DSH Storage Domain。
- 出生资料仅归 UserSubject，并要求可信确认事件回调。
- YuanQi 唤醒记录仅归 YuanQiSubject，要求可信 direct-user 事件、首条会话用户消息、精确启动口令及 DSH 事件时间。
- GitHub Actions 已建立；最新运行 `42216613430` 在 commit `c426f4e09cb68342a461a989045fe5490401a3ec` 上成功，6 项测试通过。

**当前限制：** 事件验证回调尚未连接真实 DSH 消息事件；Storage Domain 后端真实持久化、Cordis 生命周期集成、根入口整体导入和真实宿主验收仍未通过。PR #3 保持 Draft。

后续按 E00-20E-05C 起推进 Worldline 与 SelfModel，不把未实现能力写成 DONE。此前表格中的源码恢复验收标准已被用户取消，不再作为当前阶段关闭条件。
