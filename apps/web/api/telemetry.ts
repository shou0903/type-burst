import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getClientIp, getRedis } from "./_shared/shareStore.js";
import {
  RedisTelemetryStore,
  TELEMETRY_BODY_LIMIT_BYTES,
  TelemetryRateLimitError,
  isTelemetryPlayerId,
  validateTelemetryBatch,
} from "./_shared/telemetryStore.js";

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;
const KNOWN_ORIGINS = new Set([
  "https://type-burst.com",
  "https://www.type-burst.com",
]);

function headerValue(req: VercelRequest, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "";
}

function allowedOrigins(): Set<string> {
  const result = new Set(KNOWN_ORIGINS);
  const configured = process.env.TELEMETRY_ALLOWED_ORIGINS ?? process.env.PUBLIC_SITE_ORIGINS ?? "";
  for (const origin of configured.split(",")) {
    const normalized = origin.trim().replace(/\/$/, "");
    if (/^https?:\/\/[^\s/]+(?::\d+)?$/.test(normalized)) result.add(normalized);
  }
  return result;
}

/** Same-origin is deliberately strict: the browser must send an exact origin. */
export function isAllowedTelemetryOrigin(req: VercelRequest): boolean {
  const origin = headerValue(req, "origin").trim().replace(/\/$/, "");
  if (!origin || origin.includes(" ") || origin.includes("#") || origin.includes("?")) return false;
  return allowedOrigins().has(origin);
}

function isJsonRequest(req: VercelRequest): boolean {
  return JSON_CONTENT_TYPE.test(headerValue(req, "content-type").trim());
}

function rawBodyBytes(body: unknown): number {
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (Buffer.isBuffer(body)) return body.byteLength;
  try {
    return Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function decodeBody(body: unknown): unknown | null {
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

function reject(res: VercelResponse, status: number, message: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: message });
}

/**
 * Best-effort first-party behavior ingestion. The response deliberately omits
 * accepted counts, session ids and player ids; the client never waits for this
 * endpoint to update the game UI.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    reject(res, 405, "Method not allowed");
    return;
  }
  if (!isAllowedTelemetryOrigin(req) || !isJsonRequest(req)) {
    reject(res, 403, "Forbidden");
    return;
  }
  const declaredLength = Number(headerValue(req, "content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > TELEMETRY_BODY_LIMIT_BYTES) {
    reject(res, 413, "Payload too large");
    return;
  }
  if (rawBodyBytes(req.body) > TELEMETRY_BODY_LIMIT_BYTES) {
    reject(res, 413, "Payload too large");
    return;
  }

  if (req.method === "DELETE") {
    const body = decodeBody(req.body);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      reject(res, 400, "Invalid telemetry payload");
      return;
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["v", "playerId"].includes(key)) || record.v !== 1 || !isTelemetryPlayerId(record.playerId)) {
      reject(res, 400, "Invalid telemetry payload");
      return;
    }
    try {
      const redis = getRedis();
      await new RedisTelemetryStore(redis).deletePlayer(record.playerId);
      // Idempotent by design. Never reveal whether the pseudonymous identity
      // existed, nor whether a hash secret is configured.
      res.setHeader("Cache-Control", "no-store");
      res.status(204).end();
    } catch {
      reject(res, 503, "Telemetry unavailable");
    }
    return;
  }

  const batch = validateTelemetryBatch(decodeBody(req.body));
  if (!batch) {
    reject(res, 400, "Invalid telemetry payload");
    return;
  }

  try {
    const redis = getRedis();
    const store = new RedisTelemetryStore(redis);
    await store.accept({
      batchId: batch.batchId,
      sessionId: batch.sessionId,
      ...(batch.playerId === undefined ? {} : { playerId: batch.playerId }),
      events: batch.events,
      ip: getClientIp(req),
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
  } catch (error) {
    if (error instanceof TelemetryRateLimitError) {
      reject(res, 429, "Too many requests");
      return;
    }
    // Do not expose Redis errors or event data. A telemetry outage must never
    // make gameplay fail; the browser treats this as a fire-and-forget call.
    reject(res, 503, "Telemetry unavailable");
  }
}
