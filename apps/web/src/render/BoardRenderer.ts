import type {
  Attribute,
  BlockView,
  GameEvent,
  GamePhase,
  PlayerSnapshot,
} from "@type-burst/game-core";

export const BOARD_COLS = 6;
export const BOARD_ROWS = 10;
const DANGER_ROW = 8;

export interface RendererOptions {
  cellW: number;
  cellH: number;
  pad: number;
  /** ブロックに文章を描くか(CPUミニ盤面では false) */
  drawText: boolean;
  /** カウントダウン・GO・終了などのオーバーレイを描くか */
  overlays: boolean;
}

export const MAIN_RENDERER_OPTIONS: RendererOptions = {
  cellW: 110,
  cellH: 80,
  pad: 18,
  drawText: true,
  overlays: true,
};

export const MINI_RENDERER_OPTIONS: RendererOptions = {
  cellW: 34,
  cellH: 24,
  pad: 8,
  drawText: false,
  overlays: false,
};

export function canvasSize(opts: RendererOptions): { w: number; h: number } {
  return {
    w: BOARD_COLS * opts.cellW + opts.pad * 2,
    h: BOARD_ROWS * opts.cellH + opts.pad * 2,
  };
}

export interface FrameMeta {
  phase: GamePhase;
  countdownMsLeft: number;
  elapsedMs: number;
  /** 終了時の大テキスト("FINISH!" / "YOU WIN!" / "YOU LOSE…")。null なら非表示 */
  endText: string | null;
  endColor?: string;
}

export interface AttributePalette {
  fill: string;
  bright: string;
  dark: string;
}

interface AttributeStyle extends AttributePalette {
  shape: "triangle" | "circle" | "diamond" | "star";
}

/** 属性ごとの形状(ハイコントラスト時等のため色に依らない識別手段として維持する) */
const ATTRIBUTE_SHAPES: Record<Attribute, AttributeStyle["shape"]> = {
  fire: "triangle",
  water: "circle",
  wind: "diamond",
  light: "star",
};

/**
 * 既定の盤面カラー(D-055で盤面カラーテーマ機能を追加する以前からの配色)。
 * `attributeColors` が未設定の場合や、テーマ解放判定を持たない単体テスト・
 * ミニ盤面などで使うフォールバック。
 */
const DEFAULT_ATTRIBUTE_COLORS: Record<Attribute, AttributePalette> = {
  fire: { fill: "#c2402f", bright: "#ff8a70", dark: "#7c2418" },
  water: { fill: "#1f6dc2", bright: "#6fc0ff", dark: "#123f7a" },
  wind: { fill: "#1f9e74", bright: "#5fe8b6", dark: "#116048" },
  light: { fill: "#c29a1f", bright: "#ffdf70", dark: "#7a5f10" },
};

const GARBAGE_STYLE = { fill: "#4a5164", bright: "#9aa3ba", dark: "#2c3140" };
const BOMB_STYLE = { fill: "#3a3f52", bright: "#ffb054", dark: "#1e2130" };
const PRISM_COLORS = ["#ff8a70", "#6fc0ff", "#5fe8b6", "#ffdf70"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  color: string;
  stroke?: boolean;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  vr: number;
  age: number;
  life: number;
  color: string;
  width: number;
}

interface Vec {
  x: number;
  y: number;
}

interface TextLayout {
  size: number;
  lines: string[];
}

/**
 * 盤面の Canvas 描画。ゲームロジックは持たず、Snapshot と GameEvent だけを見る。
 * メイン盤面と CPU ミニ盤面の両方で使う。
 */
