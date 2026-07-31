import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

/**
 * 管理者統計ダッシュボード(D-093)の認可チェック。
 *
 * ユーザーベースの認証は作らない(利用者は運営者本人のみのため)。
 * `Authorization: Bearer <token>` を環境変数 ADMIN_STATS_TOKEN と比較する。
 *
 * - 環境変数が未設定なら常に拒否する。設定漏れで全公開になる事故を防ぐため。
 * - 長さが異なる場合は timingSafeEqual に渡さず先に弾く
 *   (timingSafeEqual は長さ不一致だと例外を投げるため)。
 * - タイミング攻撃対策として、文字列の `===` 比較ではなく timingSafeEqual を使う。
 */
export function isAuthorizedAdmin(req: VercelRequest): boolean {
  const expected = process.env.ADMIN_STATS_TOKEN;
  if (!expected) return false;

  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith("Bearer ")) return false;
  const provided = value.slice("Bearer ".length);
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
