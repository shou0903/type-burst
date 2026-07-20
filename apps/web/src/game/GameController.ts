import { DuelGame, SurvivalGame } from "@type-blast/game-core";
import type {
  CpuDifficulty,
  DuelSnapshot,
  DuelSummary,
  GameEvent,
  SurvivalSnapshot,
  SurvivalSummary,
} from "@type-blast/game-core";
import { GARBAGE_PHRASES, PHRASES } from "@type-blast/phrase-content";
import { TypingAutomaton } from "@type-blast/typing-engine";
import {
  BoardRenderer,
  MAIN_RENDERER_OPTIONS,
  MINI_RENDERER_OPTIONS,
  type FrameMeta,
} from "../render/BoardRenderer";
import { SoundEngine } from "../audio/SoundEngine";

export type GameMode =
  | { type: "survival" }
  | { type: "duel"; difficulty: CpuDifficulty };

export type GameResult =
  | { mode: "survival"; summary: SurvivalSummary }
  | { mode: "duel"; summary: DuelSummary };

export type AnySnapshot = SurvivalSnapshot | DuelSnapshot;

export interface GameControllerOptions {
  canvas: HTMLCanvasElement;
  /** DUEL のときの CPU ミニ盤面 */
  cpuCanvas: HTMLCanvasElement | null;
  mode: GameMode;
  sound: SoundEngine;
  reducedMotion: boolean;
  highContrast: boolean;
  fontScale: number;
  onSnapshot: (snapshot: AnySnapshot) => void;
  onFinish: (result: GameResult) => void;
  onImeDetected: () => void;
}

/**
 * ゲームロジックと描画・音・キーボードをつなぐ。ゲームルールはここに書かない。
 */
export class GameController {
  private readonly game: SurvivalGame | DuelGame;
  private readonly renderer: BoardRenderer;
  private readonly cpuRenderer: BoardRenderer | null;
  private readonly sound: SoundEngine;
  private readonly options: GameControllerOptions;
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;
  private finished = false;

