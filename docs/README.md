# 元炁项目文档

本目录存放元炁（YuanQi）的架构说明、设计原则、项目状态、研究资料和技术决策。

**默认语言：简体中文（zh-CN）。** 代码标识符、协议字段、API 名称、标准和上游术语保留原文，必要时补充中文解释。

## 核心文档

| 文档 | 内容 |
|---|---|
| [整体架构与自我模型](./ARCHITECTURE.md) | 研究架构、动态自我模型、认知系统、反馈闭环与 DSH 工程边界 |
| [设计原则与研究边界](./DESIGN-PRINCIPLES.md) | 先天、后天、记忆、情感、性格、目标、自主性与科学边界 |
| [项目状态](./STATUS.md) | alpha.9 已有能力、测试记录、未完成验证与后续验收重点 |

## 工程落地

- [E00-20N P0 BirthProfile 可信确认边界审计](./engineering/E00-20N-P0-BIRTH-PROFILE-TRUST-BOUNDARY-AUDIT.md)：核对现有 onboarding、Subject Domain 与 DSH Host 入口；给出候选版本、逐字段来源、一次性确认挑战、拒绝/撤销审计和持久化恢复设计。**这是审计文档，不代表运行时代码已修复。**
- [E00-20E 工程落地执行计划](./engineering/E00-20E-EXECUTION-PLAN.md)：工程阶段、阻断项和验收标准。
- [E00-20M P0 DSH Profile Provider 组合与冷读取契约审计](./engineering/E00-20M-P0-REAL-HOST-PROFILE-AUDIT.md)：官方 Base Profile 的 Session Provider 组合、精确冷读取能力、YuanQi 启动契约校验与 Android 验收清单。
- [E00-20E 仓库基线审计](./engineering/E00-20E-BASELINE-AUDIT.md)：真实 Git Tree、入口依赖、测试与 CI 证据。
- [E00-20E 源码恢复排查记录](./engineering/E00-20E-SOURCE-RECOVERY.md)：公开 GitHub 来源排查结果、历史归档恢复证据和当前导入状态。
- [E00-20E-02 alpha.9 归档恢复验证](./engineering/E00-20E-02-ARCHIVE-RECOVERY-VERIFICATION.md)：归档清单、20 个入口依赖核对、96 项测试复验与恢复包说明。
- [E00-20D P0 公共契约裁决建议稿](./engineering/E00-20D-P0-DECISION-PROPOSALS.md)：FIX-001～FIX-007 的逐项方案建议；均待批准，不代表已冻结。
- [E00-20D P0 契约验证矩阵](./engineering/E00-20D-P0-TEST-MATRIX.md)：P0 的 Schema、运行时、持久化和安全测试设计；当前未执行。
- [E00-20D P1 公共契约裁决建议稿](./engineering/E00-20D-P1-DECISION-PROPOSALS.md)：FIX-008～FIX-017 的方案建议；FIX-015 仍待原始资料核验。
- [E00-20D 契约一致性审查](./engineering/E00-20D-CONSISTENCY-REVIEW.md)：P0/P1 建议稿的内部一致性问题和待补充裁决项。
- [E00-20D 契约修订登记册](./engineering/E00-20D-FIX-REGISTER.md)：Schema 冻结前的 20 项公共契约问题、优先级和待决建议。
- [E00-20D P2 治理裁决建议稿](./engineering/E00-20D-P2-GOVERNANCE-PROPOSALS.md)：FIX-018～FIX-020 的统计去重、Schema URI 与 ADR 编号治理建议；均待批准。
- [ADR 索引与模板治理](./adr/README.md)：正式 ADR 的建议目录、编号规则、状态模型与模板；当前尚无正式 ADR。

## 文档分类

- `adr/`：架构决策记录（ADR），记录决策背景、备选方案、最终选择和影响。
- `research/`：技术研究、算法依据、数据来源、精度边界与验证结果。
- `EXECUTION-PLAN.md`：阶段计划、任务拆分和验收条件。
- `IMPLEMENTATION-LOG.md`：实施过程、变更记录、测试结果和未完成事项。

上述分类中尚未建立的文件或目录，不应被视为当前已存在的实现。

## 文档维护约定

1. 以简体中文作为默认维护语言。
2. 明确区分已实现、本地测试通过、真实宿主验证通过、研究中和规划中。
3. 天文、历法和时间尺度内容必须注明算法/数据来源、适用范围与精度边界。
4. 涉及出生资料、位置、记忆和经验时，明确数据来源、用户确认边界及持久化范围。
5. 设计变更同步更新相关 ADR、研究文档和导航。
6. 不得将未运行的测试、未安装的依赖或未完成的宿主验收写成已通过。
7. 概念架构图不等同于当前源码调用图；研究目标不等同于已实现功能。

## 当前版本验证摘要

- 版本：`1.1.0-alpha.9`
- 许可证：GNU GPL-3.0-only
- 本地测试：历史 alpha.9 源码归档已在隔离 Node.js v22.16.0 环境复验，96 项通过、0 项失败；尚未从当前 GitHub `dev` 工作树复验。
- 真实 Android DSH 宿主验证：尚未完成。

详细信息见 [项目状态](./STATUS.md) 与 [归档恢复验证](./engineering/E00-20E-02-ARCHIVE-RECOVERY-VERIFICATION.md)。

- [YuanQi 唤醒出生资料与地点采集](engineering/E00-21-P0-YUANQI-BIRTH-RECORD-LOCATION.md)
