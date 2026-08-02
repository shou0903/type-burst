import type {
  CpuDifficulty,
  DuelSummary,
  PlayerSummary,
  SurvivalDifficulty,
  SurvivalSummary,
} from "@type-burst/game-core";
import {
  accumulateProgress,
  defaultLifetimeProgress,
  mergeLifetimeProgress,
  type LifetimeProgress,
} from "@type-burst/progression";

const SETTINGS_KEY = "typeblast.settings.v1";
const RESULTS_KEY = "typeblast.results.v2";
const DUEL_RECORD_KEY = "typeblast.duel.v1";
const NICKNAME_KEY = "typeblast.nickname.v1";
/** 生涯累計プレイ統計(D-054)。既存の typeblast.results.v2 とは別キーで保持する
 * (results は直近履歴のみを保持する用途のため、性質の異なるデータを混在させない)。 */
const PROGRESS_KEY = "typeblast.progress.v1";

export type FontScale = 1 | 1.15 | 1.3;

/**
 * 直近結果として保持する件数(D-054, Feature 3: 成長グラフ)。
 * 従来は10件だったが、KPM・正確率の長期的な推移を見せるには短すぎるため増やした。
 * 60件でも1件あたり数十バイト程度で、localStorageの容量上は十分小さい。
 */
const MAX_STORED_RESULTS = 60;

export interface Settings {
  soundOn: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  fontScale: FontScale;
}

export interface StoredResult {
  score: number;
  maxChain: number;
  kpm: number;
  accuracy: number;
  phraseCount: number;
  survivedMs: number;
  playedAt: string;
  difficulty: SurvivalDifficulty;
  /** 記録を作ったルール。旧データはサバイバルとして移行する。 */
  mode?: "survival" | "daily";
  ruleset?: "survival-v1" | "daily-v2";
}

export type DuelRecord = Record<CpuDifficulty, { wins: number; losses: number }>;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function defaultSettings(): Settings {
  return {
    soundOn: true,
    // 仕様書§20: OS側のアニメーション削減設定を初回起動時の既定値に反映する
    reducedMotion: prefersReducedMotion(),
    highContrast: false,
    fontScale: 1,
  };
}
const DEFAULT_DUEL_RECORD: DuelRecord = {
  easy: { wins: 0, losses: 0 },
  normal: { wins: 0, losses: 0 },
  hard: { wins: 0, losses: 0 },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ストレージ不可でもゲームは続行できる
  }
}

export function loadResults(): StoredResult[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return Array.isArray(parsed) ? parsed.flatMap(normalizeStoredResult) : [];
  } catch {
    return [];
  }
}

/** 引き継ぎ復元時だけ使用する。端末の既存記録との自動マージはしない。 */
export function replaceResults(value: unknown): StoredResult[] {
  const results = Array.isArray(value)
    ? value.flatMap(normalizeStoredResult).slice(0, MAX_STORED_RESULTS)
    : [];
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch {
    // localStorage が使えない場合もゲームは継続する。
  }
  return results;
}

/** サバイバル結果を直近 MAX_STORED_RESULTS 件だけ保持する(設計書 §27, D-054で10→60件に拡大) */
export function appendResult(
  summary: SurvivalSummary,
  mode: "survival" | "daily" = "survival",
): StoredResult[] {
  const results = loadResults();
  results.unshift({
    score: summary.score,
    maxChain: summary.maxChain,
    kpm: summary.kpm,
    accuracy: summary.accuracy,
    phraseCount: summary.phraseCount,
    survivedMs: summary.survivedMs,
    playedAt: new Date().toISOString(),
    difficulty: summary.difficulty,
    mode,
    ruleset: mode === "daily" ? "daily-v2" : "survival-v1",
  });
  const trimmed = results.slice(0, MAX_STORED_RESULTS);
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(trimmed));
  } catch {
    // 保存失敗は無視
  }
  recordProgress(summary, summary.survivedMs);
  return trimmed;
}

/**
 * 難易度別の自己ベスト。難易度間はプレイに必要な技術が異なり比較に意味が
 * ないため、指定難易度の記録だけで集計する(D-032)。
 * difficulty未設定の旧データ(難易度導入前に保存された記録)は
 * normalとして扱い、既存ユーザーのベストスコア表示が消えないようにする。
 */
export function bestScore(results: StoredResult[], difficulty: SurvivalDifficulty): number {
  return results
    .filter((r) => r.mode !== "daily" && (r.difficulty ?? "normal") === difficulty)
    .reduce((max, r) => Math.max(max, r.score), 0);
}

export function loadDuelRecord(): DuelRecord {
  try {
    const raw = localStorage.getItem(DUEL_RECORD_KEY);
    if (!raw) return structuredClone(DEFAULT_DUEL_RECORD);
    return { ...structuredClone(DEFAULT_DUEL_RECORD), ...(JSON.parse(raw) as DuelRecord) };
  } catch {
    return structuredClone(DEFAULT_DUEL_RECORD);
  }
}

