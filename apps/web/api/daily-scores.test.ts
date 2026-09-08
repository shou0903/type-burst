import { describe, expect, it } from "vitest";
import { isCurrentChallenge } from "./daily-scores";

describe("デイリー挑戦チケットの日付・経過時間検証", () => {
  it("同日の開始は2分+猶予まで受理し、それを超えたものは拒否する", () => {
    const start = Date.parse("2026-09-08T00:00:00.000Z");
    const challenge = "2026-09-08";

    expect(isCurrentChallenge(challenge, start, start + 125_000)).toBe(true);
    expect(isCurrentChallenge(challenge, start, start + 125_001)).toBe(false);
    expect(isCurrentChallenge(challenge, start, start - 1)).toBe(false);
  });

  it("JSTの日付境界をまたぐ終了は開始日のチャレンジとして猶予内だけ受理する", () => {
    const start = Date.parse("2026-09-07T14:59:30.000Z"); // 9/7 23:59:30 JST
    const challenge = "2026-09-07";

    expect(isCurrentChallenge(challenge, start, Date.parse("2026-09-07T15:01:30.000Z"))).toBe(true);
    expect(isCurrentChallenge(challenge, start, Date.parse("2026-09-07T15:05:00.001Z"))).toBe(false);
  });

  it("開始時刻が別の日付、または未来のチケットを受理しない", () => {
    const now = Date.parse("2026-09-08T00:10:00.000Z");
    expect(isCurrentChallenge("2026-09-08", Date.parse("2026-09-07T23:59:59.000Z"), now)).toBe(false);
    expect(isCurrentChallenge("2026-09-08", now + 1, now)).toBe(false);
  });
});
