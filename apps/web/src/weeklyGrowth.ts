import type { SurvivalDifficulty } from "@type-burst/game-core";
import type { StoredResult } from "./storage";

/** JST は夏時間のない固定オフセットなので、週境界を UTC の数値で安全に扱える。 */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type WeeklyGrowthStatus = "empty" | "no-current" | "current-only" | "comparison";
export type WeeklyScoreTrend = "up" | "down" | "flat" | "unavailable";

export interface WeeklyAggregate {
  /** JST 月曜 00:00 を表す UTC ISO 文字列 */
  weekStart: string;
  /** 次の JST 月曜 00:00 を表す UTC ISO 文字列(期間の終端・含まない) */
  weekEnd: string;
  playCount: number;
  bestScore: number;
  averageAccuracy: number | null;
  maxChain: number;
}

export interface WeeklyGrowthSummary {
  /** 最新の有効なサバイバル記録から選んだ難易度。記録がない場合は null。 */
  difficulty: SurvivalDifficulty | null;
  currentWeek: WeeklyAggregate;
  previousWeek: WeeklyAggregate;
  status: WeeklyGrowthStatus;
  /** 両週に記録がある場合だけ算出する。色に依存しない比較表示に使う。 */
  bestScoreDelta: number | null;
  bestScoreTrend: WeeklyScoreTrend;
  latestPlayedAt: string | null;
}

const EMPTY_DIFFICULTY: SurvivalDifficulty = "normal";
const ACCURACY_ACCUMULATORS = new WeakMap<WeeklyAggregate, { total: number; count: number }>();

/**
 * 指定時刻が属する「JST 月曜 00:00」の UTC Date を返す。
 * 例: 日曜 14:59 UTC は JST 日曜 23:59、日曜 15:00 UTC は JST 月曜 00:00。
 * 不正な日時は null とし、呼び出し側が記録を集計対象から除外できるようにする。
 */
export function jstWeekStart(value: Date | string | number): Date | null {
  const time = toValidTime(value);
  if (time === null) return null;

  const jst = new Date(time + JST_OFFSET_MS);
  const day = jst.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const mondayUtc = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate() - daysSinceMonday,
  );
  return new Date(mondayUtc - JST_OFFSET_MS);
}

/**
 * 端末に保存された結果から、最新のサバイバル難易度を基準に週次サマリーを作る。
 * 配列の順番は信用せず playedAt の時刻で最新を選ぶ。旧データの mode 未設定は
 * サバイバルとして扱い、デイリー記録だけは常に除外する。
 */
export function buildWeeklyGrowth(
  results: readonly StoredResult[],
  now: Date | string | number = new Date(),
): WeeklyGrowthSummary {
  const currentStart = jstWeekStart(now) ?? jstWeekStart(new Date())!;
  const currentStartMs = currentStart.getTime();
  const previousStartMs = currentStartMs - WEEK_MS;
  const currentWeek = emptyAggregate(currentStartMs);
  const previousWeek = emptyAggregate(previousStartMs);

  const validSurvival = results.flatMap((result) => {
    if (result.mode === "daily" || result.ruleset === "daily-v2") return [];
    const playedAt = toValidTime(result.playedAt);
    return playedAt === null ? [] : [{ result, playedAt }];
  });

  const latest = validSurvival.reduce<{ result: StoredResult; playedAt: number } | null>(
    (found, candidate) => (found === null || candidate.playedAt > found.playedAt ? candidate : found),
    null,
  );

  if (latest === null) {
    return {
      difficulty: null,
      currentWeek,
      previousWeek,
      status: "empty",
      bestScoreDelta: null,
      bestScoreTrend: "unavailable",
      latestPlayedAt: null,
    };
  }

  const difficulty = normalizeDifficulty(latest.result.difficulty);
  for (const entry of validSurvival) {
    if (normalizeDifficulty(entry.result.difficulty) !== difficulty) continue;
    if (entry.playedAt >= currentStartMs && entry.playedAt < currentStartMs + WEEK_MS) {
      addToAggregate(currentWeek, entry.result);
    } else if (entry.playedAt >= previousStartMs && entry.playedAt < currentStartMs) {
      addToAggregate(previousWeek, entry.result);
    }
  }

  const hasCurrent = currentWeek.playCount > 0;
  const hasPrevious = previousWeek.playCount > 0;
  const status: WeeklyGrowthStatus = hasCurrent
    ? hasPrevious
      ? "comparison"
      : "current-only"
    : "no-current";
  const bestScoreDelta = hasCurrent && hasPrevious
    ? currentWeek.bestScore - previousWeek.bestScore
    : null;

  return {
    difficulty,
    currentWeek,
    previousWeek,
    status,
    bestScoreDelta,
    bestScoreTrend: trendForDelta(bestScoreDelta),
    latestPlayedAt: latest.result.playedAt,
  };
}

function emptyAggregate(startMs: number): WeeklyAggregate {
  const aggregate: WeeklyAggregate = {
    weekStart: new Date(startMs).toISOString(),
    weekEnd: new Date(startMs + WEEK_MS).toISOString(),
    playCount: 0,
    bestScore: 0,
    averageAccuracy: null,
    maxChain: 0,
  };
  ACCURACY_ACCUMULATORS.set(aggregate, { total: 0, count: 0 });
  return aggregate;
}

function addToAggregate(aggregate: WeeklyAggregate, result: StoredResult): void {
  aggregate.playCount += 1;
  if (Number.isFinite(result.score)) aggregate.bestScore = Math.max(aggregate.bestScore, result.score);
  if (Number.isFinite(result.maxChain)) aggregate.maxChain = Math.max(aggregate.maxChain, result.maxChain);

  if (Number.isFinite(result.accuracy)) {
    const accumulator = ACCURACY_ACCUMULATORS.get(aggregate) ?? { total: 0, count: 0 };
    accumulator.total += result.accuracy;
    accumulator.count += 1;
    aggregate.averageAccuracy = accumulator.total / accumulator.count;
  }
}

function trendForDelta(delta: number | null): WeeklyScoreTrend {
  if (delta === null) return "unavailable";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function normalizeDifficulty(value: SurvivalDifficulty | undefined): SurvivalDifficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "god"
    ? value
    : EMPTY_DIFFICULTY;
}

function toValidTime(value: Date | string | number): number | null {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
