import { track } from "@vercel/analytics";
import { isBehaviorTelemetryEnabled } from "./behaviorTelemetry";

const SESSION_KEY = "typeburst.content-source.v1";
const CONTENT_ENTRY_KEY = "typeburst.content-entry.v1";
const MAX_EVENT_PROPERTIES = 2;
const ALLOWED_EVENT_PROPERTIES = new Set([
  "mode",
  "difficulty",
  "firstPlay",
  "source",
  "path",
  "action",
]);

type FunnelValue = string | number | boolean;
type FunnelEventName =
  | "Content Entry"
  | "Game Started"
  | "Game Finished"
  | "Tutorial Completed"
  | "Result Action"
  | "Share Action";

function normalized(value: string | null): string | null {
  if (!value) return null;
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
  return safe || null;
}

function coarseSource(value: string | null): string {
  const source = normalized(value);
  if (!source) return "direct";
  if (source === "google-organic" || source === "bing-organic" || source === "yahoo-organic") {
    return source;
  }
  if (source.startsWith("guide-")) return "guide";
  if (["social", "share", "newsletter", "direct"].includes(source)) return source;
  return "other";
}

function coarsePath(pathname: string): string {
  if (["home", "about", "guide", "tool", "romaji", "other"].includes(pathname)) {
    return pathname;
  }
  if (pathname === "/" || pathname === "") return "home";
  if (pathname === "/about.html" || pathname === "/press.html") return "about";
  if (pathname.startsWith("/guides")) return "guide";
  if (pathname.startsWith("/tools")) return "tool";
  if (pathname.startsWith("/romaji")) return "romaji";
  return "other";
}

function coarseValue(key: string, value: FunnelValue): FunnelValue | null {
  if (key === "source") return typeof value === "string" ? coarseSource(value) : null;
  if (key === "path") return typeof value === "string" ? coarsePath(value) : null;
  if (key === "mode") {
    return typeof value === "string" && ["survival", "daily", "duel", "tutorial"].includes(value)
      ? value
      : null;
  }
  if (key === "difficulty") {
    return typeof value === "string" && ["easy", "normal", "hard", "god"].includes(value)
      ? value
      : null;
  }
  if (key === "action") {
    return typeof value === "string" && ["retry", "analysis", "open"].includes(value)
      ? value
      : null;
  }
  if (key === "firstPlay") return typeof value === "boolean" ? value : null;
  return null;
}

function referrerSource(): string | null {
  if (typeof document === "undefined" || !document.referrer) return null;
  try {
    const hostname = new URL(document.referrer).hostname.toLowerCase();
    if (hostname.includes("google.")) return "google-organic";
    if (hostname.includes("bing.com")) return "bing-organic";
    if (hostname.includes("yahoo.")) return "yahoo-organic";
  } catch {
    return null;
  }
  return null;
}

function sessionValue(key: string): string | null {
  try {
    if (typeof window !== "undefined") return window.sessionStorage.getItem(key);
  } catch {
    // sessionStorage が使えない環境では、呼び出し元のメモリフォールバックを使う。
  }
  return null;
}

function setSessionValue(key: string, value: string): boolean {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(key, value);
      return true;
    }
  } catch {
    // sessionStorage が使えなくても計測とゲーム本編は止めない。
  }
  return false;
}

function currentSource(): string {
  return coarseSource(sessionValue(SESSION_KEY));
}

/**
 * Vercel Analytics のカスタムイベントを安全に送る共通窓口。
 * プランごとのプロパティ上限を超えないよう最大2個に固定し、許可した
 * 粗い導線属性以外（playerId、ニックネーム、入力内容、スコア等）は捨てる。
 */
export function trackFunnelEvent(
  name: FunnelEventName,
  properties: Record<string, FunnelValue> = {},
): void {
  if (!isBehaviorTelemetryEnabled()) return;
  const safeProperties = Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => ALLOWED_EVENT_PROPERTIES.has(key))
      .map(([key, value]) => [key, coarseValue(key, value)] as const)
      .filter((entry): entry is readonly [string, FunnelValue] => entry[1] !== null)
      .slice(0, MAX_EVENT_PROPERTIES),
  );

  try {
    track(name, safeProperties);
  } catch {
    // 計測サービスの失敗はゲームを止めない。
  }
}

/**
 * 検索・記事経由の匿名導線をセッション単位で保持する。
 * source/path は低カーディナリティへ丸め、同じ組み合わせを1回だけ送る。
 */
export function captureContentAttribution(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const guide = normalized(params.get("guide"));
  const rawSource =
    normalized(params.get("source")) ??
    normalized(params.get("utm_source")) ??
    (guide ? `guide-${guide}` : null) ??
    referrerSource();
  // タイトルへ戻った時など、新しい参照元がない再描画では既存セッションの
  // 流入元をdirectで上書きしない。初回の完全なdirectは未保存のままでよい。
  if (rawSource) setSessionValue(SESSION_KEY, coarseSource(rawSource));
}

function contentEntryMarker(source: string, path: string): string {
  return `${CONTENT_ENTRY_KEY}:${source}:${path}`;
}

let contentEntriesInMemory = new Set<string>();

/** ランディング到達はStrictModeやタイトルへの戻りで重複させず、1セッション1回だけ送る。 */
export function trackLandingView(): void {
  // Reactのpassive effectは子から親へ実行される場合がある。AppRoot側の
  // captureを待つと初回だけdirectへ誤分類し得るため、送信直前にも同期する。
  captureContentAttribution();
  const source = currentSource();
  const path = typeof window === "undefined" ? "home" : coarsePath(window.location.pathname);
  const marker = contentEntryMarker(source, path);
  if (contentEntriesInMemory.has(marker) || sessionValue(marker) === "1") return;
  contentEntriesInMemory.add(marker);
  setSessionValue(marker, "1");
  trackFunnelEvent("Content Entry", { source, path });
}

/** 入口からモード開始までを1イベントにまとめる。 */
export function trackAttributedGameStart(mode: string, firstPlay = false): void {
  if (mode === "tutorial") {
    trackFunnelEvent("Game Started", { mode, firstPlay });
    return;
  }
  trackFunnelEvent("Game Started", { mode, source: currentSource() });
}

/** チュートリアル完了の計測。完了ボタン側で1回だけ呼ぶ。 */
export function trackTutorialCompleted(firstPlay: boolean): void {
  trackFunnelEvent("Tutorial Completed", { firstPlay, source: currentSource() });
}
