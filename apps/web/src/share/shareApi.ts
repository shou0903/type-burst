/** 共有カードのアップロードと、各SNSへの受け渡し(D-091)。 */

export interface ShareLink {
  id: string;
  /** 絶対URL。SNSの投稿本文にそのまま載せる */
  url: string;
}

/** OGP画像として保存できる上限に収まるまで品質を落とす */
const JPEG_QUALITIES = [0.9, 0.82, 0.72];
const MAX_BASE64 = 560_000;

export function canvasToJpegBase64(canvas: HTMLCanvasElement): string {
  let encoded = "";
  for (const quality of JPEG_QUALITIES) {
    encoded = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (encoded.length <= MAX_BASE64) return encoded;
  }
  return encoded;
}

export async function createShareLink(
  canvas: HTMLCanvasElement,
  ogTitle: string,
  ogDescription: string,
): Promise<ShareLink> {
  const image = canvasToJpegBase64(canvas);
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, ogTitle, ogDescription }),
  });
  if (!response.ok) throw new Error(`share failed: ${response.status}`);
  const data = (await response.json()) as { id?: string; path?: string };
  if (!data.id || !data.path) throw new Error("share response was malformed");
  return { id: data.id, url: new URL(data.path, window.location.origin).toString() };
}

export function xIntentUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function lineShareUrl(text: string, url: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
    url,
  )}&text=${encodeURIComponent(text)}`;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // revokeが早すぎるとダウンロードが始まらない環境があるため少し待つ
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    },
    "image/jpeg",
    0.92,
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // クリップボードAPIが拒否される環境(権限・非セキュアコンテキスト)向けの退避策
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
