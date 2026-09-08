import { describe, expect, it } from "vitest";
import { TypingAutomaton } from "@type-burst/typing-engine";

// Published examples in romaji-small-kana.html and romaji-n-input.html.
// Assert every keystroke, not just completion (rejected keys must not be hidden).
describe("ローマ字解説記事の入力例", () => {
  it.each([
    ["てぃ", "thi"], ["てぃ", "texi"], ["てぃ", "teli"],
    ["でゅ", "dhu"], ["でゅ", "dexyu"], ["でゅ", "delyu"],
    ["うぃ", "whi"], ["うぃ", "uxi"], ["うぃ", "uli"],
    ["てぃー", "thi-"], ["てぃー", "texi-"],
    ["でゅお", "dhuo"], ["でゅお", "dexyuo"],
    ["あっ", "axtu"], ["あっ", "altu"],
    ["っぽい", "ppoi"], ["っぽい", "xtupoi"],
    ["がっこう", "gakkou"], ["がっこう", "gaxtukou"],
    ["かんじ", "kanji"], ["かんい", "kanni"],
    ["げんいん", "genninn"], ["しんや", "shinnya"],
    ["あんない", "annnai"], ["にほん", "nihonn"],
    ["にほん", "nihon'"], ["にほん", "nihoxn"],
    ["たんい", "tanni"], ["かんぱい", "kanpai"], ["かんぱい", "kannpai"],
  ])("%s ← %s を誤打鍵なしで完了できる", (reading, keys) => {
    const automaton = new TypingAutomaton(reading);
    for (const key of keys) expect(automaton.feed(key).accepted).toBe(true);
    expect(automaton.isAccepted()).toBe(true);
  });

  it.each([
    ["あんない", "annai"], ["にほん", "nihon"], ["てぃ", "ti"],
  ])("%s ← %s は正しい完成綴りではない", (reading, keys) => {
    const automaton = new TypingAutomaton(reading);
    let rejected = false;
    for (const key of keys) rejected ||= !automaton.feed(key).accepted;
    expect(rejected || !automaton.isAccepted()).toBe(true);
  });
});
