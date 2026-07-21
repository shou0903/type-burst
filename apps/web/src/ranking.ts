import type { SurvivalDifficulty, SurvivalSummary } from "@type-burst/game-core";

export interface RankingEntry {
  id: string;
  nickname: string;
  score: number;
  difficulty: SurvivalDifficulty;
  maxChain: number;
  survivedMs: number;
  level: number;
  submittedAt: string;
}

export type SubmitScoreResult = { ok: true } | { ok: false; reason: string };

/** サバイバル結果をランキングへ送信する。失敗してもゲーム進行には影響させない */
export async function submitScore(
  nickname: string,
  summary: SurvivalSummary,
): Promise<SubmitScoreResult> {
  try {
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname,
        score: summary.score,
        difficulty: summary.difficulty,
        maxChain: summary.maxChain,
        survivedMs: summary.survivedMs,
        level: summary.level,
      }),
    });
    if (!res.ok) {
      return { ok: false, reason: res.status === 429 ? "rate_limited" : "rejected" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

export async function fetchTopScores(
  difficulty: SurvivalDifficulty,
  limit = 100,
): Promise<RankingEntry[]> {
  const res = await fetch(`/api/scores?difficulty=${difficulty}&limit=${limit}`);
  if (!res.ok) throw new Error(`ランキング取得に失敗しました(${res.status})`);
  const data = (await res.json()) as { entries: RankingEntry[] };
  return data.entries;
}
