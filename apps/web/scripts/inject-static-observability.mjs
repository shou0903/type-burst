import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(appRoot, "dist");
const snippet = `    <script>
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    </script>
    <script defer src="/_vercel/insights/script.js"></script>
    <script defer src="/_vercel/speed-insights/script.js"></script>
`;

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  }));
  return nested.flat();
}

let injected = 0;
for (const path of await htmlFiles(distRoot)) {
  const html = await readFile(path, "utf8");
  if (html.includes('/_vercel/insights/script.js')) continue;
  if (!html.includes("</head>")) throw new Error(`${path}: </head> がありません`);
  await writeFile(path, html.replace("</head>", `${snippet}  </head>`), "utf8");
  injected += 1;
}

console.log(`静的ページ計測: ${injected} HTML にWeb Analytics / Speed Insightsを追加しました`);
