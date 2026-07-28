import { describe, expect, it } from "vitest";
import type { JapanesePhrase } from "@type-burst/phrase-content";
import {
  buildWeakKeyPromptMap,
  buildWeakKeyPrompts,
  countKey,
  normalizeTargetKey,
} from "./weakKeyPrompts";

const phrases: readonly JapanesePhrase[] = [
  {
    id: "ramen",
    displayText: "ラーメン",
    readingKana: "らーめん",
    tier: "short",
    category: "test",
    moraCount: 4,
    weight: 1,
    enabled: true,
    source: "original",
  },
  {
    id: "sushi",
    displayText: "寿司",
    readingKana: "すし",
    tier: "micro",
    category: "test",
    moraCount: 2,
    weight: 1,
    enabled: true,
    source: "original",
  },
];

describe("苦手キー練習の課題抽出", () => {
  it("対象キーを1文字へ正規化する", () => {
    expect(normalizeTargetKey(" R ")).toBe("r");
    expect(normalizeTargetKey("rr")).toBe("");
    expect(normalizeTargetKey("1")).toBe("");
  });

  it("対象キーの出現回数を数える", () => {
    expect(countKey("ra-men", "R")).toBe(1);
    expect(countKey("banana", "a")).toBe(3);
  });

  it("標準ローマ字に対象キーを含む課題だけを返す", () => {
    const prompts = buildWeakKeyPrompts("r", phrases);
    expect(prompts.map((prompt) => prompt.id)).toEqual(["ramen"]);
    expect(prompts[0]?.canonicalRomaji).toContain("r");
    expect(prompts[0]?.targetCount).toBeGreaterThan(0);
  });

  it("実際の単語データから主要キーの練習課題を作れる", () => {
    const promptMap = buildWeakKeyPromptMap();
    for (const key of ["a", "i", "u", "e", "o", "k", "s", "t", "n", "h", "m", "y", "r", "w"]) {
      expect(promptMap.get(key)?.length, `${key}キーの課題`).toBeGreaterThanOrEqual(10);
    }
  });
});
