import type { DailyProgress } from "./daily";
import { loadDailyProgress, replaceDailyProgress } from "./daily";
import { loadPlayerId } from "./playerId";
import {
  loadDuelRecord,
  loadNickname,
  loadProgress,
  loadResults,
  replaceDuelRecord,
  replaceNickname,
  replaceProgress,
  replaceResults,
  type DuelRecord,
  type StoredResult,
} from "./storage";
import type { LifetimeProgress } from "@type-burst/progression";

const SNAPSHOT_THROTTLE_MS = 30_000;
let lastSnapshotUploadAt = 0;

export interface PlayerSnapshot {
  version: 1;
  nickname: string | null;
  progress: LifetimeProgress;
  results: StoredResult[];
  dailyProgress: DailyProgress;
  duelRecord: DuelRecord;
}

export interface RestorePreview {
  snapshot: PlayerSnapshot;
}

function isSnapshot(value: unknown): value is PlayerSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PlayerSnapshot>;
  const progress = snapshot.progress as Partial<LifetimeProgress> | undefined;
  const dailyProgress = snapshot.dailyProgress as Partial<DailyProgress> | undefined;
  if (
    snapshot.version !== 1 ||
    (typeof snapshot.nickname !== "string" && snapshot.nickname !== null) ||
    !progress ||
    !dailyProgress ||
    !Array.isArray(snapshot.results) ||
    !snapshot.duelRecord
  ) return false;
  return [
    progress.totalGames,
    progress.totalScore,
    progress.bestScore,
    progress.bestKpm,
    progress.bestAccuracy,
    progress.totalPhrases,
    progress.totalPlaytimeMs,
    progress.maxChainEver,
  ].every(isFiniteNonNegative) &&
    (progress.bestAccuracy ?? 0) <= 1 &&
    isFiniteNonNegative(dailyProgress.currentStreak) &&
    isFiniteNonNegative(dailyProgress.bestStreak) &&
    isFiniteNonNegative(dailyProgress.freezes);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function buildPlayerSnapshot(): PlayerSnapshot {
  return {
    version: 1,
    nickname: loadNickname(),
    progress: loadProgress(),
    results: loadResults(),
    dailyProgress: loadDailyProgress(),
    duelRecord: loadDuelRecord(),
  };
}

/**
 * 結果画面を止めずに記録を保存する。通信失敗・オフライン時は何もしない。
 */
export function queueSnapshotUpload(): void {
  const now = Date.now();
  if (now - lastSnapshotUploadAt < SNAPSHOT_THROTTLE_MS) return;
  lastSnapshotUploadAt = now;
  void request("snapshot", { snapshot: buildPlayerSnapshot() }).catch(() => undefined);
}

export async function issueTransferCode(): Promise<string> {
  const response = await request("issue", { snapshot: buildPlayerSnapshot() });
  if (!response || typeof response.code !== "string") throw new Error("issue transfer code failed");
  return response.code;
}

export async function previewRestore(code: string): Promise<RestorePreview> {
  const response = await request("lookup", { code });
  if (!isSnapshot(response?.snapshot)) throw new Error("invalid transfer code");
  return { snapshot: response.snapshot };
}

export async function restoreFromCode(code: string): Promise<PlayerSnapshot> {
  const response = await request("restore", { code });
  if (!isSnapshot(response?.snapshot)) throw new Error("invalid transfer code");
  return response.snapshot;
}

/** 明示確認の後にのみ実行する。既存データとのマージは絶対に行わない。 */
export function replaceLocalPlayerData(snapshot: PlayerSnapshot): void {
  replaceProgress(snapshot.progress);
  replaceResults(snapshot.results);
  replaceDailyProgress(snapshot.dailyProgress);
  replaceDuelRecord(snapshot.duelRecord);
  replaceNickname(snapshot.nickname);
}

export async function deleteCloudPlayerData(): Promise<void> {
  await request("delete");
}

async function request(action: "snapshot" | "issue" | "lookup" | "restore" | "delete", payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch("/api/player-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, playerId: loadPlayerId(), ...payload }),
  });
  if (!response.ok) throw new Error(`player data: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}