  constructor(options: GameControllerOptions) {
    this.options = options;
    this.sound = options.sound;
    const seed = `${options.mode.type}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.game =
      options.mode.type === "survival"
        ? new SurvivalGame(seed, PHRASES, GARBAGE_PHRASES)
        : new DuelGame(seed, PHRASES, GARBAGE_PHRASES, options.mode.difficulty);
    this.renderer = new BoardRenderer(options.canvas, MAIN_RENDERER_OPTIONS);
    this.renderer.reducedMotion = options.reducedMotion;
    this.renderer.highContrast = options.highContrast;
    this.renderer.fontScale = options.fontScale;
    this.cpuRenderer =
      options.cpuCanvas && options.mode.type === "duel"
        ? new BoardRenderer(options.cpuCanvas, MINI_RENDERER_OPTIONS)
        : null;
    if (this.cpuRenderer) {
      this.cpuRenderer.reducedMotion = options.reducedMotion;
      this.cpuRenderer.highContrast = options.highContrast;
      this.cpuRenderer.fontScale = options.fontScale;
    }

    if (import.meta.env.DEV) {
      // 開発時のみ: ブラウザコンソールからの動作検証用
      (window as unknown as Record<string, unknown>).__typeblastDebug = this;
    }
  }

  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("paste", this.blockPaste, true);
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("paste", this.blockPaste, true);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(100, Math.max(0, now - this.lastTime));
    this.lastTime = now;

    this.dispatch(this.game.advance(dt));
    this.render(dt);

    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(dt: number): void {
    const snapshot = this.game.getSnapshot();
    const meta: FrameMeta = {
      phase: snapshot.phase,
      countdownMsLeft: snapshot.countdownMsLeft,
      elapsedMs: snapshot.elapsedMs,
      endText: this.endText(snapshot),
      endColor: this.endColor(snapshot),
    };
    this.renderer.draw(snapshot.player, meta, dt);
    if (this.cpuRenderer && snapshot.mode === "duel") {
      this.cpuRenderer.draw(snapshot.cpu, { ...meta, endText: null }, dt);
    }
    this.options.onSnapshot(snapshot);
  }

  private endText(snapshot: AnySnapshot): string | null {
    if (snapshot.phase !== "ended") return null;
    if (snapshot.mode === "survival") return "FINISH!";
    return snapshot.winner === "player" ? "YOU WIN!" : "YOU LOSE…";
  }

  private endColor(snapshot: AnySnapshot): string {
    if (snapshot.mode === "duel" && snapshot.phase === "ended") {
      return snapshot.winner === "player" ? "#8ef5c9" : "#ff8a70";
    }
    return "#ffffff";
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.isComposing || e.key === "Process") {
      this.options.onImeDetected();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.dispatch(this.game.triggerBurst());
      return;
    }
    if (e.key === "Escape" || e.key === "Backspace") {
      e.preventDefault();
      this.dispatch(this.game.cancelSelection());
      return;
    }
    if (/^[a-zA-Z'-]$/.test(e.key)) {
      e.preventDefault();
      this.dispatch(this.game.feedKey(e.key));
    }
  };

  private blockPaste = (e: Event): void => {
    e.preventDefault();
  };

  /** SurvivalGame は GameEvent[]、DuelGame は TaggedEvent[] を返す */
  private dispatch(events: ReturnType<SurvivalGame["advance"]> | ReturnType<DuelGame["advance"]>): void {
    for (const item of events) {
      if ("side" in item) {
        this.processEvent(item.event, item.side);
      } else {
        this.processEvent(item, "player");
      }
    }
  }

  private processEvent(event: GameEvent, side: "player" | "cpu"): void {
    const renderer = side === "player" ? this.renderer : this.cpuRenderer;
    renderer?.onEvent(event);

    if (side === "cpu") {
      // CPU側は重要イベントだけ鳴らす
      switch (event.type) {
        case "garbageLanded":
          this.sound.garbageLand();
          break;
        case "blocksCleared":
          if (event.chain >= 3) this.sound.chainStep(event.chain);
          break;
        default:
          break;
      }
      return;
    }

    switch (event.type) {
      case "keyAccepted":
        this.sound.keyTap();
        break;
      case "keyRejected":
        this.sound.keyMiss();
        break;
      case "targetLocked":
        this.sound.targetLock();
        break;
      case "phraseCompleted":
        if (event.perfect) this.sound.perfect();
        break;
      case "blocksCleared":
        this.sound.explosion(event.chain);
        if (event.chain >= 2) this.sound.chainStep(event.chain);
        break;
      case "burstReady":
        this.sound.burstReady();
        break;
      case "selectionCancelled":
        this.sound.cancel();
        break;
      case "rowDropped":
        this.sound.rowDrop();
        break;
      case "allClear":
        this.sound.allClear();
        break;
      case "levelUp":
        this.sound.levelUp();
        break;
      case "burstFired":
        this.sound.burst();
        break;
      case "garbageSent":
        this.sound.garbageSend();
        break;
      case "garbageLanded":
        this.sound.garbageLand();
        break;
      case "riseWarning":
        this.sound.riseWarning();
        break;
      case "countdownTick":
        this.sound.countdownTick();
        break;
      case "started":
        this.sound.gameStart();
        break;
      case "survivalFinished":
        this.finish({ mode: "survival", summary: event.summary });
        break;
      case "duelFinished":
        this.finish({ mode: "duel", summary: event.summary });
        break;
      default:
        break;
    }
  }

  private finish(result: GameResult): void {
    if (this.finished) return;
    this.finished = true;
    if (result.mode === "survival") this.sound.gameFinish();
    else if (result.summary.won) this.sound.win();
    else this.sound.lose();
    // 終了演出を見せてから結果画面へ
    window.setTimeout(() => {
      if (!this.disposed) this.options.onFinish(result);
    }, 1400);
  }

  // ------------------------------------------------------------------
  // 開発検証用フック(DEV ビルドのみ window.__typeblastDebug に載る)
  // ------------------------------------------------------------------

  debugSnapshot(): AnySnapshot {
    return this.game.getSnapshot();
  }

  debugAdvance(ms: number): void {
    const step = 50;
    let left = ms;
    while (left > 0) {
      const dt = Math.min(step, left);
      left -= dt;
      this.dispatch(this.game.advance(dt));
    }
    this.render(16);
  }

  debugType(keys: string): void {
    for (const key of keys) {
      this.dispatch(this.game.feedKey(key));
    }
  }

  debugBurst(): void {
    this.dispatch(this.game.triggerBurst());
  }

  debugRomajiFor(displayText: string): string | null {
    const snapshot = this.game.getSnapshot();
    const block = snapshot.player.blocks.find((b) => b.displayText === displayText);
    const phrase =
      PHRASES.find((p) => p.displayText === displayText) ??
      GARBAGE_PHRASES.find((p) => p.displayText === displayText);
    if (!block || !phrase) return null;
    return new TypingAutomaton(phrase.readingKana).getCanonicalRomaji();
  }
}
