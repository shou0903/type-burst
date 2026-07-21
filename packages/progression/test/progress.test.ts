import { describe, expect, it } from "vitest";
import {
  accumulateProgress,
  defaultLifetimeProgress,
  mergeLifetimeProgress,
  type PlayContribution,
} from "../src/progress";

const play = (overrides: Partial<PlayContribution> = {}): PlayContribution => ({
  score: 1000,
  kpm: 200,
  accuracy: 0.95,
  phraseCount: 5,
  maxChain: 3,
  playtimeMs: 30_000,
  ...overrides,
});

describe("defaultLifetimeProgress", () => {
  it("すべて0の初期状態を返す(新規プレイヤー)", () => {
    const p = defaultLifetimeProgress();
    expect(p.totalGames).toBe(0);
    expect(p.totalScore).toBe(0);
    expect(p.bestScore).toBe(0);
    expect(p.bestKpm).toBe(0);
    expect(p.bestAccuracy).toBe(0);
    expect(p.totalPhrases).toBe(0);
    expect(p.totalPlaytimeMs).toBe(0);
    expect(p.maxChainEver).toBe(0);
  });
});

describe("mergeLifetimeProgress (後方互換性)", () => {
  it("未保存(null/undefined)なら例外を投げずデフォルト値を返す", () => {
    expect(mergeLifetimeProgress(null)).toEqual(defaultLifetimeProgress());
    expect(mergeLifetimeProgress(undefined)).toEqual(defaultLifetimeProgress());
  });

  it("壊れたデータ(配列・プリミティブ)でも例外を投げずデフォルト値を返す", () => {
    expect(mergeLifetimeProgress([1, 2, 3])).toEqual(defaultLifetimeProgress());
    expect(mergeLifetimeProgress("garbage")).toEqual(defaultLifetimeProgress());
    expect(mergeLifetimeProgress(42)).toEqual(defaultLifetimeProgress());
  });

  it("一部フィールドのみ保存されている(将来のバージョンで項目が増えた場合を想定)場合、有効な値は保持し欠損分は既定値で補う", () => {
    const merged = mergeLifetimeProgress({ totalGames: 12, bestScore: 34000 });
    expect(merged.totalGames).toBe(12);
    expect(merged.bestScore).toBe(34000);
    expect(merged.totalScore).toBe(0);
    expect(merged.maxChainEver).toBe(0);
  });

  it("型の違う値(文字列が数値フィールドに入っている等)が混入していても無視してデフォルト値にフォールバックする", () => {
    const merged = mergeLifetimeProgress({ totalGames: "12", bestScore: null, maxChainEver: NaN });
    expect(merged.totalGames).toBe(0);
    expect(merged.bestScore).toBe(0);
    expect(merged.maxChainEver).toBe(0);
  });
});

describe("accumulateProgress", () => {
  it("1プレイ目: totalGamesが1になり、各値がそのプレイの値になる", () => {
    const next = accumulateProgress(defaultLifetimeProgress(), play());
    expect(next.totalGames).toBe(1);
    expect(next.totalScore).toBe(1000);
    expect(next.bestScore).toBe(1000);
    expect(next.bestKpm).toBe(200);
    expect(next.bestAccuracy).toBe(0.95);
    expect(next.totalPhrases).toBe(5);
    expect(next.totalPlaytimeMs).toBe(30_000);
    expect(next.maxChainEver).toBe(3);
  });

  it("複数プレイ: 累計は加算、ベスト系は最大値を維持する", () => {
    let progress = defaultLifetimeProgress();
    progress = accumulateProgress(progress, play({ score: 1000, kpm: 200, accuracy: 0.9, maxChain: 3 }));
    progress = accumulateProgress(progress, play({ score: 500, kpm: 300, accuracy: 0.8, maxChain: 6 }));

    expect(progress.totalGames).toBe(2);
    expect(progress.totalScore).toBe(1500);
    // ベストスコアは高い方(1000)のまま
    expect(progress.bestScore).toBe(1000);
    // ベストKPMは高い方(300)を採用
    expect(progress.bestKpm).toBe(300);
    // ベスト正確率は高い方(0.9)を維持
    expect(progress.bestAccuracy).toBe(0.9);
    // 最大連鎖は6を採用
    expect(progress.maxChainEver).toBe(6);
    expect(progress.totalPhrases).toBe(10);
    expect(progress.totalPlaytimeMs).toBe(60_000);
  });

  it("元のprogressを変更しない(純粋関数)", () => {
    const original = defaultLifetimeProgress();
    const snapshot = { ...original };
    accumulateProgress(original, play());
    expect(original).toEqual(snapshot);
  });
});
