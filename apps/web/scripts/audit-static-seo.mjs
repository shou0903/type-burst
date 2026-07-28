import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const origin = "https://type-burst.com";
const failures = [];
const indexableTitles = new Map();
const indexableDescriptions = new Map();
const sitemapExpected = new Set();
const internalLinkSources = new Map();

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
  if (urlPath === "/tools/typing-speed-test.html") return join(appRoot, "tools", "typing-speed-test.html");
  if (urlPath.startsWith("/src/")) return join(appRoot, urlPath.slice(1));
  if (urlPath === "/guides" || urlPath === "/guides/") return join(publicRoot, "guides", "index.html");
  if (urlPath === "/tools" || urlPath === "/tools/") return join(publicRoot, "tools", "index.html");
  if (urlPath.startsWith("/api/")) return null;
  return join(publicRoot, decodeURIComponent(urlPath).replace(/^[/\\]+/, ""));
}

const htmlFiles = [
  join(appRoot, "index.html"),
  ...(await listHtmlFiles(publicRoot)),
  join(appRoot, "tools", "typing-speed-test.html"),
];
const canonicals = new Map();
for (const path of htmlFiles) {
  const label = relative(appRoot, path);
  const html = await readFile(path, "utf8");
  const noindex = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim();
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  const h1Count = [...html.matchAll(/<h1(?:\s[^>]*)?>/gi)].length;

  if (!title) failures.push(`${label}: title がありません`);
  if (!description) failures.push(`${label}: meta description がありません`);
  if (!noindex && h1Count !== 1) failures.push(`${label}: h1 は1個必要です (現在 ${h1Count}個)`);
  if (!canonical) {
    failures.push(`${label}: canonical がありません`);
  } else {
    const canonicalUrl = new URL(canonical, origin);
    if (canonicalUrl.origin !== origin) failures.push(`${label}: canonical が外部URLです`);
    if (canonicals.has(canonicalUrl.href)) {
      failures.push(`${label}: canonical が ${canonicals.get(canonicalUrl.href)} と重複しています`);
    }
    canonicals.set(canonicalUrl.href, label);
    const publicPath = relative(publicRoot, path).replaceAll("\\", "/");
    if (
      path === join(appRoot, "index.html") ||
      path === join(appRoot, "tools", "typing-speed-test.html") ||
      publicPath === "about.html" ||
      publicPath === "press.html" ||
      publicPath.startsWith("guides/") ||
      publicPath.startsWith("tools/")
    ) {
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
  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      failures.push(`${label}: JSON-LD が不正です (${error.message})`);
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
const sitemapActual = new Set();
for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  sitemapActual.add(match[1]);
  if (!canonicals.has(match[1])) failures.push(`sitemap.xml: canonical と一致しないURL ${match[1]}`);
}
for (const expected of sitemapExpected) {
  if (!sitemapActual.has(expected)) failures.push(`sitemap.xml: 掲載漏れ ${expected}`);
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
