# YuanQi 唤醒出生资料与地点采集

## 语义约定

YuanQi 的出生时间不是用户的个人出生时间。它是用户首次在 DSH 会话中直接、单独、精确发送启动命令“启动元气”或“启动元炁”时，对应 DSH `user/message` SessionEvent 的 `time`（Unix 毫秒）。此前可以有普通消息；首次普通消息不会消耗唤醒资格。持久化时转换为 UTC ISO-8601，分别写入 `WakeRecord.birth_time` 与兼容字段 `WakeRecord.occurred_at`。不得用插件加载时间、模型生成时间或后续重试时间替代。

出生地点表示启动瞬间设备/宿主所在位置。插件优先使用可注入的 `ctx.yuanqiLocationProvider.getCurrentPosition()`；未注入时，如果 Node 进程存在 `DSH_BRIDGE_TOKEN`，Android 适配器会通过固定回环地址 `http://127.0.0.1:3083/dev/location` 读取本机 Android Host 的定位结果，并在请求头中携带 `X-DSH-Token`。不会访问外网，也不读取 IP 定位。适配器统一返回：

- `latitude`、`longitude`：WGS84 十进制度坐标；
- `accuracy_meters`：可选水平精度；
- `place_label`：可选反向地理编码地点名；
- `time_zone_id`：可选 IANA 时区；
- `captured_at`：适配器采集坐标的 ISO-8601 时间。

插件先将首次启动事件、原始事件时间和 `birth_location.status=pending` 持久化，再异步执行一次有时限的地点采集；地点采集不阻塞 `session/flush`。采集完成后只允许将 `pending` 状态补写为 `captured` 或 `unavailable`，后续消息和重复补写不能覆盖已完成地点。若进程在采集期间退出，重启后可恢复 `pending` 并重新尝试；仍须验证定位时间与原始唤醒事件相差不超过 60 秒，历史事件不会使用当前坐标伪装。定位权限被拒、超时、适配器不存在或返回无效数据时，出生时间仍已持久化，地点最终记录为 `unavailable`，不猜测 IP 地址、不使用服务器所在地，也不伪造坐标。

## Host 接入要求

`yuanqiLocationProvider` 是 YuanQi 定义的可选宿主能力接口，不是已确认存在于所有 DSH 版本的内建 API。Android 宿主应使用系统定位权限与系统定位服务实现该适配器；Desktop 宿主应通过用户授权的位置提供能力实现。适配器应在授权缺失时返回错误，由插件记录为未知地点。宿主不得把 IP 推断位置伪装成 GPS/系统定位。

Android 接入已对接项目 `qingjian0/Deepseek-Harness-Local-Android` 现有的 `GET /dev/location?fresh=true` 路由。该路由受 Android `CapabilityGate.LOCATION` 与系统定位权限双重控制；默认能力开关关闭，用户必须在 Android 设备能力设置中显式启用“当前地理位置”，授予粗略或精确定位权限，并开启系统位置服务。Android 11+ 会通过 `LocationManager.getCurrentLocation()` 对启用的 GPS/network/passive provider 发起并行单次定位请求，原生等待最多 8 秒；若无新 fix 或等待超时才回退到缓存位置。Android 10 及更早版本仅使用缓存路径。YuanQi 额外要求定位结果年龄不超过 60 秒，且定位采集时间与 DSH 启动事件时间相差不超过 60 秒；不满足、无权限、开关关闭、无 fix 或桥接超时都会将地点记为 unavailable，但出生时间仍正常落库。坐标采集时间优先使用 Android 原生返回的 `fix_time_ms`；同时在响应时按该时间戳重新计算 `age_ms`，不把 HTTP 查询时间冒充 GPS fix 时间。

冷历史扫描会独立查找首次精确启动命令，而不是只检查首条普通消息；如果启动命令只在冷历史中发现，插件不会用当前设备位置冒充事件发生时的位置，该类记录的地点会保持未知。Fork 继承前缀与安装边界之前的事件均不参与候选选择。

## DSH 与 Android 宿主能力核验

DSH 官方插件模型通过 Cordis Context 注入宿主服务；并不存在可供所有 DSH 插件直接调用的通用 GPS API。这里对接的是用户的 Android 宿主项目自身提供的原生桥接，而不是宣称 DSH 核心自带定位服务。

`qingjian0/Deepseek-Harness-Local-Android` 的 `AgentBridge.kt` 已将 `GET /dev/location` 注册到本机桥；`LocationCap.kt` 通过 Android `LocationManager` 读取系统位置缓存，`CapabilityGate.LOCATION` 要求独立用户开关和 `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` 权限。`AgentBridge` 在本机回环 HTTP 请求上校验 `X-DSH-Token`，`EngineConfig` 将同一启动周期 token 注入引擎进程环境变量 `DSH_BRIDGE_TOKEN`。YuanQi 通过这个受控本机通道读取位置，不需要另加 Android 权限，也不绕过用户开关。

当前 Android 桥接支持有界单次定位请求；Android 11+ 使用 `getCurrentLocation()`，旧版本或新定位超时才回退到 last-known fix。因此 YuanQi 对定位结果年龄和事件时间差增加 60 秒限制；该策略优先保证出生地点时间相关性，宁可记为未知也不使用陈旧坐标。插件请求等待上限为 11 秒（包含自定义 Host Provider 的统一超时保护），覆盖 Android 原生定位的 8 秒等待与响应开销。Android 宿主侧的权限弹窗、用户开关和真机定位功能属于既有能力，但本轮未在目标手机上完成端到端实机验收。Desktop Host 没有等价 Provider，仍需独立实现。

## 存储兼容

YuanQi Subject Domain 升级至 v10。旧 v3 WakeRecord 仍可读取（出生地点字段可缺省）；新建记录写入 schema v4，并包含 birth_time 与 birth_location；地点状态支持 `pending`、`captured` 和 `unavailable`，仅允许 pending 完成一次。升级不改写既有唤醒时间，不补造历史地点。
