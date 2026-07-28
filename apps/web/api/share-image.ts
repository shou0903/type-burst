import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SHARE_ID_PATTERN, getRedis, shareImageKey } from "./_shared/shareStore";

/**
 * 共有カード画像の配信(D-091)。
 * /r/<id> のOGP画像として、X・LINE・Discord などのクローラーから叩かれる。
 * 内容は一度保存したら変わらないので、長めにキャッシュさせる。
 */

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const id = single(req.query.id);
    if (!SHARE_ID_PATTERN.test(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const stored = await getRedis().get(shareImageKey(id));
    if (!stored) {
      // 期限切れでもリンクカードが崩れないよう、既定のOG画像へ寄せる
      res.setHeader("Cache-Control", "public, max-age=300");
      res.redirect(302, "/og-image-v3.png");
      return;
    }

    const buffer = Buffer.from(stored, "base64");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    res.status(200).send(buffer);
  } catch {
    res.status(500).json({ error: "Share image unavailable" });
  }
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
