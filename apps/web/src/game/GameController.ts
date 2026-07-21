import { DuelGame, SurvivalGame, TutorialGame } from "@type-burst/game-core";
import type {
  Attribute,
  CpuDifficulty,
  DuelSnapshot,
  DuelSummary,
  GameEvent,
  SurvivalDifficulty,
  SurvivalSnapshot,
  SurvivalSummary,
  TutorialSnapshot,
} from "@type-burst/game-core";
import { GARBAGE_PHRASES, PHRASES, buildThemedPhrasePool, type VocabThemeId } from "@type-burst/phrase-content";
import { TypingAutomaton } from "@type-burst/typing-engine";
import {
  BoardRenderer,
  MAIN_RENDERER_OPTIONS,
  MINI_RENDERER_OPTIONS,
  type AttributePalette,
  type FrameMeta,
} from "../render/BoardRenderer";
import { SoundEngine } from "../audio/SoundEngine";

export type GameMode =
  | { type: "survival"; difficulty: SurvivalDifficulty; theme?: VocabThemeId }
  | { type: "duel"; difficulty: CpuDifficulty }
  | { type: "tutorial" };

export type GameResult =
  | { mode: "survival"; summary: SurvivalSummary }
  | { mode: "duel"; summary: DuelSummary };

export type AnySnapshot = SurvivalSnapshot | DuelSnapshot | TutorialSnapshot;

export interface GameControllerOptions {
  canvas: HTMLCanvasElement;
  /** DUEL のときの CPU ミニ盤面 */
  cpuCanvas: HTMLCanvasElement | null;
  mode: GameMode;
  sound: SoundEngine;
  reducedMotion: boolean;
  highContrast: boolean;
  fontScale: number;
  /** 盤面カラーテーマ(D-055)。解放判定・High Contrast時のフォールバックは
   * 呼び出し側(App)で解決済みの配色をそのまま受け取る */
  attributeColors: Record<Attribute, AttributePalette>;
  onSnapshot: (snapshot: AnySnapshot) => void;
  onFinish: (result: GameResult) => void;
  onImeDetected: () => void;
}

/**
 * ゲームロジックと描画・音・キーボードをつなぐ。ゲームルールはここに書かない。
 */
export class GameController {
  private readonly game: SurvivalGame | DuelGame | TutorialGame;
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
        ? new SurvivalGame(
            seed,
            buildThemedPhrasePool(options.mode.theme ?? "all", PHRASES),
            GARBAGE_PHRASES,
            options.mode.difficulty,
          )
        : options.mode.type === "duel"
          ? // DUEL は常に「おまかせ」を使う(テーマは未継承。CPU側のバランス調整済みプールを
            // プレイヤーごとに変えると対戦の公平性の検証が複雑になるため、単純さを優先した)
            new DuelGame(seed, PHRASES, GARBAGE_PHRASES, options.mode.difficulty)
          : new TutorialGame(PHRASES, GARBAGE_PHRASES);
    this.renderer = new BoardRenderer(options.canvas, MAIN_RENDERER_OPTIONS);
    this.renderer.reducedMotion = options.reducedMotion;
    this.renderer.highContrast = options.highContrast;
    this.renderer.fontScale = options.fontScale;
    this.renderer.attributeColors = options.attributeColors;
    this.cpuRenderer =
      options.cpuCanvas && options.mode.type === "duel"
        ? new BoardRenderer(options.cpuCanvas, MINI_RENDERER_OPTIONS)
        : null;
    if (this.cpuRenderer) {
      this.cpuRenderer.reducedMotion = options.reducedMotion;
      this.cpuRenderer.highContrast = options.highContrast;
      this.cpuRenderer.fontScale = options.fontScale;
      this.cpuRenderer.attributeColors = options.attributeColors;
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
    if (snapshot.mode === "tutorial" || snapshot.phase !== "ended") return null;
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

  /** チュートリアル専用: 「次へ」ボタンから呼ばれる */
  advanceTutorialStep(): void {
    if (this.game instanceof TutorialGame) {
      this.game.nextStep();
      // 前のステップのポップアップ演出(ALL CLEAR等)を次のステップへ持ち越さない
      this.renderer.clearEffects();
      this.sound.keyTap();
    }
  }

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
      case "feverStarted":
        this.sound.feverStart();
        break;
      case "feverEnded":
        this.sound.feverEnd();
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
