import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { ApiError } from "./text.js";

export const INDEX_VERSION = 1;
export const CHAR_SEMANTICS = "unicode-codepoint";
/** 保留完整倍增轮次秩数据的文本长度上限（码点）。 */
export const ROUNDS_FULL_LIMIT = 64;

export interface DocumentRow {
  id: number;
  version: number;
  text: string;
  lengthCp: number;
  charSemantics: string;
  createdAt: string;
}

export interface IndexRow {
  docId: number;
  version: number;
  indexVersion: number;
  sa: number[];
  lcp: number[];
  utf16Map: number[];
  rounds: number[][] | null; // 小文本完整保留
  roundsSummary: { roundCount: number; note: string } | null; // 长文本摘要
  resultJson: string | null;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        text TEXT NOT NULL,
        length_cp INTEGER NOT NULL,
        char_semantics TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE TABLE IF NOT EXISTS indexes (
        doc_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        index_version INTEGER NOT NULL,
        sa TEXT NOT NULL,
        lcp TEXT NOT NULL,
        utf16_map TEXT NOT NULL,
        rounds TEXT,
        rounds_summary TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, version)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 新建文档（version=1）。 */
  createDocument(text: string, lengthCp: number): DocumentRow {
    const row = this.db
      .prepare(
        "INSERT INTO documents (id, version, text, length_cp, char_semantics, created_at) " +
          "VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM documents), 1, ?, ?, ?, ?) RETURNING *"
      )
      .get(text, lengthCp, CHAR_SEMANTICS, new Date().toISOString()) as any;
    return this.toDoc(row);
  }

  /** 修改原文：创建新版本，旧版本与其索引保持不变。 */
  updateDocument(id: number, text: string, lengthCp: number): DocumentRow {
    const cur = this.getDocument(id);
    const row = this.db
      .prepare(
        "INSERT INTO documents (id, version, text, length_cp, char_semantics, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
      )
      .get(id, cur.version + 1, text, lengthCp, CHAR_SEMANTICS, new Date().toISOString()) as any;
    return this.toDoc(row);
  }

  getDocument(id: number, version?: number): DocumentRow {
    const row = (version === undefined
      ? this.db
          .prepare("SELECT * FROM documents WHERE id = ? ORDER BY version DESC LIMIT 1")
          .get(id)
      : this.db
          .prepare("SELECT * FROM documents WHERE id = ? AND version = ?")
          .get(id, version)) as any;
    if (!row) throw new ApiError("NOT_FOUND", `文档不存在: id=${id}`, 404);
    return this.toDoc(row);
  }

  saveIndex(ix: IndexRow): void {
    this.db
      .prepare(
        `INSERT INTO indexes (doc_id, version, index_version, sa, lcp, utf16_map, rounds, rounds_summary, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (doc_id, version) DO UPDATE SET
           index_version=excluded.index_version, sa=excluded.sa, lcp=excluded.lcp,
           utf16_map=excluded.utf16_map, rounds=excluded.rounds,
           rounds_summary=excluded.rounds_summary, result_json=excluded.result_json,
           created_at=excluded.created_at`
      )
      .run(
        ix.docId,
        ix.version,
        ix.indexVersion,
        JSON.stringify(ix.sa),
        JSON.stringify(ix.lcp),
        JSON.stringify(ix.utf16Map),
        ix.rounds ? JSON.stringify(ix.rounds) : null,
        ix.roundsSummary ? JSON.stringify(ix.roundsSummary) : null,
        ix.resultJson,
        new Date().toISOString()
      );
  }

  getIndex(docId: number, version: number): IndexRow {
    const row = this.db
      .prepare("SELECT * FROM indexes WHERE doc_id = ? AND version = ?")
      .get(docId, version) as any;
    if (!row)
      throw new ApiError(
        "INDEX_NOT_BUILT",
        `文档 id=${docId} version=${version} 尚未构建索引`,
        409
      );
    return {
      docId: row.doc_id,
      version: row.version,
      indexVersion: row.index_version,
      sa: JSON.parse(row.sa),
      lcp: JSON.parse(row.lcp),
      utf16Map: JSON.parse(row.utf16_map),
      rounds: row.rounds ? JSON.parse(row.rounds) : null,
      roundsSummary: row.rounds_summary ? JSON.parse(row.rounds_summary) : null,
      resultJson: row.result_json,
    };
  }

  saveResult(docId: number, version: number, resultJson: string): void {
    this.getIndex(docId, version); // 确认索引存在
    this.db
      .prepare("UPDATE indexes SET result_json = ? WHERE doc_id = ? AND version = ?")
      .run(resultJson, docId, version);
  }

  private toDoc(row: any): DocumentRow {
    return {
      id: row.id,
      version: row.version,
      text: row.text,
      lengthCp: row.length_cp,
      charSemantics: row.char_semantics,
      createdAt: row.created_at,
    };
  }
}
