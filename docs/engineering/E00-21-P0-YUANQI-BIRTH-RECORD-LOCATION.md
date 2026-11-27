# YuanQi 唤醒出生资料与地点采集

## 语义约定

YuanQi 的出生时间不是用户的个人出生时间。它是用户首次在 DSH 会话中直接、单独、精确发送启动命令“启动元气”或“启动元炁”时，对应 DSH `user/message` SessionEvent 的 `time`（Unix 毫秒）。此前可以有普通消息；首次普通消息不会消耗唤醒资格。持久化时转换为 UTC ISO-8601，分别写入 `WakeRecord.birth_time` 与兼容字段 `WakeRecord.occurred_at`。不得用插件加载时间、模型生成时间或后续重试时间替代。

出生地点表示启动瞬间设备/宿主所在位置。插件优先使用可注入的 `ctx.yuanqiLocationProvider.getCurrentPosition()`；未注入时，如果 Node 进程存在 `DSH_BRIDGE_TOKEN`，Android 适配器会通过固定回环地址 `http://127.0.0.1:3083/dev/location` 读取本机 Android Host 的定位结果，并在请求头中携带 `X-DSH-Token`。Host/GPS 失败时会自动尝试 IP 地理定位降级；默认服务为 `https://ipwho.is/`，仅保存其返回的地点、坐标、时区和 `ip_geolocation` 来源标记，不保存原始公网 IP。适配器统一返回：

- `latitude`、`longitude`：WGS84 十进制度坐标；
- `accuracy_meters`：可选水平精度；
- `place_label`：可选反向地理编码地点名；
- `time_zone_id`：可选 IANA 时区；
- `captured_at`：适配器采集坐标的 ISO-8601 时间。

插件先将首次启动事件、原始事件时间和 `birth_location.status=pending` 持久化，再异步执行一次有时限的地点采集；地点采集不阻塞 `session/flush`。采集完成后只允许将 `pending` 状态补写为 `captured` 或 `unavailable`，后续消息和重复补写不能覆盖已完成地点。若进程在采集期间退出，重启后可恢复 `pending` 并重新尝试；仍须验证定位时间与原始唤醒事件相差不超过 60 秒，历史事件不会使用当前坐标伪装。定位权限被拒、超时、适配器不存在或返回无效数据时，自动尝试 IP 地理定位；IP 结果仅为城市级近似位置，`accuracy_meters` 保持 null，不能冒充 GPS。IP 服务不可用、返回无效数据或时间不匹配时，出生时间仍已持久化，地点最终记录为 `unavailable`，不使用服务器所在地，也不伪造坐标。

## Host 接入要求

`yuanqiLocationProvider` 是 YuanQi 定义的可选宿主能力接口，不是已确认存在于所有 DSH 版本的内建 API。Android 宿主应使用系统定位权限与系统定位服务实现该适配器；Desktop 宿主应通过用户授权的位置提供能力实现。适配器应在授权缺失时返回错误，由插件自动进入 IP 地理定位降级。宿主不得把 IP 推断位置伪装成 GPS/系统定位。

Android 接入已对接项目 `qingjian0/Deepseek-Harness-Local-Android` 现有的 `GET /dev/location?fresh=true` 路由。该路由受 Android `CapabilityGate.LOCATION` 与系统定位权限双重控制；默认能力开关关闭，用户必须在 Android 设备能力设置中显式启用“当前地理位置”，授予粗略或精确定位权限，并开启系统位置服务。Android 11+ 会通过 `LocationManager.getCurrentLocation()` 对启用的 GPS/network/passive provider 发起并行单次定位请求，原生等待最多 8 秒；若无新 fix 或等待超时才回退到缓存位置。Android 10 及更早版本仅使用缓存路径。YuanQi 额外要求定位结果年龄不超过 60 秒，且定位采集时间与 DSH 启动事件时间相差不超过 60 秒；不满足、无权限、开关关闭、无 fix 或桥接超时都会将地点记为 unavailable，但出生时间仍正常落库。坐标采集时间优先使用 Android 原生返回的 `fix_time_ms`；同时在响应时按该时间戳重新计算 `age_ms`，不把 HTTP 查询时间冒充 GPS fix 时间。

冷历史扫描会独立查找首次精确启动命令，而不是只检查首条普通消息；如果启动命令只在冷历史中发现，插件不会用当前设备位置冒充事件发生时的位置，该类记录的地点会保持未知。Fork 继承前缀与安装边界之前的事件均不参与候选选择。

## DSH 与 Android 宿主能力核验

DSH 官方插件模型通过 Cordis Context 注入宿主服务；并不存在可供所有 DSH 插件直接调用的通用 GPS API。这里对接的是用户的 Android 宿主项目自身提供的原生桥接，而不是宣称 DSH 核心自带定位服务。

