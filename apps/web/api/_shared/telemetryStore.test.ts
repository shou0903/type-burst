import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import {
  RedisTelemetryStore,
  TELEMETRY_COUNTER_RETENTION_SECONDS,
  TELEMETRY_DEDUPE_RETENTION_SECONDS,
  TELEMETRY_SET_RETENTION_SECONDS,
  TelemetryRateLimitError,
  getTelemetryKeyPrefix,
  isTelemetryPlayerId,
  isTelemetryRequestId,
  telemetryHashPlayerId,
  validateTelemetryBatch,
} from "./telemetryStore";

type Command = { name: string; args: unknown[] };

class FakePipeline {
  public constructor(private readonly redis: FakeRedis, private readonly commands: Command[] = []) {}
  public hincrby(...args: unknown[]): this { this.commands.push({ name: "hincrby", args }); return this; }
  public expireat(...args: unknown[]): this { this.commands.push({ name: "expireat", args }); return this; }
  public sadd(...args: unknown[]): this { this.commands.push({ name: "sadd", args }); return this; }
  public srem(...args: unknown[]): this { this.commands.push({ name: "srem", args }); return this; }
  public del(...args: unknown[]): this { this.commands.push({ name: "del", args }); return this; }
  public scard(...args: unknown[]): this { this.commands.push({ name: "scard", args }); return this; }
  public smembers(...args: unknown[]): this { this.commands.push({ name: "smembers", args }); return this; }
  public sinterstore(...args: unknown[]): this { this.commands.push({ name: "sinterstore", args }); return this; }
  public async exec(): Promise<Array<[Error | null, unknown]>> {
    const rows: Array<[Error | null, unknown]> = [];
    for (const command of this.commands) {
      try {
        const result = await (this.redis as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[command.name]!(...command.args);
        rows.push([null, result]);
      } catch (error) {
        rows.push([error instanceof Error ? error : new Error(String(error)), null]);
      }
    }
    return rows;
  }
}

class FakeRedis {
  public readonly values = new Map<string, string>();
  public readonly sets = new Map<string, Set<string>>();
  public readonly hashes = new Map<string, Map<string, string>>();
  public readonly expires = new Map<string, number>();

  public pipeline(): FakePipeline { return new FakePipeline(this); }
  public async set(key: string, value: string, option?: string): Promise<"OK" | null> {
    if (option === "NX" && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }
  public async expireat(key: string, timestamp: number): Promise<number> { this.expires.set(key, Number(timestamp)); return 1; }
  public async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  public async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      count += Number(this.values.delete(key));
      count += Number(this.sets.delete(key));
      count += Number(this.hashes.delete(key));
      this.expires.delete(key);
    }
    return count;
  }
  public async hincrby(key: string, field: string, amount: number): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    const next = Number(hash.get(field) ?? 0) + Number(amount);
    hash.set(field, String(next));
    this.hashes.set(key, hash);
    return next;
  }
  public async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  public async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    members.forEach((member) => set.add(String(member)));
    this.sets.set(key, set);
    return set.size - before;
  }
  public async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    const before = set.size;
    members.forEach((member) => set.delete(String(member)));
    return before - set.size;
  }
  public async scard(key: string): Promise<number> { return this.sets.get(key)?.size ?? 0; }
  public async smembers(key: string): Promise<string[]> { return [...(this.sets.get(key) ?? [])]; }
  public async sscan(key: string): Promise<[string, string[]]> { return ["0", [...(this.sets.get(key) ?? [])]]; }
  public async sinterstore(destination: string, ...keys: string[]): Promise<number> {
    const source = keys.map((key) => this.sets.get(key) ?? new Set<string>());
    const result = new Set<string>(source[0] ?? []);
    for (const set of source.slice(1)) for (const member of result) if (!set.has(member)) result.delete(member);
    this.sets.set(destination, result);
    return result.size;
  }
  public async sunionstore(destination: string, ...keys: string[]): Promise<number> {
    const result = new Set<string>();
    for (const key of keys) for (const member of this.sets.get(key) ?? []) result.add(member);
    this.sets.set(destination, result);
    return result.size;
  }
  public async eval(script: string, _numKeys: number, ...args: unknown[]): Promise<number> {
    if (script.includes("INCRBY")) {
      const keys = args.slice(0, 3).map(String);
      const [cost = 0, ipLimit = 0, sessionLimit = 0, globalLimit = 0, expiry = 0] = args.slice(3).map(Number);
      const totals = keys.map((key) => Number(this.values.get(key) ?? 0) + cost);
      keys.forEach((key, index) => { this.values.set(key, String(totals[index])); this.expires.set(key, expiry); });
      return totals[0]! <= ipLimit && totals[1]! <= sessionLimit && totals[2]! <= globalLimit ? 1 : 0;
    }
    const key = String(args[0]);
    const member = String(args[1]);
    const limit = Number(args[2]);
    const set = this.sets.get(key) ?? new Set<string>();
    if (set.has(member)) return 1;
    if (set.size >= limit) return 0;
    set.add(member);
    this.sets.set(key, set);
    return 1;
  }
}

