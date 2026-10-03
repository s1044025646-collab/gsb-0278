import { ApiError } from "./errors";

/**
 * 校验文本：按 Unicode 公开规则拒绝孤立代理项（lone surrogate）。
 * 高代理项(0xD800-0xDBFF)后必须紧跟低代理项(0xDC00-0xDFFF)，反之低代理项不得单独出现。
 */
export function validateText(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const cu = text.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new ApiError(
          "INVALID_TEXT",
          `文本包含孤立高代理项（UTF-16 偏移 ${i}），按 Unicode 规则拒绝处理`
        );
      }
      i++;
    } else if (cu >= 0xdc00 && cu <= 0xdfff) {
      throw new ApiError(
        "INVALID_TEXT",
        `文本包含孤立低代理项（UTF-16 偏移 ${i}），按 Unicode 规则拒绝处理`
      );
    }
  }
}

/** 文本 -> Unicode 码点数组（字符比较与排序均按码点值）。 */
export function toCodePoints(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0)!);
}

/** utf16Offsets[i] = 第 i 个码点在 JavaScript UTF-16 字符串中的起始偏移；末尾附 text.length。 */
export function utf16OffsetTable(text: string): number[] {
  const table: number[] = [0];
  let u16 = 0;
  for (const ch of text) {
    u16 += ch.length;
    table.push(u16);
  }
  return table;
}

/** 按码点区间取子串。 */
export function sliceByCp(text: string, cpStart: number, cpLength: number): string {
  return Array.from(text).slice(cpStart, cpStart + cpLength).join("");
}
