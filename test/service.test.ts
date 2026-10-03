import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store.js";
import { Service } from "../src/service.js";

function makeService(): { svc: Service; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-test-"));
  const svc = new Service(new Store(path.join(dir, "app.db")));
  return { svc, dir };
}

test("导入-构建-查询-报告 全流程", () => {
  const { svc } = makeService();
  const { id, version } = svc.importDocument("banana");
  assert.equal(version, 1);
  const b = svc.buildIndex(id);
  assert.equal(b.suffixCount, 6);
  assert.ok(b.roundCount >= 2);

  const sfx = svc.getSuffixes(id, undefined, 0, 10);
  assert.equal(sfx.items[0].suffixPreview, "a");
  assert.equal(sfx.items[1].suffixPreview, "ana");
  assert.equal(sfx.items[2].lcpWithPrev, 3);
  assert.ok(Array.isArray(sfx.rounds)); // 小文本保留完整轮次

  const r = svc.longestRepeat(id);
  assert.equal(r.maxLengthCp, 3);
  assert.equal(r.fragments[0].text, "ana");
  assert.deepEqual(r.fragments[0].startsCp, [1, 3]);
  assert.deepEqual(r.fragments[0].startsUtf16, [1, 3]);

  const l = svc.lcpQuery(id, 1, 3);
  assert.equal(l.lcpLengthCp, 3);
  assert.equal(l.prefix, "ana");

  const rep = svc.report(id);
  assert.equal(rep.document.text, "banana");
  assert.equal(rep.index.emptySuffixIncluded, false);
  svc.store.close();
});

test("修改原文创建新版本，旧版本索引仍可读", () => {
  const { svc } = makeService();
  const { id } = svc.importDocument("banana");
  svc.buildIndex(id);
  const v2 = svc.updateDocument(id, "abcdef");
  assert.equal(v2.version, 2);
  // 旧版本结果不变
  const r1 = svc.longestRepeat(id, 1);
  assert.equal(r1.fragments[0].text, "ana");
  // 新版本未构建索引时报 INDEX_NOT_BUILT
  assert.throws(() => svc.longestRepeat(id, 2), (e: any) => e.code === "INDEX_NOT_BUILT");
  svc.buildIndex(id, 2);
  const r2 = svc.longestRepeat(id, 2);
  assert.equal(r2.exists, false);
  svc.store.close();
});

test("表情文本的 UTF-16 偏移", () => {
  const { svc } = makeService();
  const { id } = svc.importDocument("a😀b😀a😀b");
  svc.buildIndex(id);
  const r = svc.longestRepeat(id);
  assert.equal(r.maxLengthCp, 3); // "a😀b"
  assert.equal(r.fragments[0].text, "a😀b");
  assert.deepEqual(r.fragments[0].startsCp, [0, 4]);
  assert.deepEqual(r.fragments[0].startsUtf16, [0, 6]);
  svc.store.close();
});

test("错误码：孤立代理项 / 超长 / 未找到 / 参数", () => {
  const { svc } = makeService();
  assert.throws(() => svc.importDocument("x\uD800"), (e: any) => e.code === "LONE_SURROGATE");
  assert.throws(() => svc.importDocument(123), (e: any) => e.code === "INVALID_INPUT");
  assert.throws(() => svc.importDocument("a".repeat(200_001)), (e: any) => e.code === "DOC_TOO_LARGE");
  assert.throws(() => svc.buildIndex(999), (e: any) => e.code === "NOT_FOUND");
  const { id } = svc.importDocument("banana");
  svc.buildIndex(id);
  assert.throws(() => svc.lcpQuery(id, 0, 99), (e: any) => e.code === "INVALID_INPUT");
  svc.store.close();
});

test("长文本只保存轮次摘要", () => {
  const { svc } = makeService();
  const { id } = svc.importDocument("ab".repeat(100));
  const b = svc.buildIndex(id);
  assert.equal(b.roundsKept, "summary");
  const sfx = svc.getSuffixes(id, undefined, 0, 5);
  assert.equal(sfx.rounds, null);
  assert.ok(sfx.roundsSummary.roundCount >= 1);
  svc.store.close();
});

test("重启后可读取索引与原始片段（重新打开同一 DB）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-test-"));
  const dbPath = path.join(dir, "app.db");
  let svc = new Service(new Store(dbPath));
  const { id } = svc.importDocument("mississippi");
  svc.buildIndex(id);
  svc.longestRepeat(id);
  svc.store.close();

  svc = new Service(new Store(dbPath));
  const r = svc.longestRepeat(id);
  assert.equal(r.maxLengthCp, 4); // "issi"
  assert.deepEqual(r.fragments[0].startsCp, [1, 4]);
  const rep = svc.report(id);
  assert.equal(rep.document.text, "mississippi");
  svc.store.close();
});

