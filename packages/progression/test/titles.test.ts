import { describe, expect, it } from "vitest";
import { TITLE_LADDER, titleProgressForScore } from "../src/titles";

describe("TITLE_LADDER", () => {
  it("先頭は累計スコア0で到達できる(新規プレイヤーが必ず称号を持てる)", () => {
    expect(TITLE_LADDER[0]!.threshold).toBe(0);
  });

  it("しきい値は昇順である", () => {
    for (let i = 1; i < TITLE_LADDER.length; i++) {
      expect(TITLE_LADDER[i]!.threshold).toBeGreaterThan(TITLE_LADDER[i - 1]!.threshold);
    }
  });

  it("称号idとlabelはすべて一意である", () => {
    expect(new Set(TITLE_LADDER.map((t) => t.id)).size).toBe(TITLE_LADDER.length);
    expect(new Set(TITLE_LADDER.map((t) => t.label)).size).toBe(TITLE_LADDER.length);
  });
});

describe("titleProgressForScore", () => {
  it("スコア0は最初の称号で、次の称号までの残りが正しい", () => {
    const p = titleProgressForScore(0);
    expect(p.current.id).toBe(TITLE_LADDER[0]!.id);
    expect(p.currentIndex).toBe(0);
    expect(p.next?.id).toBe(TITLE_LADDER[1]!.id);
    expect(p.remainingToNext).toBe(TITLE_LADDER[1]!.threshold);
    expect(p.progressRatio).toBe(0);
  });

  it("しきい値ちょうどでその称号に到達する", () => {
    const p = titleProgressForScore(TITLE_LADDER[2]!.threshold);
    expect(p.current.id).toBe(TITLE_LADDER[2]!.id);
    expect(p.progressRatio).toBe(0);
  });

  it("2つの称号の中間ではprogressRatioが0〜1の間になる", () => {
    const lo = TITLE_LADDER[1]!.threshold;
    const hi = TITLE_LADDER[2]!.threshold;
    const mid = Math.floor((lo + hi) / 2);
    const p = titleProgressForScore(mid);
    expect(p.current.id).toBe(TITLE_LADDER[1]!.id);
    expect(p.progressRatio).toBeGreaterThan(0);
    expect(p.progressRatio).toBeLessThan(1);
  });

  it("最高位の称号に到達した場合はnextがnullでremainingToNextが0", () => {
    const maxThreshold = TITLE_LADDER[TITLE_LADDER.length - 1]!.threshold;
    const p = titleProgressForScore(maxThreshold + 1_000_000);
    expect(p.current.id).toBe(TITLE_LADDER[TITLE_LADDER.length - 1]!.id);
    expect(p.next).toBeNull();
    expect(p.remainingToNext).toBe(0);
    expect(p.progressRatio).toBe(1);
  });

  it("負の値やNaNは0として扱われ、例外を投げない", () => {
    expect(() => titleProgressForScore(-500)).not.toThrow();
    expect(titleProgressForScore(-500).current.id).toBe(TITLE_LADDER[0]!.id);
    expect(() => titleProgressForScore(NaN)).not.toThrow();
    expect(titleProgressForScore(NaN).current.id).toBe(TITLE_LADDER[0]!.id);
  });
});
