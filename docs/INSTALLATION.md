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

## 5. 唤醒时间与出生资料

元炁自身的唤醒时间与用户个人出生资料相互独立。

当前实现的唤醒条件：安装后可以先有普通 direct-user 消息；元炁会等待首次满足以下条件的事件：DSH `user/message` 来源为真实 direct user（`source.kind === 'user'`），消息内容数组恰好包含一个文本块，且该文本完整精确等于“启动元气”或“启动元炁”。前后空格、换行、引号、标点、附加文字、多文本块、助手输出和注入上下文均不触发。普通首条消息只记录首次消息事实，不消耗启动资格，也不会创建唤醒记录、主线 Worldline 或 Session 绑定。首次精确启动命令的唤醒时间必须使用该 DSH `SessionEvent.time`。冷历史恢复会排除安装边界之前和 Fork 继承前缀中的事件；若启动命令只在冷历史中发现，不会用当前设备位置冒充历史地点。详见 [E00-21 P0 唤醒出生资料与地点采集](./engineering/E00-21-P0-YUANQI-BIRTH-RECORD-LOCATION.md)。

用户出生资料必须由用户明确提供并确认。不得通过 IP、设备定位或模型推断补全出生地点或出生事实。

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
