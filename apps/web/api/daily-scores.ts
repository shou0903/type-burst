import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

const CHALLENGE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLAYER_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const MAX_SCORE = 500_000;
const MAX_CHAIN = 60;
const MAX_SURVIVED_MS = 121_000;
const NICKNAME_MAX_LENGTH = 12;
const RETENTION_SECONDS = 45 * 24 * 60 * 60;
const DAILY_RULESET_VERSION = 2;
const DAILY_RANKED_ATTEMPTS = 3;
const SUBMISSION_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const MIDNIGHT_GRACE_MS = 5 * 60 * 1000;
const DAILY_ATTEMPT_MAX_AGE_MS = 125_000;
const ATTEMPT_TOKEN_PATTERN = /^[A-Za-z0-9-]{16,100}$/;

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
  return `leaderboard:daily:v${DAILY_RULESET_VERSION}:${challengeId}`;
}

function entryKey(challengeId: string, playerId: string): string {
  return `daily-score:v${DAILY_RULESET_VERSION}:${challengeId}:${playerId}`;
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
  if (body.action === "start") {
    await handleStart(body, res);
    return;
  }
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const playerId = sanitizePlayerId(body.playerId);
  const nickname = sanitizeNickname(body.nickname);
  const score = Number(body.score);
  const kpm = Number(body.kpm);
  const accuracy = Number(body.accuracy);
  const maxChain = Number(body.maxChain);
  const survivedMs = Number(body.survivedMs);
  // ranked=false は練習結果。ランキング結果は開始時に発行した
  // サーバー側チケットを必須にして、クライアント側の回数操作を防ぐ。
  const ranked = body.ranked !== false;
  const submissionId =
    typeof body.submissionId === "string" && SUBMISSION_PATTERN.test(body.submissionId)
      ? body.submissionId
      : null;
  const attemptToken =
    typeof body.attemptToken === "string" && ATTEMPT_TOKEN_PATTERN.test(body.attemptToken)
      ? body.attemptToken
      : null;

  if (!CHALLENGE_PATTERN.test(challengeId) || !playerId || !nickname) {
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
  const entry: DailyEntry = {
    playerId,
    nickname,
    score: Math.floor(score),
    kpm: Math.round(kpm),
    accuracy,
    maxChain: Math.floor(maxChain),
    survivedMs: Math.floor(survivedMs),
    submittedAt: new Date().toISOString(),
  };
  const submissionKey = submissionId
    ? dailySubmissionKey(challengeId, playerId, submissionId)
    : "";
  if (!ranked) {
    // 練習結果はランキングへ書き込まない。レスポンスだけ返すので、
    // UIが練習からランキング表示へ戻る導線は維持できる。
    if (challengeId !== todayInJapan()) {
      res.status(400).json({ error: "Invalid daily challenge" });
      return;
    }
    res.status(200).json(await buildResponse(redis, challengeId, playerId));
    return;
  }
  // ランキング枠は開始時に発行したサーバー側チケットでのみ消費する。
  // クライアントがstartedAtやsubmissionIdを自由に作って回数制限を回避する余地を残さない。
  if (!attemptToken) {
    res.status(428).json({ error: "Daily attempt token required" });
    return;
  }
  const tokenKey = dailyAttemptTokenKey(challengeId, playerId, attemptToken);
  const tokenStartedAt = Number(await redis.get(tokenKey));
  if (!isCurrentChallenge(challengeId, tokenStartedAt)) {
    res.status(400).json({ error: "Invalid daily attempt" });
    return;
  }
  const result = await upsertDailyBest(
    redis,
    key,
    entryKey(challengeId, playerId),
    submissionKey,
    tokenKey,
    entry,
    ranked,
  );
  if (result === -1) {
    res.status(429).json({ error: "Daily ranked attempts exhausted" });
    return;
  }
  if (result === -3) {
    res.status(409).json({ error: "Daily attempt already used" });
    return;
  }

  res.status(200).json(await buildResponse(redis, challengeId, playerId));
}

/** ランキング枠をゲーム開始時に1つ予約し、推測困難な一回限りチケットを返す。 */
async function handleStart(body: Record<string, unknown>, res: VercelResponse): Promise<void> {
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const playerId = sanitizePlayerId(body.playerId);
  if (!CHALLENGE_PATTERN.test(challengeId) || challengeId !== todayInJapan() || !playerId) {
    res.status(400).json({ error: "Invalid daily identity" });
    return;
  }
  const token = randomUUID();
  const redis = getRedis();
  const result = await reserveDailyAttempt(
    redis,
    dailyAttemptKey(challengeId, playerId),
    dailyAttemptTokenKey(challengeId, playerId, token),
    token,
    Date.now(),
  );
  if (result === -1) {
    res.status(429).json({ error: "Daily ranked attempts exhausted" });
    return;
  }
  if (result !== 1) {
    res.status(503).json({ error: "Daily attempt unavailable" });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({ ranked: true, attemptToken: token });
}

/** 2分チャレンジを日付境界で開始した場合だけ、終了後5分まで受理する。 */
export function isCurrentChallenge(
  challengeId: string,
  startedAt: number,
  now = Date.now(),
): boolean {
  const today = japanDateAt(now);
  if (!Number.isFinite(startedAt)) return false;
  const elapsed = now - startedAt;
  if (elapsed < 0) return false;
  if (japanDateAt(startedAt) !== challengeId) return false;
  if (challengeId === today) return elapsed <= DAILY_ATTEMPT_MAX_AGE_MS;
  if (elapsed > MIDNIGHT_GRACE_MS) return false;
  return previousDate(today) === challengeId;
}

function japanDateAt(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function previousDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - 1))
    .toISOString()
    .slice(0, 10);
}

