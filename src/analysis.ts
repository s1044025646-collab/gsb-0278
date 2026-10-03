import { ApiError } from "./errors";

export interface RepeatFragment {
  /** 片段首次出现的码点起点（用于取回片段文本） */
  startCp: number;
  lengthCp: number;
  /** 所有出现起点（码点计数，升序，允许重叠） */
  occurrencesCp: number[];
}

export interface LongestRepeatResult {
  /** 最长重复长度（码点）；0 表示不存在非空重复片段 */
  maxLengthCp: number;
  /** 按码点字典序排列、去重后的片段（可能被截断） */
  fragments: RepeatFragment[];
  /** 达到最大长度的不同片段总数（截断时仍给出总量） */
  totalFragments: number;
  truncated: boolean;
}

/**
 * 最长重复片段：maxL = max(lcp)。
 * lcp[i] == maxL 的相邻位置构成连续分组，每组对应一个不同的最长片段，
 * 组内后缀 { sa[l..r] } 的全部起点即该片段的完整出现集合（允许重叠）。
 */
export function findLongestRepeats(
  cps: number[],
  sa: number[],
  lcp: number[],
  maxFragments: number
): LongestRepeatResult {
  const n = cps.length;
  let maxL = 0;
  for (const v of lcp) if (v > maxL) maxL = v;
  if (maxL === 0) {
    return { maxLengthCp: 0, fragments: [], totalFragments: 0, truncated: false };
  }

  const groups: RepeatFragment[] = [];
  let i = 1;
  while (i < n) {
    if (lcp[i] === maxL) {
      const startIdx = i - 1;
      while (i < n && lcp[i] === maxL) i++;
      // lcp 连续分组为 [startIdx+1 .. i-1]，涉及后缀 sa[startIdx .. i-1]
      const occ = sa.slice(startIdx, i).map((p) => p);
      occ.sort((a, b) => a - b);
      groups.push({ startCp: sa[startIdx], lengthCp: maxL, occurrencesCp: occ });
    } else {
      i++;
    }
  }

  // 按片段内容的码点字典序排序并去重（同一片段的出现集合在 SA 中必然连续，正常不会跨组重复）
  const cmpFragment = (a: RepeatFragment, b: RepeatFragment): number => {
    for (let t = 0; t < maxL; t++) {
      const d = cps[a.startCp + t] - cps[b.startCp + t];
      if (d !== 0) return d;
    }
    return a.startCp - b.startCp;
  };
  groups.sort(cmpFragment);
  const dedup: RepeatFragment[] = [];
  for (const g of groups) {
    const last = dedup[dedup.length - 1];
    if (last && cmpFragment(last, g) === 0) {
      const merged = new Set([...last.occurrencesCp, ...g.occurrencesCp]);
      last.occurrencesCp = Array.from(merged).sort((a, b) => a - b);
    } else {
      dedup.push(g);
    }
  }

  const total = dedup.length;
  const truncated = total > maxFragments;
  return {
    maxLengthCp: maxL,
    fragments: dedup.slice(0, maxFragments),
    totalFragments: total,
    truncated,
  };
}

/** 两个指定后缀（按文本码点起点 i、j）的最长公共前缀长度。经 SA 区间最小 LCP 求得。 */
export function suffixPairLcp(sa: number[], lcp: number[], n: number, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= n || j >= n) {
    throw new ApiError("BAD_PARAM", `后缀起点越界：i=${i}, j=${j}，文本长度 ${n}`);
  }
  if (i === j) return n - i;
  const rank = new Array<number>(n);
  for (let t = 0; t < n; t++) rank[sa[t]] = t;
  let a = rank[i], b = rank[j];
  if (a > b) [a, b] = [b, a];
  let m = Infinity;
  for (let t = a + 1; t <= b; t++) if (lcp[t] < m) m = lcp[t];
  return m;
}
