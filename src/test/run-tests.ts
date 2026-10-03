import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { toCodePoints, validateText, utf16OffsetTable, sliceByCp } from "../textutil";
import { buildSuffixArray, buildLcp } from "../suffixArray";
import { findLongestRepeats, suffixPairLcp } from "../analysis";
import { ApiError } from "../errors";
import { Store } from "../db";
import { Service } from "../service";

let passed = 0;
function ok(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

/** 朴素枚举：所有子串的出现位置与最长重复长度（仅用于小文本对照）。 */
function naiveLongest(text: string): Map<string, number[]> {
  const chars = Array.from(text);
  const n = chars.length;
  for (let len = n; len >= 1; len--) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i + len <= n; i++) {
      const s = chars.slice(i, i + len).join("");
      const arr = seen.get(s) ?? [];
      arr.push(i);
      seen.set(s, arr);
    }
    const repeated = new Map<string, number[]>();
    for (const [s, occ] of seen) if (occ.length >= 2) repeated.set(s, occ);
    if (repeated.size > 0) return repeated;
  }
  return new Map();
}

function naiveLcpOfSuffixes(text: string, i: number, j: number): number {
  const chars = Array.from(text);
  let h = 0;
  while (i + h < chars.length && j + h < chars.length && chars[i + h] === chars[j + h]) h++;
  return h;
}

function checkPermutation(sa: number[], n: number): void {
  assert.equal(sa.length, n, "SA 长度应等于文本长度");
  const sorted = sa.slice().sort((a, b) => a - b);
  for (let i = 0; i < n; i++) assert.equal(sorted[i], i, "SA 必须是 0..n-1 的完整排列");
}

function checkLcpNaive(text: string, sa: number[], lcp: number[]): void {
  for (let i = 1; i < sa.length; i++) {
    const expect = naiveLcpOfSuffixes(text, sa[i - 1], sa[i]);
    assert.equal(lcp[i], expect, `lcp[${i}] 与逐字符比较不一致`);
  }
}

function checkLongestNaive(text: string): void {
  const cps = toCodePoints(text);
  const { sa } = buildSuffixArray(cps);
  const lcp = buildLcp(cps, sa);
  checkPermutation(sa, cps.length);
  checkLcpNaive(text, sa, lcp);
  const result = findLongestRepeats(cps, sa, lcp, 1000);
  const naive = naiveLongest(text);
  if (naive.size === 0) {
    assert.equal(result.maxLengthCp, 0, "朴素枚举无重复时算法应返回 0");
    assert.equal(result.fragments.length, 0);
    return;
  }
  const naiveLen = naive.values().next().value!.length ? Array.from(naive.keys())[0].length : 0;
  const expectedLen = Array.from(naive.keys())[0];
  assert.equal(result.maxLengthCp, Array.from(expectedLen).length, "最长长度应与朴素枚举一致");
  assert.equal(result.fragments.length, naive.size, "片段数量应与朴素枚举一致");
  const naiveMap = new Map(Array.from(naive.entries()).map(([k, v]) => [k, v.slice().sort((a, b) => a - b)]));
  for (const f of result.fragments) {
    const fragText = sliceByCp(text, f.startCp, f.lengthCp);
    const expect = naiveMap.get(fragText);
    assert.ok(expect, `片段 ${JSON.stringify(fragText)} 应出现在朴素结果中`);
    assert.deepEqual(f.occurrencesCp, expect, `片段 ${JSON.stringify(fragText)} 的出现起点集合应完整`);
    // 每个片段都能按报告偏移从原文取回
    for (const p of f.occurrencesCp) {
      assert.equal(sliceByCp(text, p, f.lengthCp), fragText);
    }
  }
}

console.log("运行测试...\n");

// ---------- 已知样例 ----------
ok("banana：后缀次序与 LCP", () => {
  const cps = toCodePoints("banana");
  const { sa } = buildSuffixArray(cps);
  const lcp = buildLcp(cps, sa);
  assert.deepEqual(sa, [5, 3, 1, 0, 4, 2]);
  assert.deepEqual(lcp, [0, 1, 3, 0, 0, 2]);
});