function dailyAttemptKey(challengeId: string, playerId: string): string {
  return `daily-attempts:v${DAILY_RULESET_VERSION}:${challengeId}:${playerId}`;
}

function dailySubmissionKey(challengeId: string, playerId: string, submissionId: string): string {
  return `daily-submission:v${DAILY_RULESET_VERSION}:${challengeId}:${playerId}:${submissionId}`;
}

function dailyAttemptTokenKey(challengeId: string, playerId: string, token: string): string {
  return `daily-attempt-token:v${DAILY_RULESET_VERSION}:${challengeId}:${playerId}:${token}`;
}

async function reserveDailyAttempt(
  redis: Redis,
  attemptsKey: string,
  tokenKey: string,
  token: string,
  startedAt: number,
): Promise<number> {
  const result = await redis.eval(
    `
      local attempts = tonumber(redis.call("GET", KEYS[1]) or "0")
      if attempts >= tonumber(ARGV[1]) then return -1 end
      local stored = redis.call("SET", KEYS[2], ARGV[4], "EX", tonumber(ARGV[3]), "NX")
      if not stored then return -2 end
      redis.call("INCR", KEYS[1])
      redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
      return 1
    `,
    2,
    attemptsKey,
    tokenKey,
    String(DAILY_RANKED_ATTEMPTS),
    token,
    String(RETENTION_SECONDS),
    String(startedAt),
  );
  return Number(result);
}

/**
 * デイリーの挑戦枠、最高スコア、最高スコアに対応する詳細を1回のLua実行で更新する。
 * 低い再送で詳細だけが混ざったり、同時送信で最高点が巻き戻ったりしないようにする。
 * 戻り値: 1=最高記録更新、0=自己ベスト維持、-2=同一送信IDの再送、-3=使用済みチケット。
 */
