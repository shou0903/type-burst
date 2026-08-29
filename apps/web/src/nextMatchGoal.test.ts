import { describe, expect, it } from "vitest";
import type { StoredResult } from "./storage";
import {
  buildNextMatchGoal,
  deriveMatchGoal,
  isMatchGoalAchieved,
  type GoalSource,
} from "./nextMatchGoal";
import { SURVIVAL_RULESET } from "./storage";

function source(overrides: Partial<GoalSource> = {}): GoalSource {
  return {
    score: 100,
    maxChain: 2,
    accuracy: 0.9,
    difficulty: "normal",
    ...overrides,
  };
}

function result(overrides: Partial<StoredResult> = {}): StoredResult {
  return {
    ...source(),
    phraseCount: 4,
    kpm: 180,
    survivedMs: 60_000,
    playedAt: "2026-08-27T00:00:00.000Z",
    ruleset: SURVIVAL_RULESET,
    ...overrides,
  };
}

describe("deriveMatchGoal", () => {
  it("prioritizes a one-point accuracy improvement and caps it at 95%", () => {
    const goal = deriveMatchGoal(source({ accuracy: 0.9, maxChain: 9, score: 999 }));
    expect(goal.kind).toBe("accuracy");
    expect(goal.target).toBeCloseTo(0.91);
    expect(goal.targetText).toContain("91.0%");

    const capped = deriveMatchGoal(source({ accuracy: 0.949, maxChain: 9, score: 999 }));
    expect(capped.kind).toBe("accuracy");
    expect(capped.target).toBe(0.95);
  });

  it("uses one additional chain when accuracy is already at least 95%", () => {
    const goal = deriveMatchGoal(source({ accuracy: 0.95, maxChain: 4, score: 999 }));
    expect(goal.kind).toBe("chain");
    expect(goal.target).toBe(5);
    expect(goal.targetText).toContain("5");
  });

  it("uses a rounded-up five-percent score target after accuracy and chain", () => {
    const goal = deriveMatchGoal(source({ accuracy: 0.98, maxChain: 5, score: 100 }));
    expect(goal.kind).toBe("score");
    expect(goal.target).toBe(105);
    expect(goal.targetText).toContain("105");
  });
});

describe("buildNextMatchGoal", () => {
  it("compares the current result with the previous goal of the same difficulty", () => {
    const current = source({ accuracy: 0.94, maxChain: 3, score: 200 });
    const previous = result({ accuracy: 0.9, maxChain: 7, score: 500, difficulty: "normal" });
    const unrelated = result({ accuracy: 0.5, score: 9_999, difficulty: "hard" });
    const daily = result({ mode: "daily", accuracy: 0.1, score: 20_000, difficulty: "normal" });
    const summary = buildNextMatchGoal(current, [unrelated, daily, previous]);

    expect(summary.difficulty).toBe("normal");
    expect(summary.goal.kind).toBe("accuracy");
    expect(summary.previous?.goal.kind).toBe("accuracy");
    expect(summary.previous?.goal.target).toBeCloseTo(0.91);
    expect(summary.previous?.achieved).toBe(true);
  });

  it("evaluates previous chain and score goals independently", () => {
    const chainCurrent = source({ accuracy: 0.97, maxChain: 5, score: 100 });
    const chainPrevious = result({ accuracy: 0.97, maxChain: 4, score: 100 });
    const chainSummary = buildNextMatchGoal(chainCurrent, [chainPrevious]);
    expect(chainSummary.previous?.goal.kind).toBe("chain");
    expect(chainSummary.previous?.achieved).toBe(true);

    const scoreCurrent = source({ accuracy: 0.97, maxChain: 5, score: 105 });
    const scorePrevious = result({ accuracy: 0.97, maxChain: 5, score: 100 });
    const scoreSummary = buildNextMatchGoal(scoreCurrent, [scorePrevious]);
    expect(scoreSummary.previous?.goal.kind).toBe("score");
    expect(scoreSummary.previous?.goal.target).toBe(105);
    expect(scoreSummary.previous?.achieved).toBe(true);
  });

  it("supports evaluating a not-yet-achieved goal", () => {
    const goal = deriveMatchGoal(source({ accuracy: 0.97, maxChain: 5, score: 100 }));
    expect(isMatchGoalAchieved(goal, source({ accuracy: 0.97, maxChain: 5, score: 104 }))).toBe(false);
    expect(isMatchGoalAchieved(goal, source({ accuracy: 0.97, maxChain: 5, score: 105 }))).toBe(true);
  });

  it("keeps the previous goal when consecutive results have identical metrics", () => {
    const current = source({ accuracy: 0.9, maxChain: 2, score: 100 });
    const summary = buildNextMatchGoal(current, [result(current)]);
    expect(summary.previous?.goal.kind).toBe("accuracy");
    expect(summary.previous?.achieved).toBe(false);
  });

  it("excludes a daily-v2 ruleset even when mode is absent", () => {
    const current = source({ accuracy: 0.94, maxChain: 3, score: 200 });
    const daily = result({ mode: undefined, ruleset: "daily-v2", accuracy: 0.9 });
    expect(buildNextMatchGoal(current, [daily]).previous).toBeNull();
  });

  it("does not compare a legacy survival-v1 result with a current survival-v2 result", () => {
    const current = source({ accuracy: 0.94, maxChain: 3, score: 200 });
    const legacy = result({ ruleset: "survival-v1", accuracy: 0.9, score: 9_999 });
    expect(buildNextMatchGoal(current, [legacy]).previous).toBeNull();
  });
});
