import { describe, expect, it } from "vitest";
import {
  bandAccuracy,
  bandDuration,
  bandScore,
  createTelemetryEvent,
  sanitizeTelemetryProperties,
} from "./telemetryContract";

describe("telemetry privacy contract", () => {
  it("drops raw and unknown values while retaining coarse game bands", () => {
    expect(sanitizeTelemetryProperties("game_finish", {
      mode: "survival",
      outcome: "topped_out",
      difficulty: "hard",
      scoreBand: "10000-24999",
      nickname: "must-not-leave-device",
      typedText: "secret input",
      score: 12345,
      playerId: "raw-player-id",
    })).toEqual({
      mode: "survival",
      outcome: "topped_out",
      difficulty: "hard",
      scoreBand: "10000-24999",
    });
  });

  it("rejects events with missing or invalid required fields", () => {
    expect(createTelemetryEvent("game_start", { difficulty: "easy" })).toBeNull();
    expect(createTelemetryEvent("screen_view", { screen: "secret-admin-page" })).toBeNull();
    expect(createTelemetryEvent("transfer_action", { action: "restore", status: "success", code: "ABCD" }))
      .toMatchObject({ properties: { action: "restore", status: "success" } });
    expect(createTelemetryEvent("ranking_action", { surface: "world", action: "practice" })).toBeNull();
    expect(createTelemetryEvent("tool_action", { tool: "romaji", action: "lookup", typedText: "ひみつ" }))
      .toMatchObject({ properties: { tool: "romaji", action: "lookup" } });
  });

  it("uses explicit non-overlapping statistic bands", () => {
    expect(bandScore(0)).toBe("0");
    expect(bandScore(25_000)).toBe("25000-49999");
    expect(bandAccuracy(0.981)).toBe("98-99");
    expect(bandDuration(120_000)).toBe("120s+");
  });
});
