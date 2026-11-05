# E00-20E-02 alpha.9 源码归档恢复验证

> 日期：2026-11-05
> 工作分支：`dev`
> 状态：SOURCE RECOVERED / LOCAL VERIFIED / REPOSITORY IMPORT PENDING

## 1. 恢复来源

在用户历史文件库中找到以下项目归档：

- `yuanqi-v1.1-alpha9-source.zip`：176,010 bytes，88 个 ZIP 条目（65 个文件、23 个目录）。
- `yuanqi-v1.1-alpha9-plugin-source-only.zip`：84,042 bytes，包含发布源码与测试目录。
- `yuanqi-v1.1-alpha9-plugin.tgz`：40,052 bytes。
- `yuanqi-dsh-integrated-v0.6.1.zip`：历史旧版参考，不作为 alpha.9 当前源码基线。

alpha.9 源码归档中的 `package.json` 标识 `dsh-yuanqi-plugin@1.1.0-alpha.9`，与当前仓库版本一致。源码归档内的 `dist/dsh-yuanqi-plugin-1.1.0-alpha.9.tgz` 与独立历史库中的 alpha.9 TGZ 字节完全一致。归档包含当前 `index.js` 声明的全部 20 个本地导入目标，且包含 17 个 Node 测试文件与 5 个测试夹具文件。

归档不含 `.git`，因此不能从 ZIP 本身证明原始 Git commit、tag 或分支来源。恢复时应保留“归档来源”与“Git 历史来源”两种证据的区别。

## 2. 隔离环境复验

执行目录：隔离解压目录 `yuanqi-alpha9-work/`。

环境：
- Node.js `v22.16.0`
- npm `10.9.2`
- 满足项目声明的 Node.js `>=22`

结果：

| 检查 | 结果 |
|---|---:|
| `index.js` 本地导入目标 | 20/20 存在 |
| 缺失导入目标 | 0 |
| Node 测试文件 | 17 |
| 测试夹具文件 | 5 |
| `npm test` | 96 passed / 0 failed |
| `npm run check` | 通过（语法检查 + 测试） |
| `npm pack --dry-run` | 成功，26 个发布文件 |

本次复验重现了 alpha.9 README 中记录的 96 项测试结果。该结果只证明归档源码在当前隔离 Node 环境中的本地测试通过，不代表 GitHub CI、目标 DSH 版本契约或真实 Android DSH 宿主验收通过。

## 3. 待恢复文件范围

根据原 Git Tree 审计，需补回的 19 个运行时文件为：

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

另需恢复完整 `test/` 树，包括 17 个测试文件和 5 个夹具文件。现有 `index.js`、`package.json`、`README.md`、`cordis.patch.yml`、`src/initialization/onboarding.js` 与 `src/dsh/types/message-source.d.ts` 不应被旧归档覆盖；当前仓库的中文元数据与工程治理文档应予保留。

## 4. 可执行恢复包

已生成仅含 19 个缺失运行时模块和完整 `test/` 树的恢复包：

`E00-20E-02-alpha9-source-recovery.zip`

恢复包包含说明文件，解压目标为仓库根目录。恢复前后均应审阅 Git diff；恢复后必须从 Git 工作树重新运行 `npm run check`。

## 5. 当前状态与下一步

- 源码归档已找到并完成隔离复验。
- 19 个缺失模块在恢复归档中均存在。
- 96 项测试已在归档副本中复验通过。
- 当前 GitHub `dev` 分支尚未导入这批文件；远端 Tree 仍不能独立导入入口或运行测试。
- E00-20E-02 因此更新为 IN_PROGRESS，而不是 DONE。
- 下一步是把恢复包中的 19 个模块与 `test/` 树导入 `dev`，再从 Git 工作树重复入口检查、测试、语法检查和打包检查。
- GitHub CI 与真实 Android DSH 宿主验收仍为后续独立阶段。

不得将本文件或归档复验结果表述为 GitHub CI 通过、真实宿主通过或最终工程验收完成。
