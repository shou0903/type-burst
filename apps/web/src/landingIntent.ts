export type DailyEntryIntent = "share" | "direct" | null;

/** デイリー共有など、目的が明確な入口では初回導線より2分勝負を優先する。 */
export function parseDailyEntryIntent(search: string): DailyEntryIntent {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "daily") return null;
  return params.get("source") === "share" ? "share" : "direct";
}

/** 通常モードへ戻す際、流入計測以外のURLパラメータは壊さない。 */
export function regularModeUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("mode");
  url.searchParams.delete("source");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}
