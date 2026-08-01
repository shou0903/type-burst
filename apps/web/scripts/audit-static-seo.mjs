import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_APP_PAGES,
  BUNDLED_APP_PATHS,
  BUNDLED_TOOL_PAGES,
  BUNDLED_TOOL_PATHS,
} from "./bundled-seo-pages.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const origin = "https://type-burst.com";
const failures = [];
const indexableTitles = new Map();
const indexableDescriptions = new Map();
const sitemapExpected = new Set();
const internalLinkSources = new Map();
const sitemapImageExpected = new Set();
const adsenseAccount = "ca-pub-5471900652537950";

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listHtmlFiles(path);
      return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
    }),
  );
  return nested.flat();
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function localTarget(urlPath) {
  if (urlPath === "/") return join(appRoot, "index.html");
  if (BUNDLED_TOOL_PATHS.includes(urlPath)) {
    return join(appRoot, "tools", urlPath.slice("/tools/".length));
  }
  if (BUNDLED_APP_PATHS.includes(urlPath)) {
    return join(appRoot, BUNDLED_APP_PAGES[BUNDLED_APP_PATHS.indexOf(urlPath)] ?? "");
  }
  if (urlPath.startsWith("/src/")) return join(appRoot, urlPath.slice(1));
  if (urlPath === "/guides" || urlPath === "/guides/") return join(publicRoot, "guides", "index.html");
  if (urlPath === "/tools" || urlPath === "/tools/") return join(publicRoot, "tools", "index.html");
  if (urlPath.startsWith("/api/")) return null;
  return join(publicRoot, decodeURIComponent(urlPath).replace(/^[/\\]+/, ""));
}

