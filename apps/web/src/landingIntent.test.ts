import { describe, expect, it } from "vitest";
import { parseDailyEntryIntent, regularModeUrl } from "./landingIntent";

describe("landing intent", () => {
  it("distinguishes a shared daily invitation from a direct daily entry", () => {
    expect(parseDailyEntryIntent("?mode=daily&source=share")).toBe("share");
    expect(parseDailyEntryIntent("?mode=daily")).toBe("direct");
  });

  it("does not turn unrelated entries into a daily challenge", () => {
    expect(parseDailyEntryIntent("?mode=survival&difficulty=easy")).toBeNull();
    expect(parseDailyEntryIntent("?source=share")).toBeNull();
  });

  it("removes only the daily-entry parameters when returning to regular mode", () => {
    expect(
      regularModeUrl("https://type-burst.com/?mode=daily&source=share&utm_campaign=summer#play"),
    ).toBe("/?utm_campaign=summer");
  });
});
