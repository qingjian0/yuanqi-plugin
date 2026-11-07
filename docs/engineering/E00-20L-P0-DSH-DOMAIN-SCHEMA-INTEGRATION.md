# E00-20L P0 — YuanQi 双 Subject Domain 官方实现集成验证

> 日期：2026-11-07  
> 范围：openSubjectDomains() 与 DSH DomainFacility / DomainImpl 契约  
> 状态：代码已加入待 CI 验证；不是生产磁盘后端或 Android Profile 验收。

## 目标

此前 real-domain-contract.test.js 只用探针 Domain 验证 DSH DomainFacility，而首次唤醒与 JSONL 集成测试仍通过轻量内存 Storage Domain adapter 运行。该测试补齐一层真实契约覆盖：把 YuanQi 实际导出的 UserSubject / YuanQiSubject schema 交给 DSH 官方 DomainFacility 打开。

## 覆盖

- 打开 UserSubject Domain v1 与 YuanQiSubject Domain v8，确认 v8 对 v3-v7 的兼容声明。
- 通过 DSH DomainImpl 的真实表接口写入身份、安装边界、首次消息锁，并执行 update()。
- 关闭两个 Domain 后重新打开，验证记录恢复、版本更新持久化，以及两个 Subject 的表空间隔离。
- 验证负数 activation boundary 被实际 schema 拒绝。
- 检查双 Domain 正常关闭后 backend 不再保留打开句柄。

## 保证边界

该测试使用 DSH 官方 DomainFacility / DomainImpl，但底层 KvUnit 仍是测试内存 backend。它验证的是 YuanQi 正式 Domain schema 与 DSH 运行时契约，不代表 Android/生产磁盘 backend 的 crash durability，也不证明跨 Domain 原子事务或跨进程 CAS。真实 JSONL Session Query 集成测试与本测试覆盖不同持久化域，不能相互替代。

## 验收

- [ ] GitHub Actions 在当前 HEAD 执行通过。
- [ ] Android/Profile 实际 Storage backend 与 Session Query/Persistence providers 验收。
- [ ] OS 进程强制终止后的跨 Domain 恢复验证。
