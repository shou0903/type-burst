import { createHash, createHmac } from "node:crypto";
import Redis from "ioredis";
import {
  TELEMETRY_VERSION,
  MAX_TELEMETRY_EVENT_PROPERTIES,
  TelemetryEventName,
  TelemetryEvent,
  TelemetryProperties,
  TelemetryBatch,
  sanitizeTelemetryProperties,
} from "../../src/telemetryContract.js";

/**
 * First-party telemetry storage.
 *
 * This module intentionally stores aggregates only.  Event payloads are
 * validated at the HTTP boundary and reduced to a bounded counter field; no
 * raw event, input text, nickname, score, URL or playerId is written to
 * Redis.  Session/player members are short-lived pseudonymous set members.
 */

export const TELEMETRY_BODY_LIMIT_BYTES = 12 * 1024;
export const TELEMETRY_MAX_EVENTS = 10;
export const TELEMETRY_COUNTER_RETENTION_SECONDS = 400 * 24 * 60 * 60;
export const TELEMETRY_SET_RETENTION_SECONDS = 120 * 24 * 60 * 60;
export const TELEMETRY_DEDUPE_RETENTION_SECONDS = 25 * 60 * 60;
export const TELEMETRY_SET_MEMBER_LIMIT = 50_000;

export const TELEMETRY_IP_LIMIT_PER_HOUR = 300;
export const TELEMETRY_SESSION_LIMIT_PER_HOUR = 120;
export const TELEMETRY_GLOBAL_LIMIT_PER_HOUR = 20_000;

const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;
const KEY_PREFIX = "telemetry:v1";
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

const EVENT_NAMES: readonly TelemetryEventName[] = [
  "content_entry",
  "screen_view",
  "game_start",
  "game_finish",
  "tutorial_completed",
  "game_exit",
  "result_action",
  "share_action",
  "ranking_action",
  "analysis_action",
  "settings_change",
  "transfer_action",
  "mobile_handoff",
  "tool_action",
  "feature_used",
  "flow_failure",
];

const EVENT_NAME_SET = new Set<string>(EVENT_NAMES);
const DIMENSION_KEYS = new Set([
  "source",
  "path",
  "screen",
  "mode",
  "difficulty",
  "outcome",
  "entryPoint",
  "ranked",
  "focusGoal",
  "surface",
  "action",
  "scope",
  "setting",
  "value",
  "status",
  "availability",
  "tool",
  "feature",
  "kind",
  "reason",
  "firstPlay",
  "scoreBand",
  "kpmBand",
  "accuracyBand",
  "chainBand",
  "durationBand",
  "levelBand",
  "elapsedBand",
  "focusAchieved",
]);

export interface TelemetryAcceptedEvent {
  eventId: string;
  name: TelemetryEventName;
  properties: TelemetryProperties;
}

export interface TelemetryStoreInput {
  batchId: string;
  sessionId: string;
  playerId?: string;
  events: readonly TelemetryAcceptedEvent[];
  ip: string;
  nowMs?: number;
}

export interface TelemetryStoreResult {
  accepted: number;
  duplicate: number;
  hashSecretConfigured: boolean;
}

