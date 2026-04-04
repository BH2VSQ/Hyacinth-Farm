# 🌱 Hyacinth Farm Monitor — Server

实时监控风信子种植状态的服务端，基于 Node.js + Express + SQLite，前后端一体。

---

## 快速启动

### 方式1：直接运行（开发/测试）

```bash
npm install
node server.js
```

### 方式2：使用 PM2 部署（生产环境推荐）

```bash
# 安装依赖（包含 PM2）
npm install

# 启动服务
npm run pm2:start

# 查看运行状态
npm run pm2:status

# 查看日志
npm run pm2:logs

# 重启服务
npm run pm2:restart

# 停止服务
npm run pm2:stop

# 删除服务
npm run pm2:delete
```

**PM2 优势：**
- 自动重启（崩溃恢复）
- 日志管理
- 进程监控
- 开机自启动（需配置：`npx pm2 startup` 和 `npx pm2 save`）

服务器启动后会自动生成一个32位的 Session Key 并显示在控制台中。

浏览器访问 `http://localhost:3000`，网页可直接访问，无需认证。

> 默认端口为 3000，可在 server.js 或 ecosystem.config.js 中修改

---

## 安全认证

系统采用 Session Key 认证机制保护 API 接口：

- 服务器首次启动时自动生成32位随机 Session Key
- Session Key 保存在 `.session_key` 文件中（已加入 .gitignore）
- **网页访问无需认证**，可直接访问 `http://localhost:3000`
- **所有 POST API 接口需要认证**（数据上传、事件上报、日志上传等）
- **所有 GET API 接口无需认证**（数据查询、图片列表等，供网页使用）
- ESP32 设备需要在代码中配置 Session Key 用于数据上传

**查看 Session Key：**

```bash
# 方式1：查看服务器启动日志
# 方式2：读取文件
cat .session_key
```

---

## 目录结构

```
hyacinth-farm/
├── server.js          主服务文件（后端 + 静态资源）
├── ecosystem.config.js PM2 配置文件
├── .session_key       Session Key 文件（自动生成，不提交到 Git）
├── package.json
├── README.md
├── public/
│   └── index.html     前端单页应用
├── pic/               图片存储目录（自动创建）
├── logs/              PM2 日志目录（自动创建）
├── sensor.db          传感器数据库（SQLite，自动创建）
├── sensor.log         传感器数据文本日志（自动创建）
├── event.log          设备事件日志（自动创建）
└── debug.log          ESP32 调试日志（自动创建）
```

---

## 前端功能页面

| 标签页   | 功能                                         |
| ----- | ------------------------------------------ |
| **首页** | 最新图像 + 实时传感器数据（12项） + 最近5条设备事件 + 最新10条调试日志预览，通过 SSE 自动刷新 |
| **相册** | 历史照片浏览，按时间倒序排列，支持分页与全屏预览，支持左右切换图片                   |
| **数据** | 6个图表：土壤湿度A&B、光照强度、环境温度&湿度（双Y轴）、环境气压、电压监控（太阳能/电池/供电）、电流监控（太阳能/电池/供电），首次打开自动显示最近1小时实时数据，支持自定义时间范围查询，支持智能降采样，支持导出CSV        |
| **事件** | 完整设备事件历史记录，最新事件显示在顶部，支持实时更新                |
| **日志** | ESP32 调试信息实时显示，支持按级别过滤、自动滚动，最新日志显示在顶部，系统自动保留最近500条日志                |

### 📊 数据图表特性

- **自动加载**：首次打开图表页面自动显示最近1小时的实时数据
- **智能降采样**：查询大时间跨度数据时自动降采样（默认上限50个数据点），确保显示完整时间段的数据趋势
- **可配置上限**：降采样上限可在 `server.js` 中修改 `MAX_CHART_DATA_POINTS` 变量（默认50）
- **动态Y轴**：纵轴范围根据实际数据自动调整，便于观察细微变化
- **双Y轴显示**：环境温度&湿度图表使用双Y轴，左侧为温度（°C），右侧为湿度（%）
- **24小时制**：横轴时间显示为24小时制，格式为 HH:mm:ss
- **图例显示**：多组数据图表显示清晰的图例，使用水平短直线段标识，不可点击
- **精确数值**：纵轴数据保留两位小数，提高数据精度
- **颜色区分**：不同数据系列使用高对比度颜色，易于区分
- **交互优化**：数据点默认显示为小实心圆点，鼠标悬停时变大并显示白色边框
- **页面恢复**：页面休眠或后台运行后自动检测并刷新数据，无需手动刷新

