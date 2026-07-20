import { describe, expect, it } from "vitest";
import { TypingAutomaton, countMora, segmentKana } from "@type-burst/typing-engine";

function typeAll(a: TypingAutomaton, keys: string): { accepted: number; rejected: number } {
  let accepted = 0;
  let rejected = 0;
  for (const key of keys) {
    const r = a.feed(key);
    if (r.accepted) accepted += 1;
    else rejected += 1;
  }
  return { accepted, rejected };
}

function completes(reading: string, keys: string): boolean {
  const a = new TypingAutomaton(reading);
  typeAll(a, keys);
  return a.isAccepted();
}

describe("TypingAutomaton 複数表記", () => {
  it("し: shi / si / ci", () => {
    expect(completes("し", "shi")).toBe(true);
    expect(completes("し", "si")).toBe(true);
    expect(completes("し", "ci")).toBe(true);
  });

  it("ち: chi / ti", () => {
    expect(completes("ち", "chi")).toBe(true);
    expect(completes("ち", "ti")).toBe(true);
  });

  it("つ: tsu / tu", () => {
    expect(completes("つ", "tsu")).toBe(true);
    expect(completes("つ", "tu")).toBe(true);
  });

  it("ふ: fu / hu", () => {
    expect(completes("ふ", "fu")).toBe(true);
    expect(completes("ふ", "hu")).toBe(true);
  });

  it("じ: ji / zi", () => {
    expect(completes("じ", "ji")).toBe(true);
    expect(completes("じ", "zi")).toBe(true);
  });

  it("しゃ: sha / sya / 分解(sixya)", () => {
    expect(completes("しゃ", "sha")).toBe(true);
    expect(completes("しゃ", "sya")).toBe(true);
    expect(completes("しゃ", "sixya")).toBe(true);
    expect(completes("しゃ", "shilya")).toBe(true);
  });

  it("じゃ: ja / jya / zya", () => {
    expect(completes("じゃ", "ja")).toBe(true);
    expect(completes("じゃ", "jya")).toBe(true);
    expect(completes("じゃ", "zya")).toBe(true);
  });
});

describe("促音", () => {
  it("がっこう: kk 重複と xtu", () => {
    expect(completes("がっこう", "gakkou")).toBe(true);
    expect(completes("がっこう", "gaxtukou")).toBe(true);
    expect(completes("がっこう", "galtukou")).toBe(true);
  });

  it("しゅっぱつ: 拗音+促音の組み合わせ", () => {
    expect(completes("しゅっぱつ", "shuppatsu")).toBe(true);
    expect(completes("しゅっぱつ", "syuppatu")).toBe(true);
    expect(completes("しゅっぱつ", "shuxtupatsu")).toBe(true);
  });
});

describe("ん", () => {
  it("子音の前では単独 n を許容", () => {
    expect(completes("かんじ", "kanji")).toBe(true);
    expect(completes("かんじ", "kannji")).toBe(true);
    expect(completes("かんじ", "kan'ji")).toBe(true);
  });

  it("母音の前では単独 n を拒否(nn 必須)", () => {
    expect(completes("かんい", "kani")).toBe(false);
    expect(completes("かんい", "kanni")).toBe(true);
    expect(completes("かんい", "kan'i")).toBe(true);
  });

  it("な行の前では単独 n を拒否", () => {
    // kanna は「かんな」ではなく か+ん(n)+な と誤解釈されない
    const a = new TypingAutomaton("かんな");
    typeAll(a, "kan");
    expect(a.isAccepted()).toBe(false);
    expect(completes("かんな", "kannna")).toBe(true);
    expect(completes("かんな", "kan'na")).toBe(true);
  });

  it("末尾の ん は nn または n'", () => {
    expect(completes("ほん", "hon")).toBe(false);
    expect(completes("ほん", "honn")).toBe(true);
    expect(completes("ほん", "hon'")).toBe(true);
  });
});

describe("カタカナと長音", () => {
  it("ノート(のーと)を打てる", () => {
    expect(completes("ノート", "no-to")).toBe(true);
    expect(completes("のーと", "no-to")).toBe(true);
  });

  it("ペース(ぺーす)を打てる", () => {
    expect(completes("ぺーす", "pe-su")).toBe(true);
  });
});

describe("ミスと復帰", () => {
  it("誤キーは進捗させず、正しい進捗は消えない", () => {
    const a = new TypingAutomaton("さくら");
    expect(a.feed("s").accepted).toBe(true);
    expect(a.feed("k").accepted).toBe(false); // ミス
    expect(a.getTypedRomaji()).toBe("s");
    expect(a.feed("a").accepted).toBe(true);
    expect(a.feed("k").accepted).toBe(true);
    expect(a.feed("u").accepted).toBe(true);
    expect(a.feed("r").accepted).toBe(true);
    expect(a.feed("a").completed).toBe(true);
  });
});

describe("前方一致と進捗", () => {
  it("残りローマ字ガイドが入力に追従する", () => {
    const a = new TypingAutomaton("しりょう");
    expect(a.getCanonicalRomaji()).toBe("shiryou");
    a.feed("s");
    a.feed("i"); // si 経路を選択
    expect(a.getRemainingRomaji()).toBe("ryou");
    expect(a.getProgress()).toBeGreaterThan(0);
    expect(a.getProgress()).toBeLessThan(1);
  });

  it("進捗は完了で 1 になる", () => {
    const a = new TypingAutomaton("ほんをよみます");
    typeAll(a, "honnwoyomimasu");
    expect(a.isAccepted()).toBe(true);
    expect(a.getProgress()).toBe(1);
  });

  it("getExpectedKeys が複数経路の先頭キーを返す", () => {
    const a = new TypingAutomaton("し");
    const keys = a.getExpectedKeys();
    expect(keys).toContain("s");
    expect(keys).toContain("c");
  });
});

describe("実フレーズの完走", () => {
  const cases: Array<[string, string]> = [
    ["しりょうをかくにんする", "shiryouwokakuninsuru"],
    ["じゅぎょうのじゅんびをする", "jugyounojunbiwosuru"],
    ["でんしゃがえきにとうちゃくした", "denshagaekinitouchakushita"],
    ["おちついてにゅうりょくする", "ochitsuitenyuuryokusuru"],
    ["あしたのよていをきめる", "ashitanoyoteiwokimeru"],
  ];
  for (const [reading, romaji] of cases) {
    it(`${reading} = ${romaji}`, () => {
      expect(completes(reading, romaji)).toBe(true);
    });
  }
});

describe("countMora", () => {
  it("拗音は1モーラ、促音・長音は1モーラ", () => {
    expect(countMora("そらがあかるくなる")).toBe(9);
    expect(countMora("しゅっぱつ")).toBe(4);
    expect(countMora("のーと")).toBe(3);
    expect(countMora("じゅぎょう")).toBe(3);
  });
});

describe("segmentKana", () => {
  it("促音を次のセグメントと結合する", () => {
    const segs = segmentKana("がっこう");
    expect(segs.map((s) => s.kana)).toEqual(["が", "っこ", "う"]);
  });
});
