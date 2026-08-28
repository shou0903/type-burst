import { describe, expect, it } from "vitest";
import { defaultLifetimeProgress } from "@type-burst/progression";
import type { DailyProgress } from "./daily";
import type { DuelRecord, StoredResult } from "./storage";
import { hasRecordedPlay } from "./onboarding";

const emptyDaily: DailyProgress = {
  version: 1,
  currentStreak: 0,
  bestStreak: 0,
  freezes: 0,
  lastPlayedDate: null,
  playedDates: [],
  protectedDates: [],
  days: {},
};
const emptyDuel: DuelRecord = {
  easy: { wins: 0, losses: 0 },
  normal: { wins: 0, losses: 0 },
  hard: { wins: 0, losses: 0 },
};

describe("first-run backward compatibility", () => {
  it("treats a truly empty device as first run", () => {
    expect(hasRecordedPlay(defaultLifetimeProgress(), [], emptyDaily, emptyDuel)).toBe(false);
  });

  it("recognizes legacy results even when lifetime progress is missing", () => {
    const legacyResult = {
      score: 100,
      maxChain: 2,
      kpm: 120,
      accuracy: 0.95,
      phraseCount: 4,
      survivedMs: 30_000,
      playedAt: "2026-01-01T00:00:00.000Z",
      difficulty: "normal",
    } satisfies StoredResult;
    expect(hasRecordedPlay(defaultLifetimeProgress(), [legacyResult], emptyDaily, emptyDuel)).toBe(true);
  });

  it("recognizes old duel and daily records without lifetime progress", () => {
    expect(
      hasRecordedPlay(defaultLifetimeProgress(), [], emptyDaily, {
        ...emptyDuel,
        hard: { wins: 1, losses: 0 },
      }),
    ).toBe(true);
    expect(
      hasRecordedPlay(defaultLifetimeProgress(), [], {
        ...emptyDaily,
        playedDates: ["2026-08-27"],
      }, emptyDuel),
    ).toBe(true);
  });
});