const bundledToolPaths = new Set(BUNDLED_TOOL_PAGES.map((name) => join(appRoot, "tools", name)));
const bundledAppPaths = new Set(BUNDLED_APP_PAGES.map((name) => join(appRoot, name)));
const htmlFiles = [
  join(appRoot, "index.html"),
  ...(await listHtmlFiles(publicRoot)),
  ...BUNDLED_TOOL_PAGES.map((name) => join(appRoot, "tools", name)),
  ...BUNDLED_APP_PAGES.map((name) => join(appRoot, name)),
];
const canonicals = new Map();
for (const path of htmlFiles) {
  const label = relative(appRoot, path);
  const html = await readFile(path, "utf8");
  const publicPath = relative(publicRoot, path).replaceAll("\\", "/");
  const includedInSitemap =
    path === join(appRoot, "index.html") ||
    bundledToolPaths.has(path) ||
    bundledAppPaths.has(path) ||
    publicPath === "about.html" ||
    publicPath === "press.html" ||
    publicPath.startsWith("guides/") ||
    publicPath.startsWith("tools/");
  const monetizedPage =
    path === join(appRoot, "index.html") ||
    bundledToolPaths.has(path) ||
    bundledAppPaths.has(path) ||
    publicPath === "about.html" ||
    (publicPath.startsWith("guides/") && publicPath !== "guides/editorial-policy.html") ||
    publicPath.startsWith("tools/");
  const noindex = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const htmlLang = html.match(/<html\s+[^>]*lang=["']([^"']+)["']/i)?.[1];
  const viewport = html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i)?.[1];
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1];
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim();
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  const h1Count = [...html.matchAll(/<h1(?:\s[^>]*)?>/gi)].length;
  const ogType = html.match(/<meta\s+property=["']og:type["']\s+content=["']([^"']+)["']/i)?.[1];
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
  const ogDescription = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1];
  const ogUrl = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i)?.[1];
  const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
  const twitterCard = html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']+)["']/i)?.[1];

  if (monetizedPage) {
    const accountTags = [
      ...html.matchAll(/<meta\s+name=["']google-adsense-account["']\s+content=["']([^"']+)["'][^>]*>/gi),
    ];
    const adsenseScripts = [
      ...html.matchAll(
        /<script\s+[^>]*src=["']https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=([^"']+)["'][^>]*>/gi,
      ),
    ];
    if (accountTags.length !== 1 || accountTags[0]?.[1] !== adsenseAccount) {
      failures.push(`${label}: AdSenseアカウントメタタグが正しくありません`);
    }
    if (adsenseScripts.length !== 1 || adsenseScripts[0]?.[1] !== adsenseAccount) {
      failures.push(`${label}: AdSenseコードがhead内に1つ必要です`);
    }
  }

  if (!title) failures.push(`${label}: title がありません`);
  if (!description) failures.push(`${label}: meta description がありません`);
  if (!noindex && htmlLang !== "ja") failures.push(`${label}: html lang="ja" が必要です`);
  if (!noindex && !viewport?.includes("width=device-width")) {
    failures.push(`${label}: モバイル向けviewportが必要です`);
  }
  if (!noindex && includedInSitemap && !robots?.includes("index")) {
    failures.push(`${label}: sitemap掲載ページにはindex指定が必要です`);
  }
  if (!noindex && title && ([...title].length < 15 || [...title].length > 60)) {
    failures.push(`${label}: titleは15〜60文字を目安にしてください (現在 ${[...title].length}文字)`);
  }
  if (!noindex && description && ([...description].length < 50 || [...description].length > 160)) {
    failures.push(`${label}: meta descriptionは50〜160文字を目安にしてください (現在 ${[...description].length}文字)`);
  }
  if (!noindex && h1Count !== 1) failures.push(`${label}: h1 は1個必要です (現在 ${h1Count}個)`);
  if (!noindex && includedInSitemap && !ogType) failures.push(`${label}: og:type がありません`);
  if (!noindex && includedInSitemap && !ogTitle) failures.push(`${label}: og:title がありません`);
  if (!noindex && includedInSitemap && !ogDescription) failures.push(`${label}: og:description がありません`);
  if (!noindex && includedInSitemap && !ogUrl) failures.push(`${label}: og:url がありません`);
  if (!noindex && includedInSitemap && !ogImage) failures.push(`${label}: og:image がありません`);
  if (!noindex && includedInSitemap && !twitterCard) failures.push(`${label}: twitter:card がありません`);
  if (!canonical) {
    failures.push(`${label}: canonical がありません`);
  } else {
    const canonicalUrl = new URL(canonical, origin);
    if (canonicalUrl.origin !== origin) failures.push(`${label}: canonical が外部URLです`);
    if (canonicalUrl.protocol !== "https:" || canonicalUrl.search || canonicalUrl.hash) {
      failures.push(`${label}: canonicalはHTTPSの正規URL（クエリ・フラグメントなし）にしてください`);
    }
    if (canonicals.has(canonicalUrl.href)) {
      failures.push(`${label}: canonical が ${canonicals.get(canonicalUrl.href)} と重複しています`);
    }
    canonicals.set(canonicalUrl.href, label);
    if (ogUrl && new URL(ogUrl, origin).href !== canonicalUrl.href) {
      failures.push(`${label}: og:url が canonical と一致しません`);
    }
    if (includedInSitemap) {
      sitemapExpected.add(canonicalUrl.href);
    }
  }

  if (!noindex && title) {
    if (indexableTitles.has(title)) failures.push(`${label}: title が ${indexableTitles.get(title)} と重複しています`);
    indexableTitles.set(title, label);
  }
  if (!noindex && description) {
    if (indexableDescriptions.has(description)) {
      failures.push(`${label}: meta description が ${indexableDescriptions.get(description)} と重複しています`);
    }
    indexableDescriptions.set(description, label);
  }

  const seenIds = new Set();
  for (const match of html.matchAll(/\sid=["']([^"']+)["']/gi)) {
    if (seenIds.has(match[1])) failures.push(`${label}: id="${match[1]}" が重複しています`);
    seenIds.add(match[1]);
  }
  for (const match of html.matchAll(/href=["']#([^"']+)["']/gi)) {
    if (!seenIds.has(match[1])) failures.push(`${label}: ページ内リンク #${match[1]} の移動先がありません`);
  }

  const jsonLdPattern = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;
  const structuredItems = [];
  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      structuredItems.push(...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed]));
    } catch (error) {
      failures.push(`${label}: JSON-LD が不正です (${error.message})`);
    }
  }
  if (ogType === "article") {
    const article = structuredItems.find((item) =>
      ["Article", "BlogPosting", "NewsArticle"].includes(item?.["@type"]),
    );
    if (!article) {
      failures.push(`${label}: Article構造化データがありません`);
    } else {
      for (const property of ["headline", "image", "datePublished", "dateModified", "mainEntityOfPage", "author"]) {
        if (!article[property]) failures.push(`${label}: Article.${property} がありません`);
      }
      if (!article.author?.name || !article.author?.url) {
        failures.push(`${label}: Article.author の name/url が不足しています`);
      }
      if (!article.publisher) failures.push(`${label}: Article.publisher がありません`);
      if (
        canonical &&
        article.mainEntityOfPage &&
        new URL(article.mainEntityOfPage, origin).href !== new URL(canonical, origin).href
      ) {
        failures.push(`${label}: Article.mainEntityOfPageがcanonicalと一致しません`);
      }
    }
    if (!structuredItems.some((item) => item?.["@type"] === "BreadcrumbList")) {
      failures.push(`${label}: BreadcrumbList構造化データがありません`);
    }
    if (!/<nav\s+class=["'][^"']*\bbreadcrumb\b/i.test(html)) {
      failures.push(`${label}: 表示用パンくずがありません`);
    }
    if (!/class=["'][^"']*\bauthor-box\b/i.test(html)) failures.push(`${label}: 表示用の著者情報がありません`);
  }
  if (path === join(appRoot, "index.html")) {
    const website = structuredItems.find((item) => item?.["@type"] === "WebSite");
    const organization = structuredItems.find((item) => item?.["@type"] === "Organization");
    if (!website?.name || !website?.url || !website?.alternateName) {
      failures.push(`${label}: WebSite の name/url/alternateName が不足しています`);
    }
    if (!organization?.name || !organization?.url || !organization?.logo) {
      failures.push(`${label}: Organization の name/url/logo が不足しています`);
    }
    const game = structuredItems.find((item) => {
      const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
      return types.includes("WebApplication") || types.includes("SoftwareApplication");
    });
    const gameTypes = Array.isArray(game?.["@type"]) ? game["@type"] : [game?.["@type"]];
    if (!gameTypes.includes("WebApplication") || !gameTypes.includes("VideoGame")) {
      failures.push(`${label}: ゲームはWebApplicationとVideoGameの両方で構造化してください`);
    }
    if (game?.offers?.price !== "0" || !game?.operatingSystem) {
      failures.push(`${label}: 無料Webゲームのoffers/operatingSystemが不足しています`);
    }
  }
  if (canonical && [`${origin}/guides`, `${origin}/tools`].includes(new URL(canonical, origin).href)) {
    const collection = structuredItems.find((item) => item?.["@type"] === "CollectionPage");
    const itemList = structuredItems.find((item) => item?.["@type"] === "ItemList");
    if (!collection?.name || !collection?.url) failures.push(`${label}: CollectionPage が不足しています`);
    if (!Array.isArray(itemList?.itemListElement) || itemList.itemListElement.length === 0) {
      failures.push(`${label}: ItemList が不足しています`);
    } else {
      itemList.itemListElement.forEach((item, index) => {
        if (item?.position !== index + 1 || !item?.url || !item?.name) {
          failures.push(`${label}: ItemList ${index + 1}件目の position/url/name が不正です`);
        }
      });
    }
  }
  if (
    canonical &&
    (new URL(canonical, origin).pathname.startsWith("/tools/") || new URL(canonical, origin).pathname === "/romaji") &&
    !noindex
  ) {
    const app = structuredItems.find((item) => item?.["@type"] === "WebApplication");
    if (!app?.name || !app?.url || !app?.operatingSystem || !app?.isAccessibleForFree) {
      failures.push(`${label}: WebApplicationのname/url/operatingSystem/isAccessibleForFreeが不足しています`);
    }
    if (app?.offers?.price !== "0") {
      failures.push(`${label}: 無料ツールのWebApplication.offers.priceは"0"にしてください`);
    }
    if (!structuredItems.some((item) => item?.["@type"] === "BreadcrumbList")) {
      failures.push(`${label}: ツールページにBreadcrumbList構造化データがありません`);
    }
    if (!/class=["'][^"']*\bbreadcrumb\b/i.test(html)) {
      failures.push(`${label}: ツールページに表示用パンくずがありません`);
    }
  }
  if (publicPath === "press.html") {
    const imageObjects = structuredItems.filter((item) => item?.["@type"] === "ImageObject");
    if (imageObjects.length < 5) failures.push(`${label}: 配布画像のImageObjectが不足しています`);
    for (const image of imageObjects) {
      for (const property of ["contentUrl", "license", "acquireLicensePage", "creator"]) {
        if (!image[property]) failures.push(`${label}: ImageObject.${property} がありません`);
      }
    }
  }
  if (ogImage) {
    const imageUrl = new URL(ogImage, origin);
    if (imageUrl.origin === origin) {
      const target = localTarget(imageUrl.pathname);
      if (target && !(await exists(target))) failures.push(`${label}: og:image がありません ${ogImage}`);
    }
  }

  for (const match of html.matchAll(/<img\s[^>]*>/gi)) {
    const imageTag = match[0];
    if (!/\salt=["'][^"']*["']/i.test(imageTag)) failures.push(`${label}: alt のない画像があります`);
    if (!/\swidth=["']\d+["']/i.test(imageTag) || !/\sheight=["']\d+["']/i.test(imageTag)) {
      failures.push(`${label}: width/height のない画像があります`);
    }
    const source = imageTag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!source) continue;
    const imageUrl = new URL(source, origin);
    if (
      imageUrl.origin === origin &&
      (imageUrl.pathname.startsWith("/screenshots/") ||
        imageUrl.pathname.startsWith("/press/images/") ||
        imageUrl.pathname.startsWith("/press/logos/"))
    ) {
      imageUrl.hash = "";
      imageUrl.search = "";
      sitemapImageExpected.add(imageUrl.href);
    }
  }

  const assetPattern = /(?:href|src)=["']([^"'#]+)["']/gi;
  for (const match of html.matchAll(assetPattern)) {
    const value = match[1];
    if (!value.startsWith("/") || value.startsWith("//")) continue;
    const url = new URL(value, origin);
    const target = localTarget(url.pathname);
    if (target && !(await exists(target))) {
      failures.push(`${label}: リンク先がありません ${value}`);
    }
  }

  const linkPattern = /<a\s[^>]*href=["']([^"']+)["']/gi;
  for (const match of html.matchAll(linkPattern)) {
    const value = match[1];
    if (value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:")) continue;
    const url = new URL(value, origin);
    if (url.origin !== origin) continue;
    url.hash = "";
    url.search = "";
    const normalized = url.href.endsWith("/") && url.pathname !== "/" ? url.href.slice(0, -1) : url.href;
    const sources = internalLinkSources.get(normalized) ?? new Set();
    sources.add(label);
    internalLinkSources.set(normalized, sources);
  }
}

const sitemap = await readFile(join(publicRoot, "sitemap.xml"), "utf8");
const adsTxt = (await readFile(join(publicRoot, "ads.txt"), "utf8")).trim();
const vercelConfig = JSON.parse(await readFile(join(appRoot, "vercel.json"), "utf8"));
if (adsTxt !== "google.com, pub-5471900652537950, DIRECT, f08c47fec0942fa0") {
  failures.push("public/ads.txt のパブリッシャー情報が一致しません");
}
for (const [source, destination] of [
  ["/index.html", "/"],
  ["/guides/index.html", "/guides"],
  ["/tools/index.html", "/tools"],
  ["/romaji/index.html", "/romaji"],
]) {
  const redirect = vercelConfig.redirects?.find((item) => item.source === source);
  if (!redirect?.permanent || redirect.destination !== destination) {
    failures.push(`vercel.json: ${source} から ${destination} への恒久リダイレクトが必要です`);
  }
}
const sitemapActual = new Set();
const sitemapImageActual = new Set();
for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  sitemapActual.add(match[1]);
  if (!canonicals.has(match[1])) failures.push(`sitemap.xml: canonical と一致しないURL ${match[1]}`);
}
for (const match of sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)) {
  const imageUrl = new URL(match[1], origin);
  sitemapImageActual.add(imageUrl.href);
  if (imageUrl.origin !== origin) failures.push(`sitemap.xml: 外部画像URL ${imageUrl.href}`);
  const target = localTarget(imageUrl.pathname);
  if (target && !(await exists(target))) failures.push(`sitemap.xml: 画像がありません ${imageUrl.href}`);
}
for (const expected of sitemapExpected) {
  if (!sitemapActual.has(expected)) failures.push(`sitemap.xml: 掲載漏れ ${expected}`);
}
for (const expected of sitemapImageExpected) {
  if (!sitemapImageActual.has(expected)) failures.push(`sitemap.xml: 画像掲載漏れ ${expected}`);
}
for (const actual of sitemapImageActual) {
  if (!sitemapImageExpected.has(actual)) failures.push(`sitemap.xml: 対象外画像 ${actual}`);
}
for (const actual of sitemapActual) {
  if (!sitemapExpected.has(actual)) failures.push(`sitemap.xml: 対象外URL ${actual}`);
}
for (const expected of sitemapExpected) {
  if (expected === `${origin}/`) continue;
  const sources = internalLinkSources.get(expected);
  if (!sources || sources.size === 0) failures.push(`${expected}: 他ページからの内部リンクがありません`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`静的SEO監査: ${htmlFiles.length} HTML / ${canonicals.size} canonical / エラーなし`);
}
