import { describe, expect, it } from "vitest";
import { TypingAutomaton } from "@type-burst/typing-engine";
import { SPEED_TEST_PROMPTS } from "./speedPrompts";

function accepts(reading: string, keys: string): boolean {
  const automaton = new TypingAutomaton(reading);
  for (const key of keys) {
    if (!automaton.feed(key).accepted) return false;
  }
  return automaton.isAccepted();
}

describe("速度測定の出題", () => {
  it("全ての読みがゲーム本体の入力エンジンで標準表記を受理する", () => {
    for (const prompt of SPEED_TEST_PROMPTS) {
      const automaton = new TypingAutomaton(prompt.reading);
      const keys = automaton.getCanonicalRomaji();
      expect(accepts(prompt.reading, keys), prompt.ja).toBe(true);
    }
  });

  it("ゲーム本体で許可された代替ローマ字表記も受理する", () => {
    expect(accepts(SPEED_TEST_PROMPTS[0]!.reading, "kyouhasyuutyuusiterensyuusuru")).toBe(true);
    expect(accepts(SPEED_TEST_PROMPTS[1]!.reading, "seikakusawotamottesukosizutuhayaku")).toBe(true);
    expect(accepts(SPEED_TEST_PROMPTS[2]!.reading, "ho-mupojisyonheyubiwomodosu")).toBe(true);
  });
});
