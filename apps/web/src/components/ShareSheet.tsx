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
  xIntentUrl,
  type ShareLink,
} from "../share/shareApi";

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
  onClose: () => void;
}

type LinkState =
  | { status: "preparing" }
  | { status: "ready"; link: ShareLink }
  | { status: "failed" };

const SITE_URL = "https://type-burst.com/";

export function ShareSheet({ content, onClose }: Props): JSX.Element {
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
    createShareLink(canvas, content.ogTitle, content.ogDescription)
      .then((link) => active && setLinkState({ status: "ready", link }))
      .catch(() => active && setLinkState({ status: "failed" }));
    return () => {
      active = false;
    };
  }, [content]);

  // 開いたら閉じるボタンへフォーカスを移し、Escで閉じられるようにする。
  // リザルト画面側のグローバルキーハンドラへ抜けないよう伝播を止める。
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const node = dialogRef.current;
    node?.addEventListener("keydown", handler);
    return () => {
      node?.removeEventListener("keydown", handler);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  const shareUrl = linkState.status === "ready" ? linkState.link.url : SITE_URL;
  const preparing = linkState.status === "preparing";

  const handleCopyLink = async (): Promise<void> => {
    if (await copyText(shareUrl)) {
      setCopied("link");
      window.setTimeout(() => setCopied("idle"), 2200);
    }
  };

  const handleCopyText = async (): Promise<void> => {
    if (await copyText(`${content.text}\n${shareUrl}`)) {
      setCopied("text");
      window.setTimeout(() => setCopied("idle"), 2200);
    }
  };

  const handleSave = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, "type-burst-result.jpg");
    setSaved(true);
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
            onClick={(event) => preparing && event.preventDefault()}
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
            onClick={(event) => preparing && event.preventDefault()}
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
            共有リンクを作成できませんでした。画像の保存はそのまま使えます。
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
