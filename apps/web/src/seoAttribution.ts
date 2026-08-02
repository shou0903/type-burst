import { track } from "@vercel/analytics";

const SESSION_KEY = "typeburst.content-source.v1";

function normalized(value: string | null): string | null {
  if (!value) return null;
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
  return safe || null;
}

function referrerSource(): string | null {
  if (!document.referrer) return null;
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

export function captureContentAttribution(): void {
  const params = new URLSearchParams(window.location.search);
  const guide = normalized(params.get("guide"));
  const source =
    normalized(params.get("source")) ??
    normalized(params.get("utm_source")) ??
    (guide ? `guide-${guide}` : null) ??
    referrerSource();
  if (!source) return;

  try {
    window.sessionStorage.setItem(SESSION_KEY, source);
  } catch {
    // sessionStorage が使えなくても、ゲーム本編と計測を止めない。
  }
  track("Content Entry", { source, path: window.location.pathname });
}

export function trackAttributedGameStart(mode: string): void {
  let source = "direct";
  try {
    source = window.sessionStorage.getItem(SESSION_KEY) ?? source;
  } catch {
    // 保存できない環境は direct として匿名集計する。
  }
  track("Game Started", { mode, source });
}

/**
 * 匿名の導線イベント。個人を特定する値・入力内容・スコアは送らず、
 * 画面改善に必要な大まかな行動だけを集計する。
 */
export function trackFunnelEvent(
  name: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  try {
    track(name, properties);
  } catch {
    // 計測サービスが利用できなくてもゲームを止めない。
  }
}