export class BoardRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: RendererOptions;
  private readonly w: number;
  private readonly h: number;
  private displayPos = new Map<number, Vec>();
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private rings: Ring[] = [];
  private shakeAmp = 0;
  private flashAlpha = 0;
  private flashColor = "#ffffff";
  /** 連鎖エスカレーション用ズームパンチ(D-050)。0=通常, 値が大きいほど一瞬拡大する */
  private punchAmp = 0;
  private pulseMs = 0;
  private firstDraw = true;
  private textCache = new Map<string, TextLayout>();
  reducedMotion = false;
  highContrast = false;
  fontScale = 1;
  /**
   * 盤面カラーテーマ(アンロック要素、D-055)。どのテーマを使うか(解放済みか、
   * High Contrast時のフォールバックを適用するか)の判断は呼び出し側
   * (GameController/App)が行い、ここには最終的な配色だけを渡す。
   * これによりBoardRendererは進捗・アンロックの概念を一切知らずに済む。
   */
  attributeColors: Record<Attribute, AttributePalette> = DEFAULT_ATTRIBUTE_COLORS;

  private attributeStyle(attribute: Attribute): AttributeStyle {
    return { ...this.attributeColors[attribute], shape: ATTRIBUTE_SHAPES[attribute] };
  }

  constructor(private readonly canvas: HTMLCanvasElement, opts: RendererOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D コンテキストを取得できません");
    this.ctx = ctx;
    this.opts = opts;
    const { w, h } = canvasSize(opts);
    this.w = w;
    this.h = h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * チュートリアルのステップ切り替え時など、盤面の中身を丸ごと差し替えるタイミングで
   * 前のステップの余韻(ALL CLEAR等のポップアップ・リング演出)が次のステップへ
   * 持ち越されないようにするためのリセット。
   */
  clearEffects(): void {
    this.particles = [];
    this.popups = [];
    this.rings = [];
    this.shakeAmp = 0;
    this.flashAlpha = 0;
    this.punchAmp = 0;
  }

  private cellX(col: number): number {
    return this.opts.pad + col * this.opts.cellW;
  }

  /** row 0 = 最下段 */
  private cellY(row: number): number {
    return this.opts.pad + (BOARD_ROWS - 1 - row) * this.opts.cellH;
  }

  // ------------------------------------------------------------------
  // イベント → 演出
  // ------------------------------------------------------------------

  onEvent(event: GameEvent): void {
    switch (event.type) {
      case "blocksCleared": {
        let cx = 0;
        let cy = 0;
        for (const b of event.blocks) {
          const x = this.cellX(b.col) + this.opts.cellW / 2;
          const y = this.cellY(b.row) + this.opts.cellH / 2;
          cx += x;
          cy += y;
          this.spawnExplosion(x, y, b.attribute, b.kind);
        }
        cx /= event.blocks.length;
        cy /= event.blocks.length;

        if (event.cause === "bomb" || event.cause === "burst") {
          this.rings.push({
            x: cx,
            y: cy,
            r: 8,
            vr: event.cause === "burst" ? 900 : 550,
            age: 0,
            life: 450,
            color: "#ffb054",
            width: event.cause === "burst" ? 10 : 6,
          });
        }
        if (event.cause === "prism") {
          for (let i = 0; i < PRISM_COLORS.length; i++) {
            this.rings.push({
              x: cx,
              y: cy,
              r: 6 + i * 10,
              vr: 480,
              age: 0,
              life: 500,
              color: PRISM_COLORS[i]!,
              width: 4,
            });
          }
        }

        // スコアポップ
        if (this.opts.drawText && event.scoreGained > 0) {
          this.popups.push({
            text: `+${event.scoreGained}`,
            x: cx,
            y: cy + 26,
            age: 0,
            life: 650,
            size: 20,
            color: "#ffd75e",
          });
        }
        // CHAIN 表示
        if (event.chain >= 1 && this.opts.drawText) {
          const size = Math.min(38 + event.chain * 9, 96);
          this.popups.push({
            text: `${event.chain} CHAIN`,
            x: this.w / 2,
            y: this.h * 0.34,
            age: 0,
            life: 800,
            size,
            color: event.chain >= 5 ? "#ffd75e" : "#ffffff",
            stroke: true,
          });
        }

        // フラッシュ・シェイク・ズームパンチ(連鎖エスカレーション演出, D-050)
        // 連鎖が深いほど段階的に派手にし、大連鎖は「ドカーン」と感じる強さにする
        if (!this.reducedMotion) {
          if (event.cause === "burst") this.flash("#ffffff", 0.55);
          else if (event.cause === "bomb") this.flash("#ffb054", 0.3);
          else if (event.cause === "prism") this.flash("#bfa5ff", 0.32);
          else if (event.chain >= 2) this.flash("#ffffff", Math.min(0.55, 0.1 + event.chain * 0.05));

          const baseShake =
            event.cause === "burst" ? 16 : Math.min(2.5 + event.blocks.length * 0.5, 8);
          const chainShake = event.chain > 0 ? event.chain * 1.8 : 0;
          this.shakeAmp = Math.max(this.shakeAmp, baseShake + chainShake);

          if (event.chain >= 2 || event.cause === "burst") {
            const punch = event.cause === "burst" ? 0.24 : Math.min(0.05 * event.chain, 0.34);
            this.punchAmp = Math.max(this.punchAmp, punch);
          }
        }
        break;
      }
      case "phraseCompleted":
        if (event.perfect && this.opts.drawText) {
          this.popups.push({
            text: "PERFECT",
            x: this.w / 2,
            y: this.h * 0.2,
            age: 0,
            life: 550,
            size: 24,
            color: "#8ef5c9",
            stroke: true,
          });
        }
        break;
      case "burstFired":
        if (!this.reducedMotion) {
          this.flash("#ffffff", 0.6);
          this.shakeAmp = Math.max(this.shakeAmp, 18);
        }
        if (this.opts.drawText) {
          this.popups.push({
            text: "TYPE BURST!!",
            x: this.w / 2,
            y: this.h * 0.5,
            age: 0,
            life: 1000,
            size: 52,
            color: "#ffb054",
            stroke: true,
          });
        }
        break;
      case "garbageLanded":
        if (!this.reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, 6);
        if (this.opts.drawText) {
          this.popups.push({
            text: `妨害 +${event.count}`,
            x: this.w / 2,
            y: this.h * 0.14,
            age: 0,
            life: 800,
            size: 24,
            color: "#ff8a70",
            stroke: true,
          });
        }
        break;
      case "garbageCancelled":
        if (this.opts.drawText) {
          this.popups.push({
            text: `相殺 ${event.count}!`,
            x: this.w / 2,
            y: this.h * 0.14,
            age: 0,
            life: 700,
            size: 22,
            color: "#8ef5c9",
            stroke: true,
          });
        }
        break;
      case "allClear":
        if (!this.reducedMotion) {
          this.flash("#8ef5c9", 0.4);
          for (let i = 0; i < 3; i++) {
            this.rings.push({
              x: this.w / 2,
              y: this.h / 2,
              r: 10 + i * 24,
              vr: 700,
              age: 0,
              life: 600,
              color: "#8ef5c9",
              width: 6,
            });
          }
        }
        if (this.opts.drawText) {
          this.popups.push({
            text: "ALL CLEAR!",
            x: this.w / 2,
            y: this.h * 0.44,
            age: 0,
            life: 1100,
            size: 50,
            color: "#8ef5c9",
            stroke: true,
          });
          this.popups.push({
            text: `+${event.bonus}`,
            x: this.w / 2,
            y: this.h * 0.56,
            age: 0,
            life: 1100,
            size: 26,
            color: "#ffd75e",
            stroke: true,
          });
        }
        break;
      case "feverStarted":
        if (!this.reducedMotion) this.flash("#ffd75e", 0.5);
        if (this.opts.drawText) {
          this.popups.push({
            text: "FEVER!!",
            x: this.w / 2,
            y: this.h * 0.42,
            age: 0,
            life: 1000,
            size: 54,
            color: "#ffd75e",
            stroke: true,
          });
        }
        break;
      case "feverEnded":
        if (this.opts.drawText) {
          this.popups.push({
            text: "FEVER END",
            x: this.w / 2,
            y: this.h * 0.3,
            age: 0,
            life: 700,
            size: 24,
            color: "#ffb054",
            stroke: true,
          });
        }
        break;
      case "levelUp":
        if (this.opts.drawText) {
          this.popups.push({
            text: `LEVEL ${event.level}`,
            x: this.w / 2,
            y: this.h * 0.26,
            age: 0,
            life: 900,
            size: 34,
            color: "#6fc0ff",
            stroke: true,
          });
        }
        if (!this.reducedMotion) this.flash("#6fc0ff", 0.14);
        break;
      case "toppedOut":
        if (this.opts.drawText) {
          this.popups.push({
            text: "OVERFLOW!",
            x: this.w / 2,
            y: this.h / 2,
            age: 0,
            life: 1200,
            size: 44,
            color: "#ff8a70",
            stroke: true,
          });
        }
        break;
      default:
        break;
    }
  }

  private flash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  private spawnExplosion(
    x: number,
    y: number,
    attribute: Attribute | null,
    kind: BlockView["kind"],
  ): void {
    let colors: string[];
    if (kind === "bomb") colors = ["#ffb054", "#ff8a70", "#ffffff"];
    else if (kind === "prism") colors = PRISM_COLORS;
    else if (attribute) colors = [this.attributeStyle(attribute).bright, "#ffffff"];
    else colors = [GARBAGE_STYLE.bright, "#ffffff"];

    const scale = this.opts.drawText ? 1 : 0.45;
    const count = Math.round((this.reducedMotion ? 5 : 18) * scale);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (70 + Math.random() * 280) * scale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 70 * scale,
        age: 0,
        life: 450 + Math.random() * 350,
        size: (3 + Math.random() * 5) * scale,
        color: colors[Math.floor(Math.random() * colors.length)]!,
      });
    }
  }

  // ------------------------------------------------------------------
  // 描画
  // ------------------------------------------------------------------

  draw(snapshot: PlayerSnapshot, meta: FrameMeta, dtMs: number): void {
    const ctx = this.ctx;
    this.pulseMs += dtMs;
    ctx.save();
    ctx.clearRect(0, 0, this.w, this.h);

    if (this.shakeAmp > 0.3) {
      ctx.translate(
        (Math.random() * 2 - 1) * this.shakeAmp,
        (Math.random() * 2 - 1) * this.shakeAmp,
      );
      this.shakeAmp *= Math.exp(-dtMs / 100);
    } else {
      this.shakeAmp = 0;
    }

    // ズームパンチ(D-050): 連鎖ヒットで一瞬拡大して素早く戻る。大連鎖スローモー中は
    // さらに一段ズームインしたまま維持し、「魅せる」間を強調する(D-051)
    const bigChainZoom = snapshot.bigChainImpact && !this.reducedMotion ? 0.07 : 0;
    const zoomScale = 1 + this.punchAmp + bigChainZoom;
    if (zoomScale > 1.001) {
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(zoomScale, zoomScale);
      ctx.translate(-this.w / 2, -this.h / 2);
    }
    if (this.punchAmp > 0.002) {
      this.punchAmp *= Math.exp(-dtMs / 90);
    } else {
      this.punchAmp = 0;
    }

    this.drawBackground(snapshot);
    this.drawBlocks(snapshot, dtMs);
    this.drawDangerLine(snapshot);
    this.updateAndDrawParticles(dtMs);
    this.updateAndDrawRings(dtMs);
    this.updateAndDrawPopups(dtMs);
    this.drawDangerVignette(snapshot);
    this.drawBigChainVignette(snapshot);
    this.drawFeverOverlay(snapshot);
    this.drawIncomingWarning(snapshot);
    this.drawFlash(dtMs);
    if (this.opts.overlays) this.drawOverlay(meta);

    ctx.restore();
    this.firstDraw = false;
  }

  private drawBackground(snapshot: PlayerSnapshot): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#101321";
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= BOARD_COLS; c++) {
      const x = this.opts.pad + c * this.opts.cellW;
      ctx.beginPath();
      ctx.moveTo(x, this.opts.pad);
      ctx.lineTo(x, this.opts.pad + BOARD_ROWS * this.opts.cellH);
      ctx.stroke();
    }
    for (let r = 0; r <= BOARD_ROWS; r++) {
      const y = this.opts.pad + r * this.opts.cellH;
      ctx.beginPath();
      ctx.moveTo(this.opts.pad, y);
      ctx.lineTo(this.opts.pad + BOARD_COLS * this.opts.cellW, y);
      ctx.stroke();
    }

    // 行上昇の予告: 下端が脈打つ
    if (snapshot.riseWarningActive) {
      const pulse = 0.35 + 0.3 * Math.sin(this.pulseMs / 90);
      ctx.fillStyle = `rgba(255, 170, 60, ${pulse})`;
      ctx.fillRect(
        this.opts.pad,
        this.opts.pad + BOARD_ROWS * this.opts.cellH - 6,
        BOARD_COLS * this.opts.cellW,
        6,
      );
    }

    // バースト準備完了: 盤面の外周が金色に光る
    if (snapshot.burstReady && !this.reducedMotion) {
      const glow = 0.35 + 0.25 * Math.sin(this.pulseMs / 160);
      ctx.strokeStyle = `rgba(255, 176, 84, ${glow})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, this.w - 4, this.h - 4);
    }

    // フィーバータイム(D-052): 外周がバーストより太く・速く、金↔赤で明滅する
    if (snapshot.feverActive && !this.reducedMotion) {
      const pulse = 0.55 + 0.35 * Math.sin(this.pulseMs / 85);
      const mix = 0.5 + 0.5 * Math.sin(this.pulseMs / 130);
      const r = 255;
      const g = Math.round(140 + mix * 75);
      const b = Math.round(40 + mix * 20);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulse})`;
      ctx.lineWidth = 7;
      ctx.strokeRect(3, 3, this.w - 6, this.h - 6);
    }
  }

  private drawDangerLine(snapshot: PlayerSnapshot): void {
    const ctx = this.ctx;
    const y = this.cellY(DANGER_ROW) + this.opts.cellH;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = snapshot.danger ? "rgba(255,90,70,0.95)" : "rgba(255,90,70,0.35)";
    ctx.beginPath();
    ctx.moveTo(this.opts.pad, y);
    ctx.lineTo(this.opts.pad + BOARD_COLS * this.opts.cellW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.opts.drawText) {
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = snapshot.danger ? "rgba(255,90,70,0.95)" : "rgba(255,90,70,0.45)";
      ctx.fillText("DANGER", this.opts.pad + 4, y - 5);
    }
    ctx.restore();
  }

  private drawDangerVignette(snapshot: PlayerSnapshot): void {
    if (!snapshot.danger || this.reducedMotion) return;
    const ctx = this.ctx;
    const alpha = 0.16 + 0.1 * Math.sin(this.pulseMs / 140);
    const grad = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.42,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.72,
    );
    grad.addColorStop(0, "rgba(255,60,40,0)");
    grad.addColorStop(1, `rgba(255,60,40,${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** 大連鎖スローモー(D-051): 拡張ヒットストップ中だけ縁を金色に絞り、注目を中央へ集める */
  private drawBigChainVignette(snapshot: PlayerSnapshot): void {
    if (!snapshot.bigChainImpact || this.reducedMotion) return;
    const ctx = this.ctx;
    const pulse = 0.3 + 0.14 * Math.sin(this.pulseMs / 55);
    const grad = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.26,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.65,
    );
    grad.addColorStop(0, "rgba(255,200,80,0)");
    grad.addColorStop(1, `rgba(255,140,40,${pulse})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** フィーバータイム(D-052): 盤面全体にごく薄い暖色のティントをかける */
  private drawFeverOverlay(snapshot: PlayerSnapshot): void {
    if (!snapshot.feverActive) return;
    const ctx = this.ctx;
    const alpha = this.reducedMotion ? 0.06 : 0.06 + 0.04 * Math.sin(this.pulseMs / 200);
    ctx.fillStyle = `rgba(255, 150, 40, ${alpha})`;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawIncomingWarning(snapshot: PlayerSnapshot): void {
    if (snapshot.incomingGarbage <= 0) return;
    const ctx = this.ctx;
    const blink = 0.65 + 0.35 * Math.sin(this.pulseMs / 110);
    const size = this.opts.drawText ? 17 : 11;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.font = `900 ${size}px sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ff8a70";
    ctx.fillText(`▼妨害 ${snapshot.incomingGarbage}`, this.w - this.opts.pad - 2, this.opts.pad + 2);
    ctx.restore();
  }

  private drawFlash(dtMs: number): void {
    if (this.flashAlpha <= 0.01) {
      this.flashAlpha = 0;
      return;
    }
    const ctx = this.ctx;
    ctx.globalAlpha = this.flashAlpha;
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    this.flashAlpha *= Math.exp(-dtMs / 110);
  }

  private drawBlocks(snapshot: PlayerSnapshot, dtMs: number): void {
    const alive = new Set<number>();
    const smoothing = 1 - Math.exp(-dtMs / 55);

    for (const block of snapshot.blocks) {
      alive.add(block.id);
      const targetX = this.cellX(block.col);
      const targetY = this.cellY(block.row);
      let pos = this.displayPos.get(block.id);
      if (!pos) {
        // 初期描画は即座に配置、それ以降の新ブロックは盤面の上から降ってくる
        pos = this.firstDraw
          ? { x: targetX, y: targetY }
          : { x: targetX, y: -this.opts.cellH * 1.4 };
        this.displayPos.set(block.id, pos);
      }
      if (this.reducedMotion) {
        pos.x = targetX;
        pos.y = targetY;
      } else {
        pos.x += (targetX - pos.x) * smoothing;
        pos.y += (targetY - pos.y) * smoothing;
      }
      this.drawBlock(block, pos.x, pos.y);
    }

    for (const id of this.displayPos.keys()) {
      if (!alive.has(id)) this.displayPos.delete(id);
    }
  }

  private blockStyle(block: BlockView): { fill: string; bright: string; dark: string } {
    if (block.kind === "bomb") return BOMB_STYLE;
    if (block.kind === "garbage" || block.kind === "prism" || block.attribute === null) {
      return block.kind === "prism"
        ? { fill: "#5a4d8c", bright: "#cbb8ff", dark: "#332b52" }
        : GARBAGE_STYLE;
    }
    return this.attributeStyle(block.attribute);
  }

  private drawBlock(block: BlockView, x: number, y: number): void {
    const ctx = this.ctx;
    const style = this.blockStyle(block);
    const w = this.opts.cellW - 6;
    const h = this.opts.cellH - 6;
    const bx = x + 3;
    const by = y + 3;
    const radius = this.opts.drawText ? 10 : 5;

    ctx.save();

    if (block.state === "clearing") {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, bx - 2, by - 2, w + 4, h + 4, radius);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (block.kind === "prism") {
      const gradient = ctx.createLinearGradient(bx, by, bx, by + h);
      // 4属性の虹グラデーション
      gradient.addColorStop(0, "#ff8a70");
      gradient.addColorStop(0.34, "#ffdf70");
      gradient.addColorStop(0.67, "#5fe8b6");
      gradient.addColorStop(1, "#6fc0ff");
      ctx.fillStyle = gradient;
    } else if (this.highContrast) {
      // グラデーションより単色の方が文字とのコントラストを確保しやすい
      ctx.fillStyle = style.fill;
    } else {
      const gradient = ctx.createLinearGradient(bx, by, bx, by + h);
      gradient.addColorStop(0, style.fill);
      gradient.addColorStop(1, style.dark);
      ctx.fillStyle = gradient;
    }
    roundRect(ctx, bx, by, w, h, radius);
    ctx.fill();

    if (block.kind === "prism") {
      // 文字を読みやすくする内側の暗幕
      ctx.fillStyle = "rgba(16,19,33,0.55)";
      roundRect(ctx, bx + 3, by + 3, w - 6, h - 6, radius - 3);
      ctx.fill();
    }

    if (block.state === "locked") {
      ctx.shadowColor = style.bright;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
    } else if (block.state === "candidate") {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
    } else {
      // High Contrast: 未選択ブロックの枠も常にはっきり見せる
      ctx.strokeStyle = this.highContrast ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.14)";
      ctx.lineWidth = this.highContrast ? 2 : 1;
    }
    roundRect(ctx, bx, by, w, h, radius);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const iconR = this.opts.drawText ? 6 : 3;
    this.drawIcon(block, bx + iconR + 5, by + iconR + 5, iconR, style.bright);

    if (this.opts.drawText) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const layout = this.layoutText(block.displayText, w - 14);
      ctx.font = `bold ${layout.size}px "Yu Gothic", "Hiragino Sans", "Meiryo", sans-serif`;

      const drawLine = (line: string, ly: number): void => {
        if (this.highContrast) {
          // 縁取りでブロック色に関わらず視認性を確保する
          ctx.lineWidth = Math.max(3, layout.size / 6);
          ctx.strokeStyle = "rgba(8,10,20,0.9)";
          ctx.strokeText(line, bx + w / 2, ly, w - 10);
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillText(line, bx + w / 2, ly, w - 10);
      };

      if (layout.lines.length === 1) {
        drawLine(layout.lines[0]!, by + h / 2 + 2);
      } else {
        const lineGap = layout.size + 3;
        drawLine(layout.lines[0]!, by + h / 2 - lineGap / 2 + 2);
        drawLine(layout.lines[1]!, by + h / 2 + lineGap / 2 + 2);
      }

      if ((block.state === "locked" || block.state === "candidate") && block.progress > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(bx + 5, by + h - 10, w - 10, 6);
        ctx.fillStyle = "#ffd75e";
        ctx.fillRect(bx + 5, by + h - 10, (w - 10) * block.progress, 6);
      }
    }

    ctx.restore();
  }

  private drawIcon(block: BlockView, x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.save();
    if (block.kind === "garbage") {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.4;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.35, r * 0.65, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(x - r, y - r * 0.2, r * 2, r * 1.5);
      ctx.restore();
      return;
    }
    if (block.kind === "bomb") {
      // 爆弾: 黒球 + 火花
      ctx.fillStyle = "#1a1d29";
      ctx.beginPath();
      ctx.arc(x, y + r * 0.2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffb054";
      ctx.lineWidth = r * 0.35;
      ctx.beginPath();
      ctx.moveTo(x + r * 0.4, y - r * 0.4);
      ctx.lineTo(x + r, y - r);
      ctx.stroke();
      ctx.fillStyle = "#ffdf70";
      ctx.beginPath();
      ctx.arc(x + r * 1.1, y - r * 1.1, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (block.kind === "prism") {
      // 虹の菱形
      const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      grad.addColorStop(0, "#ff8a70");
      grad.addColorStop(0.5, "#ffdf70");
      grad.addColorStop(1, "#6fc0ff");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r * 1.2, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r * 1.2, y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    const shape = block.attribute ? ATTRIBUTE_SHAPES[block.attribute] : "circle";
    ctx.fillStyle = color;
    ctx.beginPath();
    switch (shape) {
      case "triangle":
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.lineTo(x - r, y + r);
        break;
      case "circle":
        ctx.arc(x, y, r, 0, Math.PI * 2);
        break;
      case "diamond":
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        break;
      case "star": {
        for (let i = 0; i < 10; i++) {
          const radius = i % 2 === 0 ? r * 1.25 : r * 0.5;
          const angle = (Math.PI / 5) * i - Math.PI / 2;
          const px = x + Math.cos(angle) * radius;
          const py = y + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        break;
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 1行で入り切らなければ2行に分けて、できるだけ大きな文字で描く */
  private layoutText(text: string, maxWidth: number): TextLayout {
    const cached = this.textCache.get(text);
    if (cached) return cached;
    const ctx = this.ctx;

    const fits = (t: string, size: number): boolean => {
      ctx.font = `bold ${size}px "Yu Gothic", "Hiragino Sans", "Meiryo", sans-serif`;
      return ctx.measureText(t).width <= maxWidth;
    };

    const maxSize = Math.round(22 * this.fontScale);
    const minSize = Math.round(14 * this.fontScale);
    let layout: TextLayout | null = null;
    for (let size = maxSize; size >= minSize; size -= 1) {
      if (fits(text, size)) {
        layout = { size, lines: [text] };
        break;
      }
    }
    if (!layout) {
      // 2行に分割
      const mid = Math.ceil(text.length / 2);
      const lines = [text.slice(0, mid), text.slice(mid)];
      let size = Math.round(18 * this.fontScale);
      const minTwoLine = Math.round(10 * this.fontScale);
      while (size > minTwoLine && !(fits(lines[0]!, size) && fits(lines[1]!, size))) {
        size -= 1;
      }
      layout = { size, lines };
    }
    this.textCache.set(text, layout);
    return layout;
  }

  private updateAndDrawParticles(dtMs: number): void {
    const ctx = this.ctx;
    const dt = dtMs / 1000;
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.age += dtMs;
      if (p.age >= p.life) continue;
      p.vy += 560 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      next.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = next;
  }

  private updateAndDrawRings(dtMs: number): void {
    const ctx = this.ctx;
    const next: Ring[] = [];
    for (const ring of this.rings) {
      ring.age += dtMs;
      if (ring.age >= ring.life) continue;
      ring.r += (ring.vr * dtMs) / 1000;
      const t = ring.age / ring.life;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      next.push(ring);
    }
    ctx.globalAlpha = 1;
    this.rings = next;
  }

  private updateAndDrawPopups(dtMs: number): void {
    const ctx = this.ctx;
    const next: Popup[] = [];
    for (const popup of this.popups) {
      popup.age += dtMs;
      if (popup.age >= popup.life) continue;
      const t = popup.age / popup.life;
      const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : 1.15 - t * 0.15;
      ctx.save();
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.translate(popup.x, popup.y - t * 30);
      ctx.scale(scale, scale);
      ctx.font = `900 ${popup.size}px "Arial Black", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (popup.stroke !== false) {
        ctx.lineWidth = Math.max(4, popup.size / 8);
        ctx.strokeStyle = "rgba(10,12,24,0.85)";
        ctx.strokeText(popup.text, 0, 0);
      }
      ctx.shadowColor = popup.color;
      ctx.shadowBlur = popup.size >= 36 ? 18 : 0;
      ctx.fillStyle = popup.color;
      ctx.fillText(popup.text, 0, 0);
      ctx.restore();
      next.push(popup);
    }
    this.popups = next;
  }

  private drawOverlay(meta: FrameMeta): void {
    const ctx = this.ctx;
    if (meta.phase === "countdown") {
      ctx.fillStyle = "rgba(10,12,24,0.72)";
      ctx.fillRect(0, 0, this.w, this.h);
      const seconds = Math.max(1, Math.ceil(meta.countdownMsLeft / 1000));
      const frac = 1 - ((meta.countdownMsLeft % 1000) || 1000) / 1000;
      const scale = 1 + frac * 0.25;
      ctx.save();
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(scale, scale);
      ctx.font = "900 110px 'Arial Black', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(seconds), 0, 0);
      ctx.restore();
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText("キーボードの英数入力モードで待機", this.w / 2, this.h / 2 + 96);
    } else if (meta.phase === "playing") {
      if (meta.elapsedMs < 650) {
        ctx.font = "900 72px 'Arial Black', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 1 - meta.elapsedMs / 650;
        ctx.fillStyle = "#8ef5c9";
        ctx.fillText("GO!", this.w / 2, this.h / 2);
        ctx.globalAlpha = 1;
      }
    } else if (meta.phase === "ended" && meta.endText) {
      ctx.fillStyle = "rgba(10,12,24,0.6)";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.font = "900 52px 'Arial Black', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = meta.endColor ?? "#ffffff";
      ctx.shadowBlur = 22;
      ctx.fillStyle = meta.endColor ?? "#ffffff";
      ctx.fillText(meta.endText, this.w / 2, this.h / 2);
      ctx.shadowBlur = 0;
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
