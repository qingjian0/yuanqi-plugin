# E00-20E 源码恢复排查记录

> 状态：BLOCKED
> 工作分支：`dev`
> 本记录范围：公开 GitHub 来源排查；不代表完整互联网或用户本地备份已穷尽。

## 结论

截至本次排查，尚未发现可以证明属于本项目、且包含缺失源码与测试的可信恢复来源。E00-20E-02 继续保持 BLOCKED。不得从名称相近的项目复制实现，也不得用空模块、占位代码或伪造测试解除阻断。

## 本次核查

| 来源 | 结果 | 判断 |
|---|---|---|
| 本仓库 Pull Requests（all states） | 未检索到 PR | 未发现可用于恢复的 PR 分支差异 |
| 本仓库提交搜索：`birth-code` | 无匹配提交 | 未发现对应恢复提交 |
| 本仓库提交搜索：`solar-longitude-solver` | 无匹配提交 | 未发现对应恢复提交 |
| 本仓库 Releases | 返回空列表 | 未发现发布附件恢复源 |
| 全局代码搜索：`calculate-birth-chart.js`、`normalized-birth-time.js`、`BirthProfile Worldline` | 无匹配结果 | 未发现可核验的公开副本 |
| 全局代码搜索：`birth-profile.js` | 命中其他项目的 Schema 文件 | 与本项目源码身份无关 |
| 相似仓库 `kimi9813/yuanqi-plugins` | README 明确描述为腾讯元器（Tencent Yuanqi）FastAPI 插件集合；代码为 Python 插件与 OpenAPI 规范 | **排除**：仅名称相似，不是本项目 DSH 插件源码 |
| 本仓库 Forks API | 当前 GitHub 连接器未能读取该端点 | Fork 网络状态未确认，不得写成“没有 Fork” |

## 相似仓库排除依据

`kimi9813/yuanqi-plugins` 的 README 将项目定义为腾讯元器智能体插件集合，列出的模块为 web/file/terminal/skill/agent_task，运行入口为 FastAPI 的 `app.py`。其 `plugins/` 目录包含 Python 文件，`specs/` 目录包含 OpenAPI YAML。它与本项目的 YuanQi DSH 插件、Kotlin/JS 代码契约及出生资料/Worldline 架构不符，因此不作为恢复源。

## 未改变的事实

- 原仓库当前已知缺失的 19 个 `index.js` 本地导入目标仍未恢复。
- 当前远端 Tree 没有可核验的测试源码；历史 96 项测试记录仍不能在当前快照独立复核。
- 本次没有执行项目测试、没有 CI Run、没有真实 DSH 宿主验证。
- 本次未写入任何运行时代码，也未将任何 P0 契约建议批准为 ACCEPTED。

## 下一步

1. 需要用户提供可信完整 ZIP、原始工作目录、可信 tag/commit，或能确认来源的上游分支/备份。
2. 收到来源后先记录来源、文件清单、Git 历史与校验值，再进行恢复；逐项核对 19 个入口依赖和测试目录。
3. 完整源码基线恢复并通过入口导入检查后，才进入 E00-20E-03 功能回归与 CI 基线。
4. 在源码恢复等待期间，可以继续裁决 FIX-001～FIX-007，但每项必须保留 PROPOSED/ACCEPTED 状态区别；未获批准不得生成冻结规范。

