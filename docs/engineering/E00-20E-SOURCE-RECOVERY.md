# E00-20E 源码恢复排查记录

> 状态：SOURCE RECOVERED / LOCAL VERIFIED / REPOSITORY IMPORT PENDING
> 工作分支：`dev`
> 本记录范围：公开 GitHub 来源排查与用户历史文件库归档恢复；不代表已恢复 Git 提交历史。

## 结论

此前 GitHub 公开来源排查没有发现缺失源码的提交、PR 或 Release 附件。随后在用户历史文件库中找到与当前仓库版本一致的 alpha.9 源码归档，现已完成隔离环境复验。E00-20E-02 从 BLOCKED 更新为 IN_PROGRESS：源码恢复来源已找到，但文件尚未导入当前 GitHub `dev` Tree。

不得从名称相近的项目复制实现，也不得用空模块、占位代码或伪造测试解除阻断。归档不含 `.git`，不能从归档本身证明原始提交 SHA、tag 或分支。

## GitHub 公开来源核查

| 来源 | 结果 | 判断 |
|---|---|---|
| 本仓库 Pull Requests（all states） | 未检索到 PR | 未发现可用于恢复的 PR 分支差异 |
| 本仓库提交搜索：`birth-code` | 无匹配提交 | 未发现对应恢复提交 |
| 本仓库提交搜索：`solar-longitude-solver` | 无匹配提交 | 未发现对应恢复提交 |
| 本仓库 Releases | 返回空列表 | 未发现发布附件恢复源 |
| 全局代码搜索：`calculate-birth-chart.js`、`normalized-birth-time.js`、`BirthProfile Worldline` | 无匹配结果 | 未发现可核验的公开副本 |
| 全局代码搜索：`birth-profile.js` | 命中其他项目的 Schema 文件 | 与本项目源码身份无关 |
| 相似仓库 `kimi9813/yuanqi-plugins` | README 描述为腾讯元器 FastAPI 插件集合 | **排除**：不是本项目 DSH 插件源码 |
| 本仓库 Forks API | 当前 GitHub 连接器未能读取该端点 | Fork 网络状态未确认，不得写成“没有 Fork” |

## 新发现：alpha.9 历史源码归档

历史文件库中找到：
- `yuanqi-v1.1-alpha9-source.zip`：176,010 bytes，包含 65 个文件。
- `yuanqi-v1.1-alpha9-plugin-source-only.zip`：84,042 bytes。
- `yuanqi-v1.1-alpha9-plugin.tgz`：40,052 bytes。
- `yuanqi-dsh-integrated-v0.6.1.zip`：旧版历史工作区，仅作历史参考，不作为 alpha.9 基线。

alpha.9 源码归档的 package metadata 为 `dsh-yuanqi-plugin@1.1.0-alpha.9`，与当前仓库版本一致。源码归档内的 dist TGZ 与历史文件库中独立保存的 alpha.9 TGZ 字节完全一致。归档中的 `index.js` 所声明 20 个本地导入目标全部存在；包含 17 个 Node 测试文件与 5 个夹具文件。

## 隔离复验结果

环境：Node.js `v22.16.0`、npm `10.9.2`。

| 检查 | 结果 |
|---|---:|
| 入口本地导入目标 | 20/20 存在 |
| 缺失导入目标 | 0 |
| `npm test` | 96 passed / 0 failed |
| `npm run check` | 通过（语法检查 + 测试） |
| `npm pack --dry-run` | 成功，26 个发布文件 |

这次复验重现了 alpha.9 README 中的 96 项测试记录。它只证明归档源码在当前隔离 Node 环境中的本地测试通过，不代表 GitHub CI、目标 DSH 版本契约或真实 Android DSH 宿主验收通过。详细证据见 [E00-20E-02 alpha.9 归档恢复验证](./E00-20E-02-ARCHIVE-RECOVERY-VERIFICATION.md)。

## 恢复包与当前状态

已生成 `E00-20E-02-alpha9-source-recovery.zip`，仅包含：
- 原审计缺失的 19 个运行时模块；
- 完整 `test/` 树（17 个测试文件、5 个夹具文件）；
- 恢复说明。

恢复包刻意不覆盖当前仓库已有的 `index.js`、`package.json`、中文 `README.md`、`cordis.patch.yml`、`src/initialization/onboarding.js` 和 `src/dsh/types/message-source.d.ts`。

当前 GitHub `dev` Tree 尚未导入恢复包，仍不能独立导入入口或运行测试。因此：
- 源码恢复来源：已找到；
- 隔离复验：已通过；
- Git 工作树恢复：待执行；
- GitHub CI：未执行；
- 真实 Android DSH 宿主：未验收。

## 下一步

1. 将恢复包中的 19 个模块和完整 `test/` 树导入 `dev`，审阅 diff，不覆盖现有中文元数据与工程治理文档。
2. 从 Git 工作树重新运行入口导入检查、`npm run check` 和 `npm pack --dry-run`。
3. 随后建立可重复 GitHub Actions CI 基线，进入 E00-20E-03。
4. 恢复来源没有提供 Git 历史；不得为其虚构提交 SHA、tag 或分支。
5. D09～D13、D15 仍须从原始领域资料核实；FIX-001～FIX-020 与 CR-001～CR-013 仍按原批准治理流程处理。