/** 引き継ぎ復元時だけ使用する。 */
export function replaceDuelRecord(value: unknown): DuelRecord {
  const source = value && typeof value === "object" ? value as Partial<DuelRecord> : {};
  const record: DuelRecord = structuredClone(DEFAULT_DUEL_RECORD);
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    const item = source[difficulty];
    if (!item) continue;
    record[difficulty] = {
      wins: safeCount(item.wins),
      losses: safeCount(item.losses),
    };
  }
  try {
    localStorage.setItem(DUEL_RECORD_KEY, JSON.stringify(record));
  } catch {
    // localStorage が使えない場合もゲームは継続する。
  }
  return record;
}

export function recordDuel(summary: DuelSummary): DuelRecord {
  const record = loadDuelRecord();
  const entry = record[summary.difficulty];
  if (summary.won) entry.wins += 1;
  else entry.losses += 1;
  try {
    localStorage.setItem(DUEL_RECORD_KEY, JSON.stringify(record));
  } catch {
    // 保存失敗は無視
  }
  // 対戦は自分側(player)の統計のみを生涯累計へ加算する(CPU側は対象外)
  recordProgress(summary.player, summary.durationMs);
  return record;
}

// ------------------------------------------------------------------
// 生涯累計プレイ統計(D-054: 称号/ランクシステム、D-055: アンロック要素)
// ------------------------------------------------------------------

export function loadProgress(): LifetimeProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultLifetimeProgress();
    return mergeLifetimeProgress(JSON.parse(raw));
  } catch {
    return defaultLifetimeProgress();
  }
}

/** 引き継ぎ復元時だけ使用する。 */
export function replaceProgress(value: unknown): LifetimeProgress {
  const progress = mergeLifetimeProgress(value);
  saveProgress(progress);
  return progress;
}

function saveProgress(progress: LifetimeProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // 保存失敗は無視(称号・アンロックの判定は次回プレイ時にまた更新される)
  }
}

/** サバイバル・対戦のどちらの終了時にも呼ばれる。純粋な集計はpackages/progressionに委譲する */
function recordProgress(summary: PlayerSummary, playtimeMs: number): LifetimeProgress {
  const next = accumulateProgress(loadProgress(), {
    score: summary.score,
    kpm: summary.kpm,
    accuracy: summary.accuracy,
    phraseCount: summary.phraseCount,
    maxChain: summary.maxChain,
    playtimeMs,
  });
  saveProgress(next);
  return next;
}

export function loadNickname(): string | null {
  try {
    return localStorage.getItem(NICKNAME_KEY);
  } catch {
    return null;
  }
}

export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname.trim().slice(0, 12));
  } catch {
    // 保存失敗は無視
  }
}

export function replaceNickname(nickname: string | null): void {
  try {
    if (nickname) localStorage.setItem(NICKNAME_KEY, nickname.trim().slice(0, 12));
    else localStorage.removeItem(NICKNAME_KEY);
  } catch {
    // localStorage が使えない場合もゲームは継続する。
  }
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeStoredResult(value: unknown): StoredResult[] {
  if (!value || typeof value !== "object") return [];
  const result = value as Partial<StoredResult>;
  const difficulty = result.difficulty;
  if (!(
    typeof result.score === "number" && Number.isFinite(result.score) &&
    typeof result.maxChain === "number" && Number.isFinite(result.maxChain) &&
    typeof result.kpm === "number" && Number.isFinite(result.kpm) &&
    typeof result.accuracy === "number" && Number.isFinite(result.accuracy) &&
    typeof result.phraseCount === "number" && Number.isFinite(result.phraseCount) &&
    typeof result.survivedMs === "number" && Number.isFinite(result.survivedMs) &&
    typeof result.playedAt === "string" &&
    (difficulty === undefined || difficulty === "easy" || difficulty === "normal" || difficulty === "hard" || difficulty === "god")
  )) return [];
  const normalized: StoredResult = {
    score: result.score,
    maxChain: result.maxChain,
    kpm: result.kpm,
    accuracy: result.accuracy,
    phraseCount: result.phraseCount,
    survivedMs: result.survivedMs,
    playedAt: result.playedAt,
    difficulty: difficulty ?? "normal",
  };
  // 旧形式の保存データは余計なキーを増やさず、そのままサバイバルとして扱う。
  // 新形式のデイリー記録だけはモード情報を保持して分析を分離する。
  if (result.mode === "daily" || result.ruleset === "daily-v2") {
    normalized.mode = "daily";
    normalized.ruleset = "daily-v2";
  } else if (result.mode === "survival" || result.ruleset === "survival-v1") {
    normalized.mode = "survival";
    normalized.ruleset = "survival-v1";
  }
  return [normalized];
}
