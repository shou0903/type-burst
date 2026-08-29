import type { SurvivalDifficulty, SurvivalSummary } from "@type-burst/game-core";
import { loadPlayerId } from "./playerId";
import { SURVIVAL_RULESET } from "./storage";

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

/**
 * v2を理解しない旧APIへ新ルールの記録を送らないための能力確認。
 * デプロイのロールバック直後に新しいJSがブラウザへ残るケースでも、旧APIの
 * v1ランキングへ混入させない。失敗時はランキング送信だけを静かに諦める。
 */
async function supportsCurrentRuleset(difficulty: SurvivalDifficulty): Promise<boolean> {
  const res = await fetch(
    `/api/scores?difficulty=${encodeURIComponent(difficulty)}&limit=1&ruleset=${encodeURIComponent(SURVIVAL_RULESET)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { ruleset?: unknown };
  return data.ruleset === SURVIVAL_RULESET;
}

/** サバイバル結果をランキングへ送信する。失敗してもゲーム進行には影響させない */
export async function submitScore(
  nickname: string,
  summary: SurvivalSummary,
): Promise<SubmitScoreResult> {
  try {
    if (!(await supportsCurrentRuleset(summary.difficulty))) {
      return { ok: false, reason: "ruleset_unsupported" };
    }
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: loadPlayerId(),
        ruleset: SURVIVAL_RULESET,
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
    if (data.ruleset !== SURVIVAL_RULESET) {
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
  const res = await fetch(
    `/api/scores?difficulty=${encodeURIComponent(difficulty)}&limit=${limit}&ruleset=${encodeURIComponent(SURVIVAL_RULESET)}`,
  );
  if (!res.ok) throw new Error(`ランキング取得に失敗しました(${res.status})`);
  const data = (await res.json()) as { entries: RankingEntry[]; ruleset?: unknown };
  if (data.ruleset !== SURVIVAL_RULESET) throw new Error("ランキングのルール世代が一致しません");
  return data.entries ?? [];
}

/** 上位表と、匿名playerIdに紐づく本人の順位を同時に取得する。 */
export async function fetchRanking(
  difficulty: SurvivalDifficulty,
  limit = 100,
): Promise<RankingResponse> {
  const playerId = loadPlayerId();
  const res = await fetch(
    `/api/scores?difficulty=${encodeURIComponent(difficulty)}&limit=${limit}&ruleset=${encodeURIComponent(SURVIVAL_RULESET)}&playerId=${encodeURIComponent(playerId)}`,
  );
  if (!res.ok) throw new Error(`ランキング取得に失敗しました(${res.status})`);
  const data = (await res.json()) as {
    entries: RankingEntry[];
    viewer?: RankingViewer | null;
    ruleset?: unknown;
  };
  if (data.ruleset !== SURVIVAL_RULESET) throw new Error("ランキングのルール世代が一致しません");
  return { entries: data.entries ?? [], viewer: data.viewer ?? null };
}
