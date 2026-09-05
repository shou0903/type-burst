import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(appRoot, "dist");
const snippet = `    <script>
      try {
        if (localStorage.getItem("typeburst.telemetry-enabled.v1") !== "false") {
          window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
          ["/_vercel/insights/script.js", "/_vercel/speed-insights/script.js"].forEach(function (src) {
            var script = document.createElement("script");
            script.defer = true;
            script.src = src;
            document.head.appendChild(script);
          });
          (function () {
            if (location.pathname.indexOf("/admin/") === 0) return;
            var id = function (prefix) {
              return typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
            };
            var pathname = location.pathname.toLowerCase();
            var path = pathname === "/" ? "home"
              : pathname === "/about.html" ? "about"
              : pathname.indexOf("/guides") === 0 ? "guide"
              : pathname.indexOf("/tools") === 0 ? "tool"
              : pathname.indexOf("/romaji") === 0 ? "romaji" : "other";
            // The React application records the home path after attribution capture.
            if (path === "home") return;
            var params = new URLSearchParams(location.search);
            var rawSource = (params.get("source") || params.get("utm_source") || "").toLowerCase();
            if (!rawSource && document.referrer) {
              try {
                var host = new URL(document.referrer).hostname.toLowerCase();
                rawSource = host.indexOf("google.") >= 0 ? "google-organic"
                  : host.indexOf("bing.com") >= 0 ? "bing-organic"
                  : host.indexOf("yahoo.") >= 0 ? "yahoo-organic" : "";
              } catch (_) {}
            }
            var sources = ["direct", "google-organic", "bing-organic", "yahoo-organic", "guide", "social", "share", "newsletter", "news", "other"];
            var source = rawSource.indexOf("guide-") === 0 ? "guide"
              : sources.indexOf(rawSource) >= 0 ? rawSource : rawSource ? "other" : "";
            if (source) sessionStorage.setItem("typeburst.content-source.v1", source);
            source = sessionStorage.getItem("typeburst.content-source.v1") || "direct";
            if (sources.indexOf(source) < 0) source = "other";
            var marker = "typeburst.telemetry-entry.v1:" + source + ":" + path;
            if (sessionStorage.getItem(marker) === "1") return;
            sessionStorage.setItem(marker, "1");
            var sessionId = sessionStorage.getItem("typeburst.telemetry-session.v1") || id("session");
            sessionStorage.setItem("typeburst.telemetry-session.v1", sessionId);
            var eventId = id("evt");
            var body = {
              v: 1,
              batchId: id("batch"),
              sessionId: sessionId,
              events: [{ eventId: eventId, name: "content_entry", properties: { source: source, path: path } }]
            };
            var playerId = localStorage.getItem("typeblast.player-id.v1") || localStorage.getItem("typeblast.daily-player.v1");
            if (playerId) body.playerId = playerId;
            fetch("/api/telemetry", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
              keepalive: true,
              credentials: "same-origin"
            }).catch(function () {});
          })();
        }
      } catch (_) {
        // Storage unavailable: retain the default anonymous, cookieless measurement.
        window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
        ["/_vercel/insights/script.js", "/_vercel/speed-insights/script.js"].forEach(function (src) {
          var script = document.createElement("script");
          script.defer = true;
          script.src = src;
          document.head.appendChild(script);
        });
      }
    </script>
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
