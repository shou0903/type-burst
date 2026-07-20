import { TypingAutomaton, countMora } from "@type-burst/typing-engine";
import { GARBAGE_PHRASE_SEEDS, PHRASE_SEEDS } from "./phrases";
import type { JapanesePhrase, PhraseSeed, PhraseTier } from "./types";

export type { JapanesePhrase, PhraseTier } from "./types";

/** Tier のモーラ帯域(DECISIONS.md D-003) */
export const TIER_MORA_RANGE: Record<PhraseTier, { min: number; max: number }> = {
  short: { min: 4, max: 7 },
  standard: { min: 8, max: 12 },
  long: { min: 13, max: 26 },
};

function build(seed: PhraseSeed): JapanesePhrase {
  return {
    ...seed,
    moraCount: countMora(seed.readingKana),
    weight: seed.weight ?? 1,
    enabled: true,
    source: "original",
  };
}

export const PHRASES: readonly JapanesePhrase[] = PHRASE_SEEDS.map(build);
export const GARBAGE_PHRASES: readonly JapanesePhrase[] = GARBAGE_PHRASE_SEEDS.map(build);

export interface ContentIssue {
  phraseId: string;
  problem: string;
}

const ASCII_PATTERN = /[A-Za-z0-9_@:/.\\]/;

/**
 * ビルド時・テスト時のコンテンツ検証(設計書 §26)。
 * ID重複、空文字、読み仮名不正、Tier帯域、英字・URL・コード断片混入を検出する。
 */
export function validatePhrases(
  phrases: readonly JapanesePhrase[] = [...PHRASES, ...GARBAGE_PHRASES],
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();

  for (const phrase of phrases) {
    if (seenIds.has(phrase.id)) {
      issues.push({ phraseId: phrase.id, problem: "ID重複" });
    }
    seenIds.add(phrase.id);

    if (phrase.displayText.trim() === "" || phrase.readingKana.trim() === "") {
      issues.push({ phraseId: phrase.id, problem: "空文字" });
      continue;
    }

    if (seenTexts.has(phrase.displayText)) {
      issues.push({ phraseId: phrase.id, problem: "表示文重複" });
    }
    seenTexts.add(phrase.displayText);

    if (ASCII_PATTERN.test(phrase.displayText)) {
      issues.push({ phraseId: phrase.id, problem: "英字・記号の混入" });
    }

    try {
      // 受理グラフが構築できること = 読み仮名が全て入力可能であること
      const automaton = new TypingAutomaton(phrase.readingKana);
      if (automaton.getCanonicalRomaji().length === 0) {
        issues.push({ phraseId: phrase.id, problem: "ローマ字列が空" });
      }
    } catch (e) {
      issues.push({ phraseId: phrase.id, problem: `読み仮名不正: ${String(e)}` });
    }

    const range = TIER_MORA_RANGE[phrase.tier];
    if (phrase.moraCount < range.min || phrase.moraCount > range.max) {
      issues.push({
        phraseId: phrase.id,
        problem: `Tier不一致: ${phrase.tier} なのに ${phrase.moraCount} モーラ`,
      });
    }

    if (phrase.displayText.length > 20) {
      issues.push({ phraseId: phrase.id, problem: "表示文が長すぎる(20文字超)" });
    }
  }

  return issues;
}
