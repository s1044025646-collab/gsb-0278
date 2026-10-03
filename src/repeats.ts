import { fromCodePoints } from "./text.js";

export interface RepeatFragment {
  /** 片段内容（原始文本子串，未做任何归一化）。 */
  text: string;
  /** 码点长度。 */
  lengthCp: number;
  /** 所有出现起点（码点索引，升序，允许重叠）。 */
  startsCp: number[];
}

export interface LongestRepeatResult {
  /** 最长重复长度（码点）。0 表示不存在非空重复片段。 */
  maxLengthCp: number;
  /** 是否存在非空重复片段。 */
  exists: boolean;
  /** 达到最长长度的不同片段（字典序去重），可能被截断。 */
  fragments: RepeatFragment[];
  /** 截断前的片段总数。 */
  totalFragments: number;
  /** 是否因上限被截断。 */
  truncated: boolean;
}

/**
 * 由 LCP 数组求最长重复片段。
 * 相邻 LCP 的最大值即最长重复长度；通过相邻 LCP >= maxLen 的连续分组
 * 收集每个片段的完整起点集合（分组内所有后缀的起点）。
 */
export function findLongestRepeats(
  cps: number[],
  sa: number[],
  lcp: number[],
  maxResults: number
): LongestRepeatResult {
  const n = sa.length;
  let maxLen = 0;
  for (let i = 1; i < n; i++) if (lcp[i] > maxLen) maxLen = lcp[i];

  if (maxLen === 0) {
    return {
      maxLengthCp: 0,
      exists: false,
      fragments: [],
      totalFragments: 0,
      truncated: false,
    };
  }

  // 连续分组：lcp[i] >= maxLen 的位置把相邻后缀连成一组。
  const fragments: RepeatFragment[] = [];
  const seen = new Set<string>();
  let i = 1;
  while (i < n) {
    if (lcp[i] >= maxLen) {
      const starts: number[] = [sa[i - 1]];
      while (i < n && lcp[i] >= maxLen) {
        starts.push(sa[i]);
        i++;
      }
      starts.sort((a, b) => a - b);
      const text = fromCodePoints(cps.slice(starts[0], starts[0] + maxLen));
      if (!seen.has(text)) {
        seen.add(text);
        fragments.push({ text, lengthCp: maxLen, startsCp: starts });
      }
    } else {
      i++;
    }
  }
  // 固定字典序（按码点值排序）。
  fragments.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

  const total = fragments.length;
  const truncated = total > maxResults;
  return {
    maxLengthCp: maxLen,
    exists: true,
    fragments: truncated ? fragments.slice(0, maxResults) : fragments,
    totalFragments: total,
    truncated,
  };
}
