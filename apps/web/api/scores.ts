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
const DEFAULT_RULESET: SurvivalRuleset = "survival-v1";
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
type SurvivalRuleset = "survival-v1" | "survival-v2";

/**
 * v1 のキーは既存データをそのまま読めるよう絶対に変更しない。
 * v2 はルール世代をキーに含め、ランキングと詳細ハッシュを完全分離する。
 */
export function leaderboardKey(ruleset: SurvivalRuleset, difficulty: SurvivalDifficulty): string {
  return ruleset === "survival-v1"
    ? `${LEADERBOARD_KEY_PREFIX}:${difficulty}`
    : `${LEADERBOARD_KEY_PREFIX}:${ruleset}:${difficulty}`;
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

export function playerEntryKey(
  ruleset: SurvivalRuleset,
  difficulty: SurvivalDifficulty,
  playerId: string,
): string {
  return ruleset === "survival-v1"
    ? `score:survival:${difficulty}:player:${playerId}`
    : `score:survival:${ruleset}:${difficulty}:player:${playerId}`;
}

/**
 * 既存のランダムID記録は読み続ける。プレイヤーID導入前の履歴には本人を安全に
 * 特定する情報が無いため、ニックネームでの推測統合は行わない。
 */
export function entryKeyForMember(
  ruleset: SurvivalRuleset,
  difficulty: SurvivalDifficulty,
  member: string,
): string {
  if (isPlayerMember(member)) {
    return playerEntryKey(ruleset, difficulty, member.slice(PLAYER_MEMBER_PREFIX.length));
  }
  return ruleset === "survival-v1" ? `score:${member}` : `score:survival:${ruleset}:${member}`;
}

interface ScoreEntry {
  id: string;
  rank?: number;
  nickname: string;
  score: number;
  difficulty: SurvivalDifficulty;
  maxChain: number;
  survivedMs: number;
  level: number;
  submittedAt: string;
}

interface RankingViewer {
  rank: number;
  total: number;
  score: number;
  scoreToNext: number | null;
  percentile: number;
}

interface RankingSnapshot {
  entries: ScoreEntry[];
  viewer: RankingViewer | null;
}

function isSurvivalDifficulty(value: unknown): value is SurvivalDifficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "god";
}

export function isSurvivalRuleset(value: unknown): value is SurvivalRuleset {
  return value === "survival-v1" || value === "survival-v2";
}

/** 欠落した ruleset は旧クライアントとして v1 に割り当てる。不正値は拒否する。 */
export function parseSurvivalRuleset(value: unknown): SurvivalRuleset | null {
  if (value === undefined) return DEFAULT_RULESET;
  return isSurvivalRuleset(value) ? value : null;
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
  const ruleset = parseSurvivalRuleset(req.query.ruleset);
  if (!ruleset) {
    res.status(400).json({ error: "Invalid ruleset" });
    return;
  }
  const difficulty: SurvivalDifficulty = isSurvivalDifficulty(req.query.difficulty)
    ? req.query.difficulty
    : "normal";
  const redis = getRedis();
  const requested = Number(req.query.limit);
  const limit = Math.min(
    TOP_LIMIT_MAX,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : TOP_LIMIT_DEFAULT,
  );
  const viewerId = sanitizePlayerId(req.query.playerId);

  const key = leaderboardKey(ruleset, difficulty);
  // 順位・スコア・本人情報を同じRedis実行で読む。個別コマンドを順番に
  // 発行すると、読取中の投稿で「順位とスコアが逆転した表」が返り得る。
  const { entries, viewer } = await readRankingSnapshot(
    redis,
    key,
    ruleset,
    difficulty,
    limit,
    viewerId,
  );

  res.setHeader(
    "Cache-Control",
    // 公開ランキングは投稿直後の全員表示を優先する。画面側もno-storeで取得し、
    // CDNの古い上位表が残らないようにする。
    viewerId ? "private, no-store" : "public, no-store, must-revalidate",
  );
  // クライアントはこの印を確認してからv2スコアを送る。旧APIへロールバックした
  // 直後にキャッシュ済みの新クライアントが残っても、v2記録をv1へ誤送信しない。
  res.status(200).json({ entries, viewer, ruleset });
}

