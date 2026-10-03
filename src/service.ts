import { ApiError } from "./errors";
import { Store } from "./db";
import { validateText, toCodePoints, utf16OffsetTable, sliceByCp } from "./textutil";
import { buildSuffixArray, buildLcp } from "./suffixArray";
import { findLongestRepeats, suffixPairLcp } from "./analysis";

export interface Limits {
  maxDocCodePoints: number;
  maxFragments: number;
  maxFragmentOutputCp: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxDocCodePoints: Number(process.env.REPEAT_MAX_DOC_CP || 200_000),
  maxFragments: Number(process.env.REPEAT_MAX_FRAGMENTS || 100),
  maxFragmentOutputCp: Number(process.env.REPEAT_MAX_FRAGMENT_OUTPUT_CP || 1_000),
};

export class Service {
  constructor(private store: Store, private limits: Limits = DEFAULT_LIMITS) {}

  close(): void {
    this.store.close();
  }

  importDocument(docKey: string, text: string) {
    if (typeof text !== "string") throw new ApiError("BAD_PARAM", "text 必须是字符串");
    if (!docKey) throw new ApiError("BAD_PARAM", "docKey 不能为空");
    validateText(text);
    const cps = toCodePoints(text);
    if (cps.length > this.limits.maxDocCodePoints) {
      throw new ApiError(
        "TEXT_TOO_LONG",
        `文本长度 ${cps.length} 码点超过上限 ${this.limits.maxDocCodePoints}`,
        413
      );
    }
    const doc = this.store.importDocument(docKey, text);
    return {
      documentId: doc.id,
      docKey: doc.doc_key,
      version: doc.version,
      lengthCp: cps.length,
      lengthUtf16: text.length,
      charSemantics: doc.char_semantics,
    };
  }

  buildIndex(documentId: number) {
    const doc = this.store.getDocument(documentId);
    const cps = toCodePoints(doc.text);
    const { sa, rounds, roundsSummary } = buildSuffixArray(cps);
    const lcp = buildLcp(cps, sa);
    const indexId = this.store.saveIndex(documentId, sa, lcp, rounds, roundsSummary);
    return {
      documentId,
      version: doc.version,
      indexId,
      suffixCount: sa.length,
      emptySuffixIncluded: false,
      roundsRecorded: rounds !== null,
      roundsSummary,
    };
  }

  private loadIndex(documentId: number) {
    const doc = this.store.getDocument(documentId);
    const idx = this.store.getIndexForDocument(documentId);
    return {
      doc,
      idx,
      sa: JSON.parse(idx.sa_json) as number[],
      lcp: JSON.parse(idx.lcp_json) as number[],
    };
  }

  /** 查看后缀顺序与 LCP；小文本附带每轮秩变化。 */
  getSuffixes(documentId: number, from = 0, count = 100) {
    const { doc, idx, sa, lcp } = this.loadIndex(documentId);
    const cps = toCodePoints(doc.text);
    const u16 = utf16OffsetTable(doc.text);
    const n = sa.length;
    if (from < 0 || count < 1 || count > 1000) {
      throw new ApiError("BAD_PARAM", "from 必须 >= 0，count 必须在 1..1000");
    }
    const slice = sa.slice(from, from + count).map((pos, k) => ({
      order: from + k,
      startCp: pos,
      startUtf16: u16[pos],
      lcpWithPrevious: lcp[from + k],
      suffixPreview: sliceByCp(doc.text, pos, Math.min(40, n - pos)),
    }));
    const rounds = idx.rounds_json ? JSON.parse(idx.rounds_json) : null;
    return {
      documentId,
      version: doc.version,
      suffixCount: n,
      emptySuffixIncluded: false,
      suffixes: slice,
      rounds,
      roundsSummary: JSON.parse(idx.rounds_summary_json),
      note: rounds
        ? "小文本：包含每轮倍增后的秩数组"
        : "长文本：仅保留轮次摘要，避免解释数据爆炸",
    };
  }

  /** 最长重复片段查询。 */
  getLongestRepeat(documentId: number, limit?: number) {
    const { doc, idx, sa, lcp } = this.loadIndex(documentId);
    const cps = toCodePoints(doc.text);
    const u16 = utf16OffsetTable(doc.text);
    const maxFragments = Math.min(limit ?? this.limits.maxFragments, this.limits.maxFragments);
    const result = findLongestRepeats(cps, sa, lcp, maxFragments);
    const n = cps.length;

    const fragments = result.fragments.map((f) => {
      const full = f.lengthCp <= this.limits.maxFragmentOutputCp;
      const text = full
        ? sliceByCp(doc.text, f.startCp, f.lengthCp)
        : sliceByCp(doc.text, f.startCp, this.limits.maxFragmentOutputCp);
      return {
        text,
        fragmentTruncated: !full,
        lengthCp: f.lengthCp,
        occurrences: f.occurrencesCp.map((p) => ({
          startCp: p,
          startUtf16: u16[p],
          endCp: p + f.lengthCp,
          endUtf16: u16[p + f.lengthCp],
        })),
      };
    });

    const payload = {
      documentId,
      version: doc.version,
      exists: result.maxLengthCp > 0,
      message:
        result.maxLengthCp > 0
          ? undefined
          : "不存在非空重复片段（所有非空子串至多出现一次）",
      maxLengthCp: result.maxLengthCp,
      totalFragments: result.totalFragments,
      truncated: result.truncated,
      fragments,
      positionsNote: "位置同时给出码点(startCp/endCp)与 UTF-16(startUtf16/endUtf16)两种口径；允许重叠出现",
    };
    this.store.saveResult(idx.id, "longest-repeat", payload);
    return payload;
  }

  /** 查询两个指定后缀（按码点起点）的最长公共前缀。 */
  getPairLcp(documentId: number, i: number, j: number) {
    const { doc, sa, lcp } = this.loadIndex(documentId);
    const n = sa.length;
    if (!Number.isInteger(i) || !Number.isInteger(j)) {
      throw new ApiError("BAD_PARAM", "i 和 j 必须是整数（码点起点）");
    }
    const len = suffixPairLcp(sa, lcp, n, i, j);
    const u16 = utf16OffsetTable(doc.text);
    return {
      documentId,
      i: { startCp: i, startUtf16: u16[i] },
      j: { startCp: j, startUtf16: u16[j] },
      lcpLengthCp: len,
      commonPrefix: sliceByCp(doc.text, i, len),
    };
  }

  /** 导出完整报告。 */
  getReport(documentId: number) {
    const { doc, idx } = this.loadIndex(documentId);
    const longest = this.getLongestRepeat(documentId);
    return {
      document: {
        id: doc.id,
        docKey: doc.doc_key,
        version: doc.version,
        text: doc.text,
        charSemantics: doc.char_semantics,
        createdAt: doc.created_at,
      },
      index: {
        id: idx.id,
        indexVersion: idx.index_version,
        createdAt: idx.created_at,
        roundsSummary: JSON.parse(idx.rounds_summary_json),
      },
      longestRepeat: longest,
      savedResults: this.store.getResults(idx.id),
    };
  }
}
