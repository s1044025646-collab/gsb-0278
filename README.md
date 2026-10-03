# 后缀数组重复片段定位与 LCP 解释后端

本地单文档重复片段分析服务：输入一段 Unicode 文本，自行实现**前缀倍增法**构建后缀数组（SA），由 SA 用 **Kasai 算法**生成相邻后缀的最长公共前缀数组（LCP），找出文本内部**至少出现两次的最长连续片段**。只做 API 与 CLI，无前端。

- 技术栈：TypeScript + Node.js（≥ 22.5，使用内置 `node:sqlite`）+ SQLite，纯本地运行，不依赖 Docker / WSL / 外部服务。
- 只做同一文本内部的连续重复分析，**允许出现区间重叠**；不做词典纠错、分词检索、跨文档相似度、三方合并或 DNA 组装。
- 保留原始文本：不做大小写折叠、不做 Unicode 归一化；含**孤立代理项**（lone surrogate）的输入按公开规则明确拒绝（错误码 `LONE_SURROGATE`）。

## 快速开始

```powershell
npm install        # 安装开发依赖（typescript / tsx）
npm run build      # 编译到 dist/
npm test           # 运行全部测试（含朴素枚举交叉验证）
npm start          # 启动 HTTP API（默认自动选择空闲端口）
npm run demo       # 内置演示：banana / 中文 / 表情 / 全相同字符 / 并列最长
```

数据保存在项目内 `data\app.db`（可用环境变量 `SA_DATA_DIR` 覆盖）。重启后可直接读取已保存的文档、索引与分析结果。

## 字符口径：码点 vs UTF-16

本系统内部一律按 **Unicode 码点（code point）** 计数与排序：

- 字符比较按码点值进行；文本位置和长度均为码点计数。
- 一个表情（如 `😀`，U+1F600）算 **1 个码点**，不会被拆成半个代理对。
- 同时返回与 JavaScript 字符串下标对应的 **UTF-16 偏移** 映射：`startsCp`（码点起点）、`startsUtf16`（UTF-16 起点）、`utf16Ranges`（UTF-16 区间）。例如 `"a😀b😀a😀b"` 中第二个 `a😀b` 的码点起点是 4，UTF-16 起点是 6。

## 算法说明

- **后缀数组**：前缀倍增法。初始秩为码点值离散化；第 k 轮以 `(rank[i], rank[i+k])` 为键排序，**越过文本末尾的第二秩使用独立哨兵 -1**（小于一切有效秩）。只对**非空后缀**（位置 `0..n-1`）建索引，不加入空后缀。未使用任何现成后缀数组库，也未对全部后缀切片后整体排序。
- **LCP**：Kasai 算法，`lcp[r]` 为排名第 r 与第 r-1 的后缀的最长公共前缀长度（码点）。
- **最长重复**：取相邻 LCP 的最大值 `maxLen`；为 0 时明确返回“不存在非空重复片段”（`exists=false`）。通过 **LCP ≥ maxLen 的相邻连续分组**收集每个片段的**完整起点集合**（组内所有后缀的起点），而不是只报告某一对相邻后缀。相同最大长度的多个不同片段按码点字典序列出并去重。
- 结果数量有公开上限（默认 100，`--limit` / `?limit=` 可调），截断时返回 `totalFragments`（总量）与 `truncated: true`。
- 小文本（≤ 64 码点）在索引中保留**每一轮倍增的秩快照**（`rounds`）便于解释；长文本只保存轮次数量摘要（`roundsSummary`），避免解释数据爆炸。

## HTTP API

`npm start` 启动（`node dist/cli.js serve --port 8000` 可指定端口；端口被占用时自动选择空闲端口）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/documents` | 导入文档，body `{"text": "..."}` |
| PUT | `/documents/:id` | 修改原文，**创建新版本**（旧版本与其索引保留，旧位置不会套用到新文档） |
| POST | `/documents/:id/index?version=N` | 构建后缀数组与 LCP 索引 |
| GET | `/documents/:id/suffixes?offset=&limit=` | 查看后缀顺序与 LCP（含码点/UTF-16 起点、后缀预览、倍增轮次） |
| GET | `/documents/:id/longest-repeat?limit=` | 最长重复片段查询（结果缓存于 SQLite） |
| GET | `/documents/:id/lcp?i=&j=` | 查询两个指定后缀（码点起点 i、j）的公共前缀 |
| GET | `/documents/:id/report` | 导出完整报告（文档、索引口径、最长重复结果） |

### 示例

```powershell
# 导入
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/documents -ContentType 'application/json' -Body '{"text":"banana"}'
# => {"id":1,"version":1,"lengthCp":6}
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/documents/1/index
Invoke-RestMethod -Uri http://127.0.0.1:8000/documents/1/longest-repeat
# => maxLengthCp=3，片段 "ana"，startsCp=[1,3]，startsUtf16=[1,3]
Invoke-RestMethod -Uri "http://127.0.0.1:8000/documents/1/lcp?i=1&j=3"
# => lcpLengthCp=3，prefix="ana"
```

### 错误码

统一返回 `{"error": {"code": ..., "message": ...}}`：

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | 参数缺失或类型错误 |
| `LONE_SURROGATE` | 400 | 文本含孤立代理项，拒绝处理 |
| `DOC_TOO_LARGE` | 400 | 文档超过长度上限（默认 200,000 码点） |
| `NOT_FOUND` | 404 | 文档或路由不存在 |
| `INDEX_NOT_BUILT` | 409 | 该版本尚未构建索引 |

## CLI

```powershell
node dist/cli.js import --text "banana"        # 或 --file 路径
node dist/cli.js update 1 --text "新文本"       # 创建 version=2
node dist/cli.js build 1 [--version N]
node dist/cli.js suffixes 1 [--offset N] [--limit N]
node dist/cli.js longest 1 [--limit N]
node dist/cli.js lcp 1 1 3
node dist/cli.js report 1
node dist/cli.js serve [--port N]
node dist/cli.js demo
```

## 存储

SQLite（`data\app.db`）两张表：`documents(id, version, text, length_cp, char_semantics, created_at)` 保存文档版本与字符口径（`unicode-codepoint`）；`indexes(doc_id, version, index_version, sa, lcp, utf16_map, rounds/rounds_summary, result_json)` 保存索引版本、后缀数组、LCP、UTF-16 映射与分析结果。修改原文会向 `documents` 追加新版本行，旧版本索引与结果原样保留。

## 限制与假设

- 默认上限：文档 200,000 码点、返回片段 10,000 码点、结果片段 100 个（`src/service.ts` 中 `DEFAULT_OPTIONS` 可调）。
- 前缀倍增排序使用内建比较排序，复杂度 O(n log² n)，适合本服务的本地单文档场景。
- `node:sqlite` 在 Node 25 仍标记为实验特性，启动时会打印一条 ExperimentalWarning，不影响功能。
- 仅监听 `127.0.0.1`，面向本机使用。

## 测试

`npm test` 覆盖：banana 后缀次序与 `ana` 的两个出现位置；中文、表情、全相同字符、多组并列最长；空串、单字符、无重复、重叠重复、前缀关系、末尾边界；小文本用**独立朴素枚举**核对所有子串出现位置与最长长度，并用**逐字符比较**核对 LCP；后缀数组完整排列校验；每个片段按报告偏移从原文取回校验；表情输入不拆代理对；孤立代理项拒绝；版本隔离与重启后读取。
