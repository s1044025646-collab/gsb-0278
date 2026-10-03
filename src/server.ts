import * as http from "node:http";
import { Service } from "./service";
import { toErrorBody } from "./errors";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startServer(service: Service, port: number): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: object) => {
      const json = JSON.stringify(body, null, 2);
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(json);
    };
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method || "GET";

      if (method === "GET" && url.pathname === "/health") {
        return send(200, { ok: true });
      }

      if (method === "POST" && url.pathname === "/documents") {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        return send(201, service.importDocument(String(body.key ?? "default"), body.text));
      }

      const docMatch = parts[0] === "documents" ? Number(parts[1]) : NaN;
      if (!Number.isInteger(docMatch)) {
        return send(404, { error: { code: "NOT_FOUND", message: "未知路由" } });
      }
      const action = parts[2];

      if (method === "POST" && action === "index") {
        return send(201, service.buildIndex(docMatch));
      }
      if (method === "GET" && action === "suffixes") {
        const from = url.searchParams.has("from") ? Number(url.searchParams.get("from")) : 0;
        const count = url.searchParams.has("count") ? Number(url.searchParams.get("count")) : 100;
        return send(200, service.getSuffixes(docMatch, from, count));
      }
      if (method === "GET" && action === "longest-repeat") {
        const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
        return send(200, service.getLongestRepeat(docMatch, limit));
      }
      if (method === "GET" && action === "lcp") {
        const i = Number(url.searchParams.get("i"));
        const j = Number(url.searchParams.get("j"));
        return send(200, service.getPairLcp(docMatch, i, j));
      }
      if (method === "GET" && action === "report") {
        return send(200, service.getReport(docMatch));
      }
      return send(404, { error: { code: "NOT_FOUND", message: "未知路由" } });
    } catch (err) {
      const { status, body } = toErrorBody(err);
      return send(status, body);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
