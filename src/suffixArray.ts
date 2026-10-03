/**
 * 后缀数组：前缀倍增法（prefix doubling），自行实现。
 * - 只索引非空后缀（位置 0..n-1），不加入空后缀。
 * - 字符按 Unicode 码点值排序。
 * - 每轮以 (rank[i], rank[i+k]) 为键排序，越过文本末尾的第二秩使用哨兵 -1
 *   （小于任何有效秩，有效秩从 0 开始）。
 */

export interface SuffixArrayResult {
  /** 后缀数组：sa[r] 为排名第 r 的后缀起始位置（码点索引）。 */
  sa: number[];
  /** 每一轮倍增后的秩数组快照（仅小文本时由调用方决定是否保留）。 */
  rounds: number[][];
}

export function buildSuffixArray(cps: number[]): SuffixArrayResult {
  const n = cps.length;
  if (n === 0) return { sa: [], rounds: [] };

  // 初始秩：直接对码点值做离散化压缩。
  const sortedVals = Array.from(new Set(cps)).sort((a, b) => a - b);
  const valToRank = new Map<number, number>();
  sortedVals.forEach((v, i) => valToRank.set(v, i));
  let rank = cps.map((v) => valToRank.get(v)!);

  let sa: number[] = Array.from({ length: n }, (_, i) => i);
  const rounds: number[][] = [rank.slice()];

  for (let k = 1; k < n; k <<= 1) {
    const r = rank;
    sa.sort((a, b) => {
      if (r[a] !== r[b]) return r[a] - r[b];
      const ra2 = a + k < n ? r[a + k] : -1; // 哨兵：越过末尾
      const rb2 = b + k < n ? r[b + k] : -1;
      return ra2 - rb2;
    });
    const next = new Array<number>(n);
    next[sa[0]] = 0;
    for (let i = 1; i < n; i++) {
      const a = sa[i - 1];
      const b = sa[i];
      const a2 = a + k < n ? r[a + k] : -1;
      const b2 = b + k < n ? r[b + k] : -1;
      next[b] = next[a] + (r[a] !== r[b] || a2 !== b2 ? 1 : 0);
    }
    rank = next;
    rounds.push(rank.slice());
    if (rank[sa[n - 1]] === n - 1) break; // 所有秩唯一，完成
  }
  return { sa, rounds };
}

/**
 * LCP 数组（Kasai 算法）：lcp[i] 为 sa[i] 与 sa[i-1] 两个后缀的
 * 最长公共前缀长度（码点数），lcp[0] = 0。
 */
export function buildLcp(cps: number[], sa: number[]): number[] {
  const n = sa.length;
  const lcp = new Array<number>(n).fill(0);
  if (n === 0) return lcp;
  const rankOf = new Array<number>(n);
  for (let i = 0; i < n; i++) rankOf[sa[i]] = i;
  let h = 0;
  for (let i = 0; i < n; i++) {
    const r = rankOf[i];
    if (r === 0) continue;
    const j = sa[r - 1];
    while (i + h < n && j + h < n && cps[i + h] === cps[j + h]) h++;
    lcp[r] = h;
    if (h > 0) h--;
  }
  return lcp;
}

/** 查询两个后缀（起始位置 i、j，码点索引）的最长公共前缀长度。 */
export function lcpOfSuffixes(cps: number[], i: number, j: number): number {
  let h = 0;
  const n = cps.length;
  while (i + h < n && j + h < n && cps[i + h] === cps[j + h]) h++;
  return h;
}
