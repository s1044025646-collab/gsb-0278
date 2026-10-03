/** 文本工具：Unicode 码点与 UTF-16 偏移映射。 */

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** 校验文本：拒绝孤立代理项（非 well-formed 字符串）。 */
export function validateText(text: unknown): string {
  if (typeof text !== "string") {
    throw new ApiError("INVALID_INPUT", "text 必须是字符串");
  }
  if (!text.isWellFormed()) {
    throw new ApiError(
      "LONE_SURROGATE",
      "文本包含孤立代理项（lone surrogate），按 Unicode 公开规则拒绝处理"
    );
  }
  return text;
}

/** 将字符串转为码点数组（按码点计数，不拆分代理对）。 */
export function toCodePoints(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0)!);
}

/** 由码点数组还原字符串。 */
export function fromCodePoints(cps: number[]): string {
  return String.fromCodePoint(...cps);
}

/**
 * 构建码点索引 -> UTF-16 偏移 的映射表。
 * 返回数组长度为 cps.length + 1，最后一项为整个文本的 UTF-16 长度。
 */
export function buildUtf16Map(text: string): number[] {
  const map: number[] = new Array(1);
  map[0] = 0;
  let u16 = 0;
  for (const ch of text) {
    u16 += ch.length; // BMP 字符为 1，代理对为 2
    map.push(u16);
  }
  return map;
}

/** 码点区间 [startCp, startCp+lenCp) -> UTF-16 偏移区间。 */
export function cpRangeToUtf16(
  utf16Map: number[],
  startCp: number,
  lenCp: number
): { utf16Start: number; utf16End: number } {
  return { utf16Start: utf16Map[startCp], utf16End: utf16Map[startCp + lenCp] };
}
