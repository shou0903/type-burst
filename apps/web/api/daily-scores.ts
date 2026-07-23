import type { VercelRequest, VercelResponse } from "@vercel/node";
import Redis from "ioredis";

const CHALLENGE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLAYER_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const MAX_SCORE = 500_000;
const MAX_CHAIN = 60;
const MAX_SURVIVED_MS = 121_000;
const NICKNAME_MAX_LENGTH = 12;
const RETENTION_SECONDS = 45 * 24 * 60 * 60;

interface DailyEntry {
  playerId: string;
  nickname: string;
  score: number;
  kpm: number;
  accuracy: number;
  maxChain: number;
  survivedMs: number;
  submittedAt: string;
}

let client: Redis | null = null;

function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not configured");
    client = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
  }
  return client;
}

function leaderboardKey(challengeId: string): string {
  return `leaderboard:daily:${challengeId}`;
}

function entryKey(challengeId: string, playerId: string): string {
  return `daily-score:${challengeId}:${playerId}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
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
  } catch {
    res.status(500).json({ error: "Daily leaderboard unavailable" });
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const challengeId = single(req.query.challengeId);
  const playerId = sanitizePlayerId(single(req.query.playerId));
  if (!challengeId || !CHALLENGE_PATTERN.test(challengeId)) {
    res.status(400).json({ error: "Invalid challengeId" });
    return;
  }
  const payload = await buildResponse(getRedis(), challengeId, playerId);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json(payload);
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const playerId = sanitizePlayerId(body.playerId);
  const nickname = sanitizeNickname(body.nickname);
  const score = Number(body.score);
  const kpm = Number(body.kpm);
  const accuracy = Number(body.accuracy);
  const maxChain = Number(body.maxChain);
  const survivedMs = Number(body.survivedMs);

  if (challengeId !== todayInJapan() || !playerId || !nickname) {
    res.status(400).json({ error: "Invalid daily identity" });
    return;
  }
  if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) {
    res.status(400).json({ error: "Invalid score" });
    return;
  }
  if (!Number.isFinite(kpm) || kpm < 0 || kpm > 1_500) {
    res.status(400).json({ error: "Invalid kpm" });
    return;
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
    res.status(400).json({ error: "Invalid accuracy" });
    return;
  }
  if (!Number.isFinite(maxChain) || maxChain < 0 || maxChain > MAX_CHAIN) {
    res.status(400).json({ error: "Invalid chain" });
    return;
  }
  if (!Number.isFinite(survivedMs) || survivedMs < 0 || survivedMs > MAX_SURVIVED_MS) {
    res.status(400).json({ error: "Invalid duration" });
    return;
  }

  const redis = getRedis();
  const key = leaderboardKey(challengeId);
  const previousScore = Number(await redis.zscore(key, playerId)) || 0;
  const bestScore = Math.max(previousScore, Math.floor(score));
  const entry: DailyEntry = {
    playerId,
    nickname,
    score: bestScore,
    kpm: Math.round(kpm),
    accuracy,
    maxChain: Math.floor(maxChain),
    survivedMs: Math.floor(survivedMs),
    submittedAt: new Date().toISOString(),
  };
  const pipeline = redis.pipeline();
  pipeline.hset(entryKey(challengeId, playerId), entry as unknown as Record<string, string | number>);
  pipeline.expire(entryKey(challengeId, playerId), RETENTION_SECONDS);
  pipeline.zadd(key, bestScore, playerId);
  pipeline.expire(key, RETENTION_SECONDS);
  await pipeline.exec();

  res.status(200).json(await buildResponse(redis, challengeId, playerId));
}

async function buildResponse(
  redis: Redis,
  challengeId: string,
  viewerId: string | null,
): Promise<{
  entries: Array<Pick<DailyEntry, "nickname" | "score" | "kpm" | "accuracy"> & { rank: number }>;
  total: number;
  viewer: {
    rank: number;
    total: number;
    score: number;
    scoreToNext: number | null;
    percentile: number;
  } | null;
}> {
  const key = leaderboardKey(challengeId);
  const [ids, total] = await Promise.all([redis.zrevrange(key, 0, 99), redis.zcard(key)]);
  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.hgetall(entryKey(challengeId, id)));
  const rows = await pipeline.exec();
  const entries = (rows ?? []).flatMap(([error, raw], index) => {
    if (error || !raw || Object.keys(raw).length === 0) return [];
    const item = raw as Record<string, string>;
    return [{
      rank: index + 1,
      nickname: item.nickname ?? "",
      score: Number(item.score) || 0,
      kpm: Number(item.kpm) || 0,
      accuracy: Number(item.accuracy) || 0,
    }];
  });

  let viewer = null;
  if (viewerId) {
    const rankIndex = await redis.zrevrank(key, viewerId);
    const score = Number(await redis.zscore(key, viewerId)) || 0;
    if (rankIndex !== null && score > 0) {
      const rank = rankIndex + 1;
      const next =
        rankIndex > 0 ? await redis.zrevrange(key, rankIndex - 1, rankIndex - 1, "WITHSCORES") : [];
      const nextScore = next.length >= 2 ? Number(next[1]) : null;
      viewer = {
        rank,
        total,
        score,
        scoreToNext: nextScore === null ? null : Math.max(1, nextScore - score + 1),
        percentile: total > 0 ? Math.max(0.1, Math.round((rank / total) * 1000) / 10) : 100,
      };
    }
  }
  return { entries, total, viewer };
}

function todayInJapan(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function sanitizeNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().slice(0, NICKNAME_MAX_LENGTH);
  return value || null;
}

function sanitizePlayerId(input: unknown): string | null {
  return typeof input === "string" && PLAYER_PATTERN.test(input) ? input : null;
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