export interface TelemetryRetention {
  available: boolean;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export interface TelemetryBreakdown {
  key: string;
  events: number;
  sessions: number | null;
  anonymousIds: number | null;
}

export interface TelemetryTrendPoint {
  date: string;
  sessions: number;
  anonymousIds: number | null;
  newAnonymousIds: number | null;
  gameStarts: number;
  gameFinishes: number;
}

export interface TelemetryStats {
  available: boolean;
  hashSecretConfigured: boolean;
  generatedAt: string;
  today: string;
  todayStats: {
    sessions: number;
    anonymousIds: number | null;
    newAnonymousIds: number | null;
    gameStarts: number;
    gameFinishes: number;
    completionRate: number | null;
    contentEntries: number;
    funnel: Array<{ key: string; events: number; sessions: number; anonymousIds: number | null; rate: number | null }>;
    sources: TelemetryBreakdown[];
    modes: TelemetryBreakdown[];
    difficulties: TelemetryBreakdown[];
    resultActions: TelemetryBreakdown[];
    entryPoints: TelemetryBreakdown[];
    outcomes: TelemetryBreakdown[];
    scoreBands: TelemetryBreakdown[];
    kpmBands: TelemetryBreakdown[];
    accuracyBands: TelemetryBreakdown[];
    chainBands: TelemetryBreakdown[];
    durationBands: TelemetryBreakdown[];
    levelBands: TelemetryBreakdown[];
    features: TelemetryBreakdown[];
    shareActions: TelemetryBreakdown[];
    rankingActions: TelemetryBreakdown[];
    analysisActions: TelemetryBreakdown[];
    transferStatuses: TelemetryBreakdown[];
    mobileActions: TelemetryBreakdown[];
    settingChanges: TelemetryBreakdown[];
    tools: TelemetryBreakdown[];
    toolActions: TelemetryBreakdown[];
    failures: TelemetryBreakdown[];
  };
  trend30: TelemetryTrendPoint[];
  retention: TelemetryRetention;
}

interface HashVersion {
  version: "v1" | "v2";
  secret: string;
}

interface HashVersionsOptions {
  env?: NodeJS.ProcessEnv;
}

function configuredHashVersions(env: NodeJS.ProcessEnv = process.env): HashVersion[] {
  const versions: HashVersion[] = [];
  const v2 = typeof env.TELEMETRY_HASH_SECRET_V2 === "string" ? env.TELEMETRY_HASH_SECRET_V2.trim() : "";
  const v1 = typeof env.TELEMETRY_HASH_SECRET_V1 === "string" ? env.TELEMETRY_HASH_SECRET_V1.trim() : "";
  // V2 is the active version. V1 remains discoverable solely for deletion and
  // migration-safe reads; player ids are never used as Redis keys.
  if (v2) versions.push({ version: "v2", secret: v2 });
  if (v1) versions.push({ version: "v1", secret: v1 });
  return versions;
}

export function telemetryHashSecretConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredHashVersions(env).length > 0;
}

export function telemetryHashPlayerId(playerId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!PLAYER_ID_PATTERN.test(playerId)) return null;
  const active = configuredHashVersions(env)[0];
  if (!active) return null;
  return createHmac("sha256", active.secret).update(playerId, "utf8").digest("hex");
}

function telemetryHashPlayerVersions(playerId: string, env: NodeJS.ProcessEnv = process.env): HashVersion[] {
  if (!PLAYER_ID_PATTERN.test(playerId)) return [];
  return configuredHashVersions(env);
}

export function isTelemetryRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function isTelemetryPlayerId(value: unknown): value is string {
  return typeof value === "string" && PLAYER_ID_PATTERN.test(value);
}

function jstDay(dateMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function jstDayStartEpoch(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return Math.floor(Date.now() / 1000);
  const [, year, month, date] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(date), 0, 0, 0) / 1000) - 9 * 60 * 60;
}

function dayKey(day: string): string {
  return `${KEY_PREFIX}:day:${day}`;
}

function daySetKey(day: string, kind: "sessions" | "players" | "new-players", version?: "v1" | "v2"): string {
  return `${KEY_PREFIX}:day:${day}:${kind}${version ? `:${version}` : ""}`;
}

function dayDimensionSetKey(day: string, kind: "sessions" | "players", eventName: string, dimensions: string, version?: "v1" | "v2"): string {
  return `${KEY_PREFIX}:day:${day}:${kind}:${eventName}:${dimensions}${version ? `:${version}` : ""}`;
}

function dayEventSetKey(day: string, kind: "sessions" | "players", eventName: string, version?: "v1" | "v2"): string {
  return `${KEY_PREFIX}:day:${day}:event-${kind}:${eventName}${version ? `:${version}` : ""}`;
}

function dedupeKey(eventId: string): string {
  const digest = createHash("sha256").update(eventId, "utf8").digest("hex");
  return `${KEY_PREFIX}:dedupe:${digest}`;
}

function firstSeenKey(hashVersion: "v1" | "v2", playerHash: string): string {
  return `${KEY_PREFIX}:first:${hashVersion}:${playerHash}`;
}

function rateLimitKey(kind: "ip" | "session" | "global", value: string, hourEpoch: number): string {
  return `${KEY_PREFIX}:rate:${kind}:${value}:${hourEpoch}`;
}

function hashRateValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function canonicalDimensions(properties: TelemetryProperties): string {
  const entries = Object.entries(properties)
    .filter(([key, value]) => DIMENSION_KEYS.has(key) && (typeof value === "string" || typeof value === "boolean"))
    .sort(([a], [b]) => a.localeCompare(b));
  // Values are all contract enums/booleans, but encode defensively so a
  // future contract cannot introduce Redis separators or unbounded fields.
  return entries
    .map(([key, value]) => `${key}=${String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32)}`)
    .join("&") || "all";
}

function counterField(eventName: string, dimensions: string): string {
  return dimensions === "all" ? `event:${eventName}` : `event:${eventName}|${dimensions}`;
}