const base = {
  v: 1,
  batchId: "batch-12345678",
  sessionId: "session-12345678",
  events: [
    {
      eventId: "event-12345678",
      name: "game_finish",
      properties: {
        mode: "survival",
        outcome: "topped_out",
        scoreBand: "1000-4999",
        accuracyBand: "95-97",
      },
    },
  ],
};
const finishEvent = base.events[0]!;

describe("telemetry trust boundary", () => {
  it("accepts shared-contract enum and stat-band properties", () => {
    const value = validateTelemetryBatch(base);
    expect(value?.events).toHaveLength(1);
    expect(value?.events[0]?.properties).toEqual(finishEvent.properties);
  });

  it("rejects unknown properties rather than partially sanitizing them", () => {
    const value = validateTelemetryBatch({
      ...base,
      events: [{ ...finishEvent, properties: { mode: "survival", outcome: "topped_out", playerId: "secret" } }],
    });
    expect(value).toBeNull();
  });

  it("rejects malformed ids, extra top-level fields and oversized batches", () => {
    expect(validateTelemetryBatch({ ...base, extra: "nope" })).toBeNull();
    expect(validateTelemetryBatch({ ...base, sessionId: "short" })).toBeNull();
    expect(validateTelemetryBatch({ ...base, events: Array.from({ length: 11 }, (_, index) => ({ ...finishEvent, eventId: `event-${index.toString().padStart(8, "0")}` })) })).toBeNull();
    expect(isTelemetryRequestId("event-12345678")).toBe(true);
    expect(isTelemetryRequestId("event with spaces")).toBe(false);
    expect(isTelemetryPlayerId("player-12345678")).toBe(true);
    expect(isTelemetryPlayerId("nope")).toBe(false);
  });

  it("uses V2 for new hashes and does not hash without a configured secret", () => {
    const playerId = "player-12345678";
    const v2 = telemetryHashPlayerId(playerId, { TELEMETRY_HASH_SECRET_V1: "old", TELEMETRY_HASH_SECRET_V2: "new" });
    const v1 = telemetryHashPlayerId(playerId, { TELEMETRY_HASH_SECRET_V1: "old" });
    expect(v2).toBeTruthy();
    expect(v2).not.toBe(v1);
    expect(telemetryHashPlayerId(playerId, {})).toBeNull();
  });

  it("stores only aggregates, deduplicates event ids, and uses fixed expirations", async () => {
    const redis = new FakeRedis();
    const nowMs = Date.UTC(2026, 7, 29, 3, 0, 0);
    const playerId = "player-12345678";
    const batch = validateTelemetryBatch(base)!;
    const store = new RedisTelemetryStore(redis as unknown as Redis, {
      TELEMETRY_HASH_SECRET_V2: "test-secret-v2",
    });
    const input = {
      batchId: batch.batchId,
      sessionId: batch.sessionId,
      playerId,
      events: batch.events,
      ip: "203.0.113.10",
      nowMs,
    };
    await expect(store.accept(input)).resolves.toMatchObject({ accepted: 1, duplicate: 0, hashSecretConfigured: true });
    await expect(store.accept(input)).resolves.toMatchObject({ accepted: 0, duplicate: 1 });

    const serialized = JSON.stringify({ values: [...redis.values], sets: [...redis.sets], hashes: [...redis.hashes] });
    expect(serialized).not.toContain(playerId);
    expect(serialized).not.toContain(input.sessionId);
    const nowSec = Math.floor(nowMs / 1000);
    const dedupeExpiry = [...redis.expires.entries()].find(([key]) => key.includes(`${getTelemetryKeyPrefix()}:dedupe:`))?.[1];
    expect(dedupeExpiry).toBe(nowSec + TELEMETRY_DEDUPE_RETENTION_SECONDS);
    const dayKey = `${getTelemetryKeyPrefix()}:day:2026-08-29`;
    expect(redis.expires.get(dayKey)).toBe(Date.UTC(2026, 7, 29) / 1000 - 9 * 60 * 60 + TELEMETRY_COUNTER_RETENTION_SECONDS);
    expect(redis.expires.get(`${dayKey}:sessions`)).toBe(Date.UTC(2026, 7, 29) / 1000 - 9 * 60 * 60 + TELEMETRY_SET_RETENTION_SECONDS);
    expect(redis.expires.get(`${dayKey}:players:v2`)).toBe(Date.UTC(2026, 7, 29) / 1000 - 9 * 60 * 60 + TELEMETRY_SET_RETENTION_SECONDS);
  });

  it("enforces the per-session event cap", async () => {
    const redis = new FakeRedis();
    const store = new RedisTelemetryStore(redis as unknown as Redis, { TELEMETRY_HASH_SECRET_V2: "test" });
    const nowMs = Date.UTC(2026, 7, 29, 3, 0, 0);
    for (let index = 0; index < 120; index += 1) {
      const event = validateTelemetryBatch({
        ...base,
        events: [{ ...finishEvent, eventId: `event-${index.toString().padStart(8, "0")}` }],
      })!.events;
      await store.accept({ batchId: `batch-${index.toString().padStart(8, "0")}`, sessionId: "session-12345678", events: event, ip: "198.51.100.4", nowMs });
    }
    const last = validateTelemetryBatch({ ...base, events: [{ ...finishEvent, eventId: "event-99999999" }] })!.events;
    await expect(store.accept({ batchId: "batch-99999999", sessionId: "session-12345678", events: last, ip: "198.51.100.4", nowMs })).rejects.toBeInstanceOf(TelemetryRateLimitError);
  });

  it("deletes active/cohort/first-seen members for both configured HMAC versions", async () => {
    const redis = new FakeRedis();
    const playerId = "player-12345678";
    const nowMs = Date.UTC(2026, 7, 29, 3, 0, 0);
    const eventV1 = validateTelemetryBatch({ ...base, events: [{ ...finishEvent, eventId: "event-v10000000" }] })!.events;
    const eventV2 = validateTelemetryBatch({ ...base, events: [{ ...finishEvent, eventId: "event-v20000000" }] })!.events;
    await new RedisTelemetryStore(redis as unknown as Redis, { TELEMETRY_HASH_SECRET_V1: "old" }).accept({
      batchId: "batch-v10000000", sessionId: "session-12345678", playerId, events: eventV1, ip: "192.0.2.4", nowMs,
    });
    await new RedisTelemetryStore(redis as unknown as Redis, { TELEMETRY_HASH_SECRET_V2: "new", TELEMETRY_HASH_SECRET_V1: "old" }).accept({
      batchId: "batch-v20000000", sessionId: "session-22345678", playerId, events: eventV2, ip: "192.0.2.4", nowMs,
    });
    const v1Hash = telemetryHashPlayerId(playerId, { TELEMETRY_HASH_SECRET_V1: "old" })!;
    const v2Hash = telemetryHashPlayerId(playerId, { TELEMETRY_HASH_SECRET_V2: "new" })!;
    expect([...redis.sets.values()].some((set) => set.has(v1Hash) || set.has(v2Hash))).toBe(true);
    await new RedisTelemetryStore(redis as unknown as Redis, { TELEMETRY_HASH_SECRET_V2: "new", TELEMETRY_HASH_SECRET_V1: "old" }).deletePlayer(playerId);
    expect([...redis.sets.values()].some((set) => set.has(v1Hash) || set.has(v2Hash))).toBe(false);
    expect([...redis.values.keys()].some((key) => key.includes(v1Hash) || key.includes(v2Hash))).toBe(false);
  });
});