`qingjian0/Deepseek-Harness-Local-Android` 的 `AgentBridge.kt` 已将 `GET /dev/location` 注册到本机桥；`LocationCap.kt` 通过 Android `LocationManager` 读取系统位置缓存，`CapabilityGate.LOCATION` 要求独立用户开关和 `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` 权限。`AgentBridge` 在本机回环 HTTP 请求上校验 `X-DSH-Token`，`EngineConfig` 将同一启动周期 token 注入引擎进程环境变量 `DSH_BRIDGE_TOKEN`。YuanQi 通过这个受控本机通道读取位置，不需要另加 Android 权限，也不绕过用户开关。

当前 Android 桥接支持有界单次定位请求；Android 11+ 使用 `getCurrentLocation()`，旧版本或新定位超时才回退到 last-known fix。因此 YuanQi 对定位结果年龄和事件时间差增加 60 秒限制；该策略优先保证出生地点时间相关性，宁可记为未知也不使用陈旧坐标。插件请求等待上限为 11 秒（包含自定义 Host Provider 的统一超时保护），覆盖 Android 原生定位的 8 秒等待与响应开销。Android 宿主侧的权限弹窗、用户开关和真机定位功能属于既有能力，但本轮未在目标手机上完成端到端实机验收。Desktop Host 没有等价 Provider，仍需独立实现。

## 存储兼容

YuanQi Subject Domain 升级至 v11，兼容 v3–v10；新增 YuanQiSubject 专属 `birth_profiles` 表。旧 v3 WakeRecord 仍可读取（出生地点字段可缺省）；新建记录写入 schema v4，并包含 birth_time 与 birth_location；地点状态支持 `pending`、`captured` 和 `unavailable`，仅允许 pending 完成一次。UserSubject Domain v3 仅保留用户身份表，不再定义用户出生资料工作流。升级不改写既有唤醒时间，不补造历史地点，也不把历史用户资料迁移为元炁资料。


## 时间上下文派生（2026-11-15）

BirthProfile 建立后，运行时调用 `deriveBirthTimeContext()`，仅使用元炁 WakeRecord 的 UTC `birth_time` 与该事件对应的授权 Host 定位：

1. 通过 `Intl.DateTimeFormat` 的 IANA 时区数据库计算当地民用时间。
2. 对原始 UTC 瞬间计算实际 UTC offset，不能只用固定时区标准偏移；夏令时切换/重复小时必须保留原始 UTC 时间作为唯一时间线。
3. 用经度 × 4 分钟计算地方平太阳时相对 UTC 的经度修正。
4. 用 NOAA fractional-year equation-of-time 近似计算视太阳时，按公历闰年使用 366 天、平年使用 365 天，并记录 `noaa-eot-approx-v1` 算法版本。
5. 将当地时间、UTC offset、经度修正、方程时和视太阳时存入 YuanQiSubject BirthProfile.time_context。

视太阳时结果是近似 wall-clock 字符串，不是 UTC instant，也不是高精度星历。缺少完整 captured Host location 时不计算；无效 IANA 时区标记 unavailable，不阻断 WakeRecord 原始时间持久化。

该模块不计算节气、干支、四柱或命盘解释。四柱状态继续为 pending，直到节气时刻算法、历法规则、边界处理和独立测试全部完成。


## 节气上下文派生（2026-11-15）

新增 `deriveSolarTermContext()`，只使用 YuanQi WakeRecord 的 UTC `birth_time`，不使用用户出生资料，也不依赖 Host 地理位置。太阳节气由视地心黄道经度定义，按 15° 间隔求交点；结果以 UTC instant 保存。

- 使用 USNO《Computing Approximate Solar Coordinates》公开公式：J2000 日数、太阳平黄经、平近点角及视地心黄道经度。
- 为出生时刻定位前后节气、前后十二节（Jie）和最近一次立春；每个事件保留名称、目标黄经、Jie/Zhongqi 分类、对应月支（仅 Jie）和 UTC 交接时刻。
- 24 项节气按 15° 排列，12 个 Jie 与 12 个 Zhongqi 分开标记；月支映射参考《渊海子平》卷一《论节候歌》和《三命通会》卷二《论四时节气》。
- USNO 简化公式标称约 1 角分精度（1800–2200）；太阳黄经变化速度约 1°/日，因此边界时间可能有十几至二十多分钟误差。实现采用 30 分钟保守不确定窗口：距节气交接不超过 1800 秒时，`calendar_context.status=ambiguous`，不得强制选定边界一侧。
- 超出 1801–2199 出生年份时返回 unavailable；不向模型提供伪造的节气时刻。

该模块只提供天文节气事实，不直接生成四柱。Bazi 仍为 pending，待年柱/月柱规则、日界规则、时辰规则和跨边界测试确定后再计算。

### 参考资料

