# ADR-001：项目定位与 DSH 宿主

- 状态：Accepted
- 决策主题：元炁是 DSH 插件，不是独立 Agent Runtime。

## 背景
元炁需要 Agent、Session、消息、模型调用、工具和持久化能力。重复实现宿主会造成生命周期、权限和数据边界分裂。

## 决策
DSH 是宿主与产品入口。DSH 负责 Agent Runtime、模型调用、Session/消息生命周期、工具执行、插件生命周期和 Storage Domain。元炁负责生命上下文领域模型和演化逻辑。

## 约束
- 不另建 Agent Runtime。
- 不在插件内启动独立 Python 子进程作为在线运行依赖。
- 不以第二套在线持久化系统替代 DSH Storage Domain。
- 宿主版本兼容性必须以真实测试证明，peer dependency 范围不是验收证明。

## 验收
在目标 DSH 版本完成插件加载、工具注册、存储读写、Session 路由和卸载/重启测试。
