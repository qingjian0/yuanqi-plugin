# E00-20E 工程落地：仓库基线审计

> 审计日期：2026-11-05
> 仓库：`qingjian0/yuanqi-plugin`
> 审计基线分支：`main`
> 基线提交：`228fd46d5969a3b965017e295e533f55c556facd`
> 工程工作分支：`dev`
> 审计范围：Git Tree、入口导入、package.json、项目状态与发布记录

## 1. 执行结论

当前远端仓库快照不足以直接开展完整契约集成和可重复工程验收。必须先补齐源码与测试基线，再把 E00-20D 的设计契约接入工程。

本审计没有修改 `main`。后续工程变更统一在 `dev` 分支进行；完成阶段验收后再通过 Pull Request 评审，不直接合并稳定分支。

## 2. 仓库事实

| 项目 | 审计结果 |
|---|---|
| 默认分支 | `main` |
| 基线提交 | `228fd46d5969a3b965017e295e533f55c556facd` |
| 基线 Tree 条目数 | 21 |
| 工作分支 | `dev` |
| 当前 Schema 文件 | 0 |
| 当前 ADR 文件 | 0 |
| 当前 GitHub Actions Workflow 文件 | 0 |
| 当前测试文件 | 0 |
| `docs/EXECUTION-PLAN.md` | 不存在 |
| `docs/IMPLEMENTATION-LOG.md` | 不存在 |
| `package-lock.json` | 不存在 |
| 真实 Android DSH 宿主验收 | 项目状态文档标记为待验收 |

Tree 条目数包含目录节点，不等于文件数量。

## 3. 入口导入完整性

当前 `index.js` 声明 20 个本地模块导入：

- 其中 1 个目标文件存在：`src/initialization/onboarding.js`。
- 其余 19 个目标文件未出现在基线 Git Tree：
  - `src/birth/birth-code.js`
  - `src/birth/civil-time.js`
  - `src/birth/birth-profile.js`
  - `src/birth/solar-time.js`
  - `src/birth/four-pillars.js`
  - `src/birth/solar-term-provider.js`
  - `src/birth/normalized-birth-time.js`
  - `src/birth/xi-segment.js`
  - `src/birth/solar-longitude-solver.js`
  - `src/birth/astronomy-bundle-v7.js`
  - `src/birth/iers-eop.js`
  - `src/birth/tai-utc.js`
  - `src/birth/time-scale-provider.js`
  - `src/birth/usno-delta-t.js`
  - `src/birth/meeus-solar-ephemeris.js`
  - `src/birth/practical-solar-term-provider.js`
  - `src/birth/calculate-birth-chart.js`
  - `src/dsh/plugin.js`
  - `src/worldline/runtime.js`

因此当前 Git Tree 无法证明入口模块可以完整导入。不能通过添加空文件或伪造导出解决该问题。

## 4. 测试与 CI 证据缺口

当前 `package.json` 定义：

- `test`: `node --test`
- `check`: 入口和 `src/**/*.js` 语法检查后执行 `node --test`

但基线 Git Tree 中没有测试文件或 Workflow。README、STATUS 和 alpha.9 发布记录提到“96 项通过”，这属于已有文档记录；当前提交没有对应测试源码、执行日志或 CI Run，故本次无法独立复核。

本审计不把未执行的测试标记为通过，也不推断历史测试一定未执行。

## 5. 历史提交核对

基线提交历史显示，alpha.9 源码上传记录包括：

- `index.js`
- `cordis.patch.yml`
- `src/dsh/types/message-source.d.ts`
- `src/initialization/onboarding.js`

本次可见历史未提供其余入口依赖模块和测试文件。当前证据更符合“远端上传快照不完整”，而不是已经证明这些文件在最近提交中被删除。

## 6. 阻断项与处理顺序

| 优先级 | 阻断项 | 处理要求 |
|---|---|---|
| P0 | 19 个入口依赖模块缺失 | 从可信完整源码基线恢复，不创建空壳替代 |
| P0 | 测试源码缺失 | 恢复实际测试并核对 96 项记录 |
| P0 | 缺少可执行 CI | 建立可重复的 CI 检查与证据 |
| P1 | 缺少 ADR 与执行日志目录 | 建立可追溯的决策与实施记录 |
| P1 | E00-20D 契约尚未进入仓库 | 先落地公共 Schema，再按已核实领域扩展 |
| P1 | D09-D13、D15 名称和契约未核验 | 从原始领域资料核实，禁止猜测 |
| P2 | 缺少锁文件 | 在依赖和 Node/npm 版本确认后生成并纳入版本控制 |

## 7. 工程执行规则

1. 不修改 `main`；工作内容留在 `dev`。
2. 不覆盖或重写现有插件入口、DSH 生命周期和 Storage Domain 集成。
3. 不通过空模块、假测试或静态报告伪造验收结果。
4. Schema 设计与运行时领域校验分开；JSON Schema 不承担授权、数据库唯一性、跨领域写权限等运行时证明。
5. 未核实的领域只允许登记为 `UNVERIFIED`，不得生成虚构业务契约。
6. 每个工程阶段记录实际文件、提交、命令、测试结果和未完成项。
7. 未完成真实宿主验证时，继续明确标记为待验收。

## 8. 后续复核与下一步

2026-11-05 在建立 `dev` 后再次复核了可见分支与提交记录：仓库存在 `main`、`dev`、`work/e00-20e-contracts` 三个分支；可见的 alpha.9 源码上传提交仍仅涉及本审计第 5 节列出的四个路径，未发现其余缺失模块和测试的可信恢复提交。该复核没有证明其他未公开或未连接来源不存在，因此阻断仍保持 BLOCKED。

E00-20D 的 20 项契约修订问题现登记在 [E00-20D 契约修订登记册](./E00-20D-FIX-REGISTER.md)。登记册是待裁决问题清单，不代表规范已经批准或实现。


1. 获取完整且可信的 YuanQi alpha.9 源码与测试基线，或确认当前远端快照就是预期交付范围。
2. 恢复源码和测试后，先验证入口导入与现有功能回归。
3. 建立 CI 基线。
4. 再落地 E00-20D 的 Common Schema、Messaging Schema 和 Registry。
5. 最后按领域核验结果逐步扩展领域契约。

**审计结论：**当前可以安全推进契约工程的文档和公共 Schema 基础，但不能宣称插件源码、测试或端到端 CI 已经完整。