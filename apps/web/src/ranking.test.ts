import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurvivalSummary } from "@type-burst/game-core";
import { submitScore } from "./ranking";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});

const summary: SurvivalSummary = {
  seed: "ranking-test",
  score: 12_340,
  maxChain: 7,
  kpm: 220,
  accuracy: 0.98,
  phraseCount: 12,
  perfectPhraseCount: 9,
  correctKeyCount: 120,
  incorrectKeyCount: 2,
  garbageSent: 0,
  burstCount: 1,
  analysis: {
    totalKeystrokes: 122,
    correctKeystrokes: 120,
    incorrectKeystrokes: 2,
    accuracy: 0.98,
    averageIntervalMs: 240,
    keyStats: [],
    weakKeys: [],
    firstHalf: { keystrokes: 61, accuracy: 0.98, avgIntervalMs: 240 },
    secondHalf: { keystrokes: 61, accuracy: 0.98, avgIntervalMs: 240 },
    handStats: [],
    fingerStats: [],
  },
  survivedMs: 60_000,
  level: 4,
  difficulty: "normal",
  timeLimitMs: null,
  finishReason: "toppedOut",
};

describe("通常ランキングの自己ベスト送信", () => {
  beforeEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  it("匿名プレイヤーIDを送るが、サーバーの更新結果だけを受け取る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, updated: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitScore("バースト王", summary)).resolves.toEqual({ ok: true, updated: true });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ nickname: "バースト王", score: 12_340, difficulty: "normal" });
    expect(body.playerId).toMatch(/^[A-Za-z0-9-]{8,80}$/);
  });

  it("自己ベスト未更新をそのまま画面へ返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, updated: false }), { status: 200 })),
    );

    await expect(submitScore("バースト王", summary)).resolves.toEqual({ ok: true, updated: false });
  });
});
