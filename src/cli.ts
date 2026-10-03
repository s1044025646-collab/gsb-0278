#!/usr/bin/env node
import * as path from "node:path";
import * as fs from "node:fs";
import { Store } from "./db";
import { Service } from "./service";
import { startServer } from "./server";

const dataDir = process.env.REPEAT_DATA_DIR || path.join(__dirname, "..", "data");
const store = new Store(dataDir);
const service = new Service(store);

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "serve": {
      const portArg = argValue(args, "port") ?? process.env.PORT;
      const port = portArg ? Number(portArg) : 0; // 默认选择空闲端口
      const server = await startServer(service, port);
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`服务已启动: http://127.0.0.1:${actual}  (数据目录: ${dataDir})`);
      break;
    }
    case "import": {
      const key = argValue(args, "key") ?? "default";
      const file = argValue(args, "file");
      const text = file ? fs.readFileSync(file, "utf8") : (argValue(args, "text") ?? "");
      print(service.importDocument(key, text));
      break;
    }
    case "build": {
      print(service.buildIndex(Number(argValue(args, "doc"))));
      break;
    }
    case "suffixes": {
      const from = Number(argValue(args, "from") ?? 0);
      const count = Number(argValue(args, "count") ?? 100);
      print(service.getSuffixes(Number(argValue(args, "doc")), from, count));
      break;
    }
    case "longest": {
      const limit = argValue(args, "limit");
      print(service.getLongestRepeat(Number(argValue(args, "doc")), limit ? Number(limit) : undefined));
      break;
    }
    case "lcp": {
      print(
        service.getPairLcp(
          Number(argValue(args, "doc")),
          Number(argValue(args, "i")),
          Number(argValue(args, "j"))
        )
      );
      break;
    }
    case "report": {
      const report = service.getReport(Number(argValue(args, "doc")));
      const out = argValue(args, "out");
      if (out) {
        fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
        console.log(`报告已写入 ${out}`);
      } else {
        print(report);
      }
      break;
    }
    case "demo": {
      const doc = service.importDocument("demo-banana", "banana");
      console.log("导入 banana:", JSON.stringify(doc));
      const idx = service.buildIndex(doc.documentId);
      console.log("索引:", JSON.stringify(idx));
      console.log("\n后缀顺序与 LCP:");
      print(service.getSuffixes(doc.documentId));
      console.log("\n最长重复片段:");
      print(service.getLongestRepeat(doc.documentId));
      console.log("\n后缀(1) 与后缀(3) 的公共前缀:");
      print(service.getPairLcp(doc.documentId, 1, 3));
      break;
    }
    default:
      console.log(`用法: node dist/cli.js <命令> [参数]

命令:
  serve [--port N]                 启动 HTTP API（默认自动选择空闲端口）
  import --key K (--text T | --file F)   导入文档（文本变化自动创建新版本）
  build --doc ID                   构建后缀数组与 LCP 索引
  suffixes --doc ID [--from N] [--count N]   查看后缀顺序与 LCP（小文本含轮次秩）
  longest --doc ID [--limit N]     查询最长重复片段
  lcp --doc ID --i A --j B         查询两个后缀的公共前缀
  report --doc ID [--out FILE]     导出分析报告
  demo                             运行 banana 演示

环境变量: REPEAT_DATA_DIR, REPEAT_MAX_DOC_CP, REPEAT_MAX_FRAGMENTS, REPEAT_MAX_FRAGMENT_OUTPUT_CP`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => {
    // serve 模式保持进程存活
    if (process.argv[2] !== "serve") store.close();
  });
