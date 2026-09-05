import { useEffect, useRef, useState } from "react";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  drawShareCard,
} from "../share/shareCard";
import type { ShareContent } from "../share/shareContent";
import {
  copyText,
  createShareLink,
  downloadCanvas,
  lineShareUrl,
  shareFallbackUrl,
  xIntentUrl,
  type ShareLink,
} from "../share/shareApi";
import { trackBehaviorEvent } from "../behaviorTelemetry";

/**
 * 共有シート(D-091)。
 *
 * 設計の要点:
 * - 開いた瞬間にカードを描いて見せる。「何が投稿されるか」を先に見せないと
 *   人は共有ボタンを押さない。アップロードの完了は待たせない。
 * - リンク生成に失敗しても、画像の保存とサイトURLの共有は必ずできる。
 *   共有導線が丸ごと死ぬ状態を作らない。
 */

interface Props {
  content: ShareContent;
  mode: "survival" | "daily" | "duel";
  onClose: () => void;
}

type LinkState =
  | { status: "preparing" }
  | { status: "ready"; link: ShareLink }
  | { status: "failed" };

export function ShareSheet({ content, mode, onClose }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [linkState, setLinkState] = useState<LinkState>({ status: "preparing" });
  const [copied, setCopied] = useState<"idle" | "link" | "text">("idle");
  const [saved, setSaved] = useState(false);

  // カードを描いてから、その内容をアップロードする
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawShareCard(canvas, content.card);

    let active = true;
    createShareLink(canvas, content.ogTitle, content.ogDescription, content.targetPath)
      .then((link) => {
        if (!active) return;
        setLinkState({ status: "ready", link });
        trackBehaviorEvent("share_action", { mode, action: "open", status: "success" });
      })
      .catch(() => {
        if (!active) return;
        setLinkState({ status: "failed" });
        trackBehaviorEvent("share_action", { mode, action: "open", status: "error" });
      });
    return () => {
      active = false;
    };
  }, [content, mode]);

  // 開いたら閉じるボタンへフォーカスを移し、Escで閉じられるようにする。
  // リザルト画面側のグローバルキーハンドラへ抜けないよう伝播を止める。
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href]:not([aria-disabled="true"]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    const node = dialogRef.current;
    node?.addEventListener("keydown", handler);
    return () => {
      node?.removeEventListener("keydown", handler);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  const shareUrl =
    linkState.status === "ready" ? linkState.link.url : shareFallbackUrl(content.targetPath);
  const preparing = linkState.status === "preparing";

  const handleCopyLink = async (): Promise<void> => {
    if (await copyText(shareUrl)) {
      setCopied("link");
      trackBehaviorEvent("share_action", { mode, action: "copy_link", status: "success" });
      window.setTimeout(() => setCopied("idle"), 2200);
    } else {
      trackBehaviorEvent("share_action", { mode, action: "copy_link", status: "error" });
    }
  };

  const handleCopyText = async (): Promise<void> => {
    if (await copyText(`${content.text}\n${shareUrl}`)) {
      setCopied("text");
      trackBehaviorEvent("share_action", { mode, action: "copy_text", status: "success" });
      window.setTimeout(() => setCopied("idle"), 2200);
    } else {
      trackBehaviorEvent("share_action", { mode, action: "copy_text", status: "error" });
    }
  };

  const handleSave = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, "type-burst-result.jpg");
    setSaved(true);
    trackBehaviorEvent("share_action", { mode, action: "save_image", status: "success" });
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="sh-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="sh-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sh-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sh-head">
          <div>
            <p className="sh-eyebrow">SHARE YOUR RESULT</p>
            <h2 className="sh-title" id="sh-title">この記録を共有する</h2>
          </div>
          <button className="sh-close" ref={closeRef} onClick={onClose} aria-label="共有を閉じる">
            ✕
          </button>
        </header>

        <div className="sh-preview">
          <canvas
            ref={canvasRef}
            width={SHARE_CARD_WIDTH}
            height={SHARE_CARD_HEIGHT}
            className="sh-canvas"
            aria-label="共有カードのプレビュー"
            role="img"
          />
          <div className={`sh-preview-state${preparing ? " is-visible" : ""}`} aria-hidden={!preparing}>
            <span className="sh-spinner" />
            リンクを準備中…
          </div>
        </div>

        <pre className="sh-text" aria-label="投稿される文面">{content.text}</pre>

        <div className="sh-actions">
          <a
            className={`sh-btn sh-btn-x${preparing ? " is-disabled" : ""}`}
            href={xIntentUrl(content.text, shareUrl)}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={preparing}
            onClick={(event) => {
              if (preparing) {
                event.preventDefault();
                return;
              }
              // Opening the external composer is observable; an actual post is not.
              trackBehaviorEvent("share_action", { mode, action: "x", status: "started" });
            }}
          >
            <span className="sh-btn-glyph" aria-hidden="true">𝕏</span>
            Xに投稿する
          </a>
          <a
            className={`sh-btn sh-btn-line${preparing ? " is-disabled" : ""}`}
            href={lineShareUrl(content.text, shareUrl)}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={preparing}
            onClick={(event) => {
              if (preparing) {
                event.preventDefault();
                return;
              }
              trackBehaviorEvent("share_action", { mode, action: "line", status: "started" });
            }}
          >
            LINEで送る
          </a>
        </div>

        <div className="sh-subactions">
          <button className="sh-sub" onClick={handleSave}>
            {saved ? "保存しました" : "画像を保存"}
          </button>
          <button className="sh-sub" onClick={handleCopyLink} disabled={preparing}>
            {copied === "link" ? "コピーしました" : "リンクをコピー"}
          </button>
          <button className="sh-sub" onClick={handleCopyText} disabled={preparing}>
            {copied === "text" ? "コピーしました" : "文面ごとコピー"}
          </button>
        </div>

        {linkState.status === "failed" && (
          <p className="sh-note sh-note-warn">
            記録カード付きリンクを作成できませんでした。ゲームへのリンクと画像は共有できます。
          </p>
        )}
        {linkState.status === "ready" && (
          <p className="sh-note">
            リンクを開いた人には、このカードがそのまま表示されます。
          </p>
        )}
      </div>
    </div>
  );
}
