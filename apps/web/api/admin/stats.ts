import type { VercelRequest, VercelResponse } from "@vercel/node";
import Redis from "ioredis";
import { isAuthorizedAdmin } from "../_shared/adminAuth.js";
import { histogram, summarize } from "../_shared/statsMath.js";

/**
 * 管理者専用プレイデータ統計(D-094, D-095で拡張)。
 *
 * `apps/web/public/admin/stats.html` から呼ばれる、運営者本人だけが見るための集計API。
 * サイトマップ・robots.txt から除外し、noindexにしている(公開ページではない)。
 *
 * ここで表示できるのは「送信済みスコア」の集計のみ。CPU対戦の結果・称号や
 * 生涯累計プレイ統計・苦手キー分析は端末のlocalStorageにしか存在せず、
 * サーバーは一切関知していないため、原理的にここには出せない
 * (画面側にもその旨を明記している)。
 */

const SURVIVAL_DIFFICULTIES = ["easy", "normal", "hard", "god"] as const;
type SurvivalDifficulty = (typeof SURVIVAL_DIFFICULTIES)[number];

const SURVIVAL_KEY_PREFIX = "leaderboard:survival:alltime";
/** scores.ts の自己ベスト制(D-093)導入時に加わった、プレイヤー別記録の接頭辞 */
const PLAYER_MEMBER_PREFIX = "player:";
const DAILY_RULESET_VERSION = 2;
/** 参加者数の推移として見せる日数 */
const RECENT_DAILY_DAYS = 30;
/** KPM・正確率・スコアの平均推移として見せる日数(1日ごとにhgetallするため長すぎない範囲) */
const DAILY_TREND_DAYS = 14;
/** サバイバル側の MAX_RETAINED_ENTRIES(scores.ts)と同じ上限に合わせる */
const MAX_SAMPLE = 500;
/** 頻出ニックネームの上位何件を見せるか */
const TOP_NICKNAME_LIMIT = 15;

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
    const [survivalResult, daily, shares] = await Promise.all([
      buildSurvivalStats(redis),
      buildDailyStats(redis),
      buildShareStats(redis),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      survival: survivalResult.byDifficulty,
      survivalActivity: survivalResult.activity,
      daily,
      shares,
    });
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

interface SurvivalEntry {
  nickname: string;
  score: number;
  maxChain: number;
  level: number;
  submittedAt: string;
}

/**
 * scores.ts の entryKeyForMember と同じ解決ロジック(D-093の自己ベスト制に対応)。
 * 新方式(自己ベスト)は member が "player:<id>" で、詳細は
 * score:survival:<difficulty>:player:<id> という専用キーに入る。
 * 移行前の記録は member がランダムIDそのもので、score:<id> に入っている。
 * ここを更新し忘れると、自己ベスト制へ移行したプレイヤーの記録が
 * 集計から静かに漏れる(実際にD-094公開直後に1件の欠落として発現した)。
 */
function entryKeyForMember(difficulty: SurvivalDifficulty, member: string): string {
  if (member.startsWith(PLAYER_MEMBER_PREFIX)) {
    const playerId = member.slice(PLAYER_MEMBER_PREFIX.length);
    return `score:survival:${difficulty}:player:${playerId}`;
  }
  return `score:${member}`;
}

