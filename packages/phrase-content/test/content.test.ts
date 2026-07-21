import { describe, expect, it } from "vitest";
import {
  GARBAGE_PHRASES,
  PHRASES,
  validatePhrases,
} from "@type-burst/phrase-content";

describe("phrase-content", () => {
  it("検証エラーがない", () => {
    const issues = validatePhrases();
    expect(issues).toEqual([]);
  });

  it("Vertical Slice の必要件数(標準30件以上)を満たす", () => {
    expect(PHRASES.length).toBeGreaterThanOrEqual(30);
    expect(GARBAGE_PHRASES.length).toBeGreaterThanOrEqual(8);
  });

  it("各 Tier に問題が存在する", () => {
    for (const tier of ["micro", "short", "standard", "long"] as const) {
      expect(PHRASES.filter((p) => p.tier === tier).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("moraCount が読み仮名から計算されている", () => {
    const sample = PHRASES.find((p) => p.id === "daily_0001");
    expect(sample?.moraCount).toBe(9);
  });
});
