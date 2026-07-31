import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SHARE_ID_PATTERN, escapeHtml, getRedis, shareMetaKey } from "./_shared/shareStore.js";

/**
 * 共有リンク /r/<id> の実体(D-091)。
 *
 * 役割は2つ。
 * 1. SNSのクローラーにOGPを返し、記録入りのリンクカードを出させる
 * 2. 開いた人をその場でプレイへ送り込む(獲得導線の着地点)
 *
 * SPA側でルーティングしない理由: OGPはクローラーがJSを実行しない前提のため、
 * サーバーがHTMLの時点でmetaタグを埋めている必要がある。
 *
 * robotsはnoindex,follow。ユーザー生成の結果ページが大量に索引されると
 * 中身の薄いページばかりが並びサイト全体の評価を下げるため。
 */

const ORIGIN = "https://type-burst.com";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const id = single(req.query.id);
  if (!SHARE_ID_PATTERN.test(id)) {
    res.redirect(302, "/");
    return;
  }

  let title = "TYPE BURST の記録";
  let description =
    "打ち切ったブロックが爆発する日本語タイピングゲーム。登録不要・完全無料でPCブラウザから遊べます。";
  let found = false;

  try {
    const meta = await getRedis().hgetall(shareMetaKey(id));
    if (meta && meta.title) {
      title = meta.title;
      description = meta.description ?? description;
      found = true;
    }
  } catch {
    // Redis障害時も着地ページ自体は返す。共有リンクが死んだ体験にはしない。
  }

  const imageUrl = found ? `${ORIGIN}/api/share-image?id=${id}` : `${ORIGIN}/og-image-v3.png`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.status(200).send(renderHtml({ id, title, description, imageUrl, found }));
}

function renderHtml(input: {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  found: boolean;
}): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const imageUrl = escapeHtml(input.imageUrl);
  const pageTitle = `${title}｜TYPE BURST`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#090c17" />
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${description}" />
<meta name="robots" content="noindex,follow" />
<link rel="canonical" href="${ORIGIN}/r/${input.id}" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />

<meta property="og:type" content="article" />
<meta property="og:locale" content="ja_JP" />
<meta property="og:site_name" content="TYPE BURST" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${ORIGIN}/r/${input.id}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:image:secure_url" content="${imageUrl}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${title}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${imageUrl}" />
<meta name="twitter:image:alt" content="${title}" />

<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100vh;
  background:
    radial-gradient(1100px 620px at 50% -10%, rgba(194,64,47,.24), transparent 62%),
    radial-gradient(900px 520px at 12% 108%, rgba(31,109,194,.20), transparent 60%),
    linear-gradient(170deg,#0b0f1c 0%,#090c17 55%,#05070e 100%);
  color:#edf4ff;
  font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo",system-ui,sans-serif;
  display:flex;flex-direction:column;align-items:center;
  padding:40px 20px 64px;
}
.rp-shell{width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:28px}
.rp-brand{
  font-family:"Helvetica Neue",Arial,sans-serif;font-weight:800;font-size:26px;
  letter-spacing:.24em;text-decoration:none;color:#edf4ff;
}
.rp-brand span{color:#ff8a70}
.rp-card{
  width:100%;border-radius:18px;overflow:hidden;
  border:1px solid rgba(255,138,112,.28);
  box-shadow:0 28px 70px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04) inset;
  background:#080b14;line-height:0;
}
.rp-card img{width:100%;height:auto;display:block}
.rp-headline{margin:0;text-align:center;font-size:clamp(21px,4.4vw,29px);line-height:1.5;letter-spacing:.01em}
.rp-lede{margin:0;text-align:center;color:#b9c0d8;font-size:clamp(14px,3vw,16px);line-height:1.85;max-width:34em}
.rp-cta{
  display:inline-flex;align-items:center;justify-content:center;gap:12px;
  min-width:min(360px,100%);padding:20px 40px;border-radius:999px;
  background:linear-gradient(135deg,#ff8a70 0%,#c2402f 62%,#7c2418 100%);
  color:#fff;font-size:clamp(17px,3.6vw,20px);font-weight:800;letter-spacing:.06em;
  text-decoration:none;border:1px solid rgba(255,255,255,.22);
  box-shadow:0 16px 42px rgba(194,64,47,.45);
  transition:transform .18s ease,box-shadow .18s ease;
}
.rp-cta:hover{transform:translateY(-2px);box-shadow:0 22px 54px rgba(194,64,47,.6)}
.rp-cta small{font-weight:600;font-size:.72em;opacity:.85;letter-spacing:.04em}
.rp-features{
  list-style:none;margin:0;padding:0;display:grid;gap:10px;width:100%;
  grid-template-columns:repeat(auto-fit,minmax(168px,1fr));
}
.rp-features li{
  display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:12px;
  background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);
  font-size:14px;color:#d5dbec;
}
.rp-features b{font-size:16px;font-weight:700}
.rp-g1{color:#5fe8b6}.rp-g2{color:#6fc0ff}.rp-g3{color:#ffdf70}.rp-g4{color:#ff8a70}
.rp-note{margin:0;text-align:center;color:#6f7791;font-size:13px;line-height:1.8}
.rp-note a{color:#8fb6ff}
@media (max-width:560px){body{padding:28px 16px 48px}.rp-shell{gap:22px}}
@media (prefers-reduced-motion:reduce){.rp-cta{transition:none}.rp-cta:hover{transform:none}}
</style>
</head>
<body>
<div class="rp-shell">
  <a class="rp-brand" href="/">TYPE <span>BURST</span></a>

  <div class="rp-card">
    <img src="${imageUrl}" width="1200" height="630" alt="${title}" />
  </div>

  <h1 class="rp-headline">${title}</h1>
  <p class="rp-lede">
    TYPE BURST は、日本語をローマ字で打ち切るとブロックが爆発し、同じ属性が4つ以上つながると連鎖する
    タイピング×連鎖パズルです。速さだけでは勝てません。
  </p>

  <a class="rp-cta" href="/">この記録に挑戦する<small>無料・登録不要</small></a>

  <ul class="rp-features">
    <li><b class="rp-g1">◆</b>4段階の難易度</li>
    <li><b class="rp-g2">●</b>毎日のチャレンジ</li>
    <li><b class="rp-g3">★</b>苦手キーの分析</li>
    <li><b class="rp-g4">▲</b>世界ランキング</li>
  </ul>

  <p class="rp-note">
    プレイには物理キーボードが必要です。スマートフォンでご覧の場合は、PCでのアクセスをおすすめします。<br />
    <a href="/about.html">ゲームの詳しい紹介を見る</a>
  </p>
</div>
</body>
</html>`;
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
