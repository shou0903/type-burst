import type { SurvivalDifficulty } from "@type-burst/game-core";
import { submitScore, type RankingSummary } from "./ranking";

/**
 * 通信断で結果画面を閉じても、ランキング登録の機会を失わないための
 * 小さな端末内キュー。入力内容・分析データは保存せず、ランキングに
 * 必要な粗い結果だけを難易度ごとに1件保持する。
 */
const OUTBOX_KEY = "typeblast.ranking-outbox.v1";
const MAX_PENDING = 4;
const RETRY_INTERVAL_MS = 30_000;
const RUN_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

export interface PendingRankingSubmission {
  runId: string;
  nickname: string;
  summary: RankingSummary;
  queuedAt: string;
  lastAttemptAt?: number;
}

/** 未送信キューを読み込む。壊れた旧データは静かに捨てる。 */
export function loadPendingRankingSubmissions(): PendingRankingSubmission[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const normalized = normalizePending(entry);
      return normalized ? [normalized] : [];
    }).slice(0, MAX_PENDING);
  } catch {
    return [];
  }
}

/** 送信失敗した結果を、難易度ごとの最高記録としてキューへ追加する。 */
export function enqueueRankingSubmission(
  runId: string,
  nickname: string,
  summary: RankingSummary,
): void {
  const normalized = normalizePending({
    runId,
    nickname,
    summary,
    queuedAt: new Date().toISOString(),
  });
  if (!normalized || normalized.summary.score <= 0) return;

  const current = loadPendingRankingSubmissions();
  const sameRun = current.findIndex((entry) => entry.runId === normalized.runId);
  let next: PendingRankingSubmission[];
  if (sameRun >= 0) {
    next = current.slice();
    next[sameRun] = normalized;
  } else {
    const sameDifficulty = current.find(
      (entry) => entry.summary.difficulty === normalized.summary.difficulty,
    );
    // すでに保留中の方が高ければ、低い結果を増やさない。
    if (sameDifficulty && sameDifficulty.summary.score >= normalized.summary.score) {
      notifyOutboxChanged();
      return;
    }
    next = current.filter(
      (entry) => entry.summary.difficulty !== normalized.summary.difficulty,
    );
    next.unshift(normalized);
  }
  savePending(next.slice(0, MAX_PENDING));
}

/** 成功した結果をキューから取り除く。 */
export function removePendingRankingSubmission(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) return;
  const next = loadPendingRankingSubmissions().filter((entry) => entry.runId !== runId);
  savePending(next);
}

/**
 * 保留中のうち1件だけをベストエフォートで再送する。短い間隔で何度も
 * 叩かないため、画面表示・フォーカス復帰から呼び出してもレート制限を
 * 無駄に消費しない。戻り値は今回成功した件数。
 */
export async function retryPendingRankingSubmissions(): Promise<number> {
  const queue = loadPendingRankingSubmissions();
  const now = Date.now();
  const target = queue.find(
    (entry) =>
      entry.lastAttemptAt === undefined || now - entry.lastAttemptAt >= RETRY_INTERVAL_MS,
  );
  if (!target) return 0;

  const marked = queue.map((entry) =>
    entry.runId === target.runId ? { ...entry, lastAttemptAt: now } : entry,
  );
  savePending(marked);

  const result = await submitScore(target.nickname, target.summary);
  if (!result.ok) return 0;
  removePendingRankingSubmission(target.runId);
  return 1;
}

function savePending(value: PendingRankingSubmission[]): void {
  try {
    if (value.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(value.slice(0, MAX_PENDING)));
  } catch {
    // private mode等ではメモリを増やさず、ゲーム進行を優先する。
  }
  notifyOutboxChanged();
}

function notifyOutboxChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("typeburst:ranking-outbox-changed"));
}

function normalizePending(value: unknown): PendingRankingSubmission | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<PendingRankingSubmission>;
  const summary = source.summary;
  if (!summary || typeof summary !== "object") return null;
  const raw = summary as Partial<RankingSummary>;
  if (
    typeof source.runId !== "string" ||
    !RUN_ID_PATTERN.test(source.runId) ||
    typeof source.nickname !== "string" ||
    typeof source.queuedAt !== "string" ||
    !isDifficulty(raw.difficulty) ||
    !finiteInRange(raw.score, 1, 1_000_000) ||
    !finiteInRange(raw.maxChain, 0, 60) ||
    !finiteInRange(raw.survivedMs, 0, 6 * 60 * 60 * 1000) ||
    !finiteInRange(raw.level, 1, 10_000)
  ) {
    return null;
  }
  const nickname = source.nickname.trim().slice(0, 12);
  if (!nickname) return null;
  const lastAttemptAt =
    typeof source.lastAttemptAt === "number" && Number.isFinite(source.lastAttemptAt)
      ? Math.max(0, source.lastAttemptAt)
      : undefined;
  return {
    runId: source.runId,
    nickname,
    summary: {
      score: Math.floor(raw.score),
      difficulty: raw.difficulty,
      maxChain: Math.floor(raw.maxChain),
      survivedMs: Math.floor(raw.survivedMs),
      level: Math.floor(raw.level),
    },
    queuedAt: source.queuedAt,
    ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
  };
}

function isDifficulty(value: unknown): value is SurvivalDifficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "god";
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
