import type { VercelRequest, VercelResponse } from "@vercel/node";
import Redis from "ioredis";
import { isAuthorizedAdmin } from "../_shared/adminAuth";
import { histogram, summarize } from "../_shared/statsMath";

/**
 * 管理者専用プレイデータ統計(D-093)。
 *
 * `apps/web/public/admin/stats.html` から呼ばれる、運営者本人だけが見るための集計API。
 * サイトマップ・robots.txt から除外し、noindexにしている(公開ページではない)。
 *
 * ここで表示できるのは「送信済みスコア」の集計のみ。0点や未送信のプレイ、
 * ページ閲覧数などのトラフィック全体はここでは分からない
 * (Vercel Web Analyticsの管轄であり、Redisには記録されていないため)。
 */

const SURVIVAL_DIFFICULTIES = ["easy", "normal", "hard", "god"] as const;
type SurvivalDifficulty = (typeof SURVIVAL_DIFFICULTIES)[number];

const SURVIVAL_KEY_PREFIX = "leaderboard:survival:alltime";
const DAILY_RULESET_VERSION = 2;
const RECENT_DAILY_DAYS = 7;
/** サバイバル側の MAX_RETAINED_ENTRIES(scores.ts)と同じ上限に合わせる */
const MAX_SAMPLE = 500;

let client: Redis | null = null;

function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL が設定されていません");
    client = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
  }
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!isAuthorizedAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const redis = getRedis();
    const [survival, daily, shares] = await Promise.all([
      buildSurvivalStats(redis),
      buildDailyStats(redis),
      buildShareStats(redis),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ generatedAt: new Date().toISOString(), survival, daily, shares });
  } catch {
    res.status(500).json({ error: "Stats unavailable" });
  }
}

// ------------------------------------------------------------------
// サバイバル
// ------------------------------------------------------------------

interface SurvivalHashRow {
  nickname?: string;
  score?: string;
  maxChain?: string;
  level?: string;
  submittedAt?: string;
}

async function buildSurvivalStats(
  redis: Redis,
): Promise<Record<SurvivalDifficulty, unknown>> {
  const result = {} as Record<SurvivalDifficulty, unknown>;
  for (const difficulty of SURVIVAL_DIFFICULTIES) {
    const key = `${SURVIVAL_KEY_PREFIX}:${difficulty}`;
    const [total, ids] = await Promise.all([redis.zcard(key), redis.zrevrange(key, 0, MAX_SAMPLE - 1)]);

    if (ids.length === 0) {
      result[difficulty] = { total, top: [], score: null, scoreHistogram: [], maxChain: null, level: null };
      continue;
    }

    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.hgetall(`score:${id}`);
    const rows = await pipeline.exec();

    const entries: SurvivalHashRow[] = [];
    for (const row of rows ?? []) {
      const [err, raw] = row;
      if (err || !raw || Object.keys(raw as object).length === 0) continue;
      entries.push(raw as SurvivalHashRow);
    }

    const scores = entries.map((e) => Number(e.score) || 0);
    const chains = entries.map((e) => Number(e.maxChain) || 0);
    const levels = entries.map((e) => Number(e.level) || 1);

    result[difficulty] = {
      total,
      // ids は zrevrange 済み(スコア降順)なので先頭10件がそのまま上位
      top: entries.slice(0, 10).map((e) => ({
        nickname: e.nickname ?? "",
        score: Number(e.score) || 0,
        maxChain: Number(e.maxChain) || 0,
        level: Number(e.level) || 1,
        submittedAt: e.submittedAt ?? "",
      })),
      score: summarize(scores),
      scoreHistogram: histogram(scores, 12),
      maxChain: summarize(chains),
      level: summarize(levels),
    };
  }
  return result;
}

// ------------------------------------------------------------------
// デイリーチャレンジ
// ------------------------------------------------------------------

interface DailyHashRow {
  nickname?: string;
  score?: string;
  kpm?: string;
  accuracy?: string;
}

function dailyLeaderboardKey(challengeId: string): string {
  return `leaderboard:daily:v${DAILY_RULESET_VERSION}:${challengeId}`;
}

function dailyEntryKey(challengeId: string, playerId: string): string {
  return `daily-score:v${DAILY_RULESET_VERSION}:${challengeId}:${playerId}`;
}

function japanDateString(date: Date): string {
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

async function buildDailyStats(redis: Redis): Promise<unknown> {
  const now = Date.now();
  const dates = Array.from({ length: RECENT_DAILY_DAYS }, (_, i) =>
    japanDateString(new Date(now - i * 86_400_000)),
  );
  const today = dates[0]!;

  const recentDays = await Promise.all(
    dates.map(async (date) => ({
      date,
      participants: await redis.zcard(dailyLeaderboardKey(date)),
    })),
  );

  const todayKey = dailyLeaderboardKey(today);
  const [participants, ids] = await Promise.all([
    redis.zcard(todayKey),
    redis.zrevrange(todayKey, 0, MAX_SAMPLE - 1),
  ]);

  if (ids.length === 0) {
    return {
      today,
      recentDays,
      todayStats: { participants, top: [], score: null, kpm: null, accuracy: null },
    };
  }

  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.hgetall(dailyEntryKey(today, id));
  const rows = await pipeline.exec();

  const entries: DailyHashRow[] = [];
  for (const row of rows ?? []) {
    const [err, raw] = row;
    if (err || !raw || Object.keys(raw as object).length === 0) continue;
    entries.push(raw as DailyHashRow);
  }

  const scores = entries.map((e) => Number(e.score) || 0);
  const kpms = entries.map((e) => Number(e.kpm) || 0);
  // accuracy は 0〜1 で保存されているため、表示用に % へ変換する
  const accuracies = entries.map((e) => (Number(e.accuracy) || 0) * 100);

  return {
    today,
    recentDays,
    todayStats: {
      participants,
      top: entries.slice(0, 10).map((e) => ({
        nickname: e.nickname ?? "",
        score: Number(e.score) || 0,
        kpm: Number(e.kpm) || 0,
        accuracy: (Number(e.accuracy) || 0) * 100,
      })),
      score: summarize(scores),
      scoreHistogram: histogram(scores, 12),
      kpm: summarize(kpms),
      kpmHistogram: histogram(kpms, 12),
      accuracy: summarize(accuracies),
      accuracyHistogram: histogram(accuracies, 10),
    },
  };
}

// ------------------------------------------------------------------
// 共有カード
// ------------------------------------------------------------------

async function buildShareStats(redis: Redis): Promise<{ totalCreated: number }> {
  const total = Number(await redis.get("stats:shares:total")) || 0;
  return { totalCreated: total };
}
