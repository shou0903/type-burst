/**
 * Vite のマルチページ入口として apps/web/tools/ に置かれ、
 * public/ ではなくビルド経由で /tools/ へ配信される検索対象ページ。
 *
 * サイトマップ生成と静的SEO監査の両方が同じ一覧を見る必要がある。
 * 以前は両スクリプトに別々のハードコード配列があり、ツールを追加するたび
 * 片方だけ更新して監査が落ちていた(D-092)。追加はこのファイルだけで済ませる。
 *
 * ページを追加したら apps/web/vite.config.ts の rollupOptions.input にも登録すること。
 */
export const BUNDLED_TOOL_PAGES = [
  "sentence-typing-practice.html",
  "typing-speed-test.html",
  "weak-key-practice.html",
  "number-symbol-practice.html",
  "input-method-check.html",
  "typing-workload.html",
];

/** URLパス("/tools/xxx.html")の一覧 */
export const BUNDLED_TOOL_PATHS = BUNDLED_TOOL_PAGES.map((name) => `/tools/${name}`);

/** Viteでバンドルする、tools以外の検索向けアプリページ */
export const BUNDLED_APP_PAGES = ["romaji/index.html"];
export const BUNDLED_APP_PATHS = ["/romaji"];
