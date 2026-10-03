import path from "node:path";
import fs from "node:fs";
import { Store } from "./store.js";
import { Service } from "./service.js";
import { createServer, pickPort } from "./server.js";

const DATA_DIR = path.resolve(process.env.SA_DATA_DIR ?? path.join(process.cwd(), "data"));
const DB_PATH = path.join(DATA_DIR, "app.db");

function makeService(): Service {
  return new Service(new Store(DB_PATH));
}

function print(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

function fail(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(2);
}

function readTextArg(args: string[]): string {
  const fileIdx = args.indexOf("--file");
  if (fileIdx >= 0) {
    const f = args[fileIdx + 1];
    if (!f) fail("--file 缺少路径");
    return fs.readFileSync(f, "utf8");
  }
  const tIdx = args.indexOf("--text");
  if (tIdx >= 0 && args[tIdx + 1] !== undefined) return args[tIdx + 1];
  // 位置参数
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length > 0) return positional.join(" ");
  fail("请通过 --text <文本> 或 --file <路径> 提供文本");
}

function numArg(args: string[], name: string): number | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n)) fail(`--${name} 必须是整数`);
  return n;
}

const HELP = `后缀数组重复片段分析 CLI

用法: node dist/cli.js <命令> [参数]

命令:
  import --text <文本> | --file <路径>   导入文档
  update <id> --text <文本> | --file ..  修改原文（创建新版本）
  build <id> [--version N]               构建后缀数组与 LCP 索引
  suffixes <id> [--version N] [--offset N] [--limit N]  查看后缀顺序与 LCP
  longest <id> [--version N] [--limit N] 最长重复片段查询
  lcp <id> <i> <j> [--version N]         两个后缀的公共前缀
  report <id> [--version N]              导出完整报告
  serve [--port N]                       启动 HTTP API（默认自动选择空闲端口）
  demo                                   运行内置演示（banana / ana / 中文 / 表情）

数据目录: ${DATA_DIR}（可用环境变量 SA_DATA_DIR 覆盖）
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(HELP);
    return;
  }
  if (cmd === "serve") {
    const preferred = numArg(rest, "port") ?? Number(process.env.PORT ?? 8000);
    const port = await pickPort(preferred);
    const service = makeService();
    const server = createServer(service);
    server.listen(port, "127.0.0.1", () => {
      console.log(`API 服务已启动: http://127.0.0.1:${port}`);
    });
    return;
  }
  if (cmd === "demo") {
    const { runDemo } = await import("./demo.js");
    runDemo(makeService());
    return;
  }

  const service = makeService();
  try {
    switch (cmd) {
      case "import":
        print(service.importDocument(readTextArg(rest)));
        break;
      case "update": {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) fail("update 需要文档 id");
        print(service.updateDocument(id, readTextArg(rest.slice(1))));
        break;
      }
      case "build":
        print(service.buildIndex(Number(rest[0]), numArg(rest, "version")));
        break;
      case "suffixes":
        print(
          service.getSuffixes(
            Number(rest[0]),
            numArg(rest, "version"),
            numArg(rest, "offset") ?? 0,
            numArg(rest, "limit") ?? 100
          )
        );
        break;
      case "longest":
        print(service.longestRepeat(Number(rest[0]), numArg(rest, "version"), numArg(rest, "limit")));
        break;
      case "lcp": {
        const id = Number(rest[0]);
        const i = Number(rest[1]);
        const j = Number(rest[2]);
        if (![id, i, j].every(Number.isInteger)) fail("用法: lcp <id> <i> <j>");
        print(service.lcpQuery(id, i, j, numArg(rest, "version")));
        break;
      }
      case "report":
        print(service.report(Number(rest[0]), numArg(rest, "version")));
        break;
      default:
        fail(`未知命令: ${cmd}\n\n${HELP}`);
    }
  } finally {
    service.store.close();
  }
}

main().catch((err) => {
  if (err && err.code) {
    console.error(`错误 [${err.code}]: ${err.message}`);
    process.exit(1);
  }
  throw err;
});
