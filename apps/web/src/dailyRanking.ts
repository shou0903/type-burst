import type { SurvivalSummary } from "@type-burst/game-core";
import { loadDailyPlayerId } from "./daily";

const REQUEST_TIMEOUT_MS = 8_000;
const START_REQUEST_TIMEOUT_MS = 3_000;
const ATTEMPT_TOKEN_PATTERN = /^[A-Za-z0-9-]{16,100}$/;

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
  const response = await fetchWithTimeout(
    `/api/daily-scores?challengeId=${encodeURIComponent(challengeId)}&playerId=${encodeURIComponent(playerId)}`,
  );
  if (!response.ok) throw new Error(`daily leaderboard: ${response.status}`);
  const data = (await response.json()) as Partial<DailyLeaderboardResponse>;
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    total: typeof data.total === "number" ? data.total : 0,
    viewer: data.viewer ?? null,
  };
}

export async function submitDailyScore(
  nickname: string,
  challengeId: string,
  summary: SurvivalSummary,
  options: {
    ranked?: boolean;
    submissionId?: string;
    startedAt?: number;
    attemptToken?: string;
  } = {},
): Promise<DailyLeaderboardResponse> {
  const response = await fetchWithTimeout("/api/daily-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname,
      challengeId,
      playerId: loadDailyPlayerId(),
      ranked: options.ranked ?? true,
      ...(options.submissionId ? { submissionId: options.submissionId } : {}),
      ...(typeof options.startedAt === "number" ? { startedAt: options.startedAt } : {}),
      ...(options.attemptToken ? { attemptToken: options.attemptToken } : {}),
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

/**
 * デイリーのランキング枠を開始時点で予約する。通信できない場合はnullを返し、
 * 呼び出し側がランキング外の練習としてゲームを続けられるようにする。
 */
export async function reserveDailyAttempt(challengeId: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      "/api/daily-scores",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          challengeId,
          playerId: loadDailyPlayerId(),
        }),
      },
      START_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { attemptToken?: unknown };
    return typeof data.attemptToken === "string" && ATTEMPT_TOKEN_PATTERN.test(data.attemptToken)
      ? data.attemptToken
      : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}
