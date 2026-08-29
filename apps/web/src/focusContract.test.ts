import { describe, expect, it } from "vitest";
import type { GameEvent } from "@type-burst/game-core";
import {
  advanceFocusProgress,
  createFocusProgress,
  DEFAULT_FOCUS_GOAL,
  focusProgressFromResult,
  focusProgressText,
  isFocusEligibleMode,
  resetFocusProgress,
} from "./focusContract";

const event = (value: GameEvent): GameEvent => value;

describe("FOCUS progress", () => {
  it("starts with the deterministic default goal and can be reset", () => {
    const initial = createFocusProgress(DEFAULT_FOCUS_GOAL);
    expect(initial).toMatchObject({
      goal: "perfect-streak",
      current: 0,
      target: 3,
      ratio: 0,
      achieved: false,
    });

    const progressed = advanceFocusProgress(
      initial,
      event({ type: "phraseCompleted", blockId: 1, perfect: true }),
    );
    expect(resetFocusProgress("chain-4")).toEqual(createFocusProgress("chain-4"));
    expect(progressed.current).toBe(1);
  });

  it("requires three consecutive PERFECT phrases and resets the streak on a miss", () => {
    let progress = createFocusProgress("perfect-streak");
    progress = advanceFocusProgress(
      progress,
      event({ type: "phraseCompleted", blockId: 1, perfect: true }),
    );
    progress = advanceFocusProgress(
      progress,
      event({ type: "phraseCompleted", blockId: 2, perfect: true }),
    );
    expect(progress).toMatchObject({ current: 2, ratio: 2 / 3, achieved: false });

    progress = advanceFocusProgress(
      progress,
      event({ type: "phraseCompleted", blockId: 3, perfect: false }),
    );
    expect(progress).toMatchObject({ current: 0, perfectStreak: 0, achieved: false });

    for (const blockId of [4, 5, 6]) {
      progress = advanceFocusProgress(
        progress,
        event({ type: "phraseCompleted", blockId, perfect: true }),
      );
    }
    expect(progress).toMatchObject({ current: 3, ratio: 1, achieved: true });
    expect(
      advanceFocusProgress(
        progress,
        event({ type: "phraseCompleted", blockId: 7, perfect: false }),
      ),
    ).toEqual(progress);
  });

  it("achieves the chain goal only at four or more chain depth", () => {
    let progress = createFocusProgress("chain-4");
    progress = advanceFocusProgress(
      progress,
      event({ type: "chainFinished", depth: 3, attackPower: 0, garbageCount: 0, scoreGained: 100 }),
    );
    expect(progress.achieved).toBe(false);
    progress = advanceFocusProgress(
      progress,
      event({ type: "chainFinished", depth: 4, attackPower: 0, garbageCount: 0, scoreGained: 100 }),
    );
    expect(progress).toMatchObject({ current: 4, ratio: 1, achieved: true });
  });

  it("requires an actual POWER or MAX burst firing", () => {
    let progress = createFocusProgress("power-burst");
    progress = advanceFocusProgress(
      progress,
      event({ type: "burstTierChanged", tier: "power", charge: 125 }),
    );
    expect(progress.achieved).toBe(false);
    progress = advanceFocusProgress(
      progress,
      event({ type: "burstFired", tier: "max", rows: 5, scoreGained: 100 }),
    );
    expect(progress).toMatchObject({ current: 1, ratio: 1, achieved: true });
    expect(focusProgressText(progress)).toBe("達成");
  });

  it("does not modify or depend on score-bearing events", () => {
    const progress = createFocusProgress("chain-4");
    const scoreBefore = 98765;
    const next = advanceFocusProgress(
      progress,
      event({ type: "blocksCleared", blocks: [], chain: 8, largestGroupSize: 5, cause: "direct", scoreGained: 999999 }),
    );
    expect(next).toEqual(progress);
    expect(scoreBefore).toBe(98765);
  });

  it("keeps FOCUS scoped to normal survival and rejects malformed result payloads", () => {
    expect(isFocusEligibleMode("survival")).toBe(true);
    expect(isFocusEligibleMode("daily")).toBe(false);
    expect(isFocusEligibleMode("duel")).toBe(false);
    expect(isFocusEligibleMode("tutorial")).toBe(false);

    const progress = createFocusProgress("chain-4");
    expect(
      focusProgressFromResult({ mode: "daily", focus: progress }),
    ).toBeNull();
    expect(focusProgressFromResult({ mode: "survival", focus: progress })).toEqual(progress);
    expect(focusProgressFromResult({ focus: { goal: "chain-4" } })).toBeNull();
    expect(focusProgressFromResult({ focus: { ...progress, ratio: 3 } })).toBeNull();
  });
});