---

## API 接口文档

### 通用规则

- 所有 POST 接口（除 `/api/image` 外）均接收 `Content-Type: application/json`
- 所有接口返回 JSON，成功时包含 `"status": "ok"`，失败时包含 `"status": "error"` 与 `"message"`
- `timestamp` 字段统一使用 **ISO 8601 格式**，例如 `2024-07-15T08:30:00.000Z`；若不传则由服务端以接收时间补充
- **所有 API 接口均需要 Session Key 认证**：
  - 方式1：在 HTTP 头中添加 `X-Session-Key: <your-32-char-key>`
  - 方式2：在 Query 参数中添加 `?session_key=<your-32-char-key>`
  - 认证失败返回 `401 Unauthorized`

---

### 📷 图像接口

#### `POST /api/image` — 上传图像

ESP32-CAM 将 JPEG 原始二进制数据作为请求体发送。

| 参数来源   | 参数名             | 说明                |
| ------ | --------------- | ----------------- |
| Header | `X-Session-Key` | Session Key（必须）   |
| Query  | `timestamp`     | 拍摄时间 ISO 8601（可选） |
| Header | `X-Timestamp`   | 同上，备选方式           |
| Body   | 原始二进制           | JPEG 图像数据         |

**成功响应**

```json
{ "status": "ok", "file": "2024-07-15T08-30-00-000Z.jpg", "timestamp": "2024-07-15T08:30:00.000Z" }
```

**ESP32 示例代码片段（Arduino）**

```cpp
HTTPClient http;
http.begin("http://192.168.1.100:3000/api/image");
http.addHeader("Content-Type", "image/jpeg");
http.addHeader("X-Session-Key", "your-32-character-session-key-here");
http.addHeader("X-Timestamp", getISO8601Time());   // 自行实现时间获取
int code = http.POST(fb->buf, fb->len);
http.end();
```

---

#### `GET /api/images` — 获取图片列表

| Query 参数 | 类型  | 默认  | 说明             |
| -------- | --- | --- | -------------- |
| `limit`  | int | 100 | 每次返回数量（最大 500） |
| `offset` | int | 0   | 分页偏移           |

**响应**

```json
{
  "total": 128,
  "files": ["2024-07-15T08-30-00-000Z.jpg", "2024-07-15T07-00-00-000Z.jpg"]
}
```

图片静态访问地址：`GET /pic/<filename>`

---

### 📊 传感器数据接口

#### `POST /api/data` — 上传传感器数据

**请求体（JSON）**

| 字段                | 类型     | 说明                            |
| ----------------- | ------ | ----------------------------- |
| `timestamp`       | string | ISO 8601 时间戳（必须包含，由 ESP32 提供） |
| `soil_moisture_a` | number | 土壤湿度A（%）                      |
| `soil_moisture_b` | number | 土壤湿度B（%）                      |
| `light`           | number | 光照强度（lx）                      |
| `temperature`     | number | 环境温度（°C）                      |
| `humidity`        | number | 环境湿度（%）                       |
| `pressure`        | number | 环境气压（kPa）                     |
| `solar_voltage`   | number | 太阳能电压（V）                      |
| `battery_voltage` | number | 电池电压（V）                       |
| `supply_voltage`  | number | 供电电压（V）                       |
| `solar_current`   | number | 太阳能电流（mA）                     |
| `battery_current` | number | 电池电流（mA）                      |
| `supply_current`  | number | 供电电流（mA）                      |

> 至少包含一个数值字段。

**示例**

```json
{
  "timestamp": "2024-07-15T08:30:00.000Z",
  "soil_moisture_a": 45.8,
  "soil_moisture_b": 52.3,
  "light": 850,
  "temperature": 22.5,
  "humidity": 65.0,
  "pressure": 101.3,
  "solar_voltage": 5.2,
  "battery_voltage": 3.7,
  "supply_voltage": 5.0,
  "solar_current": 120,
  "battery_current": -50,
  "supply_current": 200
}
```

**成功响应**

```json
{ "status": "ok", "id": 42, "timestamp": "2024-07-15T08:30:00.000Z" }
```

数据同时写入 `sensor.db`（SQLite）和 `sensor.log` 文件。

---

#### `GET /api/data` — 查询传感器数据

| Query 参数     | 类型     | 默认  | 说明                                |
| ------------ | ------ | --- | --------------------------------- |
| `limit`      | int    | 200 | 最大 1000                           |
| `start`      | string | —   | ISO 8601 开始时间                     |
| `end`        | string | —   | ISO 8601 结束时间                     |
| `downsample` | int    | 0   | 降采样间隔，0表示不降采样（自动计算，一般无需手动指定） |

