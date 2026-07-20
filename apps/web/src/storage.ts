import type {
  CpuDifficulty,
  DuelSummary,
  SurvivalDifficulty,
  SurvivalSummary,
} from "@type-burst/game-core";

const SETTINGS_KEY = "typeblast.settings.v1";
const RESULTS_KEY = "typeblast.results.v2";
const DUEL_RECORD_KEY = "typeblast.duel.v1";
const NICKNAME_KEY = "typeblast.nickname.v1";

export type FontScale = 1 | 1.15 | 1.3;

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
    const parsed = JSON.parse(raw) as StoredResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** サバイバル結果を直近10件だけ保持する(設計書 §27) */
export function appendResult(summary: SurvivalSummary): StoredResult[] {
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
  });
  const trimmed = results.slice(0, 10);
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(trimmed));
  } catch {
    // 保存失敗は無視
  }
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
    .filter((r) => (r.difficulty ?? "normal") === difficulty)
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
  return record;
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
