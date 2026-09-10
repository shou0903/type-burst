import { createRequire } from "node:module";
import type Redis from "ioredis";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureRankingIndexes, leaderboardKey, playerLeaderboardKey, playerEntryKey, readRankingSnapshot, upsertBestScore } from "./scores";

// Optional isolated Lua integration suite. Point this at an installed ioredis-mock
// module, never a production Redis URL. No network/database credentials are used.
const modulePath = process.env.RANKING_REDIS_MOCK_MODULE;
const Mock = modulePath ? createRequire(import.meta.url)(modulePath) as new () => Redis : null;
// ioredis-mock executes Lua but does not provide Redis's cjson library.
// Supply serialization only; sorted-set/hash/rank/migration logic stays untouched.
const cjsonShim = `
  cjson = { null = {} }
  function cjson.encode(value)
    if value == cjson.null then return "null" end
    if type(value) == "number" or type(value) == "boolean" then return tostring(value) end
    if type(value) == "string" then return string.format('%q', value) end
    local parts = {}
    if #value > 0 then
      for _, item in ipairs(value) do parts[#parts + 1] = cjson.encode(item) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for key, item in pairs(value) do
      parts[#parts + 1] = cjson.encode(key) .. ':' .. cjson.encode(item)
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
`;
describe.skipIf(!Mock)("one best per player: executable Redis Lua", () => {
  let redis: Redis;
  const ruleset = "survival-v1" as const;
  beforeEach(async () => {
    redis = new Mock!();
    await redis.flushall();
    const evaluate = redis.eval.bind(redis);
    redis.eval = ((script: string, ...args: unknown[]) =>
      (evaluate as (...args: unknown[]) => unknown)(cjsonShim + script, ...args)) as Redis["eval"];
  });
  const write = (player: string, score: number, difficulty: "easy" | "normal" | "hard" | "god" = "normal", nickname = "同じ名前") =>
    upsertBestScore(redis, playerLeaderboardKey(ruleset, difficulty), playerEntryKey(ruleset, difficulty, player), `player:${player}`, {
      id: `public-${score}`, nickname, score, difficulty, maxChain: 4, survivedMs: 60000, level: 5, submittedAt: "2026-09-10T00:00:00Z",
    }, leaderboardKey(ruleset, difficulty));

  it("preserves old records and splits only by actual identity, idempotently", async () => {
    const source = leaderboardKey(ruleset, "normal");
    await redis.zadd(source, 1000, "player:a", 2000, "old-a", 3000, "old-b");
    await ensureRankingIndexes(redis, ruleset, "normal");
    expect(await redis.zrange(playerLeaderboardKey(ruleset, "normal"), 0, -1)).toEqual(["player:a"]);
    expect(await redis.zrange(`${source}:legacy`, 0, -1)).toEqual(["old-a", "old-b"]);
    expect(await redis.zcard(source)).toBe(3);
    await write("a", 4000);
    await ensureRankingIndexes(redis, ruleset, "normal");
    expect(await redis.zscore(playerLeaderboardKey(ruleset, "normal"), "player:a")).toBe("4000");
  });

  it("never lowers best score or duplicates a player on ties, renames or concurrent submissions", async () => {
    await Promise.all([write("a", 300), write("a", 900), write("a", 500)]);
    expect(await write("a", 900, "normal", "新しい名前")).toBe(false);
    expect(await write("a", 100)).toBe(false);
    const key = playerLeaderboardKey(ruleset, "normal");
    expect(await redis.zcard(key)).toBe(1);
    expect(await redis.zscore(key, "player:a")).toBe("900");
    expect(await redis.zscore(leaderboardKey(ruleset, "normal"), "player:a")).toBe("900");
    expect(await redis.hget(playerEntryKey(ruleset, "normal", "a"), "score")).toBe("900");
  });

  it("reconciles late old-API writes once without lowering a newer player best", async () => {
    const source = leaderboardKey(ruleset, "normal");
    await ensureRankingIndexes(redis, ruleset, "normal");
    await write("a", 300);
    await redis.zadd(source, 900, "player:a", 700, "player:late");
    await redis.hset(playerEntryKey(ruleset, "normal", "a"), "score", "900");
    expect(await write("a", 500)).toBe(false);
    expect(await redis.hget(playerEntryKey(ruleset, "normal", "a"), "score")).toBe("900");
    await redis.set(`${source}:split-v1`, "1"); // first pass was more than two minutes ago
    await ensureRankingIndexes(redis, ruleset, "normal");
    expect(await redis.zscore(playerLeaderboardKey(ruleset, "normal"), "player:late")).toBe("700");
    expect(await redis.get(`${source}:split-v1`)).toBe("done");
  });

  it("keeps all four difficulties independent and does not merge two people with the same nickname", async () => {
    for (const difficulty of ["easy", "normal", "hard", "god"] as const) {
      await write("a", 100, difficulty);
      await write("a", 80, difficulty);
      await write("b", 200, difficulty);
      expect(await redis.zcard(playerLeaderboardKey(ruleset, difficulty))).toBe(2);
    }
  });

  it("reads coherent public ranks, gap and player count without exposing private IDs", async () => {
    await write("private-a", 900);
    await write("private-b", 500);
    const response = await readRankingSnapshot(redis, playerLeaderboardKey(ruleset, "normal"), ruleset, "normal", 100, "private-b");
    expect(response.entries.map(e => [e.rank, e.score])).toEqual([[1, 900], [2, 500]]);
    expect(response.viewer).toMatchObject({ rank: 2, total: 2, score: 500, scoreToNext: 401 });
    expect(response.entries.every(e => !("playerId" in e))).toBe(true);
    expect(JSON.stringify(response)).not.toContain("private-a");
    expect(JSON.stringify(response.viewer)).not.toContain("private-b");
  });

  it("returns a true empty array before the first registration", async () => {
    await ensureRankingIndexes(redis, ruleset, "easy");
    const response = await readRankingSnapshot(redis, playerLeaderboardKey(ruleset, "easy"), ruleset, "easy", 100, null);
    expect(response).toEqual({ entries: [], viewer: null });
  });

  it("retains a player's old best outside the top 500", async () => {
    for (let i = 0; i < 502; i++) await write(`person-${i}`, i + 1);
    await write("person-0", 0);
    expect(await redis.zcard(playerLeaderboardKey(ruleset, "normal"))).toBe(502);
    expect(await redis.zscore(playerLeaderboardKey(ruleset, "normal"), "player:person-0")).toBe("1");
  });
});
