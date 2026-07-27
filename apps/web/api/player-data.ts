import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Redis from "ioredis";

const PLAYER_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;
const MAX_SNAPSHOT_BYTES = 120_000;
const RETENTION_SECONDS = 365 * 24 * 60 * 60;
const RESTORE_LIMIT = 10;
const RESTORE_WINDOW_SECONDS = 60 * 60;
const SNAPSHOT_LIMIT = 12;
const SNAPSHOT_WINDOW_SECONDS = 60;
const ISSUE_LIMIT = 5;
const ISSUE_WINDOW_SECONDS = 10 * 60;
const TRANSFER_CODE_KEY_PREFIX = "player-transfer:v1:";

const REPLACE_TRANSFER_CODE_SCRIPT = `
  local previous = redis.call("GET", KEYS[1])
  local reserved = redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2], "NX")
  if not reserved then return 0 end
  if previous then redis.call("DEL", ARGV[3] .. previous) end
  redis.call("SET", KEYS[1], ARGV[4], "EX", ARGV[2])
  return 1
`;

const DELETE_PLAYER_DATA_SCRIPT = `
  local existing = redis.call("GET", KEYS[2])
  redis.call("DEL", KEYS[1])
  redis.call("DEL", KEYS[2])
  if existing then redis.call("DEL", ARGV[1] .. existing) end
  return 1
`;

let client: Redis | null = null;

function redis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not configured");
    client = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
  }
  return client;
}

function snapshotKey(playerId: string): string {
  return `player-snapshot:v1:${playerId}`;
}

function playerCodeKey(playerId: string): string {
  return `player-transfer-code:v1:${playerId}`;
}

function codeKey(codeHash: string): string {
  return `${TRANSFER_CODE_KEY_PREFIX}${codeHash}`;
}

function codeHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const playerId = sanitizePlayerId(body.playerId);

    if (action === "snapshot") {
      await saveSnapshot(res, req, playerId, body.snapshot);
      return;
    }
    if (action === "issue") {
      await issueCode(res, req, playerId, body.snapshot);
      return;
    }
    if (action === "lookup" || action === "restore") {
      await restore(res, req, action, playerId, body.code);
      return;
    }
    if (action === "delete") {
      await deleteSnapshot(res, playerId);
      return;
    }
    res.status(400).json({ error: "Invalid request" });
  } catch {
    // Redis の設定・通信失敗はクライアント側で静かに無視される。
    res.status(500).json({ error: "Player data unavailable" });
  }
}

async function saveSnapshot(
  res: VercelResponse,
  req: VercelRequest,
  playerId: string | null,
  rawSnapshot: unknown,
): Promise<void> {
  const snapshot = serializeSnapshot(rawSnapshot);
  if (!playerId || snapshot === null) {
    res.status(400).json({ error: "Invalid snapshot" });
    return;
  }
  const store = redis();
  if (!(await allowAttempt(store, `player-snapshot:${getClientIp(req)}`, SNAPSHOT_LIMIT, SNAPSHOT_WINDOW_SECONDS))) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  await storeSnapshot(store, playerId, snapshot);
  // playerId はレスポンスに含めない。
  res.status(200).json({ ok: true });
}

async function issueCode(
  res: VercelResponse,
  req: VercelRequest,
  playerId: string | null,
  rawSnapshot: unknown,
): Promise<void> {
  const snapshot = serializeSnapshot(rawSnapshot);
  if (!playerId || snapshot === null) {
    res.status(400).json({ error: "Invalid snapshot" });
    return;
  }

  const store = redis();
  if (!(await allowAttempt(store, `player-transfer-issue:${getClientIp(req)}`, ISSUE_LIMIT, ISSUE_WINDOW_SECONDS))) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  await storeSnapshot(store, playerId, snapshot);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode();
    const hash = codeHash(code);
    const created = await replaceTransferCode(store, playerId, hash);
    if (!created) continue;
    // コードはユーザー本人に一度だけ返す。playerId は決して返さない。
    res.status(200).json({ code: formatCode(code) });
    return;
  }
  res.status(503).json({ error: "Transfer code unavailable" });
}

