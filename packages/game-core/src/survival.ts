import type { JapanesePhrase } from "@type-burst/phrase-content";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { PlayerCore } from "./player";
import type {
  GameEvent,
  GamePhase,
  SurvivalDifficulty,
  SurvivalSnapshot,
  SurvivalSummary,
} from "./types";

export interface SurvivalGameOptions {
  /** null/未指定なら従来どおりトップアウトまで続く */
  timeLimitMs?: number | null;
  /** デイリー等で難易度とは別のtier構成を使う場合の上書き */
  tierRatio?: GameConfig["tierRatio"];
}

/**
 * サバイバルモード(1人用)。
 * 通常は行上昇が徐々に加速し、盤面があふれたら終了。
 * デイリー等はoptionsで制限時間を設定できる。
 * 難易度(D-032, D-033, D-039, D-041)は1ブロックあたりの文章の長さ(tierRatio)のみを変え、
 * 行上昇の速さ・盤面サイズは全難易度共通にする(理由はconfig.tsのコメント参照)。
 */
export class SurvivalGame {
  readonly seed: string;
  readonly difficulty: SurvivalDifficulty;
  private readonly config: GameConfig;
  private readonly core: PlayerCore;

  private phase: GamePhase = "countdown";
  private countdownMsLeft: number;
  private lastCountdownSecond: number;
  private elapsedMs = 0;
  private level = 1;
  private readonly timeLimitMs: number | null;
  private finishReason: SurvivalSummary["finishReason"] = "toppedOut";
  private events: GameEvent[] = [];

  constructor(
    seed: string,
    phrases: readonly JapanesePhrase[],
    garbagePhrases: readonly JapanesePhrase[],
    difficulty: SurvivalDifficulty = "normal",
    config: GameConfig = DEFAULT_CONFIG,
    options: SurvivalGameOptions = {},
  ) {
    this.seed = seed;
    this.difficulty = difficulty;
    this.config = config;
    this.timeLimitMs =
      typeof options.timeLimitMs === "number" && options.timeLimitMs > 0
        ? options.timeLimitMs
        : null;
    const profile = config.survivalDifficulty[difficulty];
    this.countdownMsLeft = config.countdownMs;
    this.lastCountdownSecond = Math.ceil(config.countdownMs / 1000);
    // 行上昇(config.survivalRise)は共通のまま、文章の長さ配分だけ難易度で変える(D-033, D-039)
    const effectiveConfig: GameConfig = {
      ...config,
      tierRatio: options.tierRatio ?? profile.tierRatio,
    };
    this.core = new PlayerCore(seed, phrases, garbagePhrases, effectiveConfig, config.survivalRise);
  }

  advance(deltaMs: number): GameEvent[] {
    if (deltaMs < 0) deltaMs = 0;
    if (this.phase === "countdown") {
      this.countdownMsLeft -= deltaMs;
      const second = Math.max(0, Math.ceil(this.countdownMsLeft / 1000));
      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
        if (second > 0) this.events.push({ type: "countdownTick", secondsLeft: second });
      }
      if (this.countdownMsLeft <= 0) {
        this.phase = "playing";
        this.events.push({ type: "started" });
        const leftover = -this.countdownMsLeft;
        this.countdownMsLeft = 0;
        if (leftover > 0) this.advancePlaying(leftover);
      }
    } else if (this.phase === "playing") {
      this.advancePlaying(deltaMs);
    }
    return this.drain();
  }

  private advancePlaying(deltaMs: number): void {
    const remaining =
      this.timeLimitMs === null ? deltaMs : Math.max(0, this.timeLimitMs - this.elapsedMs);
    const appliedDelta = Math.min(deltaMs, remaining);
    this.elapsedMs += appliedDelta;

    // 30秒ごとのレベルアップ(ボーナス加点)
    const newLevel = 1 + Math.floor(this.elapsedMs / this.config.survivalLevel.intervalMs);
    while (this.level < newLevel) {
      this.level += 1;
      const bonus = this.level * this.config.survivalLevel.bonusPerLevel;
      this.core.addScore(bonus);
      this.events.push({ type: "levelUp", level: this.level, bonus });
    }

    this.core.advance(appliedDelta);
    this.events.push(...this.core.drainEvents());
    const reachedTimeLimit = this.timeLimitMs !== null && this.elapsedMs >= this.timeLimitMs;
    if (this.core.toppedOut || reachedTimeLimit) {
      this.finishReason = reachedTimeLimit ? "timeLimit" : "toppedOut";
      this.core.flushResolving();
      this.core.frozen = true;
      this.events.push(...this.core.drainEvents());
      this.phase = "ended";
      this.events.push({ type: "survivalFinished", summary: this.getSummary() });
    }
  }

  feedKey(key: string): GameEvent[] {
    if (this.phase === "playing") {
      this.core.feedKey(key);
      this.events.push(...this.core.drainEvents());
    }
    return this.drain();
  }

  triggerBurst(): GameEvent[] {
    if (this.phase === "playing") {
      this.core.triggerBurst();
      this.events.push(...this.core.drainEvents());
    }
    return this.drain();
  }

  cancelSelection(): GameEvent[] {
    if (this.phase === "playing") {
      this.core.cancelSelection();
      this.events.push(...this.core.drainEvents());
    }
    return this.drain();
  }

  getSnapshot(): SurvivalSnapshot {
    return {
      mode: "survival",
      phase: this.phase,
      countdownMsLeft: this.countdownMsLeft,
      elapsedMs: this.elapsedMs,
      timeLimitMs: this.timeLimitMs,
      level: this.level,
      player: this.core.getSnapshot(),
    };
  }

  getSummary(): SurvivalSummary {
    return {
      ...this.core.getSummary(),
      seed: this.seed,
      survivedMs: this.elapsedMs,
      level: this.level,
      difficulty: this.difficulty,
      timeLimitMs: this.timeLimitMs,
      finishReason: this.finishReason,
    };
  }

  /** テスト・デバッグ用 */
  getCore(): PlayerCore {
    return this.core;
  }

  private drain(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }
}
