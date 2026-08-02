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
 *
 * ランキングは難易度ごとに完全に分離する(D-041)。匿名プレイヤーIDごとに
 * 各難易度の最高スコア1件だけを保持する。以前はスコア補正係数
 * (SCORE_MULTIPLIER)で1本のランキングに正規化していたが、ユーザーから
 * 「ランキングは難易度別に分けたほうがいい」との指摘を受け、正規化ではなく
 * 難易度ごとに別々のsorted setへ分離する方式に変更した。
 */

const LEADERBOARD_KEY_PREFIX = "leaderboard:survival:alltime";
const MAX_RETAINED_ENTRIES = 500;
const TOP_LIMIT_DEFAULT = 100;
const TOP_LIMIT_MAX = 100;
const MAX_PLAUSIBLE_SCORE = 1_000_000;
const MAX_PLAUSIBLE_CHAIN = 60;
const MAX_PLAUSIBLE_SURVIVED_MS = 6 * 60 * 60 * 1000; // 6時間
const RATE_LIMIT_WINDOW_SEC = 5;
const NICKNAME_MAX_LENGTH = 12;
const PLAYER_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const PLAYER_MEMBER_PREFIX = "player:";

type SurvivalDifficulty = "easy" | "normal" | "hard" | "god";

function leaderboardKey(difficulty: SurvivalDifficulty): string {
  return `${LEADERBOARD_KEY_PREFIX}:${difficulty}`;
}

/**
 * 新しいランキング会員は匿名プレイヤーIDをそのままsorted setのmemberに使わない。
 * memberの接頭辞で旧ランダムIDの記録と区別しつつ、GETレスポンスからもIDを隠す。
 */
function playerMember(playerId: string): string {
  return `${PLAYER_MEMBER_PREFIX}${playerId}`;
}

function isPlayerMember(member: string): boolean {
  return member.startsWith(PLAYER_MEMBER_PREFIX);
}

function playerEntryKey(difficulty: SurvivalDifficulty, playerId: string): string {
  return `score:survival:${difficulty}:player:${playerId}`;
}

/**
 * 既存のランダムID記録は読み続ける。プレイヤーID導入前の履歴には本人を安全に
 * 特定する情報が無いため、ニックネームでの推測統合は行わない。
 */
function entryKeyForMember(difficulty: SurvivalDifficulty, member: string): string {
  if (isPlayerMember(member)) {
    return playerEntryKey(difficulty, member.slice(PLAYER_MEMBER_PREFIX.length));
  }
  return `score:${member}`;
}

interface ScoreEntry {
  id: string;
  nickname: string;
  score: number;
  difficulty: SurvivalDifficulty;
  maxChain: number;
  survivedMs: number;
  level: number;
  submittedAt: string;
}

