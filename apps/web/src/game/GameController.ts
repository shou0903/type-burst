import { DEFAULT_CONFIG, DuelGame, SurvivalGame, TutorialGame } from "@type-burst/game-core";
import type {
  CpuDifficulty,
  DuelSnapshot,
  DuelSummary,
  GameEvent,
  SurvivalDifficulty,
  SurvivalSnapshot,
  SurvivalSummary,
  TutorialSnapshot,
} from "@type-burst/game-core";
import { GARBAGE_PHRASES, PHRASES } from "@type-burst/phrase-content";
import { TypingAutomaton } from "@type-burst/typing-engine";
import { BoardRenderer, MAIN_RENDERER_OPTIONS, MINI_RENDERER_OPTIONS, type FrameMeta } from "../render/BoardRenderer";
import { SoundEngine } from "../audio/SoundEngine";
import { DAILY_TIME_LIMIT_MS, dailySeed } from "../daily";
import {
  advanceFocusProgress,
  createFocusProgress,
  type FocusGoalId,
  type FocusProgress,
} from "../focusContract";

export type GameMode =
  | { type: "survival"; difficulty: SurvivalDifficulty; focusGoal?: FocusGoalId }
  | { type: "daily"; challengeId: string; ranked: boolean }
  | { type: "duel"; difficulty: CpuDifficulty }
  | { type: "tutorial" };

