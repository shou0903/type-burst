import type { SurvivalSummary } from "@type-burst/game-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_RANKED_ATTEMPTS,
  DAILY_RULESET_VERSION,
  dailyBestScore,
  dailyAttempts,
  dailyChallengeId,
  loadDailyProgress,
  loadDailyPlayerId,
  recordDailyResult,
} from "./daily";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

function summary(score: number): SurvivalSummary {
  return {
    score,
    survivedMs: 120_000,
    timeLimitMs: 120_000,
    finishReason: "timeLimit",
  } as SurvivalSummary;
}

describe("player id migration", () => {
  it("reuses the legacy daily player id for the shared player id", () => {
    const legacyId = "8b5f2a0c-03a8-4f7a-9a77-123456789abc";
    storage.clear();
    storage.set("typeblast.daily-player.v1", legacyId);
    expect(loadDailyPlayerId()).toBe(legacyId);
    expect(storage.get("typeblast.player-id.v1")).toBe(legacyId);
  });
});

describe("デイリーチャレンジ", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("日付は日本時間を基準にする", () => {
    expect(dailyChallengeId(new Date("2026-07-23T14:59:59.000Z"))).toBe("2026-07-23");
    expect(dailyChallengeId(new Date("2026-07-23T15:00:00.000Z"))).toBe("2026-07-24");
  });

  it("ランキング対象は1日3回までで、練習はベストだけ更新する", () => {
    const challengeId = "2026-07-23";
    for (let attempt = 1; attempt <= DAILY_RANKED_ATTEMPTS; attempt += 1) {
      recordDailyResult(challengeId, summary(attempt * 100), true);
    }
    recordDailyResult(challengeId, summary(999), false);

    const progress = loadDailyProgress();
    expect(dailyAttempts(progress, challengeId)).toBe(3);
    expect(progress.days[challengeId]?.bestScore).toBe(999);
    expect(progress.days[challengeId]?.rulesetVersion).toBe(DAILY_RULESET_VERSION);
  });

  it("旧ルールの当日記録は連続記録を保ったまま新ルールの3回へ切り替わる", () => {
    const challengeId = "2026-07-26";
    storage.set("typeblast.daily.v1", JSON.stringify({
      version: 1,
      currentStreak: 4,
      bestStreak: 4,
      freezes: 0,
      lastPlayedDate: challengeId,
      playedDates: [challengeId],
      protectedDates: [],
      days: {
        [challengeId]: { attempts: 3, bestScore: 5000, lastPlayedAt: "2026-07-26T00:00:00.000Z" },
      },
    }));

    const before = loadDailyProgress();
    expect(dailyAttempts(before, challengeId)).toBe(0);
    expect(dailyBestScore(before, challengeId)).toBe(0);

    const result = recordDailyResult(challengeId, summary(7000), true);
    expect(result.firstPlayToday).toBe(false);
    expect(result.progress.currentStreak).toBe(4);
    expect(dailyAttempts(result.progress, challengeId)).toBe(1);
    expect(dailyBestScore(result.progress, challengeId)).toBe(7000);
  });

  it("7日継続で休み券を獲得し、1日の空白を保護できる", () => {
    for (let day = 1; day <= 7; day += 1) {
      recordDailyResult(
        `2026-07-${String(day).padStart(2, "0")}`,
        summary(day * 100),
        true,
      );
    }

    const afterSevenDays = loadDailyProgress();
    expect(afterSevenDays.currentStreak).toBe(7);
    expect(afterSevenDays.freezes).toBe(1);

    const protectedResult = recordDailyResult(
      "2026-07-09",
      summary(900),
      true,
    );
    expect(protectedResult.freezeUsed).toBe(true);
    expect(protectedResult.progress.currentStreak).toBe(8);
    expect(protectedResult.progress.freezes).toBe(0);
    expect(protectedResult.progress.protectedDates).toContain("2026-07-08");
  });
});
