import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankingSummary } from "./ranking";

const submitScoreMock = vi.hoisted(() => vi.fn());
vi.mock("./ranking", () => ({ submitScore: submitScoreMock }));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});
vi.stubGlobal("window", { dispatchEvent: vi.fn() });

const summary = (difficulty: RankingSummary["difficulty"], score: number): RankingSummary => ({
  difficulty,
  score,
  maxChain: 4,
  survivedMs: 60_000,
  level: 3,
});

describe("ランキング送信の端末内回復キュー", () => {
  beforeEach(() => {
    storage.clear();
    submitScoreMock.mockReset();
  });

  it("難易度ごとに保留中の最高記録だけを残す", async () => {
    const outbox = await import("./rankingOutbox");
    outbox.enqueueRankingSubmission("run-normal-low", "A", summary("normal", 100));
    outbox.enqueueRankingSubmission("run-normal-high", "B", summary("normal", 200));
    outbox.enqueueRankingSubmission("run-normal-lower", "C", summary("normal", 150));
    outbox.enqueueRankingSubmission("run-easy", "D", summary("easy", 50));

    const pending = outbox.loadPendingRankingSubmissions().sort((a, b) => a.runId.localeCompare(b.runId));
    expect(pending).toMatchObject([
      { runId: "run-easy", nickname: "D", summary: { score: 50 } },
      { runId: "run-normal-high", nickname: "B", summary: { score: 200 } },
    ]);
  });

  it("再送に成功した記録だけをキューから削除する", async () => {
    const outbox = await import("./rankingOutbox");
    outbox.enqueueRankingSubmission("run-success", "A", summary("normal", 100));
    submitScoreMock.mockResolvedValue({ ok: true, updated: true });

    await expect(outbox.retryPendingRankingSubmissions()).resolves.toBe(1);
    expect(outbox.loadPendingRankingSubmissions()).toEqual([]);
    expect(submitScoreMock).toHaveBeenCalledWith("A", summary("normal", 100));
  });

  it("再送に失敗した記録は次の機会へ残す", async () => {
    const outbox = await import("./rankingOutbox");
    outbox.enqueueRankingSubmission("run-failure", "A", summary("normal", 100));
    submitScoreMock.mockResolvedValue({ ok: false, reason: "network_error" });

    await expect(outbox.retryPendingRankingSubmissions()).resolves.toBe(0);
    expect(outbox.loadPendingRankingSubmissions()).toMatchObject([
      { runId: "run-failure", summary: { score: 100 } },
    ]);
  });
});
