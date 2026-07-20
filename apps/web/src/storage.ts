import type { CpuDifficulty, DuelSummary, SurvivalSummary } from "@type-blast/game-core";

const SETTINGS_KEY = "typeblast.settings.v1";
const RESULTS_KEY = "typeblast.results.v2";
const DUEL_RECORD_KEY = "typeblast.duel.v1";

export interface Settings {
  soundOn: boolean;
  reducedMotion: boolean;
}

export interface StoredResult {
  score: number;
  maxChain: number;
  kpm: number;
  accuracy: number;
  phraseCount: number;
  survivedMs: number;
  playedAt: string;
}

export type DuelRecord = Record<CpuDifficulty, { wins: number; losses: number }>;

const DEFAULT_SETTINGS: Settings = { soundOn: true, reducedMotion: false };
const DEFAULT_DUEL_RECORD: DuelRecord = {
  easy: { wins: 0, losses: 0 },
  normal: { wins: 0, losses: 0 },
  hard: { wins: 0, losses: 0 },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
  });
  const trimmed = results.slice(0, 10);
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(trimmed));
  } catch {
    // 保存失敗は無視
  }
  return trimmed;
}

export function bestScore(results: StoredResult[]): number {
  return results.reduce((max, r) => Math.max(max, r.score), 0);
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
