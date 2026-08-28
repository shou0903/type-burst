import type { LifetimeProgress } from "@type-burst/progression";
import type { DailyProgress } from "./daily";
import type { DuelRecord, StoredResult } from "./storage";

/**
 * progress導入前の保存データも含めて「一度でも遊んだ端末」を判定する。
 * 古いresults/対戦/デイリーだけが残る利用者を初回チュートリアルへ戻さない。
 */
export function hasRecordedPlay(
  progress: LifetimeProgress,
  results: StoredResult[],
  dailyProgress: DailyProgress,
  duelRecord: DuelRecord,
): boolean {
  if (progress.totalGames > 0 || results.length > 0) return true;
  if (dailyProgress.playedDates.length > 0 || Object.keys(dailyProgress.days).length > 0) return true;
  return Object.values(duelRecord).some(({ wins, losses }) => wins + losses > 0);
}