**响应格式**

```json
{
  "data": [...],           // 数据数组
  "total": 5000,           // 时间段内总数据点数
  "downsampled": true,     // 是否进行了降采样
  "downsampleRate": 100,   // 降采样率（每100个点取1个）
  "maxPoints": 50          // 服务器配置的最大数据点数
}
```

**降采样机制**

当查询时间段内的数据点超过配置的上限（默认50个）时，系统会自动进行降采样：
- 计算降采样率 = ⌈总数据点 / 上限⌉
- 均匀采样，确保覆盖完整时间段
- 例如：5000个数据点，上限50 → 降采样率为100 → 每100个点取1个 → 返回50个点

**配置降采样上限**

在 `server.js` 文件顶部修改配置变量：
```javascript
// 图表数据点上限配置（用于降采样）
const MAX_CHART_DATA_POINTS = 50;  // 修改此值可调整上限
```

修改后重启服务器生效。前端会自动同步服务器配置。

返回数组，按 timestamp 降序排列。

---

### 🔔 事件接口

#### `POST /api/event` — 上报设备事件

**请求体（JSON）**

| 字段          | 类型     | 说明               |
| ----------- | ------ | ---------------- |
| `timestamp` | string | ISO 8601 时间戳（必须） |
| `event`     | string | 事件名称，见下表（必须）     |
| `detail`    | string | 附加描述（可选）         |

**建议事件名称**

| event 值           | 含义    |
| ----------------- | ----- |
| `watering_start`  | 开始浇水  |
| `watering_stop`   | 停止浇水  |
| `watering_refill` | 补充浇水  |
| `pump_error`      | 水泵故障  |
| `sensor_error`    | 传感器异常 |
| `boot`            | 设备启动  |

**示例**

```json
{
  "timestamp": "2024-07-15T08:30:00.000Z",
  "event": "watering_start",
  "detail": "soil_moisture=28%"
}
```

---

#### `GET /api/events` — 查询事件记录

| Query 参数 | 默认  | 说明        |
| -------- | --- | --------- |
| `limit`  | 100 | 最大 500，降序 |

---

### 🐛 调试日志接口

#### `POST /api/log` — 上传调试日志

**请求体（JSON）**

| 字段          | 类型     | 说明                                            |
| ----------- | ------ | --------------------------------------------- |
| `timestamp` | string | ISO 8601 时间戳（必须）                              |
| `level`     | string | `DEBUG` / `INFO` / `WARN` / `ERROR`，默认 `INFO` |
| `message`   | string | 日志内容（必须）                                      |

**示例**

```json
{
  "timestamp": "2024-07-15T08:30:00.000Z",
  "level": "INFO",
  "message": "WiFi connected, RSSI=-62"
}
```

日志同时写入 `debug.log` 文件。

---

#### `GET /api/logs` — 查询调试日志

| Query 参数 | 默认  | 说明        |
| -------- | --- | --------- |
| `limit`  | 300 | 最大 1000   |
| `level`  | —   | 按级别过滤（可选） |

---

### ❤️ 心跳接口

#### `POST /api/heartbeat` — ESP32 发送心跳

ESP32 发送心跳时需要包含心跳间隔和下一次预期心跳时间。

**请求体（JSON）**

| 字段              | 类型     | 说明                     |
| --------------- | ------ | ---------------------- |
| `timestamp`     | string | ISO 8601 时间戳（可选）       |
| `interval`      | number | 心跳间隔（秒），默认 60          |
| `nextHeartbeat` | string | 下一次预期心跳时间 ISO 8601（可选） |

**示例**

```json
{
  "timestamp": "2024-07-15T08:30:00.000Z",
  "interval": 60,
  "nextHeartbeat": "2024-07-15T08:31:00.000Z"
}
```

**成功响应**

```json
{ 
  "status": "ok", 
  "timestamp": "2024-07-15T08:30:00.000Z",
  "interval": 60,
  "nextHeartbeat": "2024-07-15T08:31:00.000Z",
  "serverTime": "2024-07-15T08:30:01.234Z"
}
```

**心跳状态判断逻辑：**

- 绿色（正常）：未到预期心跳时间
- 黄色（警告）：超过预期时间 0-15 秒
- 红色（离线）：超过预期时间 15 秒以上

---

#### `GET /api/heartbeat` — 查询心跳状态

返回最后一次心跳的时间、间隔和状态。

**响应**

