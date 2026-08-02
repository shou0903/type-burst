import type { SurvivalDifficulty, SurvivalSummary } from "@type-burst/game-core";
import { loadPlayerId } from "./playerId";

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

export interface RankingViewer {
  rank: number;
  total: number;
  score: number;
  scoreToNext: number | null;
  percentile: number;
}

export interface RankingResponse {
  entries: RankingEntry[];
  viewer: RankingViewer | null;
}

export type SubmitScoreResult =
  | { ok: true; updated: boolean }
  | { ok: false; reason: string };

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
        playerId: loadPlayerId(),
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
    const data = (await res.json()) as { updated?: unknown };
    return { ok: true, updated: data.updated === true };
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
  return data.entries ?? [];
}

/** 上位表と、匿名playerIdに紐づく本人の順位を同時に取得する。 */
export async function fetchRanking(
  difficulty: SurvivalDifficulty,
  limit = 100,
): Promise<RankingResponse> {
  const playerId = loadPlayerId();
  const res = await fetch(
    `/api/scores?difficulty=${difficulty}&limit=${limit}&playerId=${encodeURIComponent(playerId)}`,
  );
  if (!res.ok) throw new Error(`ランキング取得に失敗しました(${res.status})`);
  const data = (await res.json()) as { entries: RankingEntry[]; viewer?: RankingViewer | null };
  return { entries: data.entries ?? [], viewer: data.viewer ?? null };
}
