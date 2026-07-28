import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(appRoot, "public");
const host = "type-burst.com";
const key = (await readFile(join(publicRoot, "8d9d462a4c154361bdea1b4c046bfd08.txt"), "utf8")).trim();
const sitemap = await readFile(join(publicRoot, "sitemap.xml"), "utf8");
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

if (urlList.length === 0) throw new Error("IndexNowへ送信するURLがありません");
if (urlList.some((url) => new URL(url).host !== host)) {
  throw new Error("IndexNowへ外部ホストのURLは送信できません");
}

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList,
  }),
});

if (![200, 202].includes(response.status)) {
  throw new Error(`IndexNow送信に失敗しました (HTTP ${response.status})`);
}

console.log(`IndexNow: ${urlList.length} URL を送信しました (HTTP ${response.status})`);
