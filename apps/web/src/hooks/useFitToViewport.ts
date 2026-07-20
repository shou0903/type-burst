import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const MIN_SCALE = 0.55;

/**
 * コンテンツがビューポートより大きい場合、はみ出さないよう縮小する。
 * ブックマークバー表示などでウィンドウの実効高さが減っても、画面上部が
 * 到達不能にならないようにするための対策(中央寄せ+overflow:hiddenの組み
 * 合わせは、上方向へのはみ出しがドキュメント座標マイナスとなりスクロール
 * しても永久に見えなくなるため)。
 */
export function useFitToViewport<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  style: CSSProperties;
} {
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const recompute = (): void => {
      // transform は scrollWidth/scrollHeight に影響しないため、
      // 現在のスケールを解除せずそのまま自然サイズとして測定できる。
      const naturalW = el.scrollWidth;
      const naturalH = el.scrollHeight;
      if (naturalW === 0 || naturalH === 0) return;

      const availW = window.innerWidth;
      const availH = window.innerHeight;
      const rawScale = Math.min(1, availW / naturalW, availH / naturalH);
      const scale = Math.max(MIN_SCALE, rawScale);

      setStyle(
        scale < 1
          ? {
              transform: `scale(${scale})`,
              transformOrigin: "top center",
              // スケールで縮んだ分、レイアウト上の予約領域(実寸)を
              // 詰めて不要な余白・スクロールを避ける
              marginBottom: `${(scale - 1) * naturalH}px`,
            }
          : {},
      );
    };

    // 監視対象は2つ必要: el 自体(コンテンツの高さが動的に変わる場合、
    // 例えば対戦中バッジの表示切替)と documentElement(ビューポート自体の
    // サイズ変化。ブックマークバーの表示/非表示切替はコンテンツを一切
    // 変えないため、el だけを監視していると検知できない)。
    // さらに、resize イベントも ResizeObserver も発火しない環境が
    // 稀にあるため、軽量なポーリングを保険として併用する。
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    ro.observe(document.documentElement);
    window.addEventListener("resize", recompute);
    const intervalId = window.setInterval(recompute, 500);
    recompute();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      window.clearInterval(intervalId);
    };
  }, []);

  return { ref, style };
}