async function upsertDailyBest(
  redis: Redis,
  leaderboard: string,
  detailsKey: string,
  submissionKey: string,
  attemptTokenKey: string,
  entry: DailyEntry,
  ranked: boolean,
): Promise<number> {
  const result = await redis.eval(
    `
      -- submissionId is an idempotency key for one finished run.  A retry with
      -- the same key must be a complete no-op: accepting a different payload
      -- here would let a client update its score without consuming another
      -- ranked attempt.
      if ARGV[2] ~= "" and redis.call("EXISTS", KEYS[2]) == 1 then
        return -2
      end

      if ARGV[1] == "1" then
        if redis.call("EXISTS", KEYS[4]) ~= 1 then return -3 end
        -- 予約済み枠は結果の最初の受理時に一度だけ確定する。
        redis.call("DEL", KEYS[4])
      end
      if ARGV[2] ~= "" then
        redis.call("SET", KEYS[2], "1", "EX", tonumber(ARGV[3]))
      end

      local previous = redis.call("ZSCORE", KEYS[1], ARGV[4])
      if not previous or tonumber(ARGV[5]) > tonumber(previous) then
        redis.call("ZADD", KEYS[1], ARGV[5], ARGV[4])
        redis.call("HSET", KEYS[3],
          "playerId", ARGV[4],
          "nickname", ARGV[6],
          "score", ARGV[5],
          "kpm", ARGV[7],
          "accuracy", ARGV[8],
          "maxChain", ARGV[9],
          "survivedMs", ARGV[10],
          "submittedAt", ARGV[11])
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
        redis.call("EXPIRE", KEYS[3], tonumber(ARGV[3]))
        return 1
      end
      -- 名前の変更は許可するが、最高記録の詳細は混ぜない。
      redis.call("HSET", KEYS[3], "nickname", ARGV[6])
      redis.call("EXPIRE", KEYS[3], tonumber(ARGV[3]))
      redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
      return 0
    `,
    4,
    leaderboard,
    submissionKey,
    detailsKey,
    attemptTokenKey,
    ranked ? "1" : "0",
    submissionKey ? "1" : "",
    String(RETENTION_SECONDS),
    entry.playerId,
    String(entry.score),
    entry.nickname,
    String(entry.kpm),
    String(entry.accuracy),
    String(entry.maxChain),
    String(entry.survivedMs),
    entry.submittedAt,
  );
  return Number(result);
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
  // 公開表・総数・本人順位を一つのLua実行で読む。投稿が同時に走っても、
  // 「順位だけ古い／スコアだけ新しい」組み合わせを返さない。
  const raw = await redis.eval(
    `
      local function hash_object(key_name)
        local values = redis.call("HGETALL", key_name)
        local object = {}
        for i = 1, #values, 2 do
          object[values[i]] = values[i + 1]
        end
        return object
      end

      local ids = redis.call("ZREVRANGE", KEYS[1], 0, 99)
      local entries = {}
      for index, member in ipairs(ids) do
        local h = hash_object("daily-score:v${DAILY_RULESET_VERSION}:" .. ARGV[1] .. ":" .. member)
        if next(h) ~= nil then
          entries[#entries + 1] = {
            rank = index,
            nickname = h["nickname"] or "",
            score = tonumber(h["score"]) or 0,
            kpm = tonumber(h["kpm"]) or 0,
            accuracy = tonumber(h["accuracy"]) or 0
          }
        end
      end

      local total = redis.call("ZCARD", KEYS[1])
      local viewer = cjson.null
      if ARGV[2] ~= "" then
        local rank_index = redis.call("ZREVRANK", KEYS[1], ARGV[2])
        local raw_score = redis.call("ZSCORE", KEYS[1], ARGV[2])
        local score = tonumber(raw_score) or 0
        if rank_index and score > 0 then
          local next_score = nil
          if rank_index > 0 then
            local next_row = redis.call("ZREVRANGE", KEYS[1], rank_index - 1, rank_index - 1, "WITHSCORES")
            if #next_row >= 2 then next_score = tonumber(next_row[2]) end
          end
          local percentile = 100
          if total > 0 then
            percentile = math.max(0.1, math.floor(((rank_index + 1) / total) * 1000 + 0.5) / 10)
          end
          local gap = cjson.null
          if next_score then gap = math.max(1, next_score - score + 1) end
          viewer = {
            rank = rank_index + 1,
            total = total,
            score = score,
            scoreToNext = gap,
            percentile = percentile
          }
        end
      end
      return cjson.encode({ entries = entries, total = total, viewer = viewer })
    `,
    1,
    key,
    challengeId,
    viewerId ?? "",
  );
  if (typeof raw !== "string") throw new Error("Invalid daily ranking snapshot");
  return JSON.parse(raw) as {
    entries: Array<Pick<DailyEntry, "nickname" | "score" | "kpm" | "accuracy"> & { rank: number }>;
    total: number;
    viewer: {
      rank: number;
      total: number;
      score: number;
      scoreToNext: number | null;
      percentile: number;
    } | null;
  };
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
