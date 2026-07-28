/**
 * SNS共有カード(1200x630)の描画。
 *
 * 設計方針(D-091):
 * - OG画像はサーバーではなく「クライアントのcanvasで描いてアップロード」する。
 *   @vercel/og(Satori)方式だと日本語フォントを数MB同梱する必要があり、
 *   ニックネームなど任意の日本語を確実に描ける保証がない。クライアントで描けば
 *   OSのフォントがそのまま使えるので、日本語の見栄えとニックネーム表示の
 *   両方が確実になる。
 * - 生成はユーザーが共有を押した時だけ。全リザルトで生成・保存すると
 *   Redisの容量が無駄に膨らむ。
 * - 背景に微細なグレインを載せる。暗い階調のグラデーションはJPEGで
 *   バンディングが出るため、見た目の質感と圧縮対策を兼ねている。
 */

export type ShareAccent = "fire" | "water" | "wind" | "light";

export interface ShareStat {
  label: string;
  value: string;
}

export interface ShareCardData {
  /** 左上のモードラベル(英字) */
  eyebrow: string;
  /** モードラベルの右に添える条件(難易度・日付など) */
  eyebrowSub: string;
  /** 難易度に対応する属性色 */
  accent: ShareAccent;
  /** 六角バッジの中身 */
  badgeLabel: string;
  badgeValue: string;
  /** 主役の数値 */
  headline: string;
  headlineLabel: string;
  /** 下段に並べる指標(2〜4個) */
  stats: ShareStat[];
  nickname: string | null;
}

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

const ACCENTS: Record<ShareAccent, { base: string; bright: string; deep: string; glyph: string }> = {
  fire: { base: "#c2402f", bright: "#ff8a70", deep: "#7c2418", glyph: "▲" },
  water: { base: "#1f6dc2", bright: "#6fc0ff", deep: "#123f7a", glyph: "●" },
  wind: { base: "#1f9e74", bright: "#5fe8b6", deep: "#116048", glyph: "◆" },
  light: { base: "#c29a1f", bright: "#ffdf70", deep: "#7a5f10", glyph: "★" },
};

const INK = "#edf4ff";
const INK_MUTED = "#8a93ad";
const INK_SOFT = "#b9c0d8";

const JP = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
const EN = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const PAD = 64;
const CONTENT_X = 300;
const CONTENT_RIGHT = SHARE_CARD_WIDTH - PAD;
/** 下段のニックネームの最大幅。これ以上伸ばすと属性グリフ列に重なる */
const NICKNAME_MAX_WIDTH = 270;

/** 属性グリフを返す(共有テキスト側でも使う) */
export function accentGlyph(accent: ShareAccent): string {
  return ACCENTS[accent].glyph;
}

export function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): void {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2Dコンテキストを取得できませんでした");
  const accent = ACCENTS[data.accent];

  drawBackground(ctx, accent);
  drawHeader(ctx, data, accent);
  drawBadge(ctx, data, accent);
  drawHeadline(ctx, data, accent);
  drawStats(ctx, data);
  drawFooter(ctx, data, accent);
  drawGrain(ctx);
}

// ------------------------------------------------------------------
// 背景
// ------------------------------------------------------------------

function drawBackground(ctx: CanvasRenderingContext2D, accent: (typeof ACCENTS)[ShareAccent]): void {
  const base = ctx.createLinearGradient(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  base.addColorStop(0, "#0b0f1c");
  base.addColorStop(0.55, "#090c17");
  base.addColorStop(1, "#05070e");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // スコアの背後に属性色の熱を置く。カードの主役がどこかを一瞬で伝える。
  const glow = ctx.createRadialGradient(430, 320, 0, 430, 320, 560);
  glow.addColorStop(0, withAlpha(accent.base, 0.26));
  glow.addColorStop(0.45, withAlpha(accent.deep, 0.14));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // 右上へ抜ける斜めの光条。爆発の余韻を静止画で表現する。
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i += 1) {
    const offset = i * 96;
    const streak = ctx.createLinearGradient(760 + offset, 630, 1180 + offset, -40);
    streak.addColorStop(0, "rgba(0,0,0,0)");
    streak.addColorStop(0.5, withAlpha(accent.bright, 0.05 + i * 0.008));
    streak.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.moveTo(820 + offset, SHARE_CARD_HEIGHT);
    ctx.lineTo(866 + offset, SHARE_CARD_HEIGHT);
    ctx.lineTo(1206 + offset, -40);
    ctx.lineTo(1160 + offset, -40);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  drawEmbers(ctx, accent);

  // 外周のフレーム。SNSのタイムライン上でカードの輪郭を立たせる。
  ctx.strokeStyle = withAlpha(accent.base, 0.32);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, SHARE_CARD_WIDTH - 2, SHARE_CARD_HEIGHT - 2);
  ctx.fillStyle = accent.bright;
  ctx.fillRect(0, 0, 6, SHARE_CARD_HEIGHT);
}

