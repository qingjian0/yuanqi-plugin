# E00-20L P0 — YuanQi 双 Subject Domain 官方实现集成验证

> 日期：2026-11-07  
> 范围：openSubjectDomains() 与 DSH DomainFacility / DomainImpl 契约  
> 状态：测试已通过；生产磁盘后端与 Android Profile 验收未完成。

## 目标

此前 real-domain-contract.test.js 只用探针 Domain 验证 DSH DomainFacility，而首次唤醒与 JSONL 集成测试仍通过轻量内存 Storage Domain adapter 运行。该测试补齐一层真实契约覆盖：把 YuanQi 实际导出的 UserSubject / YuanQiSubject schema 交给 DSH 官方 DomainFacility 打开。

## 覆盖

- 打开 UserSubject Domain v1 与 YuanQiSubject Domain v8，确认 v8 对 v3-v7 的兼容声明。
- 通过 DSH DomainImpl 的真实表接口写入身份、安装边界、首次消息锁，并执行 update()。
- 关闭两个 Domain 后重新打开，验证记录恢复、版本更新持久化，以及两个 Subject 的表空间隔离。
- 将格式错误的安装边界写入测试 backend，关闭 Domain 后再次 open；验证官方 DomainFacility 在打开时按 Zod schema 校验已保存记录并拒绝损坏记录。
- 检查双 Domain 正常关闭后 backend 不再保留打开句柄。

## DSH 契约修正

第一次测试错误地假设 KvTable.put() 会立即执行 Zod 校验，导致 62 项中 61 项通过、1 项失败。核对 DSH 官方 storage subsystem 文档后确认：DomainFacility.open() 加载并校验已保存记录；KvTable.put() 的契约是将数据排入写队列并持久化，不在写入时执行 schema parse。因此测试已改为验证“错误记录持久化后，在 Domain 重新打开时被拒绝”，不再臆造写入时校验行为。

## CI 结果

- 修正后 HEAD：962b9221d196256be09254221704c43603c4818f
- Push Run #315：42361157640，成功。
- PR Run #316：42361162545，成功。
- Node.js 24.9.0；62 passed / 0 failed。

## 保证边界

该测试使用 DSH 官方 DomainFacility / DomainImpl，但底层 KvUnit 仍是测试内存 backend。它验证的是 YuanQi 正式 Domain schema 与 DSH 运行时契约，不代表 Android/生产磁盘 backend 的 crash durability，也不证明跨 Domain 原子事务或跨进程 CAS。真实 JSONL Session Query 集成测试与本测试覆盖不同持久化域，不能相互替代。

## 后续验收

- [x] GitHub Actions 在当前 HEAD 执行通过。
- [ ] Android/Profile 实际 Storage backend 与 Session Query/Persistence providers 验收。
- [ ] OS 进程强制终止后的跨 Domain 恢复验证。
- [ ] 对 CI 安装阶段报告的 22 个 high severity vulnerabilities 进行依赖树定位；未定位前不执行强制升级。
