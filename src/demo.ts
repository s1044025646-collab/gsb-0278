import { Service } from "./service.js";

/** 内置演示：banana、ana、中文、表情、全相同字符、多组并列最长。 */
export function runDemo(service: Service): void {
  const samples: [string, string][] = [
    ["banana", "banana（经典样例，ana 出现两次，位置 1 和 3）"],
    ["白日依山尽，黄河入海流。白日依山尽。", "中文重复"],
    ["a😀b😀a😀b", "表情（代理对）重复"],
    ["aaaaaa", "全相同字符（重叠重复）"],
    ["abcabxabcd", "多组并列最长片段"],
  ];
  for (const [text, label] of samples) {
    const { id } = service.importDocument(text);
    service.buildIndex(id);
    const r = service.longestRepeat(id);
    console.log(`\n=== ${label} ===`);
    console.log(`文本: ${JSON.stringify(text)} (id=${id})`);
    if (!r.exists) {
      console.log("不存在非空重复片段");
    } else {
      for (const f of r.fragments) {
        console.log(
          `  片段 ${JSON.stringify(f.text)} 长度=${f.lengthCp} 起点(码点)=${JSON.stringify(f.startsCp)} 起点(UTF-16)=${JSON.stringify(f.startsUtf16)}`
        );
      }
      if (r.truncated) console.log(`  …已截断，总计 ${r.totalFragments} 个片段`);
    }
  }
  service.store.close();
}
