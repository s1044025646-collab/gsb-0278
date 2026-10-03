import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ApiError } from "./errors";

export const INDEX_VERSION = 1;
export const CHAR_SEMANTICS = "unicode-codepoint";

export interface DocumentRow {
  id: number;
  doc_key: string;
  version: number;
  text: string;
  char_semantics: string;
  created_at: string;
}

export interface IndexRow {
  id: number;
  document_id: number;
  index_version: number;
  sa_json: string;
  lcp_json: string;
  rounds_json: string | null;
  rounds_summary_json: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "repeat-lcp.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        text TEXT NOT NULL,
        char_semantics TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(doc_key, version)
      );
      CREATE TABLE IF NOT EXISTS indexes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        index_version INTEGER NOT NULL,
        sa_json TEXT NOT NULL,
        lcp_json TEXT NOT NULL,
        rounds_json TEXT,
        rounds_summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_id INTEGER NOT NULL REFERENCES indexes(id),
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** 导入文档：同 key 文本变化时创建新版本；未变化则返回已有版本。 */
  importDocument(docKey: string, text: string): DocumentRow {
    const latest = this.db
      .prepare("SELECT * FROM documents WHERE doc_key = ? ORDER BY version DESC LIMIT 1")
      .get(docKey) as DocumentRow | undefined;
    if (latest && latest.text === text) return latest;
    const version = latest ? latest.version + 1 : 1;
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        "INSERT INTO documents (doc_key, version, text, char_semantics, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(docKey, version, text, CHAR_SEMANTICS, now);
    return this.getDocument(Number(info.lastInsertRowid));
  }

  getDocument(id: number): DocumentRow {
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
      | DocumentRow
      | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `文档不存在：id=${id}`, 404);
    return row;
  }

  latestVersionOf(docKey: string): DocumentRow {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE doc_key = ? ORDER BY version DESC LIMIT 1")
      .get(docKey) as DocumentRow | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `文档不存在：key=${docKey}`, 404);
    return row;
  }

  saveIndex(
    documentId: number,
    sa: number[],
    lcp: number[],
    rounds: object | null,
    roundsSummary: object
  ): number {
    const info = this.db
      .prepare(
        "INSERT INTO indexes (document_id, index_version, sa_json, lcp_json, rounds_json, rounds_summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        documentId,
        INDEX_VERSION,
        JSON.stringify(sa),
        JSON.stringify(lcp),
        rounds ? JSON.stringify(rounds) : null,
        JSON.stringify(roundsSummary),
        new Date().toISOString()
      );
    return Number(info.lastInsertRowid);
  }

  getIndexForDocument(documentId: number): IndexRow {
    const row = this.db
      .prepare("SELECT * FROM indexes WHERE document_id = ? ORDER BY id DESC LIMIT 1")
      .get(documentId) as IndexRow | undefined;
    if (!row) {
      throw new ApiError("INDEX_NOT_BUILT", `文档 ${documentId} 尚未构建索引`, 409);
    }
    return row;
  }

  saveResult(indexId: number, kind: string, payload: object): void {
    this.db
      .prepare("INSERT INTO results (index_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)")
      .run(indexId, kind, JSON.stringify(payload), new Date().toISOString());
  }

  getResults(indexId: number): Array<{ kind: string; payload: unknown; created_at: string }> {
    const rows = this.db
      .prepare("SELECT kind, payload_json, created_at FROM results WHERE index_id = ? ORDER BY id")
      .all(indexId) as Array<{ kind: string; payload_json: string; created_at: string }>;
    return rows.map((r) => ({ kind: r.kind, payload: JSON.parse(r.payload_json), created_at: r.created_at }));
  }

  close(): void {
    this.db.close();
  }
}
