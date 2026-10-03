import { test } from "node:test";
import assert from "node:assert/strict";
import { toCodePoints, fromCodePoints, buildUtf16Map, validateText, ApiError } from "../src/text.js";
import { buildSuffixArray, buildLcp, lcpOfSuffixes } from "../src/suffixArray.js";
import { findLongestRepeats } from "../src/repeats.js";

/** 朴素后缀数组：直接比较后缀（仅用于小文本交叉验证）。 */
function naiveSA(cps: number[]): number[] {
  const n = cps.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => {
    for (let k = 0; ; k++) {
      const ca = a + k < n ? cps[a + k] : -1;
      const cb = b + k < n ? cps[b + k] : -1;
      if (ca !== cb) return ca - cb;
      if (ca === -1) return 0;
    }
  });
  return idx;
}

/** 朴素 LCP：逐字符比较相邻后缀。 */
function naiveLcp(cps: number[], sa: number[]): number[] {
  const lcp = new Array(sa.length).fill(0);
  for (let r = 1; r < sa.length; r++) {
    let h = 0;
    const a = sa[r - 1], b = sa[r];
    while (a + h < cps.length && b + h < cps.length && cps[a + h] === cps[b + h]) h++;
    lcp[r] = h;
  }
  return lcp;
}

/** 朴素最长重复：枚举所有子串的出现位置。 */
function naiveLongest(cps: number[]): { maxLen: number; fragments: Map<string, number[]> } {
  const n = cps.length;
  let maxLen = 0;
  const occ = new Map<string, number[]>();
  for (let len = 1; len <= n; len++) {
    for (let s = 0; s + len <= n; s++) {
      const key = fromCodePoints(cps.slice(s, s + len));
      if (!occ.has(key)) occ.set(key, []);
      occ.get(key)!.push(s);
    }
  }
  const result = new Map<string, number[]>();
  for (const [k, v] of occ) {
    if (v.length >= 2) {
      const len = [...k].length;
      if (len > maxLen) {
        maxLen = len;
        result.clear();
        result.set(k, v);
      } else if (len === maxLen && len > 0) {
        result.set(k, v);
      }
    }
  }
  return { maxLen, fragments: result };
}

function checkText(text: string) {
  const cps = toCodePoints(text);
  const { sa } = buildSuffixArray(cps);
  const lcp = buildLcp(cps, sa);

  // 完整排列
  assert.deepEqual([...sa].sort((a, b) => a - b), Array.from({ length: cps.length }, (_, i) => i));
  // 与朴素 SA 一致
  assert.deepEqual(sa, naiveSA(cps), `SA mismatch for ${JSON.stringify(text)}`);
  // 与逐字符比较的 LCP 一致
  assert.deepEqual(lcp, naiveLcp(cps, sa), `LCP mismatch for ${JSON.stringify(text)}`);

  // 最长重复与朴素枚举一致
  const res = findLongestRepeats(cps, sa, lcp, 1000);
  const naive = naiveLongest(cps);
  assert.equal(res.maxLengthCp, naive.maxLen, `maxLen mismatch for ${JSON.stringify(text)}`);
  assert.equal(res.exists, naive.maxLen > 0);
  assert.equal(res.totalFragments, naive.fragments.size);
  for (const f of res.fragments) {
    const expect = naive.fragments.get(f.text);
    assert.ok(expect, `fragment ${JSON.stringify(f.text)} missing in naive`);
    assert.deepEqual(f.startsCp, expect);
    // 每个片段能按报告偏移从原文取回
    for (const s of f.startsCp) {
      assert.equal(fromCodePoints(cps.slice(s, s + f.lengthCp)), f.text);
    }
  }
}

test("banana: 后缀次序与 ana 两次出现", () => {
  const cps = toCodePoints("banana");
  const { sa } = buildSuffixArray(cps);
  assert.deepEqual(sa.map((i) => fromCodePoints(cps.slice(i))), [
    "a", "ana", "anana", "banana", "na", "nana",
  ]);
  const lcp = buildLcp(cps, sa);
  assert.deepEqual(lcp, [0, 1, 3, 0, 0, 2]);
  const res = findLongestRepeats(cps, sa, lcp, 100);
  assert.equal(res.maxLengthCp, 3);
  assert.equal(res.fragments.length, 1);
  assert.equal(res.fragments[0].text, "ana");
  assert.deepEqual(res.fragments[0].startsCp, [1, 3]);
});

test("已知样例与边界", () => {
  checkText("banana");
  checkText("");            // 空串
  checkText("a");           // 单字符
  checkText("abcdef");      // 无重复
  checkText("aaaaaa");      // 全相同字符（重叠重复）
  checkText("ababab");      // 前缀关系
  checkText("abcabxabcd");  // 多组并列最长
  checkText("mississippi");
  checkText("白日依山尽，黄河入海流。白日依山尽。"); // 中文
  checkText("a😀b😀a😀b");  // 表情
  checkText("😀😀😀");      // 全相同表情
});

test("空串与无重复明确返回不存在", () => {
  for (const t of ["", "a", "abcdef"]) {
    const cps = toCodePoints(t);
    const { sa } = buildSuffixArray(cps);
    const res = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
    assert.equal(res.exists, false);
    assert.equal(res.maxLengthCp, 0);
  }
});

test("重叠重复：aaaa 的最长重复是 aaa 出现在 0 和 1", () => {
  const cps = toCodePoints("aaaa");
  const { sa } = buildSuffixArray(cps);
  const res = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(res.maxLengthCp, 3);
  assert.deepEqual(res.fragments[0].startsCp, [0, 1]);
});

test("多组并列最长片段按字典序且去重", () => {
  const cps = toCodePoints("abcabxabcd");
  const { sa } = buildSuffixArray(cps);
  const res = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(res.maxLengthCp, 3);
  assert.deepEqual(res.fragments.map((f) => f.text), ["abc"]);
  checkText("xyabzabwab"); // "ab" 多处
});

test("结果数量上限与截断标志", () => {
  const cps = toCodePoints("abab");
  const { sa } = buildSuffixArray(cps);
  const res = findLongestRepeats(cps, sa, buildLcp(cps, sa), 100);
  assert.equal(res.maxLengthCp, 2);
  assert.equal(res.truncated, false);
});

test("UTF-16 映射：表情不拆代理对", () => {
  const text = "a😀b";
  const map = buildUtf16Map(text);
  assert.deepEqual(map, [0, 1, 3, 4]);
  const cps = toCodePoints(text);
  assert.equal(cps.length, 3);
  assert.equal(cps[1], 0x1f600);
});

test("孤立代理项被拒绝", () => {
  assert.throws(() => validateText("abc\uD800"), (e: any) => e instanceof ApiError && e.code === "LONE_SURROGATE");
  assert.throws(() => validateText("\uDC00\uD800"), (e: any) => e.code === "LONE_SURROGATE");
  assert.equal(validateText("😀"), "😀");
});

test("lcpOfSuffixes 逐字符一致", () => {
  const cps = toCodePoints("banana");
  assert.equal(lcpOfSuffixes(cps, 1, 3), 3); // ana
  assert.equal(lcpOfSuffixes(cps, 0, 2), 0);
  assert.equal(lcpOfSuffixes(cps, 2, 2), 4); // 自身
});

test("伪随机小文本交叉验证", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  const alphabet = ["a", "b", "c", "中", "😀"];
  for (let t = 0; t < 200; t++) {
    const len = rnd() % 25;
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[rnd() % alphabet.length];
    checkText(s);
  }
});
