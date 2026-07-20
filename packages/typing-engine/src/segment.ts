import {
  KANA_TO_ROMAJI,
  N_ALWAYS,
  SOKUON_ALTERNATIVES,
  isVowelChar,
  normalizeKana,
} from "./kana";

/** 読み仮名を分割した1単位。alternatives の先頭が標準表記 */
export interface KanaSegment {
  kana: string;
  alternatives: readonly string[];
}

const SMALL_KANA = new Set(["ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゃ", "ゅ", "ょ", "ゎ"]);

interface ParsedUnit {
  kana: string;
  alternatives: string[];
  length: number; // 消費した文字数
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** っ・ん 以外の1単位(拗音含む)を読み取る */
function parseUnit(chars: readonly string[], i: number): ParsedUnit {
  const c1 = chars[i];
  if (c1 === undefined) {
    throw new Error("parseUnit: out of range");
  }
  const c2 = chars[i + 1];
  if (c2 !== undefined && SMALL_KANA.has(c2)) {
    const pair = c1 + c2;
    const alts: string[] = [];
    const direct = KANA_TO_ROMAJI[pair];
    if (direct) {
      alts.push(...direct);
    }
    // 分解入力(し + ゃ = sixya など)も受理する
    const base = KANA_TO_ROMAJI[c1];
    const small = KANA_TO_ROMAJI[c2];
    if (base && small) {
      for (const b of base) {
        for (const s of small) {
          alts.push(b + s);
        }
      }
    }
    if (alts.length > 0) {
      return { kana: pair, alternatives: dedupe(alts), length: 2 };
    }
  }
  const single = KANA_TO_ROMAJI[c1];
  if (!single) {
    throw new Error(`typing-engine: 未対応のかな「${c1}」`);
  }
  return { kana: c1, alternatives: [...single], length: 1 };
}

/**
 * 読み仮名をローマ字受理グラフのセグメント列へ変換する。
 * - 促音「っ」は次のセグメントと結合し、子音重複と xtu/ltu 系を受理
 * - 「ん」は次のセグメントに応じて単独 n の可否を判定
 * - カタカナはひらがなへ正規化
 */
export function segmentKana(reading: string): KanaSegment[] {
  const normalized = normalizeKana(reading);
  const chars = [...normalized];
  const segments: KanaSegment[] = [];
  let i = 0;

  while (i < chars.length) {
    const c = chars[i];
    if (c === undefined) break;

    if (c === "っ") {
      if (i + 1 >= chars.length || chars[i + 1] === "ん" || chars[i + 1] === "っ") {
        // 末尾などの単独促音は xtu 系のみ
        segments.push({ kana: "っ", alternatives: [...SOKUON_ALTERNATIVES] });
        i += 1;
        continue;
      }
      const next = parseUnit(chars, i + 1);
      const alts: string[] = [];
      for (const alt of next.alternatives) {
        const head = alt.charAt(0);
        // 子音開始なら先頭子音の重複で促音を表現(n 始まりは「ん」と衝突するため除外)
        if (!isVowelChar(head) && head !== "n" && head !== "-") {
          alts.push(head + alt);
        }
      }
      for (const soku of SOKUON_ALTERNATIVES) {
        for (const alt of next.alternatives) {
          alts.push(soku + alt);
        }
      }
      segments.push({ kana: "っ" + next.kana, alternatives: dedupe(alts) });
      i += 1 + next.length;
      continue;
    }

    if (c === "ん") {
      let allowSingleN = false;
      if (i + 1 < chars.length) {
        const nextChar = chars[i + 1];
        let nextAlts: readonly string[];
        if (nextChar === "っ") {
          nextAlts = SOKUON_ALTERNATIVES;
        } else if (nextChar === "ん") {
          nextAlts = ["n"];
        } else {
          nextAlts = parseUnit(chars, i + 1).alternatives;
        }
        // 次が母音・な行・や行で始まり得る場合、単独 n は曖昧になるため禁止
        allowSingleN = !nextAlts.some((alt) => {
          const head = alt.charAt(0);
          return isVowelChar(head) || head === "n" || head === "y";
        });
      }
      const alts = allowSingleN ? ["n", ...N_ALWAYS] : [...N_ALWAYS];
      segments.push({ kana: "ん", alternatives: alts });
      i += 1;
      continue;
    }

    const unit = parseUnit(chars, i);
    segments.push({ kana: unit.kana, alternatives: unit.alternatives });
    i += unit.length;
  }

  return segments;
}