/** sorted setと詳細ハッシュを1回のLua実行でスナップショット化する。 */
async function readRankingSnapshot(
  redis: Redis,
  key: string,
  ruleset: SurvivalRuleset,
  difficulty: SurvivalDifficulty,
  limit: number,
  viewerId: string | null,
): Promise<RankingSnapshot> {
  const raw = await redis.eval(
    `
      local function detail_key(member)
        if string.sub(member, 1, 7) == "player:" then
          local player_id = string.sub(member, 8)
          if ARGV[2] == "survival-v1" then
            return "score:survival:" .. ARGV[3] .. ":player:" .. player_id
          end
          return "score:survival:" .. ARGV[2] .. ":" .. ARGV[3] .. ":player:" .. player_id
        end
        if ARGV[2] == "survival-v1" then
          return "score:" .. member
        end
        return "score:survival:" .. ARGV[2] .. ":" .. member
      end

      local function hash_object(key_name)
        local values = redis.call("HGETALL", key_name)
        local object = {}
        for i = 1, #values, 2 do
          object[values[i]] = values[i + 1]
        end
        return object
      end

      local ids = redis.call("ZREVRANGE", KEYS[1], 0, tonumber(ARGV[1]) - 1)
      local entries = {}
      for index, member in ipairs(ids) do
        local h = hash_object(detail_key(member))
        if next(h) ~= nil then
          local entry_difficulty = h["difficulty"]
          if entry_difficulty ~= "easy" and entry_difficulty ~= "normal" and entry_difficulty ~= "hard" and entry_difficulty ~= "god" then
            entry_difficulty = "normal"
          end
          entries[#entries + 1] = {
            id = h["id"] or "",
            rank = index,
            nickname = h["nickname"] or "",
            score = tonumber(h["score"]) or 0,
            difficulty = entry_difficulty,
            maxChain = tonumber(h["maxChain"]) or 0,
            survivedMs = tonumber(h["survivedMs"]) or 0,
            level = tonumber(h["level"]) or 1,
            submittedAt = h["submittedAt"] or ""
          }
        end
      end

      local total = redis.call("ZCARD", KEYS[1])
      local viewer = cjson.null
      if ARGV[4] ~= "" then
        local viewer_member = "player:" .. ARGV[4]
        local rank_index = redis.call("ZREVRANK", KEYS[1], viewer_member)
        local raw_score = redis.call("ZSCORE", KEYS[1], viewer_member)
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
      -- Keep the public JSON shape stable: an empty Lua table would otherwise
      -- become an object instead of the promised empty array.
      local entries_json = cjson.encode(entries)
      if #entries == 0 then entries_json = "[]" end
      return '{"entries":' .. entries_json .. ',"viewer":' .. cjson.encode(viewer) .. '}'
    `,
    1,
    key,
    String(limit),
    ruleset,
    difficulty,
    viewerId ?? "",
  );
  if (typeof raw !== "string") throw new Error("Invalid ranking snapshot");
  return JSON.parse(raw) as RankingSnapshot;
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ruleset = parseSurvivalRuleset(body.ruleset);
  if (!ruleset) {
    res.status(400).json({ error: "Invalid ruleset" });
    return;
  }
  const redis = getRedis();
  const ip = getClientIp(req);
  const rateLimitKey = `ratelimit:scores:${ip}`;
  // GET→SETでは同時送信がすり抜けるため、RedisのNXを使って原子的に予約する。
  const accepted = await redis.set(rateLimitKey, "1", "EX", RATE_LIMIT_WINDOW_SEC, "NX");
  if (accepted !== "OK") {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

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

  const key = leaderboardKey(ruleset, difficulty);
  const member = playerMember(playerId);
  const updated = await upsertBestScore(
    redis,
    key,
    playerEntryKey(ruleset, difficulty, playerId),
    member,
    entry,
  );
  await pruneOldEntries(redis, key, ruleset, difficulty);

  res.status(200).json({ ok: true, updated, ruleset });
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
  ruleset: SurvivalRuleset,
  difficulty: SurvivalDifficulty,
): Promise<void> {
  // 候補の取得と削除を分けると、候補取得後に高得点へ更新されたプレイヤーを
  // 消してしまう競合が起きる。順位を再確認しながら同一Lua実行で整理する。
  await redis.eval(
    `
      local total = redis.call("ZCARD", KEYS[1])
      local maxEntries = tonumber(ARGV[1])
      if total <= maxEntries then return 0 end
      local excess = total - maxEntries
      local members = redis.call("ZRANGE", KEYS[1], 0, excess - 1)
      local removed = 0
      for _, member in ipairs(members) do
        local rank = redis.call("ZRANK", KEYS[1], member)
        if rank and rank < excess then
          redis.call("ZREM", KEYS[1], member)
          local detail
          if string.sub(member, 1, 7) == "player:" then
            local playerId = string.sub(member, 8)
            if ARGV[2] == "survival-v1" then
              detail = "score:survival:" .. ARGV[3] .. ":player:" .. playerId
            else
              detail = "score:survival:" .. ARGV[2] .. ":" .. ARGV[3] .. ":player:" .. playerId
            end
          elseif ARGV[2] == "survival-v1" then
            detail = "score:" .. member
          else
            detail = "score:survival:" .. ARGV[2] .. ":" .. member
          end
          redis.call("DEL", detail)
          removed = removed + 1
        end
      end
      return removed
    `,
    1,
    key,
    String(MAX_RETAINED_ENTRIES),
    ruleset,
    difficulty,
  );
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
