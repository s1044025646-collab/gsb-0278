import http from "node:http";
import net from "node:net";
import { Service } from "./service.js";
import { ApiError } from "./text.js";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) reject(new ApiError("DOC_TOO_LARGE", "请求体过大"));
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError("INVALID_INPUT", "请求体不是合法 JSON");
  }
}

function intParam(value: string | null, name: string): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ApiError("INVALID_INPUT", `${name} 必须是整数`);
  return n;
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "POST" && url.pathname === "/documents") {
        const body = parseJson(await readBody(req));
        return send(res, 201, service.importDocument(body.text));
      }
      if (parts[0] === "documents" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError("INVALID_INPUT", "文档 id 必须是整数");
        const v = intParam(url.searchParams.get("version"), "version");
        const sub = parts[2];

        if (method === "PUT" && parts.length === 2) {
          const body = parseJson(await readBody(req));
          return send(res, 200, service.updateDocument(id, body.text));
        }
        if (method === "POST" && sub === "index" && parts.length === 3) {
          return send(res, 200, service.buildIndex(id, v));
        }
        if (method === "GET" && sub === "suffixes" && parts.length === 3) {
          const offset = intParam(url.searchParams.get("offset"), "offset") ?? 0;
          const limit = intParam(url.searchParams.get("limit"), "limit") ?? 100;
          return send(res, 200, service.getSuffixes(id, v, offset, limit));
        }
        if (method === "GET" && sub === "longest-repeat" && parts.length === 3) {
          const limit = intParam(url.searchParams.get("limit"), "limit");
          return send(res, 200, service.longestRepeat(id, v, limit));
        }
        if (method === "GET" && sub === "lcp" && parts.length === 3) {
          const i = intParam(url.searchParams.get("i"), "i");
          const j = intParam(url.searchParams.get("j"), "j");
          if (i === undefined || j === undefined)
            throw new ApiError("INVALID_INPUT", "缺少参数 i 或 j");
          return send(res, 200, service.lcpQuery(id, i, j, v));
        }
        if (method === "GET" && sub === "report" && parts.length === 3) {
          return send(res, 200, service.report(id, v));
        }
      }
      throw new ApiError("NOT_FOUND", `未知路由: ${method} ${url.pathname}`, 404);
    } catch (err) {
      if (err instanceof ApiError) {
        send(res, err.status, { error: { code: err.code, message: err.message } });
      } else {
        send(res, 500, { error: { code: "INTERNAL", message: String(err) } });
      }
    }
  });
}

/** 选择一个空闲端口（preferred 被占用时回退到系统分配）。 */
export function pickPort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => {
      const srv2 = net.createServer();
      srv2.listen(0, "127.0.0.1", () => {
        const port = (srv2.address() as net.AddressInfo).port;
        srv2.close(() => resolve(port));
      });
    });
    srv.listen(preferred, "127.0.0.1", () => {
      srv.close(() => resolve(preferred));
    });
  });
}