ok("banana：ana 的两个出现位置", () => {
  const cps = toCodePoints("banana");
  const { sa } = buildSuffixArray(cps);
  const lcp = buildLcp(cps, sa);
  const r = findLongestRepeats(cps, sa, lcp, 100);
  assert.equal(r.maxLengthCp, 3);
  assert.equal(r.fragments.length, 1);
  assert.equal(sliceByCp("banana", r.fragments[0].startCp, 3), "ana");
  assert.deepEqual(r.fragments[0].occurrencesCp, [1, 3]);
});

// ---------- 边界 ----------
ok("空串：无后缀、无重复", () => {
  const { sa } = buildSuffixArray([]);
  const lcp = buildLcp([], sa);
  assert.deepEqual(sa, []);
  const r = findLongestRepeats([], sa, lcp, 100);
  assert.equal(r.maxLengthCp, 0);
  assert.equal(r.fragments.length, 0);
});

ok("单字符：无重复", () => checkLongestNaive("a"));
ok("无重复文本：明确返回不存在", () => {
  checkLongestNaive("abcdefg");
  const cps = toCodePoints("abcdefg");
  const { sa } = buildSuffixArray(cps);
  const r = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(r.maxLengthCp, 0);
});

ok("全相同字符：重叠重复 aaaa -> aaa", () => {
  checkLongestNaive("aaaa");
  const cps = toCodePoints("aaaa");
  const { sa } = buildSuffixArray(cps);
  const r = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(r.maxLengthCp, 3);
  assert.deepEqual(r.fragments[0].occurrencesCp, [0, 1], "允许重叠出现");
});

ok("前缀关系：abcabc 的最长重复是整个前半", () => {
  checkLongestNaive("abcabc");
  const cps = toCodePoints("abcabc");
  const { sa } = buildSuffixArray(cps);
  const r = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(r.maxLengthCp, 3);
  assert.deepEqual(r.fragments[0].occurrencesCp, [0, 3]);
});

ok("末尾边界：abcab 的 ab 出现在文本末尾", () => {
  checkLongestNaive("abcab");
  const cps = toCodePoints("abcab");
  const { sa } = buildSuffixArray(cps);
  const r = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(r.maxLengthCp, 2);
  assert.deepEqual(r.fragments[0].occurrencesCp, [0, 3]);
});

ok("多组并列最长：ab1ab2cd3cd -> ab 与 cd", () => {
  checkLongestNaive("ab1ab2cd3cd");
  const cps = toCodePoints("ab1ab2cd3cd");
  const { sa } = buildSuffixArray(cps);
  const r = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(r.maxLengthCp, 2);
  assert.equal(r.totalFragments, 2);
  const texts = r.fragments.map((f) => sliceByCp("ab1ab2cd3cd", f.startCp, 2));
  assert.deepEqual(texts, ["ab", "cd"], "按码点字典序列出");
});

// ---------- Unicode ----------
ok("中文文本", () => {
  checkLongestNaive("春眠不觉晓，处处闻啼鸟。春眠");
});

ok("表情符号：不拆成半个代理对", () => {
  const text = "a😀b😀a😀b";
  checkLongestNaive(text);
  const cps = toCodePoints(text);
  assert.equal(cps.length, 7, "码点计数");
  const { sa } = buildSuffixArray(cps);
  const r = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(r.maxLengthCp, 3, "最长重复为 a😀b（3 个码点）");
  const u16 = utf16OffsetTable(text);
  for (const f of r.fragments) {
    const fragText = sliceByCp(text, f.startCp, f.lengthCp);
    for (const p of f.occurrencesCp) {
      // UTF-16 偏移同样能取回完整片段，且不含半代理对
      assert.equal(text.substring(u16[p], u16[p + f.lengthCp]), fragText);
    }
  }
});

ok("孤立代理项被明确拒绝", () => {
  assert.throws(() => validateText("abc\ud800"), (e: ApiError) => e.code === "INVALID_TEXT");
  assert.throws(() => validateText("\udc00abc"), (e: ApiError) => e.code === "INVALID_TEXT");
  assert.throws(() => validateText("a\ud800b"), (e: ApiError) => e.code === "INVALID_TEXT");
  validateText("a😀b"); // 合法代理对不报错
});

