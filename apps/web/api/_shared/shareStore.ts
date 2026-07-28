import Redis from "ioredis";

/**
 * 共有カード(D-091)の保管まわりの共通処理。
 * `_` 始まりのディレクトリは Vercel のルートとして公開されないため、
 * APIルート間で共有するヘルパーはここに置く。
 */

export const SHARE_TTL_SECONDS = 90 * 24 * 60 * 60;
export const SHARE_ID_PATTERN = /^[23456789abcdefghijkmnpqrstuvwxyz]{10}$/;

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL が設定されていません");
    client = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
  }
  return client;
}

export function shareMetaKey(id: string): string {
  return `share:v1:${id}`;
}

export function shareImageKey(id: string): string {
  return `share-img:v1:${id}`;
}

export function getClientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? String(forwarded[0]) : typeof forwarded === "string" ? forwarded : "";
  return raw.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

/** HTMLへ値を埋め込む際のエスケープ。属性値・テキストの双方に使える範囲を潰す。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