export type GameResult =
  | { mode: "survival"; summary: SurvivalSummary; focus?: FocusProgress }
  | { mode: "daily"; summary: SurvivalSummary; challengeId: string; ranked: boolean }
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
  onSnapshot: (snapshot: AnySnapshot) => void;
  /** 盤面に重ねない軽量な状態通知(HUDのaria-live等)。キー入力は通知しない。 */
  onPlayerEvent?: (event: GameEvent) => void;
  /** 通常サバイバル限定の今回目標。ゲームルールには影響しない。 */
  onFocusProgress?: (progress: FocusProgress) => void;
  /** 一時停止状態の変化。タブ移動時も自動停止し、復帰は明示操作にする。 */
  onPauseChange?: (paused: boolean) => void;
  /** ゲーム中の終了要求。GameScreen側で確認UIを表示する。 */
  onQuitRequest?: () => void;
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
  private paused = false;
  private pauseInputLocked = false;
  private finishTimeoutId: number | null = null;
  private focusProgress: FocusProgress | null = null;

  constructor(options: GameControllerOptions) {
    this.options = options;
    this.sound = options.sound;
    if (options.mode.type === "survival") {
      this.focusProgress = createFocusProgress(options.mode.focusGoal ?? "perfect-streak");
    }
    const seed =
      options.mode.type === "daily"
        ? dailySeed(options.mode.challengeId)
        : `${options.mode.type}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.game =
      options.mode.type === "survival"
        ? new SurvivalGame(seed, PHRASES, GARBAGE_PHRASES, options.mode.difficulty, DEFAULT_CONFIG, {
            // 盤面を読む楽しさと、TYPE BURSTを溜めて欲張る駆け引きは
            // 通常サバイバルだけに提供する。デイリーは既存の2分ルールを
            // 固定し、DUEL/チュートリアルの競技性・導線を変えない。
            enableChainVision: true,
            enableBurstOvercharge: true,
            enableClutchClear: true,
          })
        : options.mode.type === "daily"
          ? new SurvivalGame(seed, PHRASES, GARBAGE_PHRASES, "normal", DEFAULT_CONFIG, {
              timeLimitMs: DAILY_TIME_LIMIT_MS,
              fullBoardScoreAttack: true,
              // 初級と中級の中間を軸に、標準文と長文も少量混ぜる共通条件。
              tierRatio: { micro: 0.35, short: 0.45, standard: 0.15, long: 0.05 },
              enableChainVision: false,
              enableBurstOvercharge: false,
              enableClutchClear: false,
            })
        : options.mode.type === "duel"
          ? new DuelGame(seed, PHRASES, GARBAGE_PHRASES, options.mode.difficulty)
          : new TutorialGame(PHRASES, GARBAGE_PHRASES);
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
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("blur", this.handleWindowBlur);
    this.lastTime = performance.now();
    if (document.visibilityState === "hidden") this.pause();
    this.rafId = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    if (this.finishTimeoutId !== null) {
      window.clearTimeout(this.finishTimeoutId);
      this.finishTimeoutId = null;
    }
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("paste", this.blockPaste, true);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("blur", this.handleWindowBlur);
  }

  /** ゲーム内の経過時間を止める。再開は呼び出し側の明示操作で行う。 */
  pause(): void {
    if (this.disposed || this.finished || this.paused) return;
    this.paused = true;
    this.lastTime = performance.now();
    this.options.onPauseChange?.(true);
  }

  /** 一時停止中のゲームを完全に再開する。大きなdtを発生させない。 */
  resume(): void {
    if (this.disposed || this.finished || !this.paused) return;
    this.paused = false;
    this.lastTime = performance.now();
    this.options.onPauseChange?.(false);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** 終了確認など、オーバーレイ操作中にPで裏のゲームを再開させない。 */
  setPauseInputLocked(locked: boolean): void {
    this.pauseInputLocked = locked;
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    if (this.paused) {
      // 一時停止中はcoreをadvanceせず、再開時にも非表示時間を持ち込まない。
      this.lastTime = now;
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
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

    // Pはフォーム入力以外ならどこからでも安全に一時停止/再開できる。
    // 入力欄の文字を横取りしないことを優先する。
    if (e.key.toLowerCase() === "p" && !isTextInputTarget(e.target)) {
      e.preventDefault();
      if (this.pauseInputLocked) return;
      if (this.paused) this.resume();
      else this.pause();
      return;
    }

    if (this.paused) {
      // 停止中は文字入力・バースト・選択キャンセルをすべて無視する。
      // チュートリアルのEscだけは終了確認を開けるようにする。
      if (e.key === "Escape" && this.options.mode.type === "tutorial") {
        e.preventDefault();
        this.options.onQuitRequest?.();
      }
      return;
    }

    // チュートリアルはEscで終了確認を開ける。次へボタンにフォーカスが
    // 移っていても、入力欄ではないためキーボードだけで離脱できる。
    if (e.key === "Escape" && this.options.mode.type === "tutorial" && !isTextInputTarget(e.target)) {
      e.preventDefault();
      this.options.onQuitRequest?.();
      return;
    }

    // ゲーム側はwindowでキーを受け取るため、操作ボタン・入力欄へフォーカスが
    // 移ったときにEnter/Esc/文字キーを横取りすると、終了・チュートリアル・
    // ニックネーム入力などのネイティブ操作が壊れる。フォーカス中はブラウザへ
    // 完全に委ね、盤面上でフォーカスがない時だけゲーム入力として扱う。
    if (isInteractiveTarget(e.target)) return;
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
      if (e.key === "Escape" && this.options.mode.type === "tutorial") {
        this.options.onQuitRequest?.();
      } else {
        this.dispatch(this.game.cancelSelection());
      }
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

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.pause();
  };

  private handleWindowBlur = (): void => {
    this.pause();
  };

  /** チュートリアル専用: 「次へ」ボタンから呼ばれる */
  advanceTutorialStep(): void {
    if (!this.paused && this.game instanceof TutorialGame) {
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

    if (this.focusProgress) {
      const nextFocus = advanceFocusProgress(this.focusProgress, event);
      if (nextFocus !== this.focusProgress) {
        this.focusProgress = nextFocus;
        this.options.onFocusProgress?.(nextFocus);
      }
    }

    this.options.onPlayerEvent?.(event);

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
        this.sound.burst(event.tier);
        break;
      case "burstTierChanged":
        if (event.tier === "power" || event.tier === "max") this.sound.burstTier(event.tier);
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
      case "dangerChanged":
        if (event.danger) this.sound.danger();
        break;
      case "clutchClear":
        this.sound.clutchClear(event.depth);
        break;
      case "countdownTick":
        this.sound.countdownTick();
        break;
      case "started":
        this.sound.gameStart();
        break;
      case "survivalFinished":
        if (this.options.mode.type === "daily") {
          this.finish({
            mode: "daily",
            summary: event.summary,
            challengeId: this.options.mode.challengeId,
            ranked: this.options.mode.ranked,
          });
        } else {
          this.finish({
            mode: "survival",
            summary: event.summary,
            ...(this.focusProgress ? { focus: this.focusProgress } : {}),
          });
        }
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
    if (result.mode === "survival" || result.mode === "daily") this.sound.gameFinish();
    else if (result.summary.won) this.sound.win();
    else this.sound.lose();
    // 終了演出を見せてから結果画面へ
    const finishDelay = this.options.reducedMotion ? 50 : 1400;
    this.finishTimeoutId = window.setTimeout(() => {
      this.finishTimeoutId = null;
      if (!this.disposed) this.options.onFinish(result);
    }, finishDelay);
  }

  // ------------------------------------------------------------------
  // 開発検証用フック(DEV ビルドのみ window.__typeblastDebug に載る)
  // ------------------------------------------------------------------

  debugSnapshot(): AnySnapshot {
    return this.game.getSnapshot();
  }

  debugAdvance(ms: number): void {
    if (this.paused) return;
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
    if (this.paused) return;
    for (const key of keys) {
      this.dispatch(this.game.feedKey(key));
    }
  }

  debugBurst(): void {
    if (this.paused) return;
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("button, input, select, textarea, a[href]") !== null
  );
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea");
}