async function restore(
  res: VercelResponse,
  req: VercelRequest,
  action: "lookup" | "restore",
  destinationPlayerId: string | null,
  rawCode: unknown,
): Promise<void> {
  const store = redis();
  if (!(await allowRestoreAttempt(store, getClientIp(req)))) {
    res.status(429).json({ error: "Too many attempts" });
    return;
  }

  const code = normalizeCode(rawCode);
  const sourcePlayerId = code ? await store.get(codeKey(codeHash(code))) : null;
  const snapshot = sourcePlayerId ? await store.get(snapshotKey(sourcePlayerId)) : null;
  // 形式不正・存在しない・期限切れを同じ応答にする。playerId も返さない。
  if (!sourcePlayerId || !snapshot) {
    res.status(404).json({ error: "Invalid transfer code" });
    return;
  }
  if (action === "restore") {
    if (!destinationPlayerId) {
      res.status(404).json({ error: "Invalid transfer code" });
      return;
    }
    // 新しい端末の匿名IDにコピーする。既存の端末データとは自動マージしない。
    await storeSnapshot(store, destinationPlayerId, snapshot);
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({ snapshot: JSON.parse(snapshot) });
}

async function deleteSnapshot(res: VercelResponse, playerId: string | null): Promise<void> {
  if (!playerId) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const store = redis();
  await store.eval(
    DELETE_PLAYER_DATA_SCRIPT,
    2,
    snapshotKey(playerId),
    playerCodeKey(playerId),
    TRANSFER_CODE_KEY_PREFIX,
  );
  res.status(200).json({ ok: true });
}

async function storeSnapshot(store: Redis, playerId: string, snapshot: string): Promise<void> {
  const currentCodeHash = await store.get(playerCodeKey(playerId));
  const pipeline = store.pipeline();
  pipeline.set(snapshotKey(playerId), snapshot, "EX", RETENTION_SECONDS);
  if (currentCodeHash) {
    pipeline.expire(playerCodeKey(playerId), RETENTION_SECONDS);
    pipeline.expire(codeKey(currentCodeHash), RETENTION_SECONDS);
  }
  await pipeline.exec();
}

function serializeSnapshot(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    !isValidNickname(snapshot.nickname) ||
    !isValidProgress(snapshot.progress) ||
    !isValidResults(snapshot.results) ||
    !isValidDailyProgress(snapshot.dailyProgress) ||
    !isValidDuelRecord(snapshot.duelRecord)
  ) return null;
  const serialized = JSON.stringify(snapshot);
  return Buffer.byteLength(serialized, "utf8") <= MAX_SNAPSHOT_BYTES ? serialized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidNickname(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length <= 12);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidProgress(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    value.totalGames,
    value.totalScore,
    value.bestScore,
    value.bestKpm,
    value.bestAccuracy,
    value.totalPhrases,
    value.totalPlaytimeMs,
    value.maxChainEver,
  ].every(isFiniteNonNegative) && Number(value.bestAccuracy) <= 1;
}

function isValidResults(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 60) return false;
  return value.every((result) => {
    if (!isRecord(result)) return false;
    return [
      result.score,
      result.maxChain,
      result.kpm,
      result.accuracy,
      result.phraseCount,
      result.survivedMs,
    ].every(isFiniteNonNegative) &&
      Number(result.accuracy) <= 1 &&
      typeof result.playedAt === "string" &&
      (result.difficulty === undefined || ["easy", "normal", "hard", "god"].includes(String(result.difficulty)));
  });
}

function isValidDailyProgress(value: unknown): boolean {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    !isFiniteNonNegative(value.currentStreak) ||
    !isFiniteNonNegative(value.bestStreak) ||
    !isFiniteNonNegative(value.freezes) ||
    Number(value.freezes) > 2 ||
    !(value.lastPlayedDate === null || isDate(value.lastPlayedDate)) ||
    !isDateList(value.playedDates) ||
    !isDateList(value.protectedDates) ||
    !isRecord(value.days)
  ) return false;
  return Object.entries(value.days).every(([date, day]) =>
    isDate(date) && isRecord(day) &&
    isFiniteNonNegative(day.attempts) &&
    isFiniteNonNegative(day.bestScore) &&
    typeof day.lastPlayedAt === "string" &&
    (day.rulesetVersion === undefined || isFiniteNonNegative(day.rulesetVersion)),
  );
}

function isDateList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 90 && value.every(isDate);
}

function isDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidDuelRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["easy", "normal", "hard"].every((difficulty) => {
    const record = value[difficulty];
    return isRecord(record) && isFiniteNonNegative(record.wins) && isFiniteNonNegative(record.losses);
  });
}

function sanitizePlayerId(value: unknown): string | null {
  return typeof value === "string" && PLAYER_PATTERN.test(value) ? value : null;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/-/g, "").trim();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

function makeCode(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]!).join("");
}

function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

async function allowRestoreAttempt(store: Redis, ip: string): Promise<boolean> {
  return allowAttempt(store, `player-restore:${ip}`, RESTORE_LIMIT, RESTORE_WINDOW_SECONDS);
}

async function allowAttempt(store: Redis, scope: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = `ratelimit:${scope}`;
  const attempts = await store.incr(key);
  if (attempts === 1) await store.expire(key, windowSeconds);
  return attempts <= limit;
}

async function replaceTransferCode(store: Redis, playerId: string, hash: string): Promise<boolean> {
  const result = await store.eval(
    REPLACE_TRANSFER_CODE_SCRIPT,
    2,
    playerCodeKey(playerId),
    codeKey(hash),
    playerId,
    RETENTION_SECONDS,
    TRANSFER_CODE_KEY_PREFIX,
    hash,
  );
  return Number(result) === 1;
}

function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}