function addDays(day: string, days: number): string {
  return jstDay((jstDayStartEpoch(day) + days * DAY_SECONDS) * 1000);
}

function clampSafeCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * The endpoint uses this validator after decoding JSON. Keeping it exported
 * makes the trust boundary unit-testable without a Redis connection.
 */
export function validateTelemetryBatch(value: unknown): TelemetryBatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowedTopLevel = new Set(["v", "batchId", "sessionId", "playerId", "events"]);
  if (Object.keys(body).some((key) => !allowedTopLevel.has(key))) return null;
  if (body.v !== TELEMETRY_VERSION || !isTelemetryRequestId(body.batchId) || !isTelemetryRequestId(body.sessionId)) return null;
  if (body.playerId !== undefined && !isTelemetryPlayerId(body.playerId)) return null;
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > TELEMETRY_MAX_EVENTS) return null;

  const events: TelemetryEvent[] = [];
  for (const event of body.events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    const record = event as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["eventId", "name", "properties"].includes(key))) return null;
    if (!isTelemetryRequestId(record.eventId) || typeof record.name !== "string" || !EVENT_NAME_SET.has(record.name)) return null;
    const properties = sanitizeTelemetryProperties(record.name as TelemetryEventName, record.properties);
    const rawProperties = record.properties;
    if (!rawProperties || typeof rawProperties !== "object" || Array.isArray(rawProperties)) return null;
    if (!properties) return null;
    const rawPropertyKeys = Object.keys(rawProperties);
    // The server rejects unknown properties instead of silently accepting a
    // partially sanitized event. The cap follows the shared contract (the
    // client currently uses up to twelve coarse enum/band fields).
    if (rawPropertyKeys.length > MAX_TELEMETRY_EVENT_PROPERTIES) return null;
    if (rawPropertyKeys.some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) return null;
    if (Object.keys(properties).length > MAX_TELEMETRY_EVENT_PROPERTIES) return null;
    events.push({ eventId: record.eventId, name: record.name as TelemetryEventName, properties });
  }
  return {
    v: TELEMETRY_VERSION,
    batchId: body.batchId,
    sessionId: body.sessionId,
    ...(body.playerId === undefined ? {} : { playerId: body.playerId }),
    events,
  };
}

// Lua scripts are used for bounded sets and rate limits so concurrent requests
// cannot bypass limits with a SCARD/SADD or INCR/EXPIRE race.
const ADD_BOUNDED_MEMBER_SCRIPT = `
local exists = redis.call("SISMEMBER", KEYS[1], ARGV[1])
if exists == 1 then return 1 end
local size = redis.call("SCARD", KEYS[1])
if size >= tonumber(ARGV[2]) then return 0 end
redis.call("SADD", KEYS[1], ARGV[1])
return 1
`;

const RATE_LIMIT_SCRIPT = `
local ip = redis.call("INCRBY", KEYS[1], ARGV[1])
local session = redis.call("INCRBY", KEYS[2], ARGV[1])
local global = redis.call("INCRBY", KEYS[3], ARGV[1])
local limitIp = tonumber(ARGV[2])
local limitSession = tonumber(ARGV[3])
local limitGlobal = tonumber(ARGV[4])
if ip == tonumber(ARGV[1]) then redis.call("EXPIREAT", KEYS[1], ARGV[5]) end
if session == tonumber(ARGV[1]) then redis.call("EXPIREAT", KEYS[2], ARGV[5]) end
if global == tonumber(ARGV[1]) then redis.call("EXPIREAT", KEYS[3], ARGV[5]) end
if ip > limitIp or session > limitSession or global > limitGlobal then return 0 end
return 1
`;

export class RedisTelemetryStore {
  public constructor(private readonly store: Redis, private readonly env: NodeJS.ProcessEnv = process.env) {}

