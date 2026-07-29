import { describe, expect, it } from "vitest";
import { TypingAutomaton } from "@type-burst/typing-engine";
import { SENTENCE_PRACTICE_PROMPTS } from "./sentencePrompts";

describe("文章タイピング練習のお題", () => {
  it("各レベルに6文以上あり、読みを最後まで入力できる", () => {
    for (const prompts of Object.values(SENTENCE_PRACTICE_PROMPTS)) {
      expect(prompts.length).toBeGreaterThanOrEqual(6);
      for (const prompt of prompts) {
        expect(prompt.ja.length).toBeGreaterThan(0);
        expect(prompt.reading.length).toBeGreaterThan(0);
        expect(() => new TypingAutomaton(prompt.reading)).not.toThrow();
      }
    }
  });

  it("レベルが上がるほど平均の読みが長くなる", () => {
    const average = (key: keyof typeof SENTENCE_PRACTICE_PROMPTS) => {
      const prompts = SENTENCE_PRACTICE_PROMPTS[key];
      return prompts.reduce((sum, prompt) => sum + prompt.reading.length, 0) / prompts.length;
    };

    expect(average("beginner")).toBeLessThan(average("standard"));
    expect(average("standard")).toBeLessThan(average("long"));
  });

  it("表示文と読みがレベル内で重複しない", () => {
    for (const prompts of Object.values(SENTENCE_PRACTICE_PROMPTS)) {
      expect(new Set(prompts.map((prompt) => prompt.ja)).size).toBe(prompts.length);
      expect(new Set(prompts.map((prompt) => prompt.reading)).size).toBe(prompts.length);
    }
  });
});
