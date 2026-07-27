import type { SurvivalSummary } from "@type-burst/game-core";
import { loadPlayerId } from "./playerId";

const DAILY_STATE_KEY = "typeblast.daily.v1";
export const DAILY_RULESET_VERSION = 2;
export const DAILY_RANKED_ATTEMPTS = 3;
export const DAILY_TIME_LIMIT_MS = 120_000;

export interface DailyDayRecord {
  rulesetVersion?: number;
  attempts: number;
  bestScore: number;
  lastPlayedAt: string;
}

export interface DailyProgress {
  version: 1;
  currentStreak: number;
  bestStreak: number;
  freezes: number;
  lastPlayedDate: string | null;
  playedDates: string[];
  protectedDates: string[];
  days: Record<string, DailyDayRecord>;
}

export interface DailyRecordResult {
  progress: DailyProgress;
  firstPlayToday: boolean;
  freezeUsed: boolean;
  freezeAwarded: boolean;
}

function emptyProgress(): DailyProgress {
  return {
    version: 1,
    currentStreak: 0,
    bestStreak: 0,
    freezes: 0,
    lastPlayedDate: null,
    playedDates: [],
    protectedDates: [],
    days: {},
  };
}

/** Asia/Tokyoの日付を、SeedとAPIで共通利用できるYYYY-MM-DDへ正規化する。 */
export function dailyChallengeId(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function dailySeed(challengeId: string): string {
  return `daily-${challengeId}-v${DAILY_RULESET_VERSION}`;
}

export function loadDailyProgress(): DailyProgress {
  try {
    const raw = localStorage.getItem(DAILY_STATE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<DailyProgress>;
    return {
      ...emptyProgress(),
      ...parsed,
      playedDates: Array.isArray(parsed.playedDates) ? parsed.playedDates : [],
      protectedDates: Array.isArray(parsed.protectedDates) ? parsed.protectedDates : [],
      days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
    };
  } catch {
    return emptyProgress();
  }
}

export function saveDailyProgress(progress: DailyProgress): void {
  try {
    localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(progress));
  } catch {
    // 保存不可でもゲーム本編は続行する。
  }
}

/** 引き継ぎ復元時だけ使用する。通常プレイでは recordDailyResult を使う。 */
export function replaceDailyProgress(value: unknown): DailyProgress {
  const parsed = value && typeof value === "object" ? (value as Partial<DailyProgress>) : {};
  const next: DailyProgress = {
    ...emptyProgress(),
    ...parsed,
    version: 1,
    currentStreak: finiteNonNegative(parsed.currentStreak),
    bestStreak: finiteNonNegative(parsed.bestStreak),
    freezes: Math.min(2, finiteNonNegative(parsed.freezes)),
    lastPlayedDate: typeof parsed.lastPlayedDate === "string" ? parsed.lastPlayedDate : null,
    playedDates: Array.isArray(parsed.playedDates) ? parsed.playedDates.filter((date): date is string => typeof date === "string").slice(-90) : [],
    protectedDates: Array.isArray(parsed.protectedDates) ? parsed.protectedDates.filter((date): date is string => typeof date === "string").slice(-90) : [],
    days: parsed.days && typeof parsed.days === "object" ? parsed.days as Record<string, DailyDayRecord> : {},
  };
  saveDailyProgress(next);
  return next;
}

export function dailyAttempts(
  progress: DailyProgress,
  challengeId = dailyChallengeId(),
): number {
  const record = progress.days[challengeId];
  return record?.rulesetVersion === DAILY_RULESET_VERSION ? record.attempts : 0;
}

export function dailyBestScore(
  progress: DailyProgress,
  challengeId = dailyChallengeId(),
): number {
  const record = progress.days[challengeId];
  return record?.rulesetVersion === DAILY_RULESET_VERSION ? record.bestScore : 0;
}

export function isDailyRankedAttempt(
  progress: DailyProgress,
  challengeId = dailyChallengeId(),
): boolean {
  return dailyAttempts(progress, challengeId) < DAILY_RANKED_ATTEMPTS;
}

export function recordDailyResult(
  challengeId: string,
  summary: SurvivalSummary,
  ranked: boolean,
  now = new Date(),
): DailyRecordResult {
  const previous = loadDailyProgress();
  const progress: DailyProgress = {
    ...previous,
    playedDates: [...previous.playedDates],
    protectedDates: [...previous.protectedDates],
    days: { ...previous.days },
  };
  const storedRecord = progress.days[challengeId];
  const existing =
    storedRecord?.rulesetVersion === DAILY_RULESET_VERSION ? storedRecord : undefined;
  const firstPlayToday = !progress.playedDates.includes(challengeId);
  let freezeUsed = false;
  let freezeAwarded = false;

  if (firstPlayToday) {
    const gap = progress.lastPlayedDate
      ? daysBetween(progress.lastPlayedDate, challengeId)
      : null;
    if (gap === null || gap <= 0) {
      progress.currentStreak = Math.max(1, progress.currentStreak);
    } else if (gap === 1) {
      progress.currentStreak += 1;
    } else if (gap === 2 && progress.freezes > 0) {
      const protectedDate = shiftDate(challengeId, -1);
      progress.freezes -= 1;
      progress.currentStreak += 1;
      freezeUsed = true;
      if (!progress.protectedDates.includes(protectedDate)) {
        progress.protectedDates.push(protectedDate);
      }
    } else {
      progress.currentStreak = 1;
    }

    if (progress.currentStreak > 0 && progress.currentStreak % 7 === 0 && progress.freezes < 2) {
      progress.freezes += 1;
      freezeAwarded = true;
    }
    progress.bestStreak = Math.max(progress.bestStreak, progress.currentStreak);
    progress.lastPlayedDate = challengeId;
    if (!progress.playedDates.includes(challengeId)) progress.playedDates.push(challengeId);
  }

  progress.days[challengeId] = {
    rulesetVersion: DAILY_RULESET_VERSION,
    attempts: Math.min(
      DAILY_RANKED_ATTEMPTS,
      (existing?.attempts ?? 0) + (ranked ? 1 : 0),
    ),
    bestScore: Math.max(existing?.bestScore ?? 0, summary.score),
    lastPlayedAt: now.toISOString(),
  };

  progress.playedDates = progress.playedDates.sort().slice(-90);
  progress.protectedDates = progress.protectedDates.sort().slice(-90);
  const retained = new Set([...progress.playedDates, challengeId]);
  progress.days = Object.fromEntries(
    Object.entries(progress.days).filter(([date]) => retained.has(date)),
  );
  saveDailyProgress(progress);
  return { progress, firstPlayToday, freezeUsed, freezeAwarded };
}

export function loadDailyPlayerId(): string {
  return loadPlayerId();
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function daysBetween(from: string, to: string): number {
  return Math.round((dateNumber(to) - dateNumber(from)) / 86_400_000);
}

function shiftDate(date: string, amount: number): string {
  const shifted = new Date(dateNumber(date) + amount * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function dateNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}
