import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const MIN_SCALE = 0.55;

/**
 * コンテンツがビューポートより大きい場合、はみ出さないよう縮小する。
 * ブックマークバー表示などでウィンドウの実効高さが減っても、画面上部が
 * 到達不能にならないようにするための対策(中央寄せ+overflow:hiddenの組み
 * 合わせは、上方向へのはみ出しがドキュメント座標マイナスとなりスクロール
 * しても永久に見えなくなるため)。
 */
interface FitToViewportOptions {
  /**
   * コンテンツ自身の高さ変化でも縮尺を更新するか。ゲーム画面ではHUDの数値や
   * 演出表示で全体が脈打たないようfalseにし、実ビューポート変更だけを追う。
   */
  observeContent?: boolean;
}

export function useFitToViewport<T extends HTMLElement>(
  { observeContent = true }: FitToViewportOptions = {},
): {
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

    // 通常画面では内容とdocumentElementも監視する。プレイ中だけはHUDの表示内容が
    // 変わるたびに盤面まで拡大縮小されないよう、実際のビューポート変更だけを追う。
    const ro = observeContent ? new ResizeObserver(recompute) : null;
    ro?.observe(el);
    ro?.observe(document.documentElement);
    window.addEventListener("resize", recompute);
    window.visualViewport?.addEventListener("resize", recompute);
    const intervalId = observeContent ? window.setInterval(recompute, 500) : null;
    recompute();
    // Canvasの論理サイズ設定や最初のsnapshot公開はuseEffectで行われるため、
    // 内容監視を止める画面でも次フレームに一度だけ完成後の寸法を取り直す。
    const initialFrameId = window.requestAnimationFrame(recompute);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", recompute);
      window.visualViewport?.removeEventListener("resize", recompute);
      if (intervalId !== null) window.clearInterval(intervalId);
      window.cancelAnimationFrame(initialFrameId);
    };
  }, [observeContent]);

  return { ref, style };
}
