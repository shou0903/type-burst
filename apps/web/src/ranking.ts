import type { SurvivalDifficulty, SurvivalSummary } from "@type-burst/game-core";
import { loadPlayerId } from "./playerId";

/**
 * 世界ランキングは既存記録を引き継ぐ。ゲーム内の端末記録は survival-v2 として
 * 比較を分けるが、公開ランキングまで空の別世代へ切り替えない。
 */
const RANKING_RULESET = "survival-v1" as const;
const REQUEST_TIMEOUT_MS = 8_000;

export interface RankingEntry {
  id: string;
  /** Redis sorted set上の順位。詳細ハッシュ欠落時も順位を詰めない。 */
  rank?: number;
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

/** ランキング送信に必要な結果だけを表す型。分析データ全体は保持・再送しない。 */
export type RankingSummary = Pick<
  SurvivalSummary,
  "score" | "difficulty" | "maxChain" | "survivedMs" | "level"
>;

export type SubmitScoreResult =
  | { ok: true; updated: boolean }
  | { ok: false; reason: string };

/**
 * 現行APIはrulesetを明示する。旧APIは識別子を返さないが、保存先そのものが
 * v1ランキングなので互換とみなす。これにより旧正常版へロールバックしても、
 * キャッシュ済みの新クライアントでランキング表示・送信が止まらない。
 */
function isCompatibleRankingRuleset(value: unknown): boolean {
  return value === undefined || value === RANKING_RULESET;
}

async function supportsCurrentRuleset(difficulty: SurvivalDifficulty): Promise<boolean> {
  const res = await fetchWithTimeout(
    `/api/scores?difficulty=${encodeURIComponent(difficulty)}&limit=1&ruleset=${encodeURIComponent(RANKING_RULESET)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { ruleset?: unknown };
  return isCompatibleRankingRuleset(data.ruleset);
}

/** サバイバル結果をランキングへ送信する。失敗してもゲーム進行には影響させない */
export async function submitScore(
  nickname: string,
  summary: RankingSummary,
): Promise<SubmitScoreResult> {
  try {
    if (!(await supportsCurrentRuleset(summary.difficulty))) {
      return { ok: false, reason: "ruleset_unsupported" };
    }
    const res = await fetchWithTimeout("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: loadPlayerId(),
        ruleset: RANKING_RULESET,
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
    const data = (await res.json()) as { updated?: unknown; ruleset?: unknown };
    if (!isCompatibleRankingRuleset(data.ruleset)) {
      return { ok: false, reason: "ruleset_unsupported" };
    }
    return { ok: true, updated: data.updated === true };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

export async function fetchTopScores(
  difficulty: SurvivalDifficulty,
  limit = 100,
): Promise<RankingEntry[]> {
  const res = await fetchWithTimeout(
    `/api/scores?difficulty=${encodeURIComponent(difficulty)}&limit=${limit}&ruleset=${encodeURIComponent(RANKING_RULESET)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ランキング取得に失敗しました(${res.status})`);
  const data = (await res.json()) as { entries?: unknown; ruleset?: unknown };
  if (!isCompatibleRankingRuleset(data.ruleset)) throw new Error("ランキングのルール世代が一致しません");
  return Array.isArray(data.entries) ? (data.entries as RankingEntry[]) : [];
}

/** 上位表と、匿名playerIdに紐づく本人の順位を同時に取得する。 */
export async function fetchRanking(
  difficulty: SurvivalDifficulty,
  limit = 100,
): Promise<RankingResponse> {
  const playerId = loadPlayerId();
  const res = await fetchWithTimeout(
    `/api/scores?difficulty=${encodeURIComponent(difficulty)}&limit=${limit}&ruleset=${encodeURIComponent(RANKING_RULESET)}&playerId=${encodeURIComponent(playerId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ランキング取得に失敗しました(${res.status})`);
  const data = (await res.json()) as {
    entries?: unknown;
    viewer?: RankingViewer | null;
    ruleset?: unknown;
  };
  if (!isCompatibleRankingRuleset(data.ruleset)) throw new Error("ランキングのルール世代が一致しません");
  return {
    entries: Array.isArray(data.entries) ? (data.entries as RankingEntry[]) : [],
    viewer: data.viewer ?? null,
  };
}

/** ランキング表示が通信待ちのまま固定されないよう、UI向け取得に上限を設ける。 */
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}