```json
{
  "status": "ok",
  "lastHeartbeat": "2024-07-15T08:30:00.000Z",
  "nextHeartbeat": "2024-07-15T08:31:00.000Z",
  "interval": 60,
  "elapsedSeconds": 15,
  "nextElapsedSeconds": 5,
  "isOnline": true
}
```

---

### ❤️ 服务状态接口

#### `GET /api/status`

返回服务器基本状态信息，可用于心跳检测。

```json
{
  "status": "ok",
  "uptime": 3825.4,
  "sseClients": 2,
  "picCount": 64,
  "serverTime": "2024-07-15T08:30:00.000Z"
}
```

---

### 🔄 实时推送（SSE）

#### `GET /api/stream`

服务端主动推送事件，前端通过 `EventSource` 订阅，无需轮询。

| 事件名         | 触发时机     | 数据                        |
| ----------- | -------- | ------------------------- |
| `connected` | 连接建立     | `{}`                      |
| `data`      | 新传感器数据到达 | 传感器数据对象                   |
| `image`     | 新图像上传    | `{ filename, timestamp }` |
| `event`     | 新设备事件到达  | 事件对象                      |
| `log`       | 新调试日志到达  | 日志对象                      |

---

## ESP32 时间同步建议

推荐使用 NTP 同步时间后生成 ISO 8601 时间戳：

```cpp
#include <time.h>

void syncNTP() {
  configTime(8 * 3600, 0, "pool.ntp.org"); // UTC+8
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) delay(500);
}

String getISO8601() {
  struct tm t;
  getLocalTime(&t);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S.000+08:00", &t);
  return String(buf);
}
```

---

## 依赖

| 包       | 用途                     |
| ------- | ---------------------- |
| express | HTTP 服务器框架             |
| sql.js  | SQLite 纯 JS 实现（无需原生编译） |
| cors    | 跨域支持                   |

**可选依赖：**
- pm2 - 进程管理器（生产环境推荐）

---

## 生产环境部署建议

### 使用 PM2 管理进程

1. **安装依赖（包含 PM2）**
   ```bash
   npm install
   ```

2. **启动服务**
   ```bash
   npm run pm2:start
   ```

3. **配置开机自启动**
   ```bash
   npx pm2 startup
   npx pm2 save
   ```

4. **监控和管理**
   ```bash
   npm run pm2:status      # 查看状态
   npm run pm2:logs        # 查看日志
   npx pm2 monit           # 实时监控
   npm run pm2:restart     # 重启服务
   npm run pm2:stop        # 停止服务
   npm run pm2:delete      # 删除服务
   ```

### PM2 配置说明

项目包含 `ecosystem.config.js` 配置文件，可自定义：
- 实例数量（默认1个）
- 内存限制（默认500M）
- 环境变量（端口等）
- 日志路径（./logs/）

---

## 新功能说明

### 🌓 白天/黑夜模式切换

- 点击导航栏右侧的主题切换按钮（🌙/☀️）
- 模式选择会自动保存到浏览器 localStorage
- 刷新页面后保持用户选择的主题

### ❤️ 心跳监控

- ESP32 发送心跳时需要包含心跳间隔和下一次预期心跳时间
- 服务端根据 ESP32 提供的信息动态调整监控逻辑
- 页面顶部显示心跳倒计时和状态指示灯：
  - 绿色（脉动）：正常，未到预期心跳时间
  - 黄色：警告，超过预期时间 0-15 秒
  - 红色：离线，超过预期时间 15 秒以上，显示离线时长

**ESP32 心跳示例代码：**

```cpp
// 设置心跳间隔（秒）
const int HEARTBEAT_INTERVAL = 60;
const char* SESSION_KEY = "your-32-character-session-key-here";

// 发送心跳
HTTPClient http;
http.begin("http://192.168.1.100:3000/api/heartbeat");
http.addHeader("Content-Type", "application/json; charset=utf-8");
http.addHeader("X-Session-Key", SESSION_KEY);

// 计算下一次心跳时间
String nextTime = getISO8601Time(HEARTBEAT_INTERVAL);

String payload = "{\"timestamp\":\"" + getISO8601() + "\",\"interval\":" + String(HEARTBEAT_INTERVAL) + ",\"nextHeartbeat\":\"" + nextTime + "\"}";
int code = http.POST(payload);
http.end();
```

### 🎨 Logo 配置

- 页面标题栏 logo：将 `logo.png` 放在项目public目录
- 网页图标（favicon）：将 `logo.ico` 放在项目public目录
- 如果文件不存在，logo 会自动隐藏，不影响功能

---
