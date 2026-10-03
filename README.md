# 后缀数组重复片段定位与 LCP 解释后端

本地单文档重复片段分析服务。输入一段 Unicode 文本，自行实现**前缀倍增法**构建后缀数组，
再由 Kasai 算法生成相邻后缀的 LCP 数组，找出文本内部**至少出现两次的最长连续片段**。
仅提供 HTTP API 与 CLI，无前端；运行依赖只有 Node.js，SQLite 使用 Node 内置 `node:sqlite`，
不需要 Docker / WSL / 外部服务。

## 范围说明

- 只分析**同一文本内部**的连续重复，出现区间**允许重叠**（如 `aaaa` 的最长重复是 `aaa`，出现于 0 和 1）。
- 不做词典纠错、分词检索、跨文档相似度、三方合并或 DNA 组装。
- 保留原始文本：不做大小写折叠、不做 Unicode 归一化。
- 输入含**孤立代理项**（lone surrogate，高代理项后未跟低代理项或低代理项单独出现）时，
  按 Unicode 公开规则明确拒绝，返回错误码 `INVALID_TEXT`。

## 字符口径：码点 vs UTF-16

文本位置与长度一律采用 **Unicode 码点（code point）计数**，字符排序按码点值。
同时，所有返回的位置都附带 **JavaScript UTF-16 偏移**映射，方便与 JS 字符串下标互转：

- `startCp` / `endCp` / `lengthCp`：码点口径（分析口径）。
- `startUtf16` / `endUtf16`：UTF-16 码元口径（`String.prototype.substring` 可直接使用）。

例如 `a😀b` 的码点长度是 3，UTF-16 长度是 4；表情 `😀` 占 1 个码点、2 个 UTF-16 码元，
索引与结果都不会把它拆成半个代理对。

## 算法要点

- **只索引非空后缀**（位置 `0..n-1`），不加入空后缀（`emptySuffixIncluded: false`）。
- 前缀倍增：第 `k` 轮以二元组 `(rank[i], rank[i+k])` 为键排序；越过文本末尾的第二秩
  使用**独立哨兵 0**（真实秩从 1 开始编号，哨兵严格小于任何真实秩）。
- LCP 由后缀数组经 Kasai 算法 O(n) 生成。
- 最长重复长度 = 相邻 LCP 的最大值；为 0 时明确返回「不存在非空重复片段」。
- 相同最大长度的多个片段：对 `lcp[i] == maxL` 的**连续分组**取整组后缀起点，
  得到每个片段的**完整出现集合**（不是只报告某一对相邻后缀）；片段按码点字典序排列并去重。
- 小文本（≤256 码点）返回每轮倍增后的秩数组；长文本只保存轮次摘要，避免解释数据爆炸。

## 持久化与版本

SQLite（默认 `data/repeat-lcp.db`，可用 `REPEAT_DATA_DIR` 修改）保存：

- `documents`：文档版本（同一 key 文本变化时版本 +1，未变化复用旧版本）、字符口径；
- `indexes`：索引版本、后缀数组、LCP、倍增轮次（或摘要）；
- `results`：分析结果（最长重复查询等）。

旧版本的索引与原文永久保留，**旧位置不会套用到新文档**；重启后可直接读取原索引与原始片段。

## 限制（可用环境变量调整）

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `REPEAT_MAX_DOC_CP` | 200000 | 文档最大码点数，超出返回 `TEXT_TOO_LONG` |
| `REPEAT_MAX_FRAGMENTS` | 100 | 单次返回的最长片段数量上限，截断时 `truncated=true` 且保留 `totalFragments` 总量 |
| `REPEAT_MAX_FRAGMENT_OUTPUT_CP` | 1000 | 单个片段返回文本的最大码点长度，超出截断并标记 `fragmentTruncated` |
| `REPEAT_DATA_DIR` | `./data` | 数据目录 |

## 构建、测试、启动、演示

```powershell
npm install      # 安装开发依赖（typescript）
npm run build    # 编译到 dist/
npm test         # 构建并运行全部测试
npm start        # 启动 HTTP 服务（默认自动选择空闲端口）
npm run demo     # banana 演示：后缀次序、LCP、最长重复 ana@[1,3]
```

要求 Node.js ≥ 22（使用内置 `node:sqlite`，当前为实验性 API，启动时有一条实验警告，属正常）。

## CLI

```
node dist/cli.js serve [--port N]                       # 启动 API（缺省端口 0 = 自动选空闲端口）
node dist/cli.js import --key K (--text T | --file F)   # 导入文档
node dist/cli.js build --doc ID                         # 构建索引
node dist/cli.js suffixes --doc ID [--from N] [--count N]
node dist/cli.js longest --doc ID [--limit N]
node dist/cli.js lcp --doc ID --i A --j B
node dist/cli.js report --doc ID [--out FILE]
node dist/cli.js demo
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/documents` | 导入文档，body `{"key": "...", "text": "..."}` |
| POST | `/documents/:id/index` | 构建后缀数组与 LCP 索引 |
| GET | `/documents/:id/suffixes?from=&count=` | 后缀顺序与 LCP（小文本含每轮秩变化） |
| GET | `/documents/:id/longest-repeat?limit=` | 最长重复片段（含全部出现起点、双口径偏移） |
| GET | `/documents/:id/lcp?i=&j=` | 两个指定后缀（码点起点）的最长公共前缀 |
| GET | `/documents/:id/report` | 导出完整分析报告（文档、索引、结果） |
| GET | `/health` | 健康检查 |

### 错误码

统一返回 `{"error": {"code": "...", "message": "..."}}`：

- `INVALID_TEXT`：文本含孤立代理项；
- `TEXT_TOO_LONG`：超过文档长度上限（HTTP 413）；
- `NOT_FOUND`：文档不存在（HTTP 404）；
- `INDEX_NOT_BUILT`：尚未构建索引（HTTP 409）；
- `BAD_PARAM`：参数缺失或越界；
- `INTERNAL`：未预期错误（HTTP 500）。

## 已知样例

- `banana`：后缀次序 `[5,3,1,0,4,2]`，LCP `[0,1,3,0,0,2]`，最长重复 `ana` 出现于码点 1 和 3。
- 测试另覆盖：中文、表情符号、全相同字符（重叠重复）、多组并列最长、空串、单字符、
  无重复、前缀关系、末尾边界；小文本与朴素枚举全量对照，LCP 与逐字符比较核对。

## 项目结构

```
src/textutil.ts     码点/UTF-16 转换、孤立代理项校验
src/suffixArray.ts  前缀倍增后缀数组 + Kasai LCP
src/analysis.ts     最长重复分组、后缀对 LCP 查询
src/db.ts           SQLite 持久化（文档版本/索引/结果）
src/service.ts      业务层（限制、截断、报告）
src/server.ts       HTTP API
src/cli.ts          命令行入口
src/test/run-tests.ts  测试（含朴素枚举对照）
```