async function buildSurvivalStats(redis: Redis): Promise<{
  byDifficulty: Record<SurvivalDifficulty, unknown>;
  activity: unknown;
}> {
  const byDifficulty = {} as Record<SurvivalDifficulty, unknown>;
  const nicknameStats = new Map<string, { count: number; bestScore: number }>();
  const hourCounts = new Array(24).fill(0) as number[];
  const weekdayCounts = new Array(7).fill(0) as number[];
  let totalSubmissionsAcrossDifficulties = 0;

  for (const difficulty of SURVIVAL_DIFFICULTIES) {
    const key = `${SURVIVAL_KEY_PREFIX}:${difficulty}`;
    const [total, members] = await Promise.all([
      redis.zcard(key),
      redis.zrevrange(key, 0, MAX_SAMPLE - 1),
    ]);

    if (members.length === 0) {
      byDifficulty[difficulty] = {
        total,
        top: [],
        score: null,
        scoreHistogram: [],
        maxChain: null,
        maxChainHistogram: [],
        level: null,
        levelHistogram: [],
      };
      continue;
    }

    const pipeline = redis.pipeline();
    for (const member of members) pipeline.hgetall(entryKeyForMember(difficulty, member));
    const rows = await pipeline.exec();

    const entries: SurvivalEntry[] = [];
    for (const row of rows ?? []) {
      const [err, raw] = row;
      if (err || !raw || Object.keys(raw as object).length === 0) continue;
      const h = raw as SurvivalHashRow;
      const entry: SurvivalEntry = {
        nickname: h.nickname ?? "",
        score: Number(h.score) || 0,
        maxChain: Number(h.maxChain) || 0,
        level: Number(h.level) || 1,
        submittedAt: h.submittedAt ?? "",
      };
      entries.push(entry);

      // 活動集計(時間帯・曜日・頻出ニックネーム)は全難易度の記録から横断で作る
      totalSubmissionsAcrossDifficulties += 1;
      const submitted = new Date(entry.submittedAt);
      if (!Number.isNaN(submitted.getTime())) {
        hourCounts[submitted.getHours()]! += 1;
        weekdayCounts[submitted.getDay()]! += 1;
      }
      if (entry.nickname) {
        const current = nicknameStats.get(entry.nickname) ?? { count: 0, bestScore: 0 };
        current.count += 1;
        current.bestScore = Math.max(current.bestScore, entry.score);
        nicknameStats.set(entry.nickname, current);
      }
    }

    const scores = entries.map((e) => e.score);
    const chains = entries.map((e) => e.maxChain);
    const levels = entries.map((e) => e.level);

    byDifficulty[difficulty] = {
      total,
      // members は zrevrange 済み(スコア降順)なので先頭10件がそのまま上位
      top: entries.slice(0, 10),
      score: summarize(scores),
      scoreHistogram: histogram(scores, 12),
      maxChain: summarize(chains),
      maxChainHistogram: histogram(chains, Math.min(10, new Set(chains).size || 1)),
      level: summarize(levels),
      levelHistogram: histogram(levels, Math.min(12, new Set(levels).size || 1)),
    };
  }

  const topNicknames = [...nicknameStats.entries()]
    .map(([nickname, stat]) => ({ nickname, count: stat.count, bestScore: stat.bestScore }))
    .sort((a, b) => b.count - a.count || b.bestScore - a.bestScore)
    .slice(0, TOP_NICKNAME_LIMIT);

  return {
    byDifficulty,
    activity: {
      totalSampled: totalSubmissionsAcrossDifficulties,
      uniqueNicknameCount: nicknameStats.size,
      byHour: hourCounts.map((count, hour) => ({ hour, count })),
      byWeekday: weekdayCounts.map((count, weekday) => ({ weekday, count })),
      topNicknames,
    },
  };
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

async function fetchDailyEntries(redis: Redis, date: string): Promise<DailyHashRow[]> {
  const key = dailyLeaderboardKey(date);
  const ids = await redis.zrevrange(key, 0, MAX_SAMPLE - 1);
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.hgetall(dailyEntryKey(date, id));
  const rows = await pipeline.exec();
  const entries: DailyHashRow[] = [];
  for (const row of rows ?? []) {
    const [err, raw] = row;
    if (err || !raw || Object.keys(raw as object).length === 0) continue;
    entries.push(raw as DailyHashRow);
  }
  return entries;
}

async function buildDailyStats(redis: Redis): Promise<unknown> {
  const now = Date.now();
  const longDates = Array.from({ length: RECENT_DAILY_DAYS }, (_, i) =>
    japanDateString(new Date(now - i * 86_400_000)),
  );
  const today = longDates[0]!;

  const recentDays = await Promise.all(
    longDates.map(async (date) => ({
      date,
      participants: await redis.zcard(dailyLeaderboardKey(date)),
    })),
  );

  const trendDates = longDates.slice(0, DAILY_TREND_DAYS);
  const recentTrend = await Promise.all(
    trendDates.map(async (date) => {
      const entries = await fetchDailyEntries(redis, date);
      const scores = entries.map((e) => Number(e.score) || 0);
      const kpms = entries.map((e) => Number(e.kpm) || 0);
      const accuracies = entries.map((e) => (Number(e.accuracy) || 0) * 100);
      return {
        date,
        participants: entries.length,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        avgKpm: kpms.length ? Math.round(kpms.reduce((a, b) => a + b, 0) / kpms.length) : null,
        avgAccuracy: accuracies.length
          ? Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10
          : null,
      };
    }),
  );

  // 今日のぶんは recentTrend で既に取得済みのため使い回し、二重取得しない
  const todayEntries = await fetchDailyEntries(redis, today);
  const participants = todayEntries.length;

  if (participants === 0) {
    return {
      today,
      recentDays,
      recentTrend,
      todayStats: { participants: 0, top: [], score: null, kpm: null, accuracy: null },
    };
  }

  const scores = todayEntries.map((e) => Number(e.score) || 0);
  const kpms = todayEntries.map((e) => Number(e.kpm) || 0);
  const accuracies = todayEntries.map((e) => (Number(e.accuracy) || 0) * 100);

  return {
    today,
    recentDays,
    recentTrend,
    todayStats: {
      participants,
      top: todayEntries.slice(0, 10).map((e) => ({
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
