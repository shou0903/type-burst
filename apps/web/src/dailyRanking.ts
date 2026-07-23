import type { SurvivalSummary } from "@type-burst/game-core";
import { loadDailyPlayerId } from "./daily";

export interface DailyLeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  kpm: number;
  accuracy: number;
}

export interface DailyViewerRank {
  rank: number;
  total: number;
  score: number;
  scoreToNext: number | null;
  percentile: number;
}

export interface DailyLeaderboardResponse {
  entries: DailyLeaderboardEntry[];
  total: number;
  viewer: DailyViewerRank | null;
}

export async function fetchDailyLeaderboard(
  challengeId: string,
): Promise<DailyLeaderboardResponse> {
  const playerId = loadDailyPlayerId();
  const response = await fetch(
    `/api/daily-scores?challengeId=${encodeURIComponent(challengeId)}&playerId=${encodeURIComponent(playerId)}`,
  );
  if (!response.ok) throw new Error(`daily leaderboard: ${response.status}`);
  return (await response.json()) as DailyLeaderboardResponse;
}

export async function submitDailyScore(
  nickname: string,
  challengeId: string,
  summary: SurvivalSummary,
): Promise<DailyLeaderboardResponse> {
  const response = await fetch("/api/daily-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname,
      challengeId,
      playerId: loadDailyPlayerId(),
      score: summary.score,
      kpm: summary.kpm,
      accuracy: summary.accuracy,
      maxChain: summary.maxChain,
      survivedMs: summary.survivedMs,
    }),
  });
  if (!response.ok) throw new Error(`daily leaderboard: ${response.status}`);
  return (await response.json()) as DailyLeaderboardResponse;
}
