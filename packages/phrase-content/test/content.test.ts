import { describe, expect, it } from "vitest";
import {
  GARBAGE_PHRASES,
  PHRASES,
  VOCAB_THEMES,
  buildThemedPhrasePool,
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

describe("語彙テーマ(D-053)", () => {
  it("おまかせ(all)は全フレーズをそのまま返す", () => {
    const pool = buildThemedPhrasePool("all", PHRASES);
    expect(pool.length).toBe(PHRASES.length);
  });

  it("全テーマが、全Tierで健全なプールサイズ(フォールバック込みで十分な件数)を持つ", () => {
    for (const themeDef of VOCAB_THEMES) {
      const pool = buildThemedPhrasePool(themeDef.id, PHRASES);
      // PlayerCore は有効フレーズ数が10未満だと例外を投げるため、常に大きく上回る必要がある
      expect(pool.length).toBeGreaterThanOrEqual(30);
      for (const tier of ["micro", "short", "standard", "long"] as const) {
        // どのテーマでも各Tierに一定数存在すること(テーマ専用語彙が薄い場合は
        // グローバルへフォールバックするため、0件になることは起きないはず)
        expect(pool.filter((p) => p.tier === tier).length).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("ビジネス・季節テーマは対応カテゴリの専用語彙で構成される(フォールバック不要なほど充実)", () => {
    const business = buildThemedPhrasePool("business", PHRASES);
    expect(business.every((p) => p.category === "仕事")).toBe(true);

    const season = buildThemedPhrasePool("season", PHRASES);
    expect(season.every((p) => p.category === "季節")).toBe(true);
  });
});
