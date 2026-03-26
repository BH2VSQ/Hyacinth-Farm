# 🌱 Hyacinth Farm Monitor — Server

实时监控风信子种植状态的服务端，基于 Node.js + Express + SQLite，前后端一体。

---

## 快速启动

```bash
npm install
node server.js
```

浏览器访问 `http://localhost:3000`

> 默认端口为 3000，可通过环境变量 `PORT` 修改：`PORT=8080 node server.js`

---

## 目录结构

```
hyacinth-farm/
├── server.js          主服务文件（后端 + 静态资源）
├── package.json
├── README.md
├── public/
│   └── index.html     前端单页应用
├── pic/               图片存储目录（自动创建）
├── sensor.db          传感器数据库（SQLite，自动创建）
├── sensor.log         传感器数据文本日志（自动创建）
├── event.log          设备事件日志（自动创建）
└── debug.log          ESP32 调试日志（自动创建）
```

---

## 前端功能页面

| 标签页      | 功能                                         |
| -------- | ------------------------------------------ |
| **仪表板**  | 最新图像 + 实时传感器数据 + 设备事件，通过 SSE 自动刷新，无需手动刷新页面 |
| **相册**   | 历史照片浏览，按时间倒序排列，支持分页与全屏预览                   |
| **数据图表** | 温度、环境湿度、土壤湿度、气压历史折线图，支持自定义时间范围             |
| **调试日志** | ESP32 调试信息实时显示，支持按级别过滤、自动滚动                |

---

## API 接口文档

### 通用规则

- 所有 POST 接口（除 `/api/image` 外）均接收 `Content-Type: application/json`
- 所有接口返回 JSON，成功时包含 `"status": "ok"`，失败时包含 `"status": "error"` 与 `"message"`
- `timestamp` 字段统一使用 **ISO 8601 格式**，例如 `2024-07-15T08:30:00.000Z`；若不传则由服务端以接收时间补充

---

### 📷 图像接口

#### `POST /api/image` — 上传图像

ESP32-CAM 将 JPEG 原始二进制数据作为请求体发送。

| 参数来源   | 参数名           | 说明                |
| ------ | ------------- | ----------------- |
| Query  | `timestamp`   | 拍摄时间 ISO 8601（可选） |
| Header | `X-Timestamp` | 同上，备选方式           |
| Body   | 原始二进制         | JPEG 图像数据         |

**成功响应**

```json
{ "status": "ok", "file": "2024-07-15T08-30-00-000Z.jpg", "timestamp": "2024-07-15T08:30:00.000Z" }
```

**ESP32 示例代码片段（Arduino）**

```cpp
HTTPClient http;
http.begin("http://192.168.1.100:3000/api/image");
http.addHeader("Content-Type", "image/jpeg");
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

| 字段              | 类型     | 说明                            |
| --------------- | ------ | ----------------------------- |
| `timestamp`     | string | ISO 8601 时间戳（必须包含，由 ESP32 提供） |
| `temperature`   | number | 温度（°C）                        |
| `humidity`      | number | 环境湿度（%）                       |
| `soil_moisture` | number | 土壤湿度（%）                       |
| `pressure`      | number | 气压（hPa）                       |
| `light`         | number | 光照强度（预留）                      |

> 至少包含一个数值字段。

**示例**

```json
{
  "timestamp": "2024-07-15T08:30:00.000Z",
  "temperature": 22.5,
  "humidity": 65.2,
  "soil_moisture": 43.8,
  "pressure": 1013.2
}
```

**成功响应**

```json
{ "status": "ok", "id": 42, "timestamp": "2024-07-15T08:30:00.000Z" }
```

数据同时写入 `sensor.db`（SQLite）和 `sensor.log` 文件。

---

#### `GET /api/data` — 查询传感器数据

| Query 参数 | 类型     | 默认  | 说明            |
| -------- | ------ | --- | ------------- |
| `limit`  | int    | 200 | 最大 1000       |
| `start`  | string | —   | ISO 8601 开始时间 |
| `end`    | string | —   | ISO 8601 结束时间 |

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

// 发送心跳
HTTPClient http;
http.begin("http://192.168.1.100:3000/api/heartbeat");
http.addHeader("Content-Type", "application/json; charset=utf-8");

// 计算下一次心跳时间
String nextTime = getISO8601Time(HEARTBEAT_INTERVAL);

String payload = "{\"timestamp\":\"" + getISO8601() + "\",\"interval\":" + String(HEARTBEAT_INTERVAL) + ",\"nextHeartbeat\":\"" + nextTime + "\"}";
int code = http.POST(payload);
http.end();
```

### 🎨 Logo 配置

- 页面标题栏 logo：将 `logo.png` 放在项目根目录
- 网页图标（favicon）：将 `logo.ico` 放在项目根目录
- 如果文件不存在，logo 会自动隐藏，不影响功能

---

## License

MIT