/** 火の粉。乱数は使わず固定配置にして、同じ結果なら常に同じ絵になるようにする。 */
function drawEmbers(ctx: CanvasRenderingContext2D, accent: (typeof ACCENTS)[ShareAccent]): void {
  const embers: Array<[number, number, number, number]> = [
    [128, 128, 3, 0.5], [212, 486, 2, 0.36], [332, 108, 2, 0.4], [268, 566, 3, 0.28],
    [612, 96, 2, 0.34], [700, 556, 3, 0.3], [840, 176, 2, 0.26], [944, 470, 3, 0.34],
    [1052, 120, 2, 0.3], [1104, 372, 4, 0.24], [488, 262, 2, 0.3], [86, 344, 2, 0.4],
    [764, 300, 2, 0.22], [1010, 588, 2, 0.26], [396, 596, 2, 0.24],
  ];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, r, alpha] of embers) {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    halo.addColorStop(0, withAlpha(accent.bright, alpha));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha("#ffffff", alpha * 0.8);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 暗部のバンディング対策を兼ねた微細なグレイン */
function drawGrain(ctx: CanvasRenderingContext2D): void {
  const tile = 128;
  const image = ctx.createImageData(tile, tile);
  let seed = 20260728;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = (seed >>> 24) & 0xff;
    image.data[i] = 255;
    image.data[i + 1] = 255;
    image.data[i + 2] = 255;
    image.data[i + 3] = v > 218 ? 8 : 0;
  }
  const buffer = document.createElement("canvas");
  buffer.width = tile;
  buffer.height = tile;
  buffer.getContext("2d")?.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(buffer, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  ctx.restore();
}

// ------------------------------------------------------------------
// 各パーツ
// ------------------------------------------------------------------

function drawHeader(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
  accent: (typeof ACCENTS)[ShareAccent],
): void {
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 34px ${EN}`;
  const typeWidth = trackedWidth(ctx, "TYPE ", 7);
  drawTracked(ctx, "TYPE ", PAD, 96, 7, INK);
  drawTracked(ctx, "BURST", PAD + typeWidth, 96, 7, accent.bright);

  // モードチップは右寄せ。難易度の属性グリフを添えてゲーム内の語彙と揃える。
  const chipText = `${data.eyebrow}　${accent.glyph} ${data.eyebrowSub}`;
  ctx.font = `700 21px ${JP}`;
  const chipWidth = ctx.measureText(chipText).width + 44;
  const chipX = CONTENT_RIGHT - chipWidth;
  roundRect(ctx, chipX, 58, chipWidth, 48, 24);
  ctx.fillStyle = withAlpha(accent.deep, 0.55);
  ctx.fill();
  ctx.strokeStyle = withAlpha(accent.bright, 0.45);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.fillText(chipText, chipX + chipWidth / 2, 89);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.fillRect(PAD, 128, CONTENT_RIGHT - PAD, 1);
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
  accent: (typeof ACCENTS)[ShareAccent],
): void {
  const cx = 168;
  const cy = 312;
  const r = 92;

  ctx.save();
  ctx.shadowColor = withAlpha(accent.base, 0.6);
  ctx.shadowBlur = 46;
  hexPath(ctx, cx, cy, r);
  const fill = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  fill.addColorStop(0, accent.base);
  fill.addColorStop(1, accent.deep);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  hexPath(ctx, cx, cy, r - 9);
  ctx.fillStyle = "#080b14";
  ctx.fill();
  hexPath(ctx, cx, cy, r - 9);
  ctx.strokeStyle = withAlpha(accent.bright, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = `700 17px ${EN}`;
  drawTrackedCentered(ctx, data.badgeLabel, cx, cy - 26, 3, withAlpha(accent.bright, 0.9));

  // バッジの値は桁数で大きさを変える。「S+」も「128位」も枠に収める。
  const size = data.badgeValue.length <= 2 ? 62 : data.badgeValue.length <= 3 ? 48 : 38;
  ctx.font = `800 ${size}px ${JP}`;
  ctx.fillStyle = INK;
  ctx.fillText(data.badgeValue, cx, cy + 36);
  ctx.textAlign = "left";
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
  accent: (typeof ACCENTS)[ShareAccent],
): void {
  ctx.font = `700 20px ${JP}`;
  drawTracked(ctx, data.headlineLabel, CONTENT_X, 232, 4, INK_MUTED);

  // 主役の数字。桁が増えても右端を割らないよう自動で縮める。
  const maxWidth = CONTENT_RIGHT - CONTENT_X;
  let size = 132;
  ctx.font = `800 ${size}px ${EN}`;
  while (ctx.measureText(data.headline).width > maxWidth && size > 68) {
    size -= 4;
    ctx.font = `800 ${size}px ${EN}`;
  }
  const width = ctx.measureText(data.headline).width;

  ctx.save();
  ctx.shadowColor = withAlpha(accent.bright, 0.45);
  ctx.shadowBlur = 34;
  ctx.fillStyle = INK;
  ctx.fillText(data.headline, CONTENT_X, 352);
  ctx.restore();

  const bar = ctx.createLinearGradient(CONTENT_X, 0, CONTENT_X + width, 0);
  bar.addColorStop(0, accent.bright);
  bar.addColorStop(0.65, accent.base);
  bar.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bar;
  ctx.fillRect(CONTENT_X, 376, width, 7);
}

function drawStats(ctx: CanvasRenderingContext2D, data: ShareCardData): void {
  const stats = data.stats.slice(0, 4);
  if (stats.length === 0) return;
  const cellWidth = (CONTENT_RIGHT - CONTENT_X) / stats.length;

  stats.forEach((stat, index) => {
    const x = CONTENT_X + cellWidth * index;
    if (index > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x - 1, 438, 1, 78);
    }
    ctx.font = `600 19px ${JP}`;
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(stat.label, x + (index > 0 ? 28 : 0), 464);
    ctx.font = `800 42px ${JP}`;
    ctx.fillStyle = INK;
    ctx.fillText(stat.value, x + (index > 0 ? 28 : 0), 512);
  });
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  data: ShareCardData,
  accent: (typeof ACCENTS)[ShareAccent],
): void {
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.fillRect(PAD, 548, CONTENT_RIGHT - PAD, 1);

  // ニックネームは属性グリフ列に重ならない幅で打ち切る。全角12文字を超える
  // ニックネームは 420px 制限だと下段の装飾に食い込むため 270px に抑える。
  if (data.nickname) {
    ctx.font = `700 25px ${JP}`;
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(clip(ctx, data.nickname, NICKNAME_MAX_WIDTH), PAD, 595);
  }

  ctx.textAlign = "right";
  ctx.font = `800 26px ${EN}`;
  ctx.fillStyle = accent.bright;
  ctx.fillText("type-burst.com", CONTENT_RIGHT, 595);

  // 4属性のグリフを並べ、ゲームの語彙をカードの隅に残す。
  // ニックネームの右端とサイトURLの左端のちょうど中間へ置く。
  ctx.textAlign = "center";
  ctx.font = `600 20px ${JP}`;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText("◆　●　★　▲", 628, 595);
  ctx.textAlign = "left";
}

// ------------------------------------------------------------------
// 描画ヘルパー
// ------------------------------------------------------------------

/**
 * 字送りつきのテキスト描画。ctx.letterSpacing は Firefox など未対応の
 * ブラウザがあるため、1文字ずつ描いて自前で送る。
 */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  color: string,
): void {
  ctx.fillStyle = color;
  let cursor = x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

function drawTrackedCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  spacing: number,
  color: string,
): void {
  const previous = ctx.textAlign;
  ctx.textAlign = "left";
  drawTracked(ctx, text, cx - trackedWidth(ctx, text, spacing) / 2, y, spacing, color);
  ctx.textAlign = previous;
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let total = 0;
  for (const char of text) total += ctx.measureText(char).width + spacing;
  return total - spacing;
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
