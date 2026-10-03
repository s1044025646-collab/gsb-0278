import {
  ApiError,
  validateText,
  toCodePoints,
  fromCodePoints,
  buildUtf16Map,
  cpRangeToUtf16,
} from "./text.js";
import { buildSuffixArray, buildLcp, lcpOfSuffixes } from "./suffixArray.js";
import { findLongestRepeats, LongestRepeatResult } from "./repeats.js";
import { Store, INDEX_VERSION, ROUNDS_FULL_LIMIT, DocumentRow } from "./store.js";

export interface ServiceOptions {
  /** 文档长度上限（码点）。 */
  maxDocLengthCp: number;
  /** 返回片段长度上限（码点）。 */
  maxFragmentLengthCp: number;
  /** 最长重复结果返回的片段数量上限。 */
  maxResults: number;
}

export const DEFAULT_OPTIONS: ServiceOptions = {
  maxDocLengthCp: 200_000,
  maxFragmentLengthCp: 10_000,
  maxResults: 100,
};

export class Service {
  constructor(public store: Store, public opts: ServiceOptions = DEFAULT_OPTIONS) {}

  importDocument(text: unknown): { id: number; version: number; lengthCp: number } {
    const t = validateText(text);
    const cps = toCodePoints(t);
    if (cps.length > this.opts.maxDocLengthCp) {
      throw new ApiError(
        "DOC_TOO_LARGE",
        `文档长度 ${cps.length} 码点超过上限 ${this.opts.maxDocLengthCp}`
      );
    }
    const doc = this.store.createDocument(t, cps.length);
    return { id: doc.id, version: doc.version, lengthCp: doc.lengthCp };
  }

  updateDocument(id: number, text: unknown): { id: number; version: number; lengthCp: number } {
    const t = validateText(text);
    const cps = toCodePoints(t);
    if (cps.length > this.opts.maxDocLengthCp) {
      throw new ApiError(
        "DOC_TOO_LARGE",
        `文档长度 ${cps.length} 码点超过上限 ${this.opts.maxDocLengthCp}`
      );
    }
    const doc = this.store.updateDocument(id, t, cps.length);
    return { id: doc.id, version: doc.version, lengthCp: doc.lengthCp };
  }

  buildIndex(id: number, version?: number) {
    const doc = this.store.getDocument(id, version);
    const cps = toCodePoints(doc.text);
    const { sa, rounds } = buildSuffixArray(cps);
    const lcp = buildLcp(cps, sa);
    const utf16Map = buildUtf16Map(doc.text);
    const small = cps.length <= ROUNDS_FULL_LIMIT;
    this.store.saveIndex({
      docId: doc.id,
      version: doc.version,
      indexVersion: INDEX_VERSION,
      sa,
      lcp,
      utf16Map,
      rounds: small ? rounds : null,
      roundsSummary: small
        ? null
        : {
            roundCount: rounds.length,
            note: `文本长度 ${cps.length} 码点超过 ${ROUNDS_FULL_LIMIT}，仅保存轮次数量摘要以避免解释数据爆炸`,
          },
      resultJson: null,
    });
    return {
      id: doc.id,
      version: doc.version,
      indexVersion: INDEX_VERSION,
      suffixCount: sa.length,
      roundsKept: small ? "full" : "summary",
      roundCount: rounds.length,
    };
  }

  /** 查看后缀顺序与 LCP。 */
  getSuffixes(id: number, version: number | undefined, offset = 0, limit = 100) {
    const doc = this.store.getDocument(id, version);
    const ix = this.store.getIndex(doc.id, doc.version);
    const cps = toCodePoints(doc.text);
    limit = Math.min(Math.max(1, limit), 1000);
    const items = [];
    for (let r = offset; r < Math.min(offset + limit, ix.sa.length); r++) {
      const start = ix.sa[r];
      items.push({
        rank: r,
        startCp: start,
        startUtf16: ix.utf16Map[start],
        lcpWithPrev: ix.lcp[r],
        suffixPreview: fromCodePoints(cps.slice(start, start + 64)),
      });
    }
    return {
      id: doc.id,
      version: doc.version,
      suffixCount: ix.sa.length,
      offset,
      items,
      rounds: ix.rounds,
      roundsSummary: ix.roundsSummary,
    };
  }

  /** 最长重复查询（结果缓存于 SQLite）。 */
  longestRepeat(id: number, version?: number, limit?: number): LongestRepeatResult & {
    id: number;
    version: number;
    fragments: any[];
  } {
    const doc = this.store.getDocument(id, version);
    const ix = this.store.getIndex(doc.id, doc.version);
    const maxResults = Math.min(Math.max(1, limit ?? this.opts.maxResults), this.opts.maxResults);
    const cps = toCodePoints(doc.text);
    const result = findLongestRepeats(cps, ix.sa, ix.lcp, maxResults);
    const fragments = result.fragments.map((f) => ({
      text:
        f.lengthCp > this.opts.maxFragmentLengthCp
          ? [...f.text].slice(0, this.opts.maxFragmentLengthCp).join("")
          : f.text,
      lengthCp: f.lengthCp,
      startsCp: f.startsCp,
      startsUtf16: f.startsCp.map((s) => ix.utf16Map[s]),
      utf16Ranges: f.startsCp.map((s) => cpRangeToUtf16(ix.utf16Map, s, f.lengthCp)),
    }));
    const out = { id: doc.id, version: doc.version, ...result, fragments };
    this.store.saveResult(doc.id, doc.version, JSON.stringify(out));
    return out;
  }

  /** 查询两个指定后缀的公共前缀。 */
  lcpQuery(id: number, i: number, j: number, version?: number) {
    const doc = this.store.getDocument(id, version);
    const ix = this.store.getIndex(doc.id, doc.version);
    const cps = toCodePoints(doc.text);
    const n = cps.length;
    for (const [name, p] of [["i", i], ["j", j]] as const) {
      if (!Number.isInteger(p) || p < 0 || p >= n) {
        throw new ApiError("INVALID_INPUT", `${name} 必须是 [0, ${n - 1}] 内的整数（码点索引）`);
      }
    }
    const len = lcpOfSuffixes(cps, i, j);
    return {
      id: doc.id,
      version: doc.version,
      i,
      j,
      iUtf16: ix.utf16Map[i],
      jUtf16: ix.utf16Map[j],
      lcpLengthCp: len,
      prefix: fromCodePoints(cps.slice(i, i + len)),
    };
  }

  /** 导出报告。 */
  report(id: number, version?: number) {
    const doc = this.store.getDocument(id, version);
    const ix = this.store.getIndex(doc.id, doc.version);
    const result = ix.resultJson ? JSON.parse(ix.resultJson) : this.longestRepeat(id, version);
    return {
      document: {
        id: doc.id,
        version: doc.version,
        lengthCp: doc.lengthCp,
        lengthUtf16: doc.text.length,
        charSemantics: doc.charSemantics,
        createdAt: doc.createdAt,
        text: doc.text,
      },
      index: {
        indexVersion: ix.indexVersion,
        suffixCount: ix.sa.length,
        emptySuffixIncluded: false,
        sentinel: "第二秩越过文本末尾时使用哨兵 -1",
        rounds: ix.rounds,
        roundsSummary: ix.roundsSummary,
      },
      longestRepeat: result,
    };
  }
}
