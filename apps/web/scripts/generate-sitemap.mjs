import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const siteOrigin = "https://type-burst.com";

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

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function canonicalFrom(html, sourcePath) {
  const match = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (!match) throw new Error(`canonical がありません: ${relative(appRoot, sourcePath)}`);
  const url = new URL(match[1], siteOrigin);
  if (url.origin !== siteOrigin) {
    throw new Error(`外部 canonical はサイトマップへ追加できません: ${url.href}`);
  }
  url.hash = "";
  return url.href;
}

function lastModifiedFrom(html) {
  const jsonLd = html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  const meta = html.match(
    /<meta\s+property=["']article:modified_time["']\s+content=["'](\d{4}-\d{2}-\d{2})/i,
  );
  return jsonLd?.[1] ?? meta?.[1] ?? null;
}

const indexPath = join(appRoot, "index.html");
const bundledSeoPages = [join(appRoot, "tools", "typing-speed-test.html")];
const publicHtml = await listHtmlFiles(publicRoot);
const searchLandingFiles = publicHtml.filter((path) => {
  const pathFromPublic = relative(publicRoot, path).replaceAll("\\", "/");
  return (
    pathFromPublic === "about.html" ||
    pathFromPublic === "press.html" ||
    pathFromPublic.startsWith("guides/") ||
    pathFromPublic.startsWith("tools/")
  );
});

const pages = [];
for (const sourcePath of [indexPath, ...searchLandingFiles, ...bundledSeoPages]) {
  const html = await readFile(sourcePath, "utf8");
  if (/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) continue;
  pages.push({
    loc: canonicalFrom(html, sourcePath),
    lastmod: lastModifiedFrom(html),
  });
}

const uniquePages = [...new Map(pages.map((page) => [page.loc, page])).values()].sort((a, b) => {
  if (a.loc === `${siteOrigin}/`) return -1;
  if (b.loc === `${siteOrigin}/`) return 1;
  return a.loc.localeCompare(b.loc, "ja");
});

const body = uniquePages
  .map(
    ({ loc, lastmod }) =>
      `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`,
  )
  .join("\n");

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
await writeFile(join(publicRoot, "sitemap.xml"), sitemap, "utf8");
console.log(`sitemap.xml: ${uniquePages.length} URL を生成しました`);
