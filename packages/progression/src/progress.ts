/**
 * 生涯累計プレイ統計(D-054)。称号(titles.ts)は、ここで集計する
 * `totalScore` を進捗指標として参照する。
 *
 * ブラウザのlocalStorage I/O自体はapps/web/src/storage.tsが担当し、この
 * パッケージは「保存された値の解釈(マージ)」と「1プレイ分の加算」という
 * 純粋な計算だけを持つ。localStorageに依存しないため単体テストしやすい。
 */
export interface LifetimeProgress {
  /** サバイバル・対戦を合わせた累計プレイ回数 */
  totalGames: number;
  /** 累計獲得スコア(称号の進捗指標として使用) */
  totalScore: number;
  /** 自己ベストスコア(1プレイ分、難易度・モード問わず) */
  bestScore: number;
  bestKpm: number;
  /** 0〜1 */
  bestAccuracy: number;
  totalPhrases: number;
  totalPlaytimeMs: number;
  maxChainEver: number;
}

export function defaultLifetimeProgress(): LifetimeProgress {
  return {
    totalGames: 0,
    totalScore: 0,
    bestScore: 0,
    bestKpm: 0,
    bestAccuracy: 0,
    totalPhrases: 0,
    totalPlaytimeMs: 0,
    maxChainEver: 0,
  };
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 保存済みJSON(未保存=undefined、旧バージョン、壊れたデータ等あらゆる形の
 * 可能性がある)を安全にデフォルト値へマージする。フィールド単位で妥当性を
 * 検証するため、一部のフィールドだけ壊れている・欠けている場合でも他の
 * フィールドは保持される。新規プレイヤー(未保存)・既存プレイヤーの
 * どちらでも例外を投げず、常に完全な形の LifetimeProgress を返す。
 */
export function mergeLifetimeProgress(saved: unknown): LifetimeProgress {
  const base = defaultLifetimeProgress();
  if (!saved || typeof saved !== "object") return base;
  const s = saved as Partial<Record<keyof LifetimeProgress, unknown>>;
  return {
    totalGames: safeNumber(s.totalGames, base.totalGames),
    totalScore: safeNumber(s.totalScore, base.totalScore),
    bestScore: safeNumber(s.bestScore, base.bestScore),
    bestKpm: safeNumber(s.bestKpm, base.bestKpm),
    bestAccuracy: safeNumber(s.bestAccuracy, base.bestAccuracy),
    totalPhrases: safeNumber(s.totalPhrases, base.totalPhrases),
    totalPlaytimeMs: safeNumber(s.totalPlaytimeMs, base.totalPlaytimeMs),
    maxChainEver: safeNumber(s.maxChainEver, base.maxChainEver),
  };
}

/** 1プレイ分(サバイバル1試合、または対戦1試合の自分側)の集計に必要な値 */
export interface PlayContribution {
  score: number;
  kpm: number;
  /** 0〜1 */
  accuracy: number;
  phraseCount: number;
  maxChain: number;
  playtimeMs: number;
}

/**
 * 1プレイ分の結果を累計へ加算した「新しい」LifetimeProgressを返す純粋関数。
 * 引数・戻り値のどちらもミュータブルな状態を持たないため、呼び出し側
 * (storage.ts)はこの結果をそのままlocalStorageへ保存するだけでよい。
 */
export function accumulateProgress(
  progress: LifetimeProgress,
  play: PlayContribution,
): LifetimeProgress {
  return {
    totalGames: progress.totalGames + 1,
    totalScore: progress.totalScore + Math.max(0, play.score),
    bestScore: Math.max(progress.bestScore, play.score),
    bestKpm: Math.max(progress.bestKpm, play.kpm),
    bestAccuracy: Math.max(progress.bestAccuracy, play.accuracy),
    totalPhrases: progress.totalPhrases + Math.max(0, play.phraseCount),
    totalPlaytimeMs: progress.totalPlaytimeMs + Math.max(0, play.playtimeMs),
    maxChainEver: Math.max(progress.maxChainEver, play.maxChain),
  };
}