function isSurvivalDifficulty(value: unknown): value is SurvivalDifficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "god";
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
  const difficulty: SurvivalDifficulty = isSurvivalDifficulty(req.query.difficulty)
    ? req.query.difficulty
    : "normal";
  const requested = Number(req.query.limit);
  const limit = Math.min(
    TOP_LIMIT_MAX,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : TOP_LIMIT_DEFAULT,
  );
  const viewerId = sanitizePlayerId(req.query.playerId);

  const key = leaderboardKey(difficulty);
  const ids = await redis.zrevrange(key, 0, limit - 1);

  const pipeline = redis.pipeline();
  for (const member of ids) pipeline.hgetall(entryKeyForMember(difficulty, member));
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
        difficulty: isSurvivalDifficulty(h.difficulty) ? h.difficulty : "normal",
        maxChain: Number(h.maxChain) || 0,
        survivedMs: Number(h.survivedMs) || 0,
        level: Number(h.level) || 1,
        submittedAt: h.submittedAt ?? "",
      });
    }
  }

  let viewer: {
    rank: number;
    total: number;
    score: number;
    scoreToNext: number | null;
    percentile: number;
  } | null = null;
  if (viewerId) {
    const [rankIndex, rawScore, total] = await Promise.all([
      redis.zrevrank(key, playerMember(viewerId)),
      redis.zscore(key, playerMember(viewerId)),
      redis.zcard(key),
    ]);
    const score = Number(rawScore) || 0;
    if (rankIndex !== null && score > 0) {
      const next =
        rankIndex > 0
          ? await redis.zrevrange(key, rankIndex - 1, rankIndex - 1, "WITHSCORES")
          : [];
      const nextScore = next.length >= 2 ? Number(next[1]) : null;
      viewer = {
        rank: rankIndex + 1,
        total,
        score,
        scoreToNext: nextScore === null ? null : Math.max(1, nextScore - score + 1),
        percentile: total > 0 ? Math.max(0.1, Math.round(((rankIndex + 1) / total) * 1000) / 10) : 100,
      };
    }
  }

  res.setHeader(
    "Cache-Control",
    viewerId ? "private, no-store" : "s-maxage=30, stale-while-revalidate=60",
  );
  res.status(200).json({ entries, viewer });
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
  const playerId = sanitizePlayerId(body.playerId);
  const nickname = sanitizeNickname(body.nickname);
  const score = Number(body.score);
  const maxChain = Number(body.maxChain);
  const survivedMs = Number(body.survivedMs);
  const level = Number(body.level);
  const difficulty: SurvivalDifficulty = isSurvivalDifficulty(body.difficulty)
    ? body.difficulty
    : "normal";

  if (!playerId || !nickname) {
    res.status(400).json({ error: "Invalid ranking identity" });
    return;
  }
  if (!Number.isFinite(score) || score <= 0 || score > MAX_PLAUSIBLE_SCORE) {
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

  // idは画面描画用の公開ID。匿名プレイヤーIDをレスポンスに含めない。
  const id = randomUUID();
  const entry: ScoreEntry = {
    id,
    nickname,
    score: Math.floor(score),
    difficulty,
    maxChain: Math.floor(maxChain),
    survivedMs: Math.floor(survivedMs),
    level: Number.isFinite(level) && level > 0 ? Math.floor(level) : 1,
    submittedAt: new Date().toISOString(),
  };

  const key = leaderboardKey(difficulty);
  const member = playerMember(playerId);
  const updated = await upsertBestScore(redis, key, playerEntryKey(difficulty, playerId), member, entry);
  await pruneOldEntries(redis, key, difficulty);

  res.status(200).json({ ok: true, updated });
}

/**
 * scoreと詳細レコードを同時に扱い、遅い通信が高得点の詳細を低得点で上書きしないよう
 * Luaで原子的に更新する。同点では先に達成した記録を維持し、ニックネームだけ最新化する。
 */
async function upsertBestScore(
  redis: Redis,
  leaderboard: string,
  entryKey: string,
  member: string,
  entry: ScoreEntry,
): Promise<boolean> {
  const result = await redis.eval(
    `
      local previous = redis.call("ZSCORE", KEYS[1], ARGV[1])
      if not previous or tonumber(ARGV[2]) > tonumber(previous) then
        redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
        redis.call("HSET", KEYS[2],
          "id", ARGV[3],
          "nickname", ARGV[4],
          "score", ARGV[2],
          "difficulty", ARGV[5],
          "maxChain", ARGV[6],
          "survivedMs", ARGV[7],
          "level", ARGV[8],
          "submittedAt", ARGV[9])
        return 1
      end
      redis.call("HSET", KEYS[2], "nickname", ARGV[4])
      return 0
    `,
    2,
    leaderboard,
    entryKey,
    member,
    String(entry.score),
    entry.id,
    entry.nickname,
    entry.difficulty,
    String(entry.maxChain),
    String(entry.survivedMs),
    String(entry.level),
    entry.submittedAt,
  );
  return Number(result) === 1;
}

/** ランキング圏外のエントリが無限に溜まらないよう定期的に間引く */
async function pruneOldEntries(
  redis: Redis,
  key: string,
  difficulty: SurvivalDifficulty,
): Promise<void> {
  const total = await redis.zcard(key);
  if (total <= MAX_RETAINED_ENTRIES) return;
  const excess = total - MAX_RETAINED_ENTRIES;
  const toRemove = await redis.zrange(key, 0, excess - 1);
  if (toRemove.length === 0) return;
  const pipeline = redis.pipeline();
  pipeline.zrem(key, ...toRemove);
  for (const member of toRemove) pipeline.del(entryKeyForMember(difficulty, member));
  await pipeline.exec();
}

function sanitizeNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, NICKNAME_MAX_LENGTH);
  if (trimmed.length === 0) return null;
  return trimmed;
}

function sanitizePlayerId(input: unknown): string | null {
  return typeof input === "string" && PLAYER_PATTERN.test(input) ? input : null;
}

function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}
