# YuanQi 唤醒出生资料与地点采集

## 语义约定

YuanQi 的出生时间不是用户的个人出生时间。它是用户首次在 DSH 会话中直接发送精确启动命令“启动元气”或“启动元炁”时，对应 DSH `user/message` SessionEvent 的 `time`（Unix 毫秒）。持久化时转换为 UTC ISO-8601，分别写入 `WakeRecord.birth_time` 与兼容字段 `WakeRecord.occurred_at`。不得用插件加载时间、模型生成时间或后续重试时间替代。

出生地点表示启动瞬间设备/宿主所在位置。插件通过可选的宿主适配器 `ctx.yuanqiLocationProvider.getCurrentPosition()` 读取。适配器应返回：

- `latitude`、`longitude`：WGS84 十进制度坐标；
- `accuracy_meters`：可选水平精度；
- `place_label`：可选反向地理编码地点名；
- `time_zone_id`：可选 IANA 时区；
- `captured_at`：适配器采集坐标的 ISO-8601 时间。

插件会验证坐标、精度和采集时间。定位权限被拒、超时、适配器不存在或返回无效数据时，出生时间仍正常落库，地点明确记录为 `unavailable`，不猜测 IP 地址、不使用服务器所在地，也不伪造坐标。地点数据只在首次启动事件处理时采集一次；后续消息、重启和重放不得覆盖出生资料。

## Host 接入要求

`yuanqiLocationProvider` 是 YuanQi 定义的可选宿主能力接口，不是已确认存在于所有 DSH 版本的内建 API。Android 宿主应使用系统定位权限与系统定位服务实现该适配器；Desktop 宿主应通过用户授权的位置提供能力实现。适配器应在授权缺失时返回错误，由插件记录为未知地点。宿主不得把 IP 推断位置伪装成 GPS/系统定位。

当前代码已完成插件侧适配器读取、字段校验、失败降级与持久化；Android/Desktop 宿主适配器本身及真实设备权限弹窗仍需分别集成和验收，不能据此宣称设备定位已实机完成。

## 存储兼容

YuanQi Subject Domain 升级至 v9。旧 v3 WakeRecord 仍可读取（出生地点字段可缺省）；新建记录写入 schema v4，并包含 birth_time 与 birth_location。升级不改写既有唤醒时间，不补造历史地点。
