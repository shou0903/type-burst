import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bestScore,
  loadTutorialCompleted,
  markTutorialCompleted,
  replaceResults,
  type StoredResult,
} from "./storage";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

const legacyResult = {
  score: 12_340,
  maxChain: 8,
  kpm: 210,
  accuracy: 0.98,
  phraseCount: 18,
  survivedMs: 60_000,
  playedAt: "2026-07-28T00:00:00.000Z",
};

describe("引き継ぎリザルトの復元", () => {
  beforeEach(() => storage.clear());

  it("難易度がなかった旧形式の記録を通常難易度として維持する", () => {
    const results = replaceResults([legacyResult]);
    expect(results).toEqual([{ ...legacyResult, difficulty: "normal", ruleset: "survival-v1" }]);
  });

  it("壊れた記録は復元しない", () => {
    expect(replaceResults([{ ...legacyResult, score: "not-a-number" }])).toEqual([]);
  });

  it("旧ルールと現行ルールのベストスコアを混ぜない", () => {
    const results: StoredResult[] = [
      { ...legacyResult, difficulty: "normal", score: 99_999, ruleset: "survival-v1" },
      { ...legacyResult, difficulty: "normal", score: 12_000, ruleset: "survival-v2" },
    ];
    expect(bestScore(results, "normal")).toBe(12_000);
    expect(bestScore(results, "normal", "survival-v1")).toBe(99_999);
  });
});

describe("初回チュートリアル完了フラグ", () => {
  beforeEach(() => storage.clear());

  it("未完了から完了へ変わり、localStorageに保存する", () => {
    expect(loadTutorialCompleted()).toBe(false);
    markTutorialCompleted();
    expect(loadTutorialCompleted()).toBe(true);
    expect(storage.get("typeblast.tutorial-completed.v1")).toBe("1");
  });
});
