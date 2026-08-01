const DEFAULT_ORIGIN = "https://type-burst.com";
const USER_AGENT = "TYPE-BURST-SEO-AUDIT/1.0 (+https://type-burst.com/)";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    origin: process.env.SEO_ORIGIN ?? DEFAULT_ORIGIN,
    canonicalOrigin: process.env.SEO_CANONICAL_ORIGIN ?? process.env.SEO_ORIGIN ?? DEFAULT_ORIGIN,
    timeoutMs: Number(process.env.SEO_AUDIT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    concurrency: Number(process.env.SEO_AUDIT_CONCURRENCY ?? DEFAULT_CONCURRENCY),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [key, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (key === "--origin" && value) options.origin = value;
    else if (key === "--canonical-origin" && value) options.canonicalOrigin = value;
    else if (key === "--timeout-ms" && value) options.timeoutMs = Number(value);
    else if (key === "--concurrency" && value) options.concurrency = Number(value);
    else if (argument.startsWith("--")) throw new Error(`未対応のオプションです: ${argument}`);
  }
  return options;
}

function normalizeOrigin(value, label) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} は http(s) URL にしてください: ${value}`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} に認証情報・クエリ・ハッシュは指定できません: ${value}`);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.origin;
}

function normalizeUrl(value, baseOrigin) {
  const url = new URL(value, baseOrigin);
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function pageFetchUrl(pageUrl, crawlOrigin) {
  const canonical = new URL(pageUrl);
  return new URL(`${canonical.pathname}${canonical.search}`, crawlOrigin).href;
}

function canonicalFromCrawlUrl(url, crawlOrigin, canonicalOrigin) {
  const parsed = new URL(url, crawlOrigin);
  return normalizeUrl(`${canonicalOrigin}${parsed.pathname}`, canonicalOrigin);
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function extractSitemapUrls(xml, canonicalOrigin) {
  const urls = [];
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const value = decodeXml(match[1]);
    const url = new URL(value);
    if (url.origin !== canonicalOrigin) throw new Error(`サイトマップに正規ドメイン以外のURLがあります: ${url.href}`);
    if (url.search || url.hash) throw new Error(`サイトマップURLにクエリ/ハッシュがあります: ${url.href}`);
    urls.push(normalizeUrl(url.href, canonicalOrigin));
  }
  return urls;
}

async function fetchText(url, { timeoutMs, label, contentTypePattern = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1", "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (response.status !== 200) throw new Error(`${label}: HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentTypePattern && !contentTypePattern.test(contentType)) {
      throw new Error(`${label}: Content-Type が想定外です (${contentType || "未指定"})`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error(`${label}: 応答が大きすぎます (${contentLength} bytes)`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`${label}: 応答が大きすぎます`);
    return { text, response };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label}: ${timeoutMs}ms でタイムアウトしました`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function metaContent(html, name) {
  const pattern = new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  return html.match(pattern)?.[1]?.trim() ?? "";
}

function propertyContent(html, property) {
  const pattern = new RegExp(`<meta\\s+[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  return html.match(pattern)?.[1]?.trim() ?? "";
}

function linkHref(html, rel) {
  const pattern = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*href=["']([^"']+)["'][^>]*>`, "i");
  return html.match(pattern)?.[1]?.trim() ?? "";
}

function hasExpectedCanonical(html, pageUrl, canonicalOrigin) {
  const raw = linkHref(html, "canonical");
  if (!raw) return false;
  try {
    return normalizeUrl(raw, canonicalOrigin) === pageUrl;
  } catch {
    return false;
  }
}

function titleText(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function countH1(html) {
  return [...html.matchAll(/<h1(?:\s[^>]*)?>/gi)].length;
}

function parseStructuredData(html, pageUrl, failures) {
  for (const match of html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      failures.push(`${pageUrl}: JSON-LDを解析できません (${error.message})`);
    }
  }
}

function collectInternalLinks(html, crawlOrigin, canonicalOrigin) {
  const links = new Set();
  for (const match of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const value = match[1];
    if (value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("javascript:")) continue;
    try {
      const parsed = new URL(value, crawlOrigin);
      if (parsed.origin !== crawlOrigin && parsed.origin !== canonicalOrigin) continue;
      links.add(canonicalFromCrawlUrl(parsed.href, crawlOrigin, canonicalOrigin));
    } catch {
      // 静的監査で検出するため、ここでは監査を継続する。
    }
  }
  return links;
}

async function runWorkers(items, concurrency, worker) {
  const results = [];
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

function printHelp() {
  console.log(`本番SEO監査\n\n使い方: node scripts/audit-production-seo.mjs [オプション]\n\n  --origin URL             巡回先 (既定: https://type-burst.com)\n  --canonical-origin URL   canonical/サイトマップの正規ドメイン (既定: origin)\n  --timeout-ms N           1ページのタイムアウト (既定: 15000)\n  --concurrency N          同時巡回数 (既定: 4)\n`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const crawlOrigin = normalizeOrigin(options.origin, "--origin");
const canonicalOrigin = normalizeOrigin(options.canonicalOrigin, "--canonical-origin");
if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error("--timeout-ms は1000以上の整数にしてください");
if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16) throw new Error("--concurrency は1〜16の整数にしてください");

const failures = [];
const warnings = [];
const sitemapUrl = `${crawlOrigin}/sitemap.xml`;
const robotsUrl = `${crawlOrigin}/robots.txt`;
let sitemap;
try {
  sitemap = await fetchText(sitemapUrl, { timeoutMs: options.timeoutMs, label: sitemapUrl, contentTypePattern: /(?:xml|text\/plain)/i });
} catch (error) {
  failures.push(error.message);
}
let robots;
try {
  robots = await fetchText(robotsUrl, { timeoutMs: options.timeoutMs, label: robotsUrl, contentTypePattern: /(?:text\/plain|text\/html)/i });
} catch (error) {
  failures.push(error.message);
}

let sitemapUrls = [];
if (sitemap) {
  try {
    sitemapUrls = extractSitemapUrls(sitemap.text, canonicalOrigin);
  } catch (error) {
    failures.push(error.message);
  }
}
if (sitemapUrls.length === 0) failures.push("サイトマップにURLがありません");
if (sitemapUrls.length !== new Set(sitemapUrls).size) failures.push("サイトマップに重複URLがあります");
sitemapUrls = [...new Set(sitemapUrls)];

if (robots) {
  const expectedSitemapLine = `sitemap: ${canonicalOrigin}/sitemap.xml`;
  if (!robots.text.toLowerCase().includes(expectedSitemapLine)) failures.push(`robots.txt: ${expectedSitemapLine} がありません`);
  if (/disallow:\s*\/$/im.test(robots.text)) failures.push("robots.txt: サイト全体がDisallowになっています");
}

const internalLinkSources = new Map();
const pageResults = await runWorkers(sitemapUrls, options.concurrency, async (pageUrl) => {
  let fetchUrl = pageFetchUrl(pageUrl, crawlOrigin);
  let result;
  try {
    result = await fetchText(fetchUrl, { timeoutMs: options.timeoutMs, label: pageUrl, contentTypePattern: /text\/html/i });
  } catch (error) {
    failures.push(error.message);
    return { pageUrl, ok: false };
  }
  // Vite previewなど、拡張子のない静的ディレクトリを末尾スラッシュへリダイレクトせず
  // SPAフォールバックで返す開発サーバーに限り、正しいindex.htmlも試す。本番では
  // canonical URLそのものを検査するため、このフォールバックは使わない。
  if (
    crawlOrigin !== canonicalOrigin &&
    pageUrl !== `${canonicalOrigin}/` &&
    !pageUrl.endsWith(".html") &&
    !hasExpectedCanonical(result.text, pageUrl, canonicalOrigin)
  ) {
    const slashUrl = `${fetchUrl}/`;
    try {
      const slashResult = await fetchText(slashUrl, { timeoutMs: options.timeoutMs, label: `${pageUrl} (末尾スラッシュ)`, contentTypePattern: /text\/html/i });
      if (hasExpectedCanonical(slashResult.text, pageUrl, canonicalOrigin)) {
        result = slashResult;
        fetchUrl = slashUrl;
      }
    } catch {
      // 元の応答を使ってcanonical不一致として報告する。
    }
  }
  const { response, text: html } = result;
  if (response.url !== fetchUrl) failures.push(`${pageUrl}: リダイレクトされています (${response.url})`);
  if (!/<html\s[^>]*lang=["']ja["']/i.test(html)) failures.push(`${pageUrl}: html lang="ja" がありません`);
  if (!/<meta\s+[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width/i.test(html)) failures.push(`${pageUrl}: モバイルviewportがありません`);
  const robotsMeta = metaContent(html, "robots").toLowerCase();
  const xRobots = response.headers.get("x-robots-tag")?.toLowerCase() ?? "";
  if (robotsMeta.includes("noindex") || xRobots.includes("noindex")) failures.push(`${pageUrl}: noindexになっています`);
  const title = titleText(html);
  const description = metaContent(html, "description");
  if (!title) failures.push(`${pageUrl}: titleがありません`);
  if (!description) failures.push(`${pageUrl}: meta descriptionがありません`);
  if (title && ([...title].length < 15 || [...title].length > 60)) warnings.push(`${pageUrl}: titleの長さが目安外です (${[...title].length}文字)`);
  if (description && ([...description].length < 50 || [...description].length > 160)) warnings.push(`${pageUrl}: descriptionの長さが目安外です (${[...description].length}文字)`);
  const h1 = countH1(html);
  if (h1 !== 1) failures.push(`${pageUrl}: h1は1つ必要です (現在${h1}個)`);
  const canonicalRaw = linkHref(html, "canonical");
  if (!canonicalRaw) failures.push(`${pageUrl}: canonicalがありません`);
  else {
    try {
      const canonical = normalizeUrl(canonicalRaw, canonicalOrigin);
      if (canonical !== pageUrl) failures.push(`${pageUrl}: canonicalがサイトマップURLと一致しません (${canonical})`);
    } catch (error) {
      failures.push(`${pageUrl}: canonicalが不正です (${error.message})`);
    }
  }
  const ogUrl = propertyContent(html, "og:url");
  if (ogUrl) {
    try {
      if (normalizeUrl(ogUrl, canonicalOrigin) !== pageUrl) warnings.push(`${pageUrl}: og:urlがcanonicalと一致しません`);
    } catch {
      warnings.push(`${pageUrl}: og:urlが不正です`);
    }
  }
  parseStructuredData(html, pageUrl, failures);
  for (const target of collectInternalLinks(html, crawlOrigin, canonicalOrigin)) {
    const sources = internalLinkSources.get(target) ?? new Set();
    sources.add(pageUrl);
    internalLinkSources.set(target, sources);
  }
  return { pageUrl, ok: true };
});

for (const pageUrl of sitemapUrls) {
  if (pageUrl === `${canonicalOrigin}/`) continue;
  if (!internalLinkSources.has(pageUrl)) warnings.push(`${pageUrl}: サイトマップ以外からの内部リンクが見つかりません`);
}

const okCount = pageResults.filter((result) => result.ok).length;
console.log(`本番SEO監査: ${okCount}/${sitemapUrls.length}ページ取得成功 / エラー${failures.length}件 / 警告${warnings.length}件`);
if (warnings.length > 0) {
  console.warn("警告:");
  console.warn(warnings.join("\n"));
}
if (failures.length > 0) {
  console.error("エラー:");
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