  public async accept(input: TelemetryStoreInput): Promise<TelemetryStoreResult> {
    const nowMs = input.nowMs ?? Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const hourEpoch = Math.floor(nowSec / HOUR_SECONDS) * HOUR_SECONDS;
    const cost = input.events.length;
    const allowed = await this.allowRate(input.ip, input.sessionId, hourEpoch, cost, hourEpoch + HOUR_SECONDS + 1);
    if (!allowed) throw new TelemetryRateLimitError();

    const day = jstDay(nowMs);
    const dayStart = jstDayStartEpoch(day);
    const counterExpiry = dayStart + TELEMETRY_COUNTER_RETENTION_SECONDS;
    const setExpiry = dayStart + TELEMETRY_SET_RETENTION_SECONDS;
    // New writes use exactly the highest configured secret. Old V1/V2 sets are
    // both read/deleted for rotation compatibility, but are never dual-written
    // (which would inflate player counts during a secret rotation).
    const hashes = input.playerId ? configuredHashVersions(this.env).slice(0, 1) : [];
    let accepted = 0;
    let duplicate = 0;
    const newlySeenKeys: string[] = [];

    // Dedupe calls are deliberately separate from aggregate writes. A failed
    // aggregate write may be retried with the same eventId; the caller will
    // receive a server error rather than silently losing the event.
    const freshEvents: TelemetryAcceptedEvent[] = [];
    for (const event of input.events) {
      const key = dedupeKey(event.eventId);
      const created = await this.store.set(key, "1", "NX");
      if (created === "OK") await this.store.expireat(key, nowSec + TELEMETRY_DEDUPE_RETENTION_SECONDS);
      if (created === "OK") freshEvents.push(event);
      else duplicate += 1;
    }
    if (freshEvents.length === 0) {
      return { accepted: 0, duplicate, hashSecretConfigured: hashes.length > 0 };
    }

    const pipeline = this.store.pipeline();
    const counters = dayKey(day);
    for (const event of freshEvents) {
      const dimensions = canonicalDimensions(event.properties);
      pipeline.hincrby(counters, counterField(event.name, "all"), 1);
      if (dimensions !== "all") pipeline.hincrby(counters, counterField(event.name, dimensions), 1);
    }
    pipeline.expireat(counters, counterExpiry);

    // Indexes contain only aggregate set-key names and expire with the day.
    // They let the admin read path avoid Redis KEYS/SCAN over the whole DB.
    const sessionSetIndex = `${counters}:session-set-index`;
    const playerSetIndex = `${counters}:player-set-index`;

    // A session is only represented by a hash and is bounded by the set cap.
    // The raw session id is never persisted. Members are added below through
    // the bounded Lua script, so concurrent requests cannot exceed the cap.
    const sessionMember = hashRateValue(input.sessionId);
    pipeline.sadd(sessionSetIndex, daySetKey(day, "sessions"));
    for (const event of freshEvents) {
      pipeline.sadd(sessionSetIndex, dayEventSetKey(day, "sessions", event.name));
      const dimensions = canonicalDimensions(event.properties);
      if (dimensions === "all") continue;
      const key = dayDimensionSetKey(day, "sessions", event.name, dimensions);
      pipeline.sadd(sessionSetIndex, key);
    }

    for (const hashVersion of hashes) {
      const playerHash = createHmac("sha256", hashVersion.secret).update(input.playerId!, "utf8").digest("hex");
      const playerSet = daySetKey(day, "players", hashVersion.version);
      pipeline.sadd(playerSetIndex, playerSet);
      for (const event of freshEvents) pipeline.sadd(playerSetIndex, dayEventSetKey(day, "players", event.name));
      const firstKey = firstSeenKey(hashVersion.version, playerHash);
      const firstCreated = await this.store.set(firstKey, day, "NX");
      if (firstCreated === "OK") await this.store.expireat(firstKey, nowSec + TELEMETRY_SET_RETENTION_SECONDS);
      if (firstCreated === "OK") {
        newlySeenKeys.push(firstKey);
        const cohortSet = daySetKey(day, "new-players", hashVersion.version);
        pipeline.sadd(playerSetIndex, cohortSet);
      }
      for (const event of freshEvents) {
        const dimensions = canonicalDimensions(event.properties);
        if (dimensions === "all") continue;
        const key = dayDimensionSetKey(day, "players", event.name, dimensions, hashVersion.version);
        pipeline.sadd(playerSetIndex, key.replace(/:(v1|v2)$/, ""));
      }
    }

    // Apply bounded-set limits atomically after the pipeline has created the
    // members. If a set was already at capacity, trim is deterministic by
    // keeping the first 50k members returned by SSCAN; aggregate counts remain
    // intact even when unique-member metrics saturate.
    let aggregateWritten = false;
    try {
      const aggregateRows = await pipeline.exec();
      const aggregateError = aggregateRows?.find(([error]) => error)?.[0];
      if (aggregateError) throw aggregateError;
      aggregateWritten = true;
      await this.store.expireat(sessionSetIndex, setExpiry);
      await this.store.expireat(playerSetIndex, setExpiry);
      // Add bounded members after the aggregate write. If this step fails the
      // event is still counted, while the next retry can safely fill metrics.
      const addMember = async (key: string, member: string) => {
        await this.store.eval(ADD_BOUNDED_MEMBER_SCRIPT, 1, key, member, TELEMETRY_SET_MEMBER_LIMIT);
        await this.store.expireat(key, setExpiry);
      };
      try {
        await addMember(daySetKey(day, "sessions"), sessionMember);
        for (const event of freshEvents) {
          await addMember(dayEventSetKey(day, "sessions", event.name), sessionMember);
          const dimensions = canonicalDimensions(event.properties);
          if (dimensions !== "all") await addMember(dayDimensionSetKey(day, "sessions", event.name, dimensions), sessionMember);
        }
        for (const hashVersion of hashes) {
          const playerHash = createHmac("sha256", hashVersion.secret).update(input.playerId!, "utf8").digest("hex");
          await addMember(daySetKey(day, "players", hashVersion.version), playerHash);
          // Only the first-seen day's cohort receives this member. Reading the
          // marker is safe here because the marker itself was already NX-set.
          const firstDay = await this.store.get(firstSeenKey(hashVersion.version, playerHash));
          if (firstDay === day) await addMember(daySetKey(day, "new-players", hashVersion.version), playerHash);
          for (const event of freshEvents) {
            await addMember(dayEventSetKey(day, "players", event.name, hashVersion.version), playerHash);
            const dimensions = canonicalDimensions(event.properties);
            if (dimensions !== "all") await addMember(dayDimensionSetKey(day, "players", event.name, dimensions, hashVersion.version), playerHash);
          }
        }
      } catch {
        // Counters are already durable. Unique-member metrics are best effort;
        // never remove a dedupe marker and double-count a successful event.
      }
    } catch (error) {
      // A failed aggregate must not poison retries forever. Best-effort removal
      // is safe because a concurrent successful request will recreate the key.
      if (!aggregateWritten) {
        await Promise.all([
          ...freshEvents.map((event) => this.store.del(dedupeKey(event.eventId))),
          ...newlySeenKeys.map((key) => this.store.del(key)),
        ]);
      }
      throw error;
    }
    const boundedKeys = new Set<string>([
      daySetKey(day, "sessions"),
      ...freshEvents.map((event) => dayEventSetKey(day, "sessions", event.name)),
      ...hashes.map(({ version }) => daySetKey(day, "players", version)),
      ...hashes.map(({ version }) => daySetKey(day, "new-players", version)),
    ]);
    for (const event of freshEvents) {
      boundedKeys.add(dayEventSetKey(day, "sessions", event.name));
      const dimensions = canonicalDimensions(event.properties);
      if (dimensions === "all") continue;
      boundedKeys.add(dayDimensionSetKey(day, "sessions", event.name, dimensions));
      for (const { version } of hashes) boundedKeys.add(dayDimensionSetKey(day, "players", event.name, dimensions, version));
    }
    // The bounded Lua insertion above is sufficient. The safety set is kept
    // for old data, but a failed optional trim must never turn a successful
    // aggregate write into a 503 response.
    await Promise.all([...boundedKeys].map((key) => this.trimSetIfNeeded(key).catch(() => undefined)));

    accepted = freshEvents.length;
    return { accepted, duplicate, hashSecretConfigured: hashes.length > 0 };
  }

