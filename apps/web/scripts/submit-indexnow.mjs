import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const DEFAULT_ORIGIN = "https://type-burst.com";
const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_REQUEST = 10_000;
const MAX_ATTEMPTS = 3;

function parseArgs(argv) {
  const options = {
    origin: process.env.INDEXNOW_ORIGIN ?? DEFAULT_ORIGIN,
    endpoint: process.env.INDEXNOW_ENDPOINT ?? DEFAULT_ENDPOINT,
    sitemapPath: process.env.INDEXNOW_SITEMAP_PATH ?? join(publicRoot, "sitemap.xml"),
    keyPath: process.env.INDEXNOW_KEY_PATH ?? "",
    since: process.env.INDEXNOW_SINCE ?? "",
    all: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else {
      const [key, inlineValue] = argument.split("=", 2);
      const value = inlineValue ?? argv[++index];
      if (key === "--origin" && value) options.origin = value;
      else if (key === "--endpoint" && value) options.endpoint = value;
      else if (key === "--sitemap" && value) options.sitemapPath = value;
      else if (key === "--key-file" && value) options.keyPath = value;
      else if (key === "--since" && value) options.since = value;
      else if (argument.startsWith("--")) throw new Error(`未対応のオプションです: ${argument}`);
    }
  }
  return options;
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`IndexNowのoriginが不正です: ${value}`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function sitemapUrls(sitemap, origin) {
  const urls = [];
  for (const match of sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const url = new URL(decodeXml(match[1]));
    if (url.origin !== origin.origin || url.search || url.hash) {
      throw new Error(`IndexNowへ送信できないURLがサイトマップにあります: ${url.href}`);
    }
    urls.push(url.href);
  }
  return [...new Set(urls)];
}

async function changedFiles(since) {
  if (!since || /^0+$/.test(since)) return null;
  try {
    const result = await execFileAsync("git", ["diff", "--name-only", `${since}..HEAD`], { cwd: join(appRoot, "..", "..") });
    return result.stdout.split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function changedUrls(files, allUrls) {
  if (!files) return allUrls;
  if (files.length === 0) return [];
  const allPageChanges = files.some((file) =>
    file === "apps/web/index.html" ||
    file === "apps/web/vite.config.ts" ||
    file === "apps/web/vercel.json" ||
    file === "apps/web/public/sitemap.xml" ||
    file.startsWith("apps/web/src/") ||
    file.startsWith("packages/") ||
    file.startsWith("apps/web/scripts/")
  );
  if (allPageChanges) return allUrls;

  const pathToUrl = new Map(allUrls.map((url) => [new URL(url).pathname.replace(/\/$/, ""), url]));
  const matches = new Set();
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    let path = "";
    if (normalized === "apps/web/romaji/index.html") path = "/romaji";
    else if (normalized.startsWith("apps/web/tools/") && normalized.endsWith(".html")) {
      path = `/tools/${normalized.slice("apps/web/tools/".length)}`;
    } else if (normalized.startsWith("apps/web/public/") && normalized.endsWith(".html")) {
      path = `/${normalized.slice("apps/web/public/".length)}`;
    }
    const url = path ? pathToUrl.get(path.replace(/\/$/, "")) : null;
    if (url) matches.add(url);
  }
  return [...matches];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function sendChunk(payload, endpoint) {
  let lastResponse;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "user-agent": "TYPE-BURST-INDEXNOW/1.0" },
      body: JSON.stringify(payload),
    });
    lastResponse = response;
    if ([200, 202].includes(response.status)) return response;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_ATTEMPTS) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
  const detail = lastResponse ? (await lastResponse.text()).slice(0, 300) : "応答なし";
  throw new Error(`IndexNow送信に失敗しました (HTTP ${lastResponse?.status ?? "unknown"}): ${detail}`);
}

function printHelp() {
  console.log(`IndexNow送信\n\n使い方: node scripts/submit-indexnow.mjs [オプション]\n\n  --since COMMIT  変更ファイルから対象URLを絞る (CI向け)\n  --all            サイトマップ内の全URLを送信\n  --dry-run        APIへ送信せず対象URLだけ表示\n  --origin URL     正規ドメイン (既定: https://type-burst.com)\n  --sitemap PATH   サイトマップのローカルパス\n  --key-file PATH  IndexNowキーのファイル\n`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const origin = normalizeOrigin(options.origin);
const endpoint = new URL(options.endpoint);
if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("IndexNow endpointが不正です");
const keyPath = options.keyPath || join(publicRoot, "8d9d462a4c154361bdea1b4c046bfd08.txt");
const key = (await readFile(keyPath, "utf8")).trim();
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error("IndexNowキーの形式が不正です");
const sitemap = await readFile(options.sitemapPath, "utf8");
const allUrls = sitemapUrls(sitemap, origin);
if (allUrls.length === 0) throw new Error("IndexNowへ送信するURLがありません");

const files = options.all ? null : await changedFiles(options.since);
const urls = options.all || options.since ? changedUrls(files, allUrls) : allUrls;
if (urls.length === 0) {
  console.log("IndexNow: 変更された公開URLがないため送信をスキップしました");
  process.exit(0);
}

console.log(`IndexNow: ${urls.length} URLを対象にします${options.dryRun ? " (dry-run)" : ""}`);
if (options.dryRun) {
  console.log(urls.join("\n"));
  process.exit(0);
}

const batches = chunks(urls, MAX_URLS_PER_REQUEST);
for (const [index, batch] of batches.entries()) {
  const response = await sendChunk({
    host: origin.host,
    key,
    keyLocation: `${origin.href}/${key}.txt`,
    urlList: batch,
  }, endpoint.href);
  console.log(`IndexNow: ${index + 1}/${batches.length}件目を送信しました (${batch.length} URL, HTTP ${response.status})`);
}
