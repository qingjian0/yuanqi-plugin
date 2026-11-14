# YuanQi 唤醒出生资料与地点采集

## 语义约定

YuanQi 的出生时间不是用户的个人出生时间。它是用户首次在 DSH 会话中直接、单独、精确发送启动命令“启动元气”或“启动元炁”时，对应 DSH `user/message` SessionEvent 的 `time`（Unix 毫秒）。此前可以有普通消息；首次普通消息不会消耗唤醒资格。持久化时转换为 UTC ISO-8601，分别写入 `WakeRecord.birth_time` 与兼容字段 `WakeRecord.occurred_at`。不得用插件加载时间、模型生成时间或后续重试时间替代。

出生地点表示启动瞬间设备/宿主所在位置。插件通过可选的宿主适配器 `ctx.yuanqiLocationProvider.getCurrentPosition()` 读取。适配器应返回：

- `latitude`、`longitude`：WGS84 十进制度坐标；
- `accuracy_meters`：可选水平精度；
- `place_label`：可选反向地理编码地点名；
- `time_zone_id`：可选 IANA 时区；
- `captured_at`：适配器采集坐标的 ISO-8601 时间。

插件会验证坐标、精度和采集时间。定位权限被拒、超时、适配器不存在或返回无效数据时，出生时间仍正常落库，地点明确记录为 `unavailable`，不猜测 IP 地址、不使用服务器所在地，也不伪造坐标。地点数据只在首次启动命令事件处理时采集一次；后续消息、重启和重放不得覆盖出生资料。

## Host 接入要求

`yuanqiLocationProvider` 是 YuanQi 定义的可选宿主能力接口，不是已确认存在于所有 DSH 版本的内建 API。Android 宿主应使用系统定位权限与系统定位服务实现该适配器；Desktop 宿主应通过用户授权的位置提供能力实现。适配器应在授权缺失时返回错误，由插件记录为未知地点。宿主不得把 IP 推断位置伪装成 GPS/系统定位。

当前代码已完成插件侧适配器读取、字段校验、失败降级与持久化；Android/Desktop 宿主适配器本身及真实设备权限弹窗仍需分别集成和验收，不能据此宣称设备定位已实机完成。冷历史扫描会独立查找首次精确启动命令，而不是只检查首条普通消息；如果启动命令只在冷历史中发现，插件不会用当前设备位置冒充事件发生时的位置，该类记录的地点会保持未知。Fork 继承前缀与安装边界之前的事件均不参与候选选择。

## DSH 与 Android 宿主能力核验

DSH 的插件模型通过 Cordis Context 注入宿主服务；当前 YuanQi 依赖清单没有声明位置服务，DSH 官方架构/服务目录也没有确认一个通用 `getCurrentPosition()` 宿主服务。因此 `ctx.yuanqiLocationProvider` 只能视为 YuanQi 约定的可选适配接口，不能当作 DSH 已提供的 API。

当前公开 Android DSH 项目采用 Capacitor 管理界面、Kotlin 原生运行时层与 Ubuntu/PRoot 内的 Node.js DSH 三层结构。公开能力说明列出 Shizuku 和无障碍授权，但没有说明向 Node/Cordis 插件暴露系统定位 API。要实现真正自动定位，仍需 Android 项目增加明确的原生定位桥接：在原生层请求 `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`（按产品策略择一或两者）、通过 Android Location API 获取一次定位、由受控 IPC/启动注入通道提供给 DSH Host，并在授权拒绝、定位关闭、超时、无可用 provider 时返回 unavailable。不能让 PRoot 内的插件自行假设能调用 Android API，也不能把 Shizuku Shell 权限等同于定位权限。

截至本次审查，Android 原生桥接和桌面宿主 Provider 均未实现；本 PR 只完成插件端 Provider 消费契约、验证、失败降级与记录持久化。

## 存储兼容

YuanQi Subject Domain 升级至 v9。旧 v3 WakeRecord 仍可读取（出生地点字段可缺省）；新建记录写入 schema v4，并包含 birth_time 与 birth_location。升级不改写既有唤醒时间，不补造历史地点。
