import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import {
  SHARE_TTL_SECONDS,
  getClientIp,
  getRedis,
  shareImageKey,
  shareMetaKey,
} from "./_shared/shareStore.js";

/**
 * 共有カードの保管(D-091)。
 *
 * クライアントのcanvasで描いたJPEGを受け取り、短いIDで保管する。
 * /r/<id> のOGP画像として配信され、SNSのリンクカードになる。
 *
 * サーバー側で画像を生成しない理由:
 * - @vercel/og(Satori)は日本語フォントを数MB同梱する必要があり、
 *   ニックネームに使える文字を事前に確定できない。
 * - クライアントで描けばOSのフォントが使えるため、日本語の見栄えが確実。
 *
 * 保存はユーザーが共有操作をした時だけ発生する。全リザルトで保存すると
 * 容量が無駄になるため、リザルト表示時には作らない。
 */

const ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz"; // 紛らわしい 0/1/l/o を除外
const ID_LENGTH = 10;
/** base64の上限。1200x630のJPEGは通常120KB前後で収まる */
const MAX_IMAGE_BASE64 = 600_000;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 200;
const RATE_LIMIT_WINDOW_SEC = 20;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    await handlePost(req, res);
  } catch {
    res.status(500).json({ error: "Share unavailable" });
  }
}

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  const redis = getRedis();
  const rateLimitKey = `ratelimit:share:${getClientIp(req)}`;
  if (await redis.get(rateLimitKey)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  await redis.set(rateLimitKey, "1", "EX", RATE_LIMIT_WINDOW_SEC);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const image = typeof body.image === "string" ? body.image : "";
  const title = sanitizeText(body.ogTitle, MAX_TITLE);
  const description = sanitizeText(body.ogDescription, MAX_DESCRIPTION);

  if (!title || !description) {
    res.status(400).json({ error: "Invalid metadata" });
    return;
  }
  if (!image || image.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    res.status(400).json({ error: "Invalid image" });
    return;
  }
  // JPEGのマジックナンバー(0xFFD8FF → base64で "/9j/")のみ受け付ける。
  // 画像以外のデータを配信経路に載せられないようにするため。
  if (!image.startsWith("/9j/")) {
    res.status(400).json({ error: "Unsupported image format" });
    return;
  }

  const id = generateId();
  const pipeline = redis.pipeline();
  pipeline.hset(shareMetaKey(id), {
    title,
    description,
    createdAt: new Date().toISOString(),
  });
  pipeline.expire(shareMetaKey(id), SHARE_TTL_SECONDS);
  pipeline.set(shareImageKey(id), image, "EX", SHARE_TTL_SECONDS);
  // 管理者統計(D-093)向けの累計カウンタ。TTL失効しても減算しない、生成された総数。
  pipeline.incr("stats:shares:total");
  await pipeline.exec();

  res.status(200).json({ id, path: `/r/${id}` });
}

function generateId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = "";
  for (let i = 0; i < ID_LENGTH; i += 1) {
    id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return id;
}

function sanitizeText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  // 制御文字を空白に潰してから長さを詰める。HTMLへの埋め込みは配信側でエスケープする。
  // eslint-disable-next-line no-control-regex
  const value = input.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return value || null;
}
