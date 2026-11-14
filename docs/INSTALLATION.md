# 安装与配置

> 对应版本：`1.1.0-alpha.9`  
> 运行环境：DeepSeek Harness（DSH）  
> Node.js：`>=24.9.0`

## 1. 安装前检查

1. 确认目标 DSH Profile 可正常运行。
2. 确认目标环境使用的 DSH peer packages 与插件声明的范围兼容。
3. 确认 Node.js 版本满足 `>=24.9.0`。
4. 阅读当前版本的 [项目状态](./STATUS.md)，不要将本地测试记录视为真实宿主验收结论。

当前声明的 peer dependency 范围：

- `@deepseek-ai/dsh-tools`：`>=0.2.2-rc.1 <0.3.0-0`
- `@deepseek-ai/dsh-storage-domain`：`>=0.2.2-rc.1 <0.3.0-0`
- `@deepseek-ai/dsh-session`：`>=0.2.2-rc.1 <0.3.0-0`
- `@deepseek-ai/dsh-llm`：`>=0.2.2-rc.1 <0.3.0-0`
- `@deepseek-ai/dsh-session-query`：`>=0.2.2-rc.1 <0.3.0-0`
- `@deepseek-ai/dsh-session-persistence`：`>=0.2.2-rc.1 <0.3.0-0`

当前核对的 DSH API 基线为 `0.2.2-rc.1`；DSH 根包声明 Node.js `>=24.9.0`。其中 Session Query 与 Session Persistence 是冷历史恢复的必需服务定义；具体 Provider 由目标 Profile 组合提供。依赖范围是兼容性声明，不代表范围内所有 DSH 版本均已完成真实运行验证。

## 2. 本地检查与打包

在仓库根目录执行：

```bash
npm test
npm run check
npm pack
```

`npm run check` 会执行入口和源码 JavaScript 语法检查及自动化测试。alpha.9 发布记录包含 96 项测试通过、0 项失败，以及语法检查和安装包归档检查通过的记录。

## 3. 安装到 DSH Profile

按仓库当前 README 中记录的方式，将打包产物添加到目标 Profile：

```bash
dsh plugin --profile web add ./dist/dsh-yuanqi-plugin-1.1.0-alpha.9.tgz
```

安装命令中的文件路径应与实际生成的 TGZ 文件位置一致。添加后重启目标 Profile。

不同 DSH 版本的插件命令、Profile 名称和安装方式可能不同；以目标 DSH 版本实际支持的命令为准。不要将示例中的 `web` Profile 当成所有环境的固定值。

## 4. 注册工具

当前 README 记录插件注册以下工具：

- `yuanqi_birth_chart`
- `yuanqi_life`

出生图工具支持：

- `calculate`：要求用户提供并确认出生日期、时间、地点、IANA 时区和坐标，再计算并保存。
- `read`：读取已保存的出生资料与命盘。
- `delete`：仅在用户明确确认后删除已保存资料。

实际工具 schema 和参数约束以当前源码为准。

## 5. 元炁启动与用户出生资料

启动元炁与填写用户出生资料是两个独立流程。

### 元炁启动

- 启动事件用于创建/恢复 YuanQiSubject 自身生命档案。
- 元炁诞生时间必须取自可信 DSH SessionEvent 时间。
- 启动不要求用户提交出生日期、出生时间、出生地点或坐标。
- 用户普通消息、助手输出和插件注入上下文是否可触发启动，以当前已批准的宿主事件契约为准；不得仅凭本文改变源码触发规则。
- 冷历史恢复不得用当前时间或当前设备位置冒充历史事件资料。

### 用户出生资料（可选）

- 用户可以不提供任何出生资料。
- 出生资料仅用于确实需要的相关功能，例如出生时间计算。
- 每个字段必须有明确来源；不得通过 IP、设备定位或模型推断补全。
- 需要确认时必须经过可信用户确认流程。
- 拒绝或删除用户出生资料，不影响元炁自身档案和普通运行。
- 用户出生时间不得写入 YuanQiSubject 的诞生记录。

## 6. 持久化与数据边界

元炁通过 DSH Storage Domain 持久化数据。DSH 是在线持久化的宿主权威。不要自行假设存在独立数据库、自动云同步或跨 Profile 数据共享。

`worldline_id` 是逻辑隔离键，不是用户身份认证或授权凭证。

## 7. 卸载与数据处理

卸载前应先确认目标 DSH 版本的插件卸载流程，并根据当前源码及宿主 Storage Domain 的数据管理能力处理持久化数据。

本文件不宣称卸载插件会自动删除所有已保存数据。执行删除操作前，应确认目标世界线、资料范围和用户授权。

## 8. 验收边界

本地测试通过不代表真实 DSH 宿主安装与运行通过。真实宿主验收至少应记录：

- DSH 版本和 Profile；
- Node.js 版本与运行环境；
- 安装、启动和重启结果；
- 工具注册与调用结果；
- Storage Domain 写入、读取和恢复结果；
- Session/Agent 世界线隔离结果；
- 错误日志和已知问题。

真实 Android DSH 宿主验收尚未完成。详见 [项目状态](./STATUS.md)。