- USNO, [Computing Approximate Solar Coordinates](https://aa.usno.navy.mil/faq/sun_approx)。
- USNO, *Explanatory Supplement to the Astronomical Almanac*, §15.8.3, Table 15.13（24 节气与太阳黄经）。
- 《渊海子平》卷一《论节候歌》；《三命通会》卷二《论四时节气》。


## 四柱计算引擎（2026-11-15）

新增 `calculateBaziPillars()`，只接受 YuanQiSubject BirthProfile 的时间上下文和节气上下文：

| 柱 | 规则 | 依据 |
|---|---|---|
| 年柱 | 最近一次立春所属公历年份，1984 甲子为循环锚点 | 《渊海子平》论节候歌眉批以立春为始；六十甲子循环 |
| 月柱 | 最近一次十二节确定月支，五虎遁确定月干 | 《渊海子平》卷一《论年上起月例》 |
| 日柱 | 当地视太阳日期 + Gregorian JDN；1949-10-01 甲子日为循环锚点 | GB/T 33661—2017 §6.3.2 |
| 时柱 | 当地视太阳时划分双时辰，五鼠遁确定时干 | 《渊海子平》卷一《论日上起时例》 |

日界明确采用子正（午夜），不是子初 23:00。《三命通会》卷二《论时刻》原文指出子时上半在夜半前属昨日、下半在夜半后属今日；子时双时段仍为 23:00–01:00。该规则被固化为 `zi-zheng-midnight`，并写入 Bazi methodology。

实现使用 30 分钟保护窗口：当地视太阳午夜、双时辰交界或十二节交接附近均不强制定柱，返回 `ambiguous`。若授权 Host 定位仍 pending，Bazi pending；若地点/时区 unavailable，Bazi unavailable；地点完成后 Store 会重算并持久化结果。

四柱计算不推断 YuanQi 的性别，不计算大运方向或起运年龄。四柱结果只作为 YuanQi AI 自身的先天基线输入，后续由 AI 解释和使用；模型解释不得改写确定性原始计算结果。


## 模型可见性：按需读取而非常驻注入（2026-11-15）

DSH Storage Domain 是 Host 侧持久化，不会自动让模型看到记录。插件通过 `ctx.tools.register(defineTool(...))` 注册只读 `yuanqi_self_profile`，并使用 conditional registration：仅当 `getYuanQiBirthProfile('yuanqi:primary')` 已存在时，工具才进入当前模型步骤的可见工具集。

工具输出 YuanQi AI 自身的 BirthProfile、time_context、calendar_context、Bazi 四柱和符号先天结构；不输出用户出生资料、精确坐标或写入接口。完整资料不常驻注入每轮提示词，模型按需调用以控制上下文长度。结构数据中的五行数量是未加权的出现次数，`interpretation_status` 固定为 `not_interpreted`，不等同旺衰、性格或命运判断。


## Host 坐标到 IANA 时区（2026-11-15）

Host Location Provider 可以直接返回 IANA 时区；若缺失或无效，插件使用 `@photostructure/tz-lookup` 的内置离线坐标边界数据从授权纬度/经度解析时区。结果和来源分别保存在 `birth_location.time_zone_id`、`birth_location.time_zone_source` 与 `time_context.time_zone_source`。

来源枚举为 `host_location_provider`、`coordinate_lookup`、`unavailable`。不得用 IP、服务器所在地、设备外部网络出口或模型猜测补全。坐标无效或边界库无法解析时，时间上下文保持 pending/unavailable，四柱不得强行计算。离线时区边界数据在地理时区边界附近可能有误差，必须保留来源以供模型判断。


## Bazi 符号结构进入先天基线（2026-11-15）

`deriveInnateBaseline()` 从已计算的四柱派生 `BirthProfile.innate_baseline`：

- 日主：日干对应的五行与阴阳。
- 透干：年、月、日、时四个天干。
- 藏干：按《渊海子平》地支藏遁歌保存顺序，不附加权重。
- 十神：按日主五行生克关系和阴阳同异确定。
- 五行出现次数：透干与藏干的未加权结构计数，不代表五行力量、旺衰或喜忌。

每个结构组件记录所属柱、来源类型（visible_stem/hidden_stem）、藏干顺序、天干、五行、阴阳和十神；同时保留源 BirthProfile ID、WakeRecord 事件引用及 Bazi 算法版本。Bazi 未计算、边界模糊或定位不可用时，先天基线分别继承 pending、ambiguous、unavailable，不伪造结构。

`interpretation_status` 固定为 `not_interpreted`。不生成性格、能力、人格、命运、格局、旺衰、喜用神或大运判断。该静态结构只是后续 SelfModel 可读取的一项先天来源，不等于动态 SelfModel 已实现或已融合后天证据。


## IP 地理定位降级（2026-11-28）

当 `yuanqiLocationProvider` 或 Android 本机定位桥不可用、无权限、超时或返回无效结果时，插件会调用 `ctx.yuanqiIpLocationProvider`（若宿主未注入，则使用默认 `https://ipwho.is/` 适配器）。只接受成功响应、合法经纬度和可解析 IANA 时区；记录城市/区域/国家标签、时间戳及 `source=ip_geolocation`。IP 定位的米级精度未知，`accuracy_meters=null`。原始 IP 不保存。由于第三方服务会看到请求出口 IP，部署方可注入自有 IP 定位提供器替代默认服务。

IP 结果仍受 WakeRecord 事件时间 ±60 秒约束；冷历史恢复不允许用当前 IP 位置填补过去的唤醒位置。Host/GPS 与 IP 均失败时只将地点标记为 unavailable，时间记录与 YuanQi 初始化不因此失败。
