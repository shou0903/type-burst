import { useEffect, useState } from "react";
import { AttractBoard } from "./AttractBoard";
import { MobileRankingPreview } from "./MobileRankingPreview";

type CopyState = "idle" | "copied" | "error";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (): void => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/** navigator.clipboard が使えない環境向けのフォールバック(古いWebView等) */
function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * TikTok等からのモバイル流入向けランディングページ(D-057)。
 * ゲーム自体はPC専用(物理キーボード前提)のため、モバイル訪問者を
 * そのまま案内なしで弾いていた従来の`narrow-guard`(SmallScreenGuard.tsx)を
 * 置き換える。目的はモバイルでの離脱を防ぎ、後日PCで遊んでもらうこと。
 */
export function MobileLanding(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [rankingOpen, setRankingOpen] = useState(false);
  const shareSupported = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (copyState === "idle") return;
    const id = window.setTimeout(() => setCopyState("idle"), 2200);
    return () => window.clearTimeout(id);
  }, [copyState]);

  const handleCopy = async (): Promise<void> => {
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopyState("copied");
      } else if (legacyCopy(url)) {
        setCopyState("copied");
      } else {
        setCopyState("error");
      }
    } catch {
      setCopyState(legacyCopy(url) ? "copied" : "error");
    }
  };

  const handleShare = async (): Promise<void> => {
    try {
      await navigator.share({
        title: "TYPE BURST",
        text: "日本語を打ってブロックを爆破する連鎖パズル「TYPE BURST」。PCで無料・登録不要で遊べます。",
        url: window.location.href,
      });
    } catch {
      // ユーザーによる共有キャンセル等は無視してよい
    }
  };

  const copyLabel =
    copyState === "copied" ? "コピーしました!" : copyState === "error" ? "コピーできませんでした" : "URLをコピー";

  return (
    <div className="mobile-landing">
      <div className="mobile-landing-hero">
        <h1 className="mobile-landing-logo">
          TYPE <span className="mobile-landing-burst">BURST</span>
        </h1>
        <p className="mobile-landing-hook">
          TYPE BURST（タイプバースト）は、速さだけじゃなく<strong>「どこを消すか」</strong>で勝負する
          <br />
          タイピング×連鎖パズル
        </p>
      </div>

      <div className="mobile-landing-demo-wrap">
        <AttractBoard reducedMotion={reducedMotion} />
        <p className="mobile-landing-demo-caption">実際のゲーム画面(自動プレイ中)</p>
      </div>

      <div className="mobile-landing-badges">
        <span className="mobile-landing-badge">完全無料</span>
        <span className="mobile-landing-badge">登録不要</span>
        <span className="mobile-landing-badge">ブラウザですぐ遊べる</span>
      </div>

      <p className="mobile-landing-note">
        このゲームは物理キーボードでのローマ字入力が前提のため、現在はPCブラウザのみに対応しています。
      </p>

      <div className="mobile-landing-cta">
        <button className="mobile-landing-btn mobile-landing-btn-primary" onClick={handleCopy}>
          {copyLabel}
        </button>
        {shareSupported && (
          <button className="mobile-landing-btn mobile-landing-btn-secondary" onClick={handleShare}>
            自分に送る(LINEなど)
          </button>
        )}
      </div>
      <p className="mobile-landing-cta-hint">このURLをPCのブラウザで開けば、今すぐ遊べます。</p>

      <button
        className="mobile-landing-ranking-toggle"
        onClick={() => setRankingOpen((open) => !open)}
        aria-expanded={rankingOpen}
      >
        {rankingOpen ? "世界ランキングを閉じる ▲" : "🏆 世界ランキングを見る ▼"}
      </button>
      {rankingOpen && <MobileRankingPreview />}

      <div className="mobile-landing-footer">
        <a href="/about.html">TYPE BURSTとは</a>
        <span aria-hidden="true">・</span>
        <a href="/terms.html" target="_blank" rel="noreferrer">
          利用規約
        </a>
        <span aria-hidden="true">・</span>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          プライバシーポリシー
        </a>
      </div>
    </div>
  );
}
