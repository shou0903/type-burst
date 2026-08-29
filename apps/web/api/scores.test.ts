import { describe, expect, it } from "vitest";
import {
  entryKeyForMember,
  leaderboardKey,
  parseSurvivalRuleset,
  playerEntryKey,
} from "./scores";

describe("サバイバルランキングのルール世代キー", () => {
  it("v1の既存キーを一文字も変更しない", () => {
    expect(leaderboardKey("survival-v1", "normal")).toBe("leaderboard:survival:alltime:normal");
    expect(playerEntryKey("survival-v1", "normal", "player-12345678")).toBe(
      "score:survival:normal:player:player-12345678",
    );
    expect(entryKeyForMember("survival-v1", "normal", "legacy-id")).toBe("score:legacy-id");
  });

  it("v2のランキングと詳細ハッシュをv1から分離する", () => {
    expect(leaderboardKey("survival-v2", "normal")).toBe(
      "leaderboard:survival:alltime:survival-v2:normal",
    );
    expect(playerEntryKey("survival-v2", "normal", "player-12345678")).toBe(
      "score:survival:survival-v2:normal:player:player-12345678",
    );
    expect(entryKeyForMember("survival-v2", "normal", "legacy-id")).toBe(
      "score:survival:survival-v2:legacy-id",
    );
  });

  it("ruleset未指定は旧v1、不正値は拒否する", () => {
    expect(parseSurvivalRuleset(undefined)).toBe("survival-v1");
    expect(parseSurvivalRuleset("survival-v1")).toBe("survival-v1");
    expect(parseSurvivalRuleset("survival-v2")).toBe("survival-v2");
    expect(parseSurvivalRuleset("daily-v2")).toBeNull();
    expect(parseSurvivalRuleset(null)).toBeNull();
  });
});
