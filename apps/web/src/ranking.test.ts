import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurvivalSummary } from "@type-burst/game-core";
import { fetchRanking, fetchTopScores, submitScore } from "./ranking";

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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entries: [], viewer: null, ruleset: "survival-v2" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, updated: true, ruleset: "survival-v2" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitScore("バースト王", summary)).resolves.toEqual({ ok: true, updated: true });

    const [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      nickname: "バースト王",
      score: 12_340,
      difficulty: "normal",
      ruleset: "survival-v2",
    });
    expect(body.playerId).toMatch(/^[A-Za-z0-9-]{8,80}$/);
  });

  it("自己ベスト未更新をそのまま画面へ返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ entries: [], viewer: null, ruleset: "survival-v2" }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, updated: false, ruleset: "survival-v2" }), { status: 200 }),
        ),
    );

    await expect(submitScore("バースト王", summary)).resolves.toEqual({ ok: true, updated: false });
  });

  it("現行ルールのランキングを取得する", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Response(JSON.stringify({ entries: [], viewer: null, ruleset: "survival-v2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTopScores("normal", 3)).resolves.toEqual([]);
    await expect(fetchRanking("normal", 3)).resolves.toEqual({ entries: [], viewer: null });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/scores?difficulty=normal&limit=3&ruleset=survival-v2",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(
      /\/api\/scores\?difficulty=normal&limit=3&ruleset=survival-v2&playerId=/,
    );
  });

  it("旧APIへロールバック中はv2スコアを送信しない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entries: [], viewer: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitScore("バースト王", summary)).resolves.toEqual({
      ok: false,
      reason: "ruleset_unsupported",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/scores?difficulty=normal&limit=1&ruleset=survival-v2",
    );
  });
});
