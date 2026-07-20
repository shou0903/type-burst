import { normalizeKana } from "./kana";

const SMALL_YOUON = new Set(["ゃ", "ゅ", "ょ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゎ"]);

/**
 * モーラ数を数える。拗音(ゃゅょ 等)は直前のかなと合わせて1モーラ、
 * 促音「っ」と長音「ー」は1モーラと数える。
 */
export function countMora(reading: string): number {
  const normalized = normalizeKana(reading);
  let count = 0;
  for (const ch of normalized) {
    if (SMALL_YOUON.has(ch)) continue;
    count += 1;
  }
  return count;
}
