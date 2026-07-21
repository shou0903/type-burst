import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

/**
 * サバイバルモードの全期間累計ランキング(Redis sorted set)。
 * クライアントから送られたスコアをそのまま信用する簡易実装(v1)。
 * game-core は決定論的なので、将来的にはSeed+入力ログを送らせてサーバー側で
 * 再シミュレーションし検証する方式へ強化できる(docs/DECISIONS.md 参照)。
 *
 * データストアは Vercel Marketplace の Redis 連携(REDIS_URL、TCP接続)。
 * @vercel/kv(REST方式)ではなく ioredis を使う(D-029)。
 */

const LEADERBOARD_KEY = "leaderboard:survival:alltime";
const MAX_RETAINED_ENTRIES = 500;
const TOP_LIMIT_DEFAULT = 100;
const TOP_LIMIT_MAX = 100;
const MAX_PLAUSIBLE_SCORE = 1_000_000;
const MAX_PLAUSIBLE_CHAIN = 60;
const MAX_PLAUSIBLE_SURVIVED_MS = 6 * 60 * 60 * 1000; // 6時間
const RATE_LIMIT_WINDOW_SEC = 5;
const NICKNAME_MAX_LENGTH = 12;

type SurvivalDifficulty = "easy" | "normal" | "hard";

/**
 * 難易度間の公平性のためのスコア補正係数(D-032, D-033, D-039)。
 * 易しい難易度は短い文章が多く同じ操作精度でも高スコアが出やすいため、
 * ランキング反映時にこの係数を掛けて割り引く/上乗せする(行上昇の速さ自体は
 * 全難易度共通)。
 * packages/game-core/src/config.ts の survivalDifficulty[*].scoreMultiplier と
 * 必ず同じ値を保つこと(このサーバーレス関数は軽量化のため game-core を
 * importせず、値をここに複製している)。
 */
const SCORE_MULTIPLIER: Record<SurvivalDifficulty, number> = {
  easy: 0.5,
  normal: 1.0,
  hard: 1.4,
};

interface ScoreEntry {
  id: string;
  nickname: string;
  /** 難易度補正後のスコア。ランキングの並び順(zadd)に使う値 */
  score: number;
  /** 補正前の素点 */
  rawScore: number;
  difficulty: SurvivalDifficulty;
  maxChain: number;
  survivedMs: number;
  level: number;
  submittedAt: string;
}

function isSurvivalDifficulty(value: unknown): value is SurvivalDifficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

// サーバーレス関数のウォームインスタンス間で接続を使い回す(毎回接続を張り直さない)
let client: Redis | null = null;

function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL が設定されていません");
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      // サーバーレス環境でのコネクション張りっぱなしによる詰まりを避ける
      connectTimeout: 5000,
    });
  }
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "GET") {
    await handleGet(req, res);
    return;
  }
  if (req.method === "POST") {
    await handlePost(req, res);
    return;
  }
  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const redis = getRedis();
  const requested = Number(req.query.limit);
  const limit = Math.min(
    TOP_LIMIT_MAX,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : TOP_LIMIT_DEFAULT,
  );

  const ids = await redis.zrevrange(LEADERBOARD_KEY, 0, limit - 1);
  if (ids.length === 0) {
    res.status(200).json({ entries: [] });
    return;
  }

  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.hgetall(`score:${id}`);
  const results = await pipeline.exec();

  const entries: ScoreEntry[] = [];
  if (results) {
    for (const [err, raw] of results) {
      if (err || !raw || Object.keys(raw).length === 0) continue;
      const h = raw as Record<string, string>;
      entries.push({
        id: h.id ?? "",
        nickname: h.nickname ?? "",
        score: Number(h.score) || 0,
        rawScore: Number(h.rawScore) || Number(h.score) || 0,
        difficulty: isSurvivalDifficulty(h.difficulty) ? h.difficulty : "normal",
        maxChain: Number(h.maxChain) || 0,
        survivedMs: Number(h.survivedMs) || 0,
        level: Number(h.level) || 1,
        submittedAt: h.submittedAt ?? "",
      });
    }
  }

  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.status(200).json({ entries });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const redis = getRedis();
  const ip = getClientIp(req);
  const rateLimitKey = `ratelimit:scores:${ip}`;
  const recent = await redis.get(rateLimitKey);
  if (recent) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  await redis.set(rateLimitKey, "1", "EX", RATE_LIMIT_WINDOW_SEC);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const nickname = sanitizeNickname(body.nickname);
  const rawScore = Number(body.score);
  const maxChain = Number(body.maxChain);
  const survivedMs = Number(body.survivedMs);
  const level = Number(body.level);
  const difficulty: SurvivalDifficulty = isSurvivalDifficulty(body.difficulty)
    ? body.difficulty
    : "normal";

  if (!nickname) {
    res.status(400).json({ error: "Invalid nickname" });
    return;
  }
  if (!Number.isFinite(rawScore) || rawScore <= 0 || rawScore > MAX_PLAUSIBLE_SCORE) {
    res.status(400).json({ error: "Invalid score" });
    return;
  }
  if (!Number.isFinite(maxChain) || maxChain < 0 || maxChain > MAX_PLAUSIBLE_CHAIN) {
    res.status(400).json({ error: "Invalid maxChain" });
    return;
  }
  if (!Number.isFinite(survivedMs) || survivedMs < 0 || survivedMs > MAX_PLAUSIBLE_SURVIVED_MS) {
    res.status(400).json({ error: "Invalid survivedMs" });
    return;
  }

  const id = randomUUID();
  const adjustedScore = Math.round(Math.floor(rawScore) * SCORE_MULTIPLIER[difficulty]);
  const entry: ScoreEntry = {
    id,
    nickname,
    score: adjustedScore,
    rawScore: Math.floor(rawScore),
    difficulty,
    maxChain: Math.floor(maxChain),
    survivedMs: Math.floor(survivedMs),
    level: Number.isFinite(level) && level > 0 ? Math.floor(level) : 1,
    submittedAt: new Date().toISOString(),
  };

  await redis.hset(`score:${id}`, entry as unknown as Record<string, string | number>);
  await redis.zadd(LEADERBOARD_KEY, entry.score, id);
  await pruneOldEntries(redis);

  res.status(200).json({ ok: true, id });
}

/** ランキング圏外のエントリが無限に溜まらないよう定期的に間引く */
async function pruneOldEntries(redis: Redis): Promise<void> {
  const total = await redis.zcard(LEADERBOARD_KEY);
  if (total <= MAX_RETAINED_ENTRIES) return;
  const excess = total - MAX_RETAINED_ENTRIES;
  const toRemove = await redis.zrange(LEADERBOARD_KEY, 0, excess - 1);
  if (toRemove.length === 0) return;
  await redis.zrem(LEADERBOARD_KEY, ...toRemove);
  await Promise.all(toRemove.map((id) => redis.del(`score:${id}`)));
}

function sanitizeNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, NICKNAME_MAX_LENGTH);
  if (trimmed.length === 0) return null;
  return trimmed;
}

function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}
