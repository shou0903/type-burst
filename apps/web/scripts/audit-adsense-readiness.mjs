import { access, constants, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const failures = [];
const longParagraphs = new Map();

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listHtmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  }));
  return nested.flat();
}

function textFromHtml(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(header|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp);/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(html) {
  return [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]);
}

const sourceFiles = [
  join(appRoot, "index.html"),
  ...(await listHtmlFiles(publicRoot)),
  ...(await listHtmlFiles(join(appRoot, "tools"))),
  ...(await listHtmlFiles(join(appRoot, "romaji"))),
];

let indexableCount = 0;
for (const path of sourceFiles) {
  const html = await readFile(path, "utf8");
  const label = relative(appRoot, path).replaceAll("\\", "/");
  const noindex = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  if (noindex) continue;
  indexableCount += 1;

  const contentLength = textFromHtml(html).length;
  const minimum = label === "index.html" ? 1_100 : 900;
  if (contentLength < minimum) {
    failures.push(`${label}: 本文量が不足しています (${contentLength}/${minimum}文字)`);
  }

  const links = hrefs(html);
  if (!links.some((href) => href === "/" || href.startsWith("/?"))) {
    failures.push(`${label}: ゲーム本体への内部リンクがありません`);
  }
  if (!links.some((href) => href === "/guides" || href.startsWith("/guides/"))) {
    failures.push(`${label}: 練習ガイドへの内部リンクがありません`);
  }
  if (!links.some((href) => href === "/tools" || href.startsWith("/tools/"))) {
    failures.push(`${label}: 無料ツールへの内部リンクがありません`);
  }

  for (const match of html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)) {
    const paragraph = textFromHtml(match[1]);
    if (paragraph.length < 160) continue;
    const labels = longParagraphs.get(paragraph) ?? [];
    labels.push(label);
    longParagraphs.set(paragraph, labels);
  }
}

for (const [paragraph, labels] of longParagraphs) {
  if (labels.length >= 3) {
    failures.push(`長文段落が${labels.length}ページで重複しています: ${labels.join(", ")} / ${paragraph.slice(0, 42)}…`);
  }
}

const [indexHtml, privacyHtml, contactHtml, appRootSource, landingSource, adSlotsSource, stylesSource, adsTxt] = await Promise.all([
  readFile(join(appRoot, "index.html"), "utf8"),
  readFile(join(publicRoot, "privacy.html"), "utf8"),
  readFile(join(publicRoot, "contact.html"), "utf8"),
  readFile(join(appRoot, "src", "AppRoot.tsx"), "utf8"),
  readFile(join(appRoot, "src", "screens", "LandingScreen.tsx"), "utf8"),
  readFile(join(appRoot, "src", "components", "AdSlots.tsx"), "utf8"),
  readFile(join(appRoot, "src", "styles.css"), "utf8"),
  readFile(join(publicRoot, "ads.txt"), "utf8"),
]);

for (const required of ["/about.html", "/guides", "/tools", "/contact.html", "/privacy.html"]) {
  if (!indexHtml.includes(`href="${required}"`)) failures.push(`index.html: 主要導線 ${required} がありません`);
}
for (const required of [
  "Cookie",
  "ウェブビーコン",
  "IPアドレス",
  "business.safety.google/privacy/",
  "直近60試合分",
  "ゲーム終了後",
  "45日間",
  "最長1時間",
]) {
  if (!privacyHtml.includes(required)) failures.push(`public/privacy.html: ${required} の開示がありません`);
}
if (!privacyHtml.includes("mailto:typeblast.official@outlook.jp")) failures.push("public/privacy.html: 連絡先がありません");
if (!/noindex,follow/i.test(contactHtml)) failures.push("public/contact.html: noindex,follow が必要です");
if (contactHtml.includes("pagead2.googlesyndication.com")) failures.push("public/contact.html: 操作・連絡ページに広告コードを置かないでください");
if (appRootSource.includes("<AdSlots")) failures.push("src/AppRoot.tsx: 広告枠が全ゲーム画面へ常駐しています");
if (!landingSource.includes("<AdSlots")) failures.push("src/screens/LandingScreen.tsx: 広告枠の表示先が見つかりません");
const minAdWidth = Number(adSlotsSource.match(/MIN_WIDTH_FOR_ADS\s*=\s*(\d+)/)?.[1]);
const adWidth = Number(stylesSource.match(/\.ad-slot\s*\{[\s\S]*?width:\s*(\d+)px/)?.[1]);
const sideOffset = Number(stylesSource.match(/\.ad-slot-left\s*\{[\s\S]*?left:\s*(\d+)px/)?.[1]);
const safeGap = (minAdWidth - 1120) / 2 - adWidth - sideOffset;
if (![minAdWidth, adWidth, sideOffset].every(Number.isFinite) || safeGap < 20) {
  failures.push(`広告と1120px本文の安全余白が不足しています (${Number.isFinite(safeGap) ? safeGap : "計算不能"}px)`);
}
if (!/\.screen\.landing\.lp\s*>\s*\.ad-slot\s*\{[\s\S]*?position:\s*fixed/.test(stylesSource)) {
  failures.push("src/styles.css: ホーム直下要素の共通position指定から広告の固定配置を保護できていません");
}
if (adsTxt.trim() !== "google.com, pub-5471900652537950, DIRECT, f08c47fec0942fa0") failures.push("public/ads.txt: AdSense販売者情報が不正です");

try {
  await access(join(publicRoot, "contact.html"), constants.R_OK);
} catch {
  failures.push("public/contact.html: お問い合わせページがありません");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`AdSense準備監査: ${indexableCount} indexable HTML / 本文・導線・信頼情報・広告範囲にエラーなし`);
}
