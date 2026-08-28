import { describe, expect, it } from "vitest";
import type { SurvivalSummary } from "@type-burst/game-core";
import {
  DAILY_SHARE_TARGET,
  HOME_SHARE_TARGET,
  isDailyShareTarget,
  normalizeShareTarget,
} from "../../shareTarget";
import { buildDailyShare } from "./shareContent";

describe("share target allowlist", () => {
  it("keeps the daily challenge target", () => {
    expect(normalizeShareTarget(DAILY_SHARE_TARGET)).toBe(DAILY_SHARE_TARGET);
    expect(isDailyShareTarget(DAILY_SHARE_TARGET)).toBe(true);
  });

  it("falls back to home for arbitrary and external targets", () => {
    expect(normalizeShareTarget("https://example.com/steal")).toBe(HOME_SHARE_TARGET);
    expect(normalizeShareTarget("/admin/stats.html")).toBe(HOME_SHARE_TARGET);
    expect(normalizeShareTarget(null)).toBe(HOME_SHARE_TARGET);
  });

  it("assigns the daily target only to daily result content", () => {
    const summary = {
      score: 12_345,
      maxChain: 6,
      kpm: 210,
      accuracy: 0.97,
    } as SurvivalSummary;

    expect(
      buildDailyShare({
        summary,
        challengeId: "2026-08-27",
        nickname: null,
        streak: 2,
        viewer: null,
      }).targetPath,
    ).toBe(DAILY_SHARE_TARGET);
  });
});
