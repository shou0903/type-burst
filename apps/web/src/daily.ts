import type { SurvivalSummary } from "@type-burst/game-core";

const DAILY_STATE_KEY = "typeblast.daily.v1";
const DAILY_PLAYER_ID_KEY = "typeblast.daily-player.v1";
export const DAILY_RANKED_ATTEMPTS = 3;
export const DAILY_TIME_LIMIT_MS = 120_000;

export interface DailyDayRecord {
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
  return `daily-${challengeId}-v1`;
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

function saveDailyProgress(progress: DailyProgress): void {
  try {
    localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(progress));
  } catch {
    // 保存不可でもゲーム本編は続行する。
  }
}

export function dailyAttempts(
  progress: DailyProgress,
  challengeId = dailyChallengeId(),
): number {
  return progress.days[challengeId]?.attempts ?? 0;
}

export function dailyBestScore(
  progress: DailyProgress,
  challengeId = dailyChallengeId(),
): number {
  return progress.days[challengeId]?.bestScore ?? 0;
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
  const existing = progress.days[challengeId];
  const firstPlayToday = !existing;
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
  try {
    const existing = localStorage.getItem(DAILY_PLAYER_ID_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DAILY_PLAYER_ID_KEY, created);
    return created;
  } catch {
    return `session-${Math.random().toString(36).slice(2)}`;
  }
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
