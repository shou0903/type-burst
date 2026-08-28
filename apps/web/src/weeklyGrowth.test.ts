import { describe, expect, it } from "vitest";
import type { StoredResult } from "./storage";
import { buildWeeklyGrowth, jstWeekStart } from "./weeklyGrowth";

const NOW = "2026-08-26T15:00:00.000Z"; // JST 8/27(木)。今週の境界は月曜 8/24 00:00 JST。
const CURRENT = "2026-08-23T15:00:00.000Z";
const PREVIOUS = "2026-08-16T15:00:00.000Z";

function result(overrides: Partial<StoredResult> = {}): StoredResult {
  return {
    score: 100,
    maxChain: 2,
    kpm: 180,
    accuracy: 0.9,
    phraseCount: 5,
    survivedMs: 60_000,
    playedAt: "2026-08-24T00:00:00.000Z",
    difficulty: "normal",
    ...overrides,
  };
}

describe("jstWeekStart", () => {
  it("switches at Monday 00:00 JST (UTC Sunday 15:00)", () => {
    expect(jstWeekStart("2026-08-23T14:59:59.999Z")?.toISOString()).toBe(PREVIOUS);
    expect(jstWeekStart("2026-08-23T15:00:00.000Z")?.toISOString()).toBe(CURRENT);
  });

  it("rejects an invalid date", () => {
    expect(jstWeekStart("not-a-date")).toBeNull();
  });
});

describe("buildWeeklyGrowth", () => {
  it("uses the newest valid survival record, not array order, for difficulty", () => {
    const summary = buildWeeklyGrowth(
      [
        result({ difficulty: "hard", playedAt: "2026-08-24T02:00:00.000Z", score: 999 }),
        result({ difficulty: "normal", playedAt: "2026-08-24T01:00:00.000Z", score: 240 }),
        result({ mode: "daily", difficulty: "god", playedAt: "2026-08-24T09:00:00.000Z", score: 9_999 }),
        result({ difficulty: "god", playedAt: "not-a-date", score: 8_888 }),
        result({ difficulty: "normal", playedAt: PREVIOUS, score: 180 }),
      ],
      NOW,
    );

    expect(summary.difficulty).toBe("hard");
    expect(summary.currentWeek.playCount).toBe(1);
    expect(summary.currentWeek.bestScore).toBe(999);
    expect(summary.previousWeek.playCount).toBe(0);
  });

  it("treats legacy mode-less records as survival and isolates difficulty", () => {
    const summary = buildWeeklyGrowth(
      [
        result({ mode: undefined, difficulty: "easy", playedAt: "2026-08-24T01:00:00.000Z", score: 300 }),
        result({ mode: "daily", difficulty: "easy", playedAt: "2026-08-24T02:00:00.000Z", score: 9_000 }),
        result({ mode: undefined, ruleset: "daily-v2", difficulty: "god", playedAt: "2026-08-24T04:00:00.000Z", score: 12_000 }),
        result({ mode: undefined, difficulty: "easy", playedAt: PREVIOUS, score: 200 }),
        result({ mode: undefined, difficulty: "god", playedAt: "2026-08-24T03:00:00.000Z", score: 800 }),
      ],
      NOW,
    );

    expect(summary.difficulty).toBe("god");
    expect(summary.currentWeek.playCount).toBe(1);
    expect(summary.currentWeek.bestScore).toBe(800);
    expect(summary.previousWeek.playCount).toBe(0);
  });

  it("returns empty, current-only, and no-current states without a growth claim", () => {
    expect(buildWeeklyGrowth([], NOW)).toMatchObject({
      status: "empty",
      difficulty: null,
      bestScoreDelta: null,
      bestScoreTrend: "unavailable",
    });

    const currentOnly = buildWeeklyGrowth(
      [result({ playedAt: CURRENT, score: 300 })],
      NOW,
    );
    expect(currentOnly.status).toBe("current-only");
    expect(currentOnly.currentWeek.playCount).toBe(1);
    expect(currentOnly.previousWeek.playCount).toBe(0);
    expect(currentOnly.bestScoreDelta).toBeNull();
    expect(currentOnly.bestScoreTrend).toBe("unavailable");

    const noCurrent = buildWeeklyGrowth(
      [result({ playedAt: PREVIOUS, score: 200 })],
      NOW,
    );
    expect(noCurrent.status).toBe("no-current");
    expect(noCurrent.currentWeek.playCount).toBe(0);
    expect(noCurrent.previousWeek.playCount).toBe(1);
    expect(noCurrent.bestScoreDelta).toBeNull();
  });

  it.each([
    ["up", 300, 200, 100],
    ["down", 150, 200, -50],
    ["flat", 200, 200, 0],
  ] as const)("compares best scores (%s) with a numeric delta", (trend, current, previous, delta) => {
    const summary = buildWeeklyGrowth(
      [
        result({ playedAt: CURRENT, score: current }),
        result({ playedAt: PREVIOUS, score: previous }),
      ],
      NOW,
    );
    expect(summary.status).toBe("comparison");
    expect(summary.bestScoreDelta).toBe(delta);
    expect(summary.bestScoreTrend).toBe(trend);
  });
});