// ---------- 后缀对 LCP ----------
ok("后缀对公共前缀查询", () => {
  const text = "banana";
  const cps = toCodePoints(text);
  const { sa } = buildSuffixArray(cps);
  const lcp = buildLcp(cps, sa);
  assert.equal(suffixPairLcp(sa, lcp, cps.length, 1, 3), 3); // "anana" vs "ana"
  assert.equal(suffixPairLcp(sa, lcp, cps.length, 0, 2), 0);
  assert.equal(suffixPairLcp(sa, lcp, cps.length, 2, 2), 4); // 自身
  for (let i = 0; i < cps.length; i++) {
    for (let j = 0; j < cps.length; j++) {
      assert.equal(suffixPairLcp(sa, lcp, cps.length, i, j), naiveLcpOfSuffixes(text, i, j));
    }
  }
});

// ---------- 随机小文本朴素对照 ----------
ok("随机小文本：与朴素枚举全量对照", () => {
  const alphabets = ["ab", "abc", "a中😀"];
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const alphabet of alphabets) {
    const chars = Array.from(alphabet);
    for (let t = 0; t < 60; t++) {
      const len = 1 + Math.floor(rand() * 12);
      let text = "";
      for (let i = 0; i < len; i++) text += chars[Math.floor(rand() * chars.length)];
      checkLongestNaive(text);
    }
  }
});

// ---------- 服务层（含 SQLite 持久化与版本） ----------
ok("服务层：导入、版本、索引、查询、报告、重启读取", () => {
  const dir = path.join(__dirname, "..", "..", "data-test");
  fs.rmSync(dir, { recursive: true, force: true });
  const services: Service[] = [];
  const make = () => {
    const s = new Service(new Store(dir));
    services.push(s);
    return s;
  };
  let svc = make();
  const d1 = svc.importDocument("t", "banana");
  assert.equal(d1.version, 1);
  const d1again = svc.importDocument("t", "banana");
  assert.equal(d1again.version, 1, "文本未变化不创建新版本");
  const idx = svc.buildIndex(d1.documentId);
  const longest = svc.getLongestRepeat(d1.documentId);
  assert.equal(longest.maxLengthCp, 3);
  assert.equal(longest.fragments[0].text, "ana");
  assert.deepEqual(
    longest.fragments[0].occurrences.map((o) => o.startCp),
    [1, 3]
  );
  const d2 = svc.importDocument("t", "bananas");
  assert.equal(d2.version, 2, "修改原文创建新版本");
  assert.notEqual(d2.documentId, d1.documentId);
  // 旧版本索引仍然可读，位置不套用新文档
  const oldLongest = svc.getLongestRepeat(d1.documentId);
  assert.equal(oldLongest.maxLengthCp, 3);
  // 报告导出
  const report = svc.getReport(d1.documentId);
  assert.equal(report.document.text, "banana");
  assert.equal(report.longestRepeat.maxLengthCp, 3);
  // 模拟重启：新 Service/Store 实例读取同一数据目录
  svc = make();
  const longest2 = svc.getLongestRepeat(d1.documentId);
  assert.equal(longest2.fragments[0].text, "ana", "重启后可读取原索引与原始片段");
  // 轮次记录（小文本）
  const sfx = svc.getSuffixes(d1.documentId);
  assert.ok(sfx.rounds && sfx.rounds.length >= 2, "小文本应记录倍增轮次秩变化");
  assert.equal(sfx.emptySuffixIncluded, false);
  // 错误码
  assert.throws(() => svc.getLongestRepeat(d2.documentId), (e: ApiError) => e.code === "INDEX_NOT_BUILT");
  assert.throws(() => svc.importDocument("bad", "x\ud800"), (e: ApiError) => e.code === "INVALID_TEXT");
  for (const s of services) s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

ok("截断上限：片段数量限制与总量保留", () => {
  const cps = toCodePoints("aXbYaXbYcZcZ"); // 多组长度为 2 的重复
  const { sa } = buildSuffixArray(cps);
  const lcp = buildLcp(cps, sa);
  const full = findLongestRepeats(cps, sa, lcp, 100);
  const limited = findLongestRepeats(cps, sa, lcp, 1);
  if (full.totalFragments > 1) {
    assert.equal(limited.fragments.length, 1);
    assert.equal(limited.totalFragments, full.totalFragments, "截断时保留总量");
    assert.equal(limited.truncated, true);
  }
});

console.log(`\n全部通过：${passed} 项测试`);
