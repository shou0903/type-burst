import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { kv } from "@vercel/kv";

/**
 * サバイバルモードの全期間累計ランキング(Vercel KV / Redis sorted set)。
 * クライアントから送られたスコアをそのまま信用する簡易実装(v1)。
 * game-core は決定論的なので、将来的にはSeed+入力ログを送らせてサーバー側で
 * 再シミュレーションし検証する方式へ強化できる(docs/DECISIONS.md 参照)。
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

interface ScoreEntry {
  id: string;
  nickname: string;
  score: number;
  maxChain: number;
  survivedMs: number;
  level: number;
  submittedAt: string;
  // @vercel/kv の hset/hgetall が要求する Record<string, unknown> 制約を満たすため
  [key: string]: string | number;
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
  const requested = Number(req.query.limit);
  const limit = Math.min(
    TOP_LIMIT_MAX,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : TOP_LIMIT_DEFAULT,
  );

  const ids = await kv.zrange<string[]>(LEADERBOARD_KEY, 0, limit - 1, { rev: true });
  if (ids.length === 0) {
    res.status(200).json({ entries: [] });
    return;
  }

  const entries = await Promise.all(ids.map((id) => kv.hgetall<ScoreEntry>(`score:${id}`)));
  const valid = entries.filter((e): e is ScoreEntry => e !== null);
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.status(200).json({ entries: valid });
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ip = getClientIp(req);
  const rateLimitKey = `ratelimit:scores:${ip}`;
  const recent = await kv.get(rateLimitKey);
  if (recent) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  await kv.set(rateLimitKey, "1", { ex: RATE_LIMIT_WINDOW_SEC });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const nickname = sanitizeNickname(body.nickname);
  const score = Number(body.score);
  const maxChain = Number(body.maxChain);
  const survivedMs = Number(body.survivedMs);
  const level = Number(body.level);

  if (!nickname) {
    res.status(400).json({ error: "Invalid nickname" });
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

  const id = randomUUID();
  const entry: ScoreEntry = {
    id,
    nickname,
    score: Math.floor(score),
    maxChain: Math.floor(maxChain),
    survivedMs: Math.floor(survivedMs),
    level: Number.isFinite(level) && level > 0 ? Math.floor(level) : 1,
    submittedAt: new Date().toISOString(),
  };

  await kv.hset(`score:${id}`, entry);
  await kv.zadd(LEADERBOARD_KEY, { score: entry.score, member: id });
  await pruneOldEntries();

  res.status(200).json({ ok: true, id });
}

/** ランキング圏外のエントリが無限に溜まらないよう定期的に間引く */
async function pruneOldEntries(): Promise<void> {
  const total = await kv.zcard(LEADERBOARD_KEY);
  if (total <= MAX_RETAINED_ENTRIES) return;
  const excess = total - MAX_RETAINED_ENTRIES;
  const toRemove = await kv.zrange<string[]>(LEADERBOARD_KEY, 0, excess - 1);
  if (toRemove.length === 0) return;
  await kv.zrem(LEADERBOARD_KEY, ...toRemove);
  await Promise.all(toRemove.map((id) => kv.del(`score:${id}`)));
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