  public async deletePlayer(playerId: string): Promise<void> {
    const hashes = telemetryHashPlayerVersions(playerId, this.env);
    if (hashes.length === 0) return;
    const now = Date.now();
    const today = jstDay(now);
    const hashedByVersion = hashes.map(({ version, secret }) => ({
      version,
      playerHash: createHmac("sha256", secret).update(playerId, "utf8").digest("hex"),
    }));
    const indexPipeline = this.store.pipeline();
    for (let offset = 0; offset < 120; offset += 1) {
      const day = addDays(today, -offset);
      indexPipeline.smembers(`${dayKey(day)}:player-set-index`);
    }
    // Dimension-set keys are indexed in a bounded daily hash to avoid SCAN
    // calls and to make deletion predictable. The index is itself aggregate
    // metadata and expires with the day's counter hash.
    const indexRows = await indexPipeline.exec();
    const pipeline = this.store.pipeline();
    for (const { version, playerHash } of hashedByVersion) {
      for (let offset = 0; offset < 120; offset += 1) {
        const day = addDays(today, -offset);
        pipeline.srem(daySetKey(day, "players", version), playerHash);
        pipeline.srem(daySetKey(day, "new-players", version), playerHash);
        pipeline.del(firstSeenKey(version, playerHash));
      }
    }
    for (const row of indexRows ?? []) {
      const index = row[1];
      if (!Array.isArray(index)) continue;
      for (const key of index.slice(0, TELEMETRY_SET_MEMBER_LIMIT)) {
        for (const { version, playerHash } of hashedByVersion) {
          const versionedKey = String(key).endsWith(`:${version}`) ? String(key) : `${String(key)}:${version}`;
          pipeline.srem(versionedKey, playerHash);
        }
      }
    }
    await pipeline.exec();
  }

