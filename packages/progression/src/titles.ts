/**
 * 称号(タイトル)ランクシステム(D-054)。
 *
 * 累計スコア(LifetimeProgress.totalScore、サバイバル・対戦を問わず生涯で
 * 獲得したスコアの合計)を単一の指標として使う。プレイを続ける限り単調に
 * 増加する値なので、「次の称号まであと◯◯」という進捗表示が常に成立し、
 * 難易度間の比較の難しさ(D-032参照)を持ち込まずに済む。
 */
export interface TitleTier {
  id: string;
  label: string;
  /** この称号に到達するために必要な累計スコア */
  threshold: number;
}

/** 称号ラダー。しきい値は昇順である前提(テストで検証)。 */
export const TITLE_LADDER: readonly TitleTier[] = [
  { id: "novice", label: "タイピング見習い", threshold: 0 },
  { id: "beginner", label: "タイピング初心者", threshold: 5_000 },
  { id: "apprentice", label: "タイピング学徒", threshold: 20_000 },
  { id: "hunter", label: "ブロックハンター", threshold: 50_000 },
  { id: "chainMaker", label: "チェインメイカー", threshold: 100_000 },
  { id: "burstFighter", label: "バーストファイター", threshold: 200_000 },
  { id: "chainMaster", label: "連鎖の達人", threshold: 400_000 },
  { id: "typeMaster", label: "タイプマスター", threshold: 700_000 },
  { id: "grandTyper", label: "グランドタイパー", threshold: 1_200_000 },
  { id: "burstKing", label: "バースト王", threshold: 2_000_000 },
];

export interface TitleProgress {
  current: TitleTier;
  currentIndex: number;
  /** 最高位の称号に達している場合は null */
  next: TitleTier | null;
  /** 次の称号まで必要な残り累計スコア(最高位到達済みなら0) */
  remainingToNext: number;
  /** 現在の称号帯における進捗 0〜1(最高位到達済みなら1) */
  progressRatio: number;
}

export function titleProgressForScore(totalScore: number): TitleProgress {
  const score = Number.isFinite(totalScore) ? Math.max(0, totalScore) : 0;

  let currentIndex = 0;
  for (let i = 0; i < TITLE_LADDER.length; i++) {
    if (score >= TITLE_LADDER[i]!.threshold) currentIndex = i;
    else break;
  }
  const current = TITLE_LADDER[currentIndex]!;
  const next = TITLE_LADDER[currentIndex + 1] ?? null;

  if (!next) {
    return { current, currentIndex, next: null, remainingToNext: 0, progressRatio: 1 };
  }

  const span = next.threshold - current.threshold;
  const into = score - current.threshold;
  const progressRatio = span > 0 ? Math.min(1, Math.max(0, into / span)) : 1;

  return {
    current,
    currentIndex,
    next,
    remainingToNext: Math.max(0, next.threshold - score),
    progressRatio,
  };
}
