# E00-20I — PR #3 / PR #4 分支协调审查

> 日期：2026-11-07  
> 仓库：`qingjian0/yuanqi-plugin`  
> 当前主工作线：PR #3  
> 并行开发线：PR #4  
> 结论：保持两条 Draft 分支独立；只选择性移植兼容性和 Domain 契约验证，不整体合并。

## 1. 远端状态

| 项目 | PR #3 | PR #4 |
|---|---|---|
| 分支 | `work/e00-20e-05b-subject-domain-runtime` | `work/e00-20-06-p5-dsh-lifecycle-recovery` |
| 当前 HEAD | `902e6d2b5552dd616ad75eedfe9af8e686675d84` | `413fc01e5738bf7565ec791a9845408b29f71948` |
| 目标分支 | `dev` | `dev` |
| PR 状态 | Open / Draft | Open / Draft |
| CI | Run #283：50/50 | Run #250：50/50 |

两条分支相对比较：PR #4 有 28 个独有提交；PR #3 有 21 个独有提交。两者已分叉，不是简单的“PR #4 是 PR #3 的快进版本”。

## 2. PR #4 可复用的工程成果

PR #4 在 P6/P7 阶段增加了：

- Storage Domain `unknown-state` fail-closed。
- 插件初始化失败时关闭已经打开的 Domain。
- Session Flush 失败保留与错误传播。
- Node.js `>=24.9.0` 运行时基线。
- 四个 DSH peer packages 的 `>=0.2.2-rc.1 <0.3.0-0` 兼容范围。
- 直接使用 DSH `DomainFacility` / `DomainImpl` 的契约测试。
- 真实 DSH Host 验收清单。

PR #4 的 Run #250：Node.js 24.9.0，四个 peer packages 均解析为 `0.2.2-rc.1`，50 passed / 0 failed。其 DomainFacility 测试使用内存 KvUnit backend，不等于生产磁盘后端验收。

## 3. PR #4 当前不能整体移植的运行时冲突

PR #4 的插件代码在以下步骤中存在行为冲突：

1. 调用 `store.recordInitialWake()`。
2. 不检查其返回结果是否表示真正唤醒。
3. 随后无条件调用 `worldlines.createMainline()`。
4. 即使首次直接用户消息是普通文本，也创建主线并绑定 Session。

PR #4 的 `test/dsh/plugin.test.js` 明确验证：首条“你好”会创建主线 Worldline，后续“启动元炁”不创建 Wake Record。

这与 PR #3 已确认的规则不一致。PR #3 的规则是：安装后首条直接用户消息不是精确启动口令时，永久消耗首次唤醒资格，不创建 Wake Record、主线 Worldline 或 Session 绑定。

另外，PR #4 的既有 Session binding 检查只比较 `yuanqi_subject_id`，没有校验 `worldline_id` 与预期主线一致。这可能掩盖错误 Worldline 绑定。

## 4. 本轮选择性移植范围

本轮只从 PR #4 复用以下独立内容：

- `package.json` 的 Node.js 与 DSH peer dependency 兼容范围。
- `.github/workflows/ci.yml` 对实际 DSH Storage Domain 导出的检查。
- `test/dsh/real-domain-contract.test.js` 对官方 DomainFacility / DomainImpl 的直接契约测试。

本轮没有移植 PR #4 的 `src/dsh/plugin.js`、生命周期恢复测试或普通首条消息创建 Worldline 的行为。

PR #4 分支没有被修改；PR #3 和 PR #4 均保持 Draft，`dev` 与 `main` 未修改。

## 5. 后续合并/移植门槛

在任何 PR #3 / PR #4 整合前，必须先统一并验证：

1. 严格唤醒条件与普通首条消息的 Worldline 创建规则。
2. Wake Record 缺失、Wake Record 已写入但 Worldline 未创建时的恢复路径。
3. Session binding 必须同时核对主体 ID 与 Worldline ID。
4. unknown-state 下的失败任务保留、Flush 错误传播、Domain 关闭与重新打开。
5. 插件初始化任何阶段失败时均不得泄漏 Domain 句柄。
6. 使用同一套真实 DSH 版本基线和自动化验收矩阵。

在这些差异解决前，不得把 PR #4 作为 PR #3 的无条件替代，也不得整体合并两个分支。