  private async allowRate(ip: string, sessionId: string, hourEpoch: number, cost: number, expiry: number): Promise<boolean> {
    const result = await this.store.eval(
      RATE_LIMIT_SCRIPT,
      3,
      rateLimitKey("ip", hashRateValue(ip), hourEpoch),
      rateLimitKey("session", hashRateValue(sessionId), hourEpoch),
      rateLimitKey("global", "all", hourEpoch),
      cost,
      TELEMETRY_IP_LIMIT_PER_HOUR,
      TELEMETRY_SESSION_LIMIT_PER_HOUR,
      TELEMETRY_GLOBAL_LIMIT_PER_HOUR,
      expiry,
    );
    return Number(result) === 1;
  }

  private async trimSetIfNeeded(key: string): Promise<void> {
    const size = await this.store.scard(key);
    if (size <= TELEMETRY_SET_MEMBER_LIMIT) return;
    // SSCAN does not guarantee order; this is only a safety valve to stop an
    // attacker from growing memory without changing event counters.
    const members = await this.store.sscan(key, "0", "COUNT", Math.max(1, size - TELEMETRY_SET_MEMBER_LIMIT));
    const remove = members[1]?.slice(0, Math.max(0, size - TELEMETRY_SET_MEMBER_LIMIT)) ?? [];
    if (remove.length > 0) await this.store.srem(key, ...remove);
  }
}

export class TelemetryRateLimitError extends Error {
  public constructor() {
    super("Telemetry rate limit exceeded");
    this.name = "TelemetryRateLimitError";
  }
}

