import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, replaceResults } from "./storage";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

const legacyResult = {
  score: 12_340,
  maxChain: 8,
  kpm: 210,
  accuracy: 0.98,
  phraseCount: 18,
  survivedMs: 60_000,
  playedAt: "2026-07-28T00:00:00.000Z",
};

describe("引き継ぎリザルトの復元", () => {
  beforeEach(() => storage.clear());

  it("難易度がなかった旧形式の記録を通常難易度として維持する", () => {
    const results = replaceResults([legacyResult]);
    expect(results).toEqual([{ ...legacyResult, difficulty: "normal" }]);
  });

  it("壊れた記録は復元しない", () => {
    expect(replaceResults([{ ...legacyResult, score: "not-a-number" }])).toEqual([]);
  });
});

describe("BGM設定", () => {
  beforeEach(() => storage.clear());

  it("既存の設定データにはBGMをオンとして補完する", () => {
    storage.set("typeblast.settings.v1", JSON.stringify({
      soundOn: false,
      reducedMotion: false,
      highContrast: false,
      fontScale: 1,
    }));
    expect(loadSettings()).toMatchObject({ soundOn: false, bgmOn: true });
  });
});
