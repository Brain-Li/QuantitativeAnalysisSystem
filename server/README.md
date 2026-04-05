# 股票数据分析可视化平台 · 配套后端

技术栈：**Node.js（内置 `node:sqlite`）+ Express + SQLite 文件库**，无需安装独立数据库，无需 `better-sqlite3` 等原生编译依赖（适合 Windows 开发）。

## 环境要求

- **Node.js ≥ 22.13**（需支持 `import { DatabaseSync } from 'node:sqlite'`）
- 首次运行会在 `server/data/app.db` 自动创建 SQLite 文件（可改环境变量 `DATABASE_PATH`）

> `node:sqlite` 在 Node 22+ 中可能标记为 *Experimental*，属正常现象；生产环境请关注 Node 发行说明。

## 安装与启动

```bash
cd server
npm install
npm start
```

开发热重载：

```bash
npm run dev
```

默认监听：**http://127.0.0.1:8787**

可选：复制 `.env.example` 为 `.env` 并修改端口、数据库路径。

## 与前端同域调试（Vite 代理）

项目根目录 `vite.config.ts` 已配置将 `/api` 代理到本后端（默认 `http://127.0.0.1:8787`）。

**前端已对接**：登录成功后会请求 `POST /api/auth/login` 并保存数据服务 Token；数据导入在 Token 有效时走 `POST /api/datasets/upload` + 拉取行数据，否则仍使用浏览器本地 `xlsx` 解析（离线可用）。

生产环境若前后端不同源，可在前端根目录配置环境变量 **`VITE_API_BASE`**（例如 `https://api.example.com`），未设置时请求为同源相对路径 `/api/...`。

本地同时启动：

1. 终端 A：`cd server && npm start`
2. 终端 B：项目根目录 `npm run dev`

## 认证说明

| 项目 | 值 |
|------|-----|
| 用户名 | `admin`（可用环境变量 `ADMIN_USER` 覆盖） |
| 密码 | `admin123`（与现有前端 `authApi` 演示一致） |

登录成功后，后续接口在请求头携带：

```http
Authorization: Bearer <token>
```

本地调试可将 `DISABLE_AUTH=1` 写入 `.env` 跳过鉴权（**切勿用于公网**）。

---

## API 一览（均为 JSON）

### `GET /api/health`

健康检查，无需登录。

### `POST /api/auth/login`

请求体：

```json
{ "username": "admin", "password": "admin123" }
```

成功：

```json
{ "ok": true, "token": "..." }
```

### `GET /api/datasets`

列出所有数据集（需登录）。

### `GET /api/datasets/:id`

数据集元数据（字段列表、行数等）。

### `POST /api/datasets/upload`

- `Content-Type: multipart/form-data`
- 字段名：**`file`**（Excel `.xlsx` / `.xls`）
- 首行表头即字段名；**整行以 JSON 存入 `payload_json`，列增删改无需改表结构**
- 按 **（数据集 ID + 代码 + 日期）** 唯一；重复则更新该行
- “代码 / 日期” 通过 `src/utils/rowExtract.js` 中关键字匹配解析（可扩展关键字，无需改数据库）

### `GET /api/datasets/:id/rows`

分页与筛选（需登录）。

| 查询参数 | 说明 |
|----------|------|
| `page` | 默认 `1` |
| `pageSize` | 默认 `100`，最大 `500` |
| `code` | 股票代码 |
| `dateFrom` / `dateTo` | 日期区间（与行内 `date_str` 比较，格式建议 `YYYY-MM-DD`） |
| `sortBy` | `date` \| `code` \| `name` \| `volatility` |
| `sortDir` | `asc` \| `desc` |
| `filters` | URL 编码的 JSON 数组，见下 |

`filters` 示例（需 `encodeURIComponent`）：

```json
[
  { "field": "总分", "op": "gte", "value": 10 },
  { "field": "涨跌幅", "op": "like", "value": "%-%" }
]
```

支持运算符：`eq` `ne` `gt` `gte` `lt` `lte` `like`（对 `payload_json` 内对应字段做 `json_extract`）。

响应：

```json
{
  "ok": true,
  "total": 5500,
  "page": 1,
  "pageSize": 100,
  "data": [ { "...": "..." } ]
}
```

`data` 中每行为与前端 `StockData` 兼容的扁平对象。

### `DELETE /api/datasets/:id`

删除指定数据集及其全部行。

### `POST /api/admin/clear-all`

清空**所有**数据集与行数据（表结构保留）。

---

## 数据模型与性能

- **datasets**：数据集元信息与 `fields_json`（列名列表）
- **stock_rows**：`code`、`name`、`date_str`、`volatility`（便于索引与排序）、`payload_json`（完整一行）
- 索引：`dataset_id + code`、`dataset_id + date_str`、`dataset_id + name`、`dataset_id + volatility`
- WAL 模式、批量事务写入，适合约 **5500 行 × 多列** 日更场景

## 腾讯云 EdgeOne / 静态托管

- 前端静态资源可由 EdgeOne 加速；**API 需指向实际 Node 运行地址**（云函数、轻量应用服务器、或容器内 `node src/index.js`）。
- 将环境变量 `PORT` 与平台要求一致，并配置 HTTPS 与 CORS（本服务已 `cors({ origin: true })`）。

## 清空与重新上传

1. 调用 `POST /api/admin/clear-all`，或  
2. 逐个 `DELETE /api/datasets/:id`，再上传新 Excel。

---

## 目录结构

```
server/
  package.json
  .env.example
  src/
    index.js          # 入口
    db.js             # SQLite 初始化 + 事务
    middleware/auth.js
    routes/auth.js
    routes/datasets.js
    routes/admin.js
    utils/excelParse.js
    utils/rowExtract.js
    utils/queryFilters.js
  data/
    app.db            # 运行后生成（勿提交）
```
