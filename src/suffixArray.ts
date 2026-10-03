export interface RoundRecord {
  k: number;
  ranks: number[];
}

export interface SuffixArrayResult {
  sa: number[];
  /** 小文本：每轮倍增后的秩数组；长文本：仅摘要 */
  rounds: RoundRecord[] | null;
  roundsSummary: { roundCount: number; finalK: number } ;
}

/** 完整记录轮次的文本长度上限（码点数），超过则只保留摘要，避免解释数据爆炸。 */
export const ROUNDS_FULL_THRESHOLD = 256;

/**
 * 前缀倍增法构造后缀数组。
 * - 只索引非空后缀（位置 0..n-1），不加入空后缀。
 * - 每轮以 (rank[i], rank[i+k]) 二元组排序；越过文本末尾的第二秩使用独立哨兵 0
 *   （所有真实秩从 1 开始编号，哨兵严格小于任何真实秩）。
 * - 字符初始秩按 Unicode 码点值压缩。
 */
export function buildSuffixArray(cps: number[]): SuffixArrayResult {
  const n = cps.length;
  if (n === 0) {
    return { sa: [], rounds: [], roundsSummary: { roundCount: 0, finalK: 0 } };
  }

  // 初始秩：按码点值压缩到 1..m
  const sortedVals = Array.from(new Set(cps)).sort((a, b) => a - b);
  const comp = new Map<number, number>();
  sortedVals.forEach((v, idx) => comp.set(v, idx + 1));
  let rank = cps.map((v) => comp.get(v)!);

  const sa: number[] = Array.from({ length: n }, (_, i) => i);
  const keepRounds = n <= ROUNDS_FULL_THRESHOLD;
  const rounds: RoundRecord[] | null = keepRounds ? [{ k: 0, ranks: rank.slice() }] : null;
  const tmp = new Array<number>(n);

  let k = 1;
  let roundCount = 0;
  for (; ; k *= 2) {
    // 以 (rank[i], i+k<n ? rank[i+k] : 0) 为键排序，0 为末尾哨兵
    sa.sort((a, b) => {
      const ra = rank[a], rb = rank[b];
      if (ra !== rb) return ra - rb;
      const sa2 = a + k < n ? rank[a + k] : 0;
      const sb2 = b + k < n ? rank[b + k] : 0;
      return sa2 - sb2;
    });
    // 重新编号
    tmp[sa[0]] = 1;
    let classes = 1;
    for (let i = 1; i < n; i++) {
      const cur = sa[i], prev = sa[i - 1];
      const curSecond = cur + k < n ? rank[cur + k] : 0;
      const prevSecond = prev + k < n ? rank[prev + k] : 0;
      if (rank[cur] !== rank[prev] || curSecond !== prevSecond) classes++;
      tmp[cur] = classes;
    }
    rank = tmp.slice();
    roundCount++;
    if (rounds) rounds.push({ k, ranks: rank.slice() });
    if (classes === n) break;
    if (k >= n) break; // 安全出口
  }

  return { sa, rounds, roundsSummary: { roundCount, finalK: k } };
}

/** Kasai 算法：由后缀数组生成相邻后缀 LCP 数组。lcp[i] = LCP(sa[i-1], sa[i])，lcp[0] = 0。 */
export function buildLcp(cps: number[], sa: number[]): number[] {
  const n = cps.length;
  const lcp = new Array<number>(n).fill(0);
  if (n === 0) return lcp;
  const rank = new Array<number>(n);
  for (let i = 0; i < n; i++) rank[sa[i]] = i;
  let h = 0;
  for (let i = 0; i < n; i++) {
    const r = rank[i];
    if (r === 0) continue;
    const j = sa[r - 1];
    while (i + h < n && j + h < n && cps[i + h] === cps[j + h]) h++;
    lcp[r] = h;
    if (h > 0) h--;
  }
  return lcp;
}