/** Read aggregate counters for the admin dashboard. No identifiers leave Redis. */
export async function readTelemetryStats(
  store: Redis,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelemetryStats> {
  const today = jstDay(nowMs);
  const hashVersions = configuredHashVersions(env);
  const trend30: TelemetryTrendPoint[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    trend30.push(await readTrendPoint(store, day, hashVersions));
  }
  const todayStats = await readTodayStats(store, today, hashVersions);
  const retention = await readRetention(store, today, hashVersions);
  return {
    available: true,
    hashSecretConfigured: hashVersions.length > 0,
    generatedAt: new Date(nowMs).toISOString(),
    today,
    todayStats,
    trend30,
    retention,
  };
}

async function readTrendPoint(store: Redis, day: string, hashVersions: HashVersion[]): Promise<TelemetryTrendPoint> {
  const [hash, sessions] = await Promise.all([store.hgetall(dayKey(day)), store.scard(daySetKey(day, "sessions"))]);
  const playerCounts = await Promise.all(hashVersions.map(({ version }) => store.scard(daySetKey(day, "players", version))));
  const newPlayerCounts = await Promise.all(hashVersions.map(({ version }) => store.scard(daySetKey(day, "new-players", version))));
  return {
    date: day,
    sessions: clampSafeCount(sessions),
    anonymousIds: hashVersions.length ? Math.max(...playerCounts) : null,
    newAnonymousIds: hashVersions.length ? Math.max(...newPlayerCounts) : null,
    gameStarts: clampSafeCount(hash["event:game_start"]),
    gameFinishes: clampSafeCount(hash["event:game_finish"]),
  };
}

async function readTodayStats(store: Redis, day: string, hashVersions: HashVersion[]): Promise<TelemetryStats["todayStats"]> {
  const [hash, sessions] = await Promise.all([store.hgetall(dayKey(day)), store.scard(daySetKey(day, "sessions"))]);
  const playerCounts = await Promise.all(hashVersions.map(({ version }) => store.scard(daySetKey(day, "players", version))));
  const newPlayerCounts = await Promise.all(hashVersions.map(({ version }) => store.scard(daySetKey(day, "new-players", version))));
  const gameStarts = clampSafeCount(hash["event:game_start"]);
  const gameFinishes = clampSafeCount(hash["event:game_finish"]);
  const eventCount = (name: string) => clampSafeCount(hash[`event:${name}`]);
  const breakdown = async (name: string, key: string): Promise<TelemetryBreakdown[]> => {
    const totals = new Map<string, number>();
    for (const [field, count] of Object.entries(hash)) {
      if (!field.startsWith(`event:${name}|`)) continue;
      const marker = `${key}=`;
      const start = field.indexOf(marker);
      if (start < 0) continue;
      const value = field.slice(start + marker.length).split(/[&|]/, 1)[0] ?? "";
      if (!value) continue;
      totals.set(value, (totals.get(value) ?? 0) + clampSafeCount(count));
    }
    const rows = [...totals.entries()].map(([rowKey, events]) => ({ key: rowKey, events }));
    const result: TelemetryBreakdown[] = [];
    for (const row of rows.sort((a, b) => b.events - a.events).slice(0, 20)) {
      const sessionCount = await countIndexedDimensionSets(store, day, "sessions", name, key, row.key);
      const playerCounts = hashVersions.length
        ? await Promise.all(hashVersions.map(({ version }) => countIndexedDimensionSets(store, day, "players", name, key, row.key, version)))
        : [];
      result.push({
        key: row.key,
        events: row.events,
        sessions: sessionCount || null,
        anonymousIds: hashVersions.length ? Math.max(0, ...playerCounts) || null : null,
      });
    }
    return result;
  };
  const [
    sources,
    modes,
    difficulties,
    resultActions,
    entryPoints,
    outcomes,
    scoreBands,
    kpmBands,
    accuracyBands,
    chainBands,
    durationBands,
    levelBands,
    features,
    shareActions,
    rankingActions,
    analysisActions,
    transferStatuses,
    mobileActions,
    settingChanges,
    tools,
    toolActions,
    failures,
  ] = await Promise.all([
    breakdown("content_entry", "source"),
    breakdown("game_start", "mode"),
    breakdown("game_start", "difficulty"),
    breakdown("result_action", "action"),
    breakdown("game_start", "entryPoint"),
    breakdown("game_finish", "outcome"),
    breakdown("game_finish", "scoreBand"),
    breakdown("game_finish", "kpmBand"),
    breakdown("game_finish", "accuracyBand"),
    breakdown("game_finish", "chainBand"),
    breakdown("game_finish", "durationBand"),
    breakdown("game_finish", "levelBand"),
    breakdown("feature_used", "feature"),
    breakdown("share_action", "action"),
    breakdown("ranking_action", "action"),
    breakdown("analysis_action", "action"),
    breakdown("transfer_action", "status"),
    breakdown("mobile_handoff", "action"),
    breakdown("settings_change", "setting"),
    breakdown("tool_action", "tool"),
    breakdown("tool_action", "action"),
    breakdown("flow_failure", "surface"),
  ]);
  const funnelKeys = ["content_entry", "game_start", "game_finish"] as const;
  const funnelCounts = await Promise.all(
    funnelKeys.map(async (key) => ({
      key,
      events: eventCount(key),
      sessions: await countEventSessions(store, day, key),
      anonymousIds: hashVersions.length ? await countEventPlayers(store, day, key, hashVersions) : null,
    })),
  );
  // Conversion is session based. Event counts can exceed 100% because one
  // session may play repeatedly, so they are never used as funnel denominators.
  const funnel = funnelCounts.map((stage, index) => ({
    ...stage,
    rate:
      index === 0
        ? stage.sessions > 0 ? 1 : null
        : funnelCounts[index - 1]!.sessions > 0
          ? stage.sessions / funnelCounts[index - 1]!.sessions
          : null,
  }));
  return {
    sessions: clampSafeCount(sessions),
    anonymousIds: hashVersions.length ? Math.max(...playerCounts) : null,
    newAnonymousIds: hashVersions.length ? Math.max(...newPlayerCounts) : null,
    gameStarts,
    gameFinishes,
    completionRate: gameStarts > 0 ? gameFinishes / gameStarts : null,
    contentEntries: eventCount("content_entry"),
    funnel,
    sources,
    modes,
    difficulties,
    resultActions,
    entryPoints,
    outcomes,
    scoreBands,
    kpmBands,
    accuracyBands,
    chainBands,
    durationBands,
    levelBands,
    features,
    shareActions,
    rankingActions,
    analysisActions,
    transferStatuses,
    mobileActions,
    settingChanges,
    tools,
    toolActions,
    failures,
  };
}

async function countIndexedDimensionSets(
  store: Redis,
  day: string,
  kind: "sessions" | "players",
  eventName: string,
  dimensionKey: string,
  dimensionValue: string,
  version?: "v1" | "v2",
): Promise<number> {
  const indexName = `${dayKey(day)}:${kind === "sessions" ? "session" : "player"}-set-index`;
  const index = await store.smembers(indexName);
  const prefix = `${KEY_PREFIX}:day:${day}:${kind}:${eventName}:`;
  const needle = `${dimensionKey}=${dimensionValue}`;
  const candidates = index
    .filter((key) => key.startsWith(prefix) && key.includes(needle))
    .map((key) => (kind === "players" && version ? `${key}:${version}` : key));
  if (candidates.length === 0) return 0;
  if (candidates.length === 1) return store.scard(candidates[0]!);
  const temporary = `${KEY_PREFIX}:tmp:breakdown:${kind}:${eventName}:${dimensionKey}:${dimensionValue}:${version ?? "all"}`;
  const count = await store.sunionstore(temporary, ...candidates);
  await store.expireat(temporary, Math.floor(Date.now() / 1000) + 60);
  return count;
}

async function countEventSessions(store: Redis, day: string, eventName: string): Promise<number> {
  // Event-level sets preserve unique session denominators across all property
  // combinations; taking the max of individual dimension sets would be wrong.
  return store.scard(dayEventSetKey(day, "sessions", eventName));
}

async function countEventPlayers(store: Redis, day: string, eventName: string, versions: HashVersion[]): Promise<number> {
  const values = await Promise.all(versions.map(({ version }) => store.scard(dayEventSetKey(day, "players", eventName, version))));
  return values.length ? Math.max(...values) : 0;
}

async function readRetention(store: Redis, today: string, versions: HashVersion[]): Promise<TelemetryRetention> {
  if (versions.length === 0) return { available: false, d1: null, d7: null, d30: null };
  const values = await Promise.all(versions.map(async ({ version }) => {
    const totals: Record<"d1" | "d7" | "d30", { base: number; retained: number }> = {
      d1: { base: 0, retained: 0 },
      d7: { base: 0, retained: 0 },
      d30: { base: 0, retained: 0 },
    };
    // A cohort needs to be old enough for the requested day. The 120-day set
    // retention gives us up to 119 days of eligible baselines for D1.
    const tasks: Array<{
      label: "d1" | "d7" | "d30";
      cohort: string;
      active: string;
      temporary: string;
    }> = [];
    for (let baselineOffset = 119; baselineOffset >= 0; baselineOffset -= 1) {
      const baseline = addDays(today, -baselineOffset);
      for (const [label, offset] of [["d1", 1], ["d7", 7], ["d30", 30]] as const) {
        if (baselineOffset < offset) continue;
        tasks.push({
          label,
          cohort: daySetKey(baseline, "new-players", version),
          active: daySetKey(addDays(baseline, offset), "players", version),
          temporary: `${KEY_PREFIX}:tmp:retention:${version}:${baseline}:${label}`,
        });
      }
    }
    // Batch the 357 possible cohort SCARD calls into one round trip. This is
    // important on serverless Redis where sequential admin reads can time out.
    const basePipeline = store.pipeline();
    for (const task of tasks) basePipeline.scard(task.cohort);
    const baseRows = await basePipeline.exec();
    const eligible = tasks.filter((_, index) => clampSafeCount(baseRows?.[index]?.[1]) > 0);
    for (const [index, task] of tasks.entries()) {
      const base = clampSafeCount(baseRows?.[index]?.[1]);
      if (base > 0) totals[task.label].base += base;
    }
    if (eligible.length > 0) {
      const intersectionPipeline = store.pipeline();
      for (const task of eligible) {
        intersectionPipeline.sinterstore(task.temporary, task.cohort, task.active);
        // Temporary intersections contain only HMAC-pseudonymous members and
        // expire after 60 seconds; raw player IDs are never written.
        intersectionPipeline.expireat(task.temporary, Math.floor(Date.now() / 1000) + 60);
      }
      const intersectionRows = await intersectionPipeline.exec();
      eligible.forEach((task, index) => {
        const retained = clampSafeCount(intersectionRows?.[index * 2]?.[1]);
        totals[task.label].retained += retained;
      });
    }
    return {
      d1: totals.d1.base ? totals.d1.retained / totals.d1.base : null,
      d7: totals.d7.base ? totals.d7.retained / totals.d7.base : null,
      d30: totals.d30.base ? totals.d30.retained / totals.d30.base : null,
    };
  }));
  // Hash versions are ordered active-first (V2, then V1). Do not select the
  // numerically highest rate across versions, which would bias retention up.
  const pick = (key: "d1" | "d7" | "d30") => values.find((value) => typeof value[key] === "number")?.[key] ?? null;
  return {
    available: values.some((value) => value.d1 !== null || value.d7 !== null || value.d30 !== null),
    d1: pick("d1"),
    d7: pick("d7"),
    d30: pick("d30"),
  };
}

export function getTelemetryKeyPrefix(): string {
  return KEY_PREFIX;
}
